"""Action-oriented, deduplicated Telegram notifications for ETI operations."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal


Severity = Literal["success", "waiting", "warning", "critical", "recovered"]
SCHEMA_VERSION = "telegram-notification.v1"
TEST_IDENTIFIERS = ("draft-id", "MEDIA-CRUDE", "PUBLISH-CRUDE")


@dataclass(slots=True)
class NotificationEvent:
    market_date: str
    stream: str
    severity: Severity
    status_code: str
    title: str
    impact: str = ""
    action_required: bool = False
    recommended_action: str = ""
    next_action: str = ""
    retry_at: str | None = None
    article_count: int = 0
    draft_ids: list[str] = field(default_factory=list)
    details: list[str] = field(default_factory=list)
    source_run_id: str = ""
    historical: bool = False
    dry_run: bool = False
    event_id: str = ""
    schema_version: str = SCHEMA_VERSION

    def normalized(self) -> "NotificationEvent":
        if not self.event_id:
            identity = f"{self.market_date}|{self.stream}|{self.status_code}|{self.source_run_id}"
            self.event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, identity))
        self.draft_ids = list(dict.fromkeys(value for value in self.draft_ids if value))
        self.details = list(dict.fromkeys(value for value in self.details if value))
        return self


def _reports_root() -> Path:
    configured = os.getenv("ETI_REPORTS_ROOT", "").strip()
    if configured:
        return Path(configured)
    vault = Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault"))
    return vault / "reports"


def _notification_root() -> Path:
    return _reports_root() / "notifications"


def _now() -> datetime:
    return datetime.now(timezone.utc).astimezone()


def _load_state() -> dict[str, Any]:
    path = _notification_root() / "state.json"
    if not path.is_file():
        return {"schema_version": SCHEMA_VERSION, "events": {}}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"schema_version": SCHEMA_VERSION, "events": {}}
    payload.setdefault("events", {})
    return payload


def _alert_ttl(record: dict[str, Any]) -> timedelta:
    if record.get("severity") == "waiting":
        return timedelta(days=3)
    if record.get("stream") in {"summary", "fact_backfill", "summary_collector"}:
        return timedelta(days=3)
    return timedelta(days=7)


def _expire_stale_records(state: dict[str, Any], *, now: datetime | None = None) -> bool:
    changed = False
    selected_now = now or _now()
    for record in state.get("events", {}).values():
        if not record.get("active"):
            continue
        last_seen_text = str(record.get("last_seen_at") or "").strip()
        if not last_seen_text:
            continue
        try:
            last_seen = datetime.fromisoformat(last_seen_text)
        except ValueError:
            continue
        if last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        if selected_now - last_seen.astimezone(selected_now.tzinfo) <= _alert_ttl(record):
            continue
        record["active"] = False
        record["pending"] = False
        record["expired_at"] = selected_now.isoformat()
        record["resolution_reason"] = "stale_alert_ttl"
        changed = True
    return changed


def _load_reconciled_state() -> dict[str, Any]:
    state = _load_state()
    if _expire_stale_records(state):
        _atomic_json(_notification_root() / "state.json", state)
    return state


def _atomic_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _append_event(event: NotificationEvent, delivery_suppressed: bool) -> None:
    path = _notification_root() / "events" / f"{event.market_date}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {**asdict(event), "recorded_at": _now().isoformat(), "delivery_suppressed": delivery_suppressed}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _fingerprint(event: NotificationEvent) -> str:
    payload = {
        "severity": event.severity, "impact": event.impact,
        "recommended_action": event.recommended_action,
        "details": event.details, "draft_ids": event.draft_ids,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def _dedupe_key(event: NotificationEvent) -> str:
    return f"{event.market_date}:{event.stream}:{event.status_code}"


def _suppressed(event: NotificationEvent) -> bool:
    if event.dry_run or os.getenv("ETI_DISABLE_NOTIFICATIONS", "").strip() == "1":
        return True
    if event.historical:
        active_alert = any(
            record.get("market_date") == event.market_date
            and record.get("stream") == event.stream
            and record.get("active")
            and record.get("severity") in {"warning", "critical", "waiting"}
            for record in _load_reconciled_state().get("events", {}).values()
        )
        if event.severity != "success" or not active_alert:
            return True
    if "unittest" in sys.modules and os.getenv("ETI_ALLOW_TEST_NOTIFICATIONS", "").strip() != "1":
        return True
    text = " ".join([event.title, event.impact, *event.details, *event.draft_ids])
    return any(identifier in text for identifier in TEST_IDENTIFIERS)


def _send_text(text: str) -> tuple[bool, dict[str, Any]]:
    token = os.getenv("ETI_NOTIFY_TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("ETI_NOTIFY_TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        return False, {"error": "telegram_configuration_missing"}
    payload = urllib.parse.urlencode({"chat_id": chat_id, "text": text}).encode("utf-8")
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{token}/sendMessage", data=payload, method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            result = json.load(response)
    except Exception as error:
        return False, {"error": f"{type(error).__name__}: {error}"}
    return bool(result.get("ok")), result


def format_event(event: NotificationEvent, *, recovered: bool = False) -> str:
    icon = {"success": "✅", "waiting": "⏳", "warning": "⚠️", "critical": "🚨", "recovered": "🟢"}[
        "recovered" if recovered else event.severity
    ]
    heading = "ETI 异常已自动恢复" if recovered else event.title
    lines = [f"{icon} {heading}", "", f"日期：{event.market_date}", f"栏目：{event.stream}"]
    if event.impact:
        lines.append(f"影响：{event.impact}")
    if event.article_count:
        lines.append(f"文章数：{event.article_count}")
    if event.draft_ids:
        lines.append(f"草稿ID：{', '.join(event.draft_ids)}")
    if event.details:
        lines.extend(["详情：", *[f"- {detail}" for detail in event.details[:8]]])
    lines.append(f"需要操作：{'是' if event.action_required else '否'}")
    if event.recommended_action:
        lines.append(f"建议：{event.recommended_action}")
    if event.next_action:
        lines.append(f"系统下一步：{event.next_action}")
    if event.retry_at:
        lines.append(f"下次重试：{event.retry_at}")
    return "\n".join(lines)


def emit_event(event: NotificationEvent | dict[str, Any]) -> dict[str, Any]:
    selected = event if isinstance(event, NotificationEvent) else NotificationEvent(**event)
    selected.normalized()
    suppressed = _suppressed(selected)
    _append_event(selected, suppressed)
    if suppressed:
        return {
            "event_id": selected.event_id,
            "delivered": False,
            "suppressed": True,
            "deduplicated": False,
            "recovered": False,
        }
    state = _load_reconciled_state()
    records = state["events"]
    key = _dedupe_key(selected)
    previous = records.get(key, {})
    fingerprint = _fingerprint(selected)
    now = _now()
    last_sent = datetime.fromisoformat(previous["last_sent_at"]) if previous.get("last_sent_at") else None
    throttle = timedelta(hours=24 if selected.severity == "waiting" else 12)
    duplicate = previous.get("fingerprint") == fingerprint
    throttled = duplicate and last_sent is not None and selected.severity in {"waiting", "critical"} and now - last_sent < throttle
    if duplicate and selected.severity not in {"waiting", "critical"}:
        throttled = True

    task_recovery = (
        selected.severity == "success"
        and selected.stream == "system"
        and bool(selected.source_run_id)
    )
    active = [
        record for record in records.values()
        if record.get("stream") == selected.stream
        and record.get("active")
        and record.get("severity") in {"warning", "critical", "waiting"}
        and (
            (
                task_recovery
                and record.get("event", {}).get("source_run_id") == selected.source_run_id
            )
            or (not task_recovery and record.get("market_date") == selected.market_date)
        )
    ]
    recovered = selected.severity == "success" and bool(active)
    text = format_event(selected, recovered=recovered)
    delivered = False
    response: dict[str, Any] = {}
    if not throttled:
        delivered, response = _send_text(text)

    records[key] = {
        "event": asdict(selected), "market_date": selected.market_date, "stream": selected.stream,
        "severity": selected.severity, "fingerprint": fingerprint,
        "active": selected.severity in {"waiting", "warning", "critical"},
        "pending": (
            previous.get("pending", False)
            if throttled
            else not delivered
        ),
        "last_seen_at": now.isoformat(),
        "last_sent_at": now.isoformat() if delivered else previous.get("last_sent_at"),
        "delivery_response": response or previous.get("delivery_response", {}),
    }
    if recovered:
        for record in records.values():
            if record in active:
                record["active"] = False
                record["resolved_at"] = now.isoformat()
    _atomic_json(_notification_root() / "state.json", state)
    return {"event_id": selected.event_id, "delivered": delivered, "suppressed": suppressed, "deduplicated": throttled, "recovered": recovered}


def recover_task_failure(task: str) -> dict[str, Any]:
    state = _load_reconciled_state()
    active = [
        record for record in state.get("events", {}).values()
        if record.get("stream") == "system"
        and record.get("active")
        and record.get("event", {}).get("status_code") == "CRON_TASK_FAILED"
        and record.get("event", {}).get("source_run_id") == task
    ]
    if not active:
        return {
            "delivered": False, "suppressed": True,
            "deduplicated": False, "recovered": False,
        }
    return emit_event(NotificationEvent(
        market_date=_now().date().isoformat(),
        stream="system",
        severity="success",
        status_code="CRON_TASK_RECOVERED",
        title="ETI 定时任务已恢复",
        impact=f"任务 {task} 已恢复正常。",
        action_required=False,
        recommended_action="无需操作。",
        next_action="继续按原定计划运行。",
        details=[f"任务：{task}"],
        source_run_id=task,
    ))


def flush_pending() -> dict[str, int]:
    state = _load_reconciled_state()
    delivered = failed = 0
    for record in state["events"].values():
        if not record.get("pending"):
            continue
        event = NotificationEvent(**record["event"]).normalized()
        ok, response = _send_text(format_event(event))
        record["delivery_response"] = response
        if ok:
            delivered += 1
            record["pending"] = False
            record["last_sent_at"] = _now().isoformat()
        else:
            failed += 1
    _atomic_json(_notification_root() / "state.json", state)
    return {"delivered": delivered, "failed": failed}


def notification_status() -> dict[str, Any]:
    state = _load_reconciled_state()
    records = list(state["events"].values())
    return {
        "active_alerts": [record["event"] for record in records if record.get("active")],
        "pending_count": sum(bool(record.get("pending")) for record in records),
        "last_sent_at": max((record.get("last_sent_at") or "" for record in records), default="") or None,
    }


def send_telegram_message(text: str) -> bool:
    """Backward-compatible raw send; operational callers should use emit_event."""
    if os.getenv("ETI_DISABLE_NOTIFICATIONS", "").strip() == "1":
        return False
    if "unittest" in sys.modules and os.getenv("ETI_ALLOW_TEST_NOTIFICATIONS", "").strip() != "1":
        return False
    return _send_text(text)[0]


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] not in {"emit", "flush", "status", "-h", "--help"}:
        if not send_telegram_message(" ".join(sys.argv[1:])):
            print("Telegram notification was not delivered", flush=True)
        return
    parser = argparse.ArgumentParser(description="Emit and inspect ETI Telegram notifications")
    subparsers = parser.add_subparsers(dest="command")
    emit = subparsers.add_parser("emit")
    emit.add_argument("--event-file", type=Path, required=True)
    subparsers.add_parser("flush")
    subparsers.add_parser("status")
    args = parser.parse_args()
    if args.command == "emit":
        print(json.dumps(emit_event(json.loads(args.event_file.read_text(encoding="utf-8"))), ensure_ascii=False))
    elif args.command == "flush":
        print(json.dumps(flush_pending(), ensure_ascii=False))
    elif args.command == "status":
        print(json.dumps(notification_status(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

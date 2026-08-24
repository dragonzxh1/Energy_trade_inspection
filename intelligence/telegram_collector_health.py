"""Health checks for independently running Telegram collectors."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from intelligence.telegram_notify import NotificationEvent, emit_event


@dataclass(frozen=True)
class CollectorHealth:
    stream: str
    healthy: bool
    last_poll_at: str | None
    last_message_id: int
    consecutive_failures: int
    reason: str | None


def _parse_timestamp(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def inspect_state(
    stream: str,
    state_path: Path,
    *,
    now: datetime | None = None,
    stale_after: timedelta = timedelta(minutes=10),
    failure_limit: int = 3,
) -> CollectorHealth:
    current = now or datetime.now(timezone.utc)
    if not state_path.is_file():
        return CollectorHealth(stream, False, None, 0, 0, "state_file_missing")
    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return CollectorHealth(stream, False, None, 0, 0, "state_file_invalid")
    last_poll = _parse_timestamp(payload.get("last_poll_at"))
    failures = int(payload.get("consecutive_failures") or 0)
    reason = None
    if last_poll is None:
        reason = "poll_timestamp_missing"
    elif current - last_poll.astimezone(timezone.utc) > stale_after:
        reason = "poll_stale"
    elif failures >= failure_limit:
        reason = "consecutive_failures"
    return CollectorHealth(
        stream=stream,
        healthy=reason is None,
        last_poll_at=last_poll.isoformat() if last_poll else None,
        last_message_id=int(payload.get("last_message_id") or 0),
        consecutive_failures=failures,
        reason=reason,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--telegram-root", default="tmp/telegram")
    parser.add_argument("--stale-minutes", type=int, default=10)
    parser.add_argument("--failure-limit", type=int, default=3)
    parser.add_argument("--notify", action="store_true")
    args = parser.parse_args()
    root = Path(args.telegram_root)
    checks = [
        inspect_state(
            "digital",
            root / "state_platts-digits.json",
            stale_after=timedelta(minutes=args.stale_minutes),
            failure_limit=args.failure_limit,
        ),
        inspect_state(
            "summary",
            root / "state_quotes-summary.json",
            stale_after=timedelta(minutes=args.stale_minutes),
            failure_limit=args.failure_limit,
        ),
    ]
    unhealthy = [item for item in checks if not item.healthy]
    if unhealthy and args.notify:
        for item in unhealthy:
            emit_event(NotificationEvent(
                market_date=datetime.now().date().isoformat(),
                stream=item.stream,
                severity="critical",
                status_code="TELEGRAM_COLLECTOR_UNHEALTHY",
                title=f"ETI {item.stream} 采集器异常",
                impact="该内容流可能无法继续接收新资料",
                action_required=True,
                recommended_action="检查对应 systemd 服务和 Telegram 网络连接。",
                next_action="恢复后采集器会从独立游标继续补采。",
                details=[
                    f"原因：{item.reason}",
                    f"最后轮询：{item.last_poll_at or '无'}",
                    f"连续失败：{item.consecutive_failures}",
                    f"最后消息ID：{item.last_message_id}",
                ],
            ))
    print(json.dumps({
        "ok": not unhealthy,
        "collectors": [item.__dict__ for item in checks],
    }, ensure_ascii=False, indent=2))
    if unhealthy:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

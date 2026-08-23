"""Consume historical high-value fact backlog without invoking publication steps."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from psycopg import Connection

from intelligence.telegram_notify import NotificationEvent, emit_event
from .fact_repository import prepare_fact_sections
from .section_granularity import merge_pending_sections
from .runtime_scope import clamp_to_pipeline_start, pipeline_start_date


def _reports_root() -> Path:
    configured = os.getenv("ETI_REPORTS_ROOT", "").strip()
    if configured:
        return Path(configured)
    return Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault")) / "reports"


def eligible_dates(connection: Connection[Any], start: date, end: date) -> list[tuple[date, int]]:
    with connection.cursor() as cursor:
        cursor.execute(
            """SELECT document.market_date,count(*)
               FROM document_sections section
               JOIN source_documents document ON document.id=section.source_document_id
               WHERE document.market_date BETWEEN %s AND %s
                 AND document.source_verified=true AND document.processing_status='parsed'
                 AND document.needs_review=false AND section.dify_eligible=true
                 AND section.fact_extraction_status IN ('pending','failed_retryable')
               GROUP BY document.market_date ORDER BY document.market_date""",
            (start, end),
        )
        return [(row[0], int(row[1])) for row in cursor.fetchall()]


def backlog_counts(connection: Connection[Any], start: date, end: date) -> dict[str, int]:
    with connection.cursor() as cursor:
        cursor.execute(
            """SELECT
              count(*) FILTER(WHERE triage_version IS NULL AND fact_extraction_status IN ('pending','failed_retryable')),
              count(*) FILTER(WHERE document.source_verified=true AND document.processing_status='parsed'
                AND NOT document.needs_review AND dify_eligible=true AND fact_extraction_status IN ('pending','failed_retryable')),
              count(*) FILTER(WHERE document.source_verified=true AND document.processing_status='parsed'
                AND NOT document.needs_review AND dify_eligible=true AND fact_extraction_status IN ('leased','processing')),
              count(*) FILTER(WHERE document.source_verified=true AND document.processing_status='parsed'
                AND NOT document.needs_review AND dify_eligible=true AND fact_extraction_status IN ('failed_retryable','failed_terminal')),
              count(*) FILTER(WHERE fact_extraction_status='completed'),
              count(*) FILTER(WHERE fact_extraction_reason_code='SKIPPED_LOW_EDITORIAL_VALUE'),
              count(*) FILTER(WHERE fact_extraction_reason_code='SKIPPED_DUPLICATE_CONTENT'),
              count(*) FILTER(WHERE fact_extraction_status='needs_review' OR document.needs_review)
            FROM document_sections section JOIN source_documents document
              ON document.id=section.source_document_id
            WHERE document.market_date BETWEEN %s AND %s""",
            (start, end),
        )
        row = cursor.fetchone()
    keys = (
        "untriaged_sections", "eligible_pending_sections", "eligible_processing_sections",
        "eligible_failed_sections", "completed_sections", "skipped_low_value_sections",
        "skipped_duplicate_sections", "needs_review_sections",
    )
    return dict(zip(keys, map(int, row)))


def failure_reason_breakdown(
    connection: Connection[Any], run_ids: list[str],
) -> dict[str, int]:
    if not run_ids:
        return {}
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT CASE
              WHEN fact_extraction_last_error ILIKE
                'all extracted facts failed strict validation:%%'
                THEN 'STRICT_FACT_VALIDATION_FAILED'
              WHEN fact_extraction_reason_code IS NOT NULL
                THEN fact_extraction_reason_code
              ELSE 'UNKNOWN_SECTION_FAILURE'
            END reason_code,
            count(*)
            FROM document_sections
            WHERE last_run_id = ANY(%s)
              AND fact_extraction_status IN ('failed_retryable','failed_terminal')
            GROUP BY 1 ORDER BY 2 DESC,1
            """,
            (run_ids,),
        )
        return {str(row[0]): int(row[1]) for row in cursor.fetchall()}


def attempted_document_count(connection: Connection[Any], run_ids: list[str]) -> int:
    if not run_ids:
        return 0
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT count(DISTINCT source_document_id)
            FROM document_sections
            WHERE last_run_id = ANY(%s)
            """,
            (run_ids,),
        )
        return int(cursor.fetchone()[0])


def pending_validation_dates(
    connection: Connection[Any], start: date, end: date,
) -> list[tuple[date, int]]:
    with connection.cursor() as cursor:
        cursor.execute(
            """SELECT market_date,count(*)
               FROM market_facts
               WHERE market_date BETWEEN %s AND %s
                 AND verification_status='pending' AND is_current=true
               GROUP BY market_date ORDER BY market_date""",
            (start, end),
        )
        return [(row[0], int(row[1])) for row in cursor.fetchall()]


def _failure_reason_text(reason_code: str) -> str:
    labels = {
        "STRICT_FACT_VALIDATION_FAILED": "数字或单位未在证据原句中逐字出现",
        "DIFY_TIMEOUT": "Dify 超时",
        "DIFY_RATE_LIMIT": "Dify 限流",
        "DIFY_SCHEMA_MISSING_FACTS": "Dify 响应缺少 facts",
        "DIFY_SCHEMA_INVALID": "Dify 响应不符合 Schema",
        "DIFY_CONTRACT_ALL_REJECTED": "Dify 合同过滤器拒绝了全部模型事实",
        "DATABASE_WRITE_FAILED": "数据库写入失败",
        "FAILED_MAX_RETRIES": "达到最大重试次数",
        "UNKNOWN_SECTION_FAILURE": "未分类失败",
    }
    return labels.get(reason_code, reason_code)


def _summary_from_output(output: str) -> dict[str, Any]:
    for line in reversed(output.splitlines()):
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("run_id"):
            return value
    return {}


def _save_result(payload: dict[str, Any]) -> Path:
    run_id = payload["run_id"]
    path = _reports_root() / "fact_backfill" / "runs" / f"{run_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    latest = path.parent.parent / "latest.json"
    latest.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def _operational_state() -> tuple[Path, dict[str, Any]]:
    path = _reports_root() / "fact_backfill" / "state.json"
    if path.is_file():
        try:
            return path, json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    return path, {"zero_attempt_runs": 0, "last_summary_date": None}


def _save_operational_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill high-value historical fact sections")
    parser.add_argument("--date-from", type=date.fromisoformat, required=True)
    parser.add_argument("--date-to", default="yesterday")
    parser.add_argument("--max-sections", type=int, default=200)
    parser.add_argument("--max-sections-per-document", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=10)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--triage-only", action="store_true")
    args = parser.parse_args()
    end = date.today() - timedelta(days=1) if args.date_to == "yesterday" else date.fromisoformat(args.date_to)
    effective_start = clamp_to_pipeline_start(args.date_from)
    if end < effective_start or args.max_sections < 1:
        parser.error("invalid date range or section budget")
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    started = time.monotonic()
    run_id = f"BACKFILL-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    summaries: list[dict[str, Any]] = []
    with Connection.connect(database_url, autocommit=True) as connection:
        before = backlog_counts(connection, effective_start, end)
        if not args.dry_run:
            triage_counts = prepare_fact_sections(connection, effective_start, end)
            merged_groups = merge_pending_sections(connection, effective_start, end)
        else:
            triage_counts = {"eligible": 0, "skipped": 0}
            merged_groups = 0
        dates = eligible_dates(connection, effective_start, end)
        if args.triage_only:
            after = backlog_counts(connection, effective_start, end)
            print(json.dumps({
                "run_id": run_id, "triage_only": True, "before": before, "after": after,
                "triage": triage_counts, "merged_groups": merged_groups,
            }, ensure_ascii=False, default=str))
            return
    remaining_budget = args.max_sections
    for market_date, initial_count in dates:
        if remaining_budget <= 0 or args.dry_run:
            break
        eligible_remaining = initial_count
        pass_number = 0
        while remaining_budget > 0 and eligible_remaining > 0:
            pass_number += 1
            budget = min(eligible_remaining, remaining_budget)
            child_run_id = (
                f"RUN-{market_date.isoformat()}-BACKFILL-"
                f"{run_id.removeprefix('BACKFILL-')}-P{pass_number:02d}"
            )
            command = [
                sys.executable, "-m", "intelligence.market_pipeline.fact_worker",
                "--date", market_date.isoformat(), "--max-sections", str(budget),
                "--max-sections-per-document", str(args.max_sections_per_document),
                "--batch-size", str(args.batch_size), "--retry-failed",
                "--run-id", child_run_id,
            ]
            completed = subprocess.run(command, text=True, capture_output=True)
            summary = _summary_from_output(completed.stdout)
            summary["returncode"] = completed.returncode
            summary["backfill_pass"] = pass_number
            if completed.stderr:
                summary["stderr"] = completed.stderr[-4000:]
            summaries.append(summary)
            pass_attempted = int(summary.get("attempted_sections", 0))
            remaining_budget -= pass_attempted
            eligible_remaining = int(summary.get("pending_sections", 0))
            if pass_attempted == 0:
                break
    run_ids = [str(item["run_id"]) for item in summaries if item.get("run_id")]
    with Connection.connect(database_url) as connection:
        after = backlog_counts(connection, effective_start, end)
        failure_reasons = failure_reason_breakdown(connection, run_ids)
        documents_attempted = attempted_document_count(connection, run_ids)
        validation_lookback_days = max(
            0, int(os.getenv("FACT_VALIDATION_LOOKBACK_DAYS", "4"))
        )
        validation_start = max(
            effective_start, end - timedelta(days=validation_lookback_days)
        )
        validation_backlog = pending_validation_dates(connection, validation_start, end)
    validation_results: list[dict[str, Any]] = []
    if not args.dry_run:
        for market_date, pending_facts in validation_backlog:
            completed = subprocess.run(
                [
                    sys.executable, "-m", "intelligence.market_pipeline.validation_worker",
                    "--date", market_date.isoformat(),
                ],
                text=True, capture_output=True,
            )
            validation_results.append({
                "market_date": market_date.isoformat(),
                "pending_facts": pending_facts,
                "returncode": completed.returncode,
                "stdout": completed.stdout[-2000:],
                "stderr": completed.stderr[-2000:],
            })
    validation_failures = [
        item for item in validation_results if int(item["returncode"]) != 0
    ]
    attempted = sum(int(item.get("attempted_sections", 0)) for item in summaries)
    completed_count = sum(int(item.get("completed_sections", 0)) for item in summaries)
    failed_retryable = sum(int(item.get("failed_retryable_sections", 0)) for item in summaries)
    failed_terminal = sum(int(item.get("failed_terminal_sections", 0)) for item in summaries)
    failures = failed_retryable + failed_terminal
    payload = {
        "run_id": run_id, "date_range": [effective_start.isoformat(), end.isoformat()],
        "configured_start_date": (
            pipeline_start_date().isoformat() if pipeline_start_date() else None
        ),
        "eligible_before": before["eligible_pending_sections"], "attempted": attempted,
        "completed": completed_count,
        "facts_created": sum(int(item.get("facts_created", 0)) for item in summaries),
        "failed_retryable": failed_retryable, "failed_terminal": failed_terminal,
        "eligible_remaining": after["eligible_pending_sections"],
        "section_failure_rate": round(failures / attempted, 4) if attempted else 0,
        "dify_error_rate": round(failures / attempted, 4) if attempted else 0,
        "failure_reason_breakdown": failure_reasons,
        "documents_attempted": documents_attempted,
        "fair_scheduling_passes": len(summaries),
        "max_sections": args.max_sections,
        "max_sections_per_document": args.max_sections_per_document,
        "draft_generation": "not_applicable",
        "validation_backlog_dates": [
            {"market_date": item.isoformat(), "pending_facts": count}
            for item, count in validation_backlog
        ],
        "validation_window": [validation_start.isoformat(), end.isoformat()],
        "validation_results": validation_results,
        "duration_seconds": round(time.monotonic() - started, 3),
        "before": before, "after": after, "date_runs": summaries, "dry_run": args.dry_run,
        "triage": triage_counts, "merged_groups": merged_groups,
    }
    result_path = _save_result(payload)
    payload["result_path"] = str(result_path)
    print(json.dumps(payload, ensure_ascii=False, default=str))
    if args.dry_run:
        return
    state_path, state = _operational_state()
    state["zero_attempt_runs"] = int(state.get("zero_attempt_runs", 0)) + 1 if attempted == 0 and before["eligible_pending_sections"] else 0
    severity = None
    if validation_failures:
        severity = "critical"
    elif attempted and payload["section_failure_rate"] > 0.2:
        severity = "critical"
    elif state["zero_attempt_runs"] >= 2:
        severity = "warning"
    elif before["eligible_pending_sections"] and after["eligible_pending_sections"] == 0:
        severity = "success"
    elif state.get("last_summary_date") != date.today().isoformat():
        severity = "waiting"
        state["last_summary_date"] = date.today().isoformat()
    _save_operational_state(state_path, state)
    if severity:
        document_count = int(payload["documents_attempted"])
        target_dates = ", ".join(dict.fromkeys(
            str(item.get("market_date_from")) for item in summaries
            if item.get("market_date_from")
        )) or "无"
        reason_details = [
            f"失败原因：{_failure_reason_text(code)} {count} 节"
            for code, count in failure_reasons.items()
        ]
        reason_details.extend(
            f"事实验证失败：{item['market_date']}"
            for item in validation_failures
        )
        emit_event(NotificationEvent(
            market_date=date.today().isoformat(), stream="fact_backfill", severity=severity,
            status_code=("FACT_BACKFILL_HIGH_ERROR" if severity == "critical" else
                         "FACT_BACKFILL_STALLED" if severity == "warning" else
                         "FACT_BACKFILL_COMPLETE" if severity == "success" else "FACT_BACKFILL_PROGRESS"),
            title=("ETI 事实回填异常" if severity in {"critical", "warning"} else
                   "ETI 事实积压已清零" if severity == "success" else "ETI 事实回填进度"),
            impact=(
                f"本轮处理 {attempted} 节（{document_count} 份文档），"
                f"剩余 {after['eligible_pending_sections']} 节。"
            ),
            action_required=severity in {"critical", "warning"},
            recommended_action=(
                "检查失败原因与回填日志。"
                if severity in {"critical", "warning"} else "无需操作。"
            ),
            next_action="独立 Digit 成稿任务将在 07:00 检查已准备好的日期。",
            details=[
                f"处理市场日期：{target_dates}",
                (
                    f"公平调度：{payload['fair_scheduling_passes']} 轮，"
                    f"每份文档每轮最多 {args.max_sections_per_document} 节"
                ),
                f"章节失败率：{payload['section_failure_rate']:.1%}",
                *reason_details,
                "草稿状态：不适用（事实回填任务不创建公众号草稿）",
                f"结果：{result_path}",
            ],
            source_run_id=run_id,
        ))
    if validation_failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

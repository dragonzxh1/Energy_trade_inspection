"""Date-isolated, fairly scheduled source-fact extraction worker."""

from __future__ import annotations

import argparse
import json
import os
import socket
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml
from psycopg import Connection
from psycopg.rows import dict_row

from .contracts import FactType
from .fact_extraction import (
    FACT_EXTRACTION_TASK, bind_and_validate_facts_partial, call_dify_fact_workflow,
    extract_contract_filter,
    fact_extraction_schema_json, parse_fact_extraction_partial,
)
from .fact_repository import (
    claim_fact_sections, create_extraction_run, ensure_fact_runs, finalize_extraction_run,
    increment_section_attempt, mark_section_completed, mark_section_failed,
    mark_section_processing, mark_step_failed, mark_step_running, persist_fact_result,
    prepare_fact_sections, record_extraction_attempt, refresh_fact_run_statuses,
    recover_expired_section_leases,
    renew_run_leases, reopen_terminal_sections,
    reopen_contract_invalid_sections,
)
from .fact_retry import classify_extraction_error, completion_reason, run_with_retry
from .fact_scheduling import extraction_text_for_section
from .section_granularity import merge_pending_sections
from .section_triage import triage_section
from .source_dossier import load_and_persist_source_dossiers
from .runtime_scope import clamp_to_pipeline_start, pipeline_start_date


CONFIG_PATH = Path(__file__).parent.parent / "config" / "fact_worker.yaml"


def load_config() -> dict[str, Any]:
    return yaml.safe_load(CONFIG_PATH.read_text(encoding="utf-8"))["fact_worker"]


def _input_audit(row: dict[str, Any], run_id: str) -> dict[str, Any]:
    extraction_text = extraction_text_for_section(row["section_title"], row["section_text"])
    triage = triage_section(row["section_title"], row["section_text"], row["section_type"])
    return {
        "run_id": run_id, "source_id": row["source_id"], "section_id": row["section_id"],
        "market_date": row["market_date"].isoformat(), "filename": row["attachment_name"],
        "section_title": row["section_title"], "section_type": row["section_type"],
        "section_priority": row["section_priority"], "page_number": row["page_start"],
        "triage": {"score": triage.score, "category": triage.category, "reasons": triage.reasons},
        "text_length": len(row["section_text"]),
        "extraction_text_length": len(extraction_text),
        "mixed_section_focused": extraction_text != row["section_text"],
        "prompt": FACT_EXTRACTION_TASK,
        "schema": fact_extraction_schema_json(),
    }


def _extract_row(
    row: dict[str, Any], *, base_url: str, api_key: str, retry_config: dict[str, Any],
) -> dict[str, Any]:
    extraction_text = extraction_text_for_section(row["section_title"], row["section_text"])
    attempts: list[dict[str, Any]] = []
    retry_feedback: dict[str, str | None] = {"message": None}
    attempt_started = {"value": datetime.now(timezone.utc)}

    def operation() -> tuple[dict[str, Any], str | None, list[Any]]:
        attempt_started["value"] = datetime.now(timezone.utc)
        payload, workflow_run_id = call_dify_fact_workflow(
            base_url=base_url, api_key=api_key, filename=row["attachment_name"],
            market_date=row["market_date"], section_id=row["section_id"],
            section_text=extraction_text, validation_feedback=retry_feedback["message"],
        )
        try:
            contract_filter = extract_contract_filter(payload)
            if contract_filter:
                payload["_dify_contract_filter"] = contract_filter
                decode_error = str(contract_filter.get("decode_error") or "").strip()
                if decode_error:
                    raise ValueError(f"Dify contract filter decode error: {decode_error}")
                model_count = int(contract_filter.get("model_facts_count") or 0)
                accepted_count = int(contract_filter.get("accepted_facts_count") or 0)
                if model_count > 0 and accepted_count == 0:
                    reasons = contract_filter.get("rejections") or []
                    payload.setdefault("_local_validation", {})["contract_rejections"] = reasons
            extraction,schema_rejections = parse_fact_extraction_partial(payload)
            facts,rejected_facts = bind_and_validate_facts_partial(
                extraction, source_id=row["source_id"], section_id=row["section_id"],
                section_text=extraction_text, market_date=row["market_date"],
                published_at=row["published_at"], page_number=row["page_start"],
            )
            all_rejections=[*schema_rejections,*rejected_facts]
            if all_rejections:
                payload.setdefault("_local_validation",{})["rejected_facts"]=all_rejections
        except Exception as error:
            error.raw_payload=payload
            error.workflow_run_id=workflow_run_id
            raise
        return payload, workflow_run_id, facts

    def collect_attempt(
        attempt_number: int, reason_code: str, workflow_run_id: str | None,
        payload: dict[str, Any] | None, error: Exception | None,
    ) -> None:
        if error:
            retry_feedback["message"] = str(error)
        attempts.append({
            "attempt_number": attempt_number, "reason_code": reason_code,
            "workflow_run_id": workflow_run_id, "payload": payload, "error": error,
            "started_at": attempt_started["value"],
            "duration_ms": max(0, int((datetime.now(timezone.utc)-attempt_started["value"]).total_seconds()*1000)),
        })

    try:
        payload, workflow_run_id, facts = run_with_retry(
            operation, max_attempts=retry_config["max_retry_attempts"],
            initial_delay_seconds=retry_config["retry_initial_delay_seconds"],
            backoff_multiplier=retry_config["retry_backoff_multiplier"], on_attempt=collect_attempt,
        )
        return {"payload": payload, "workflow_run_id": workflow_run_id, "facts": facts, "attempts": attempts, "error": None}
    except Exception as error:
        return {"payload": None, "workflow_run_id": None, "facts": [], "attempts": attempts, "error": error}


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


def _run_id(target_from: date, target_to: date) -> str:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    scope = target_from.isoformat() if target_from == target_to else f"{target_from}_{target_to}"
    return f"RUN-{scope}-FACT-{timestamp}-{uuid.uuid4().hex[:6]}"


def connect_fact_database(database_url: str) -> Connection[Any]:
    return Connection.connect(database_url, autocommit=True)


def main() -> None:
    config = load_config()
    parser = argparse.ArgumentParser(description="Extract atomic source facts for an explicit market-date scope")
    parser.add_argument("--date", type=_parse_date)
    parser.add_argument("--date-from", type=_parse_date)
    parser.add_argument("--date-to", type=_parse_date)
    parser.add_argument("--document-id")
    parser.add_argument("--source-id")
    parser.add_argument("--section-id", help="Deprecated compatibility filter; resolve through source/document filters")
    parser.add_argument("--max-sections", "--limit", dest="max_sections", type=int, default=config["default_max_sections"])
    parser.add_argument("--max-sections-per-document", type=int, default=config["max_sections_per_document"])
    parser.add_argument("--batch-size", type=int, default=config["batch_size"])
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--retry-terminal", action="store_true")
    parser.add_argument("--retry-contract-invalid", action="store_true")
    parser.add_argument("--recover-expired-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--run-id")
    args = parser.parse_args()
    if args.date:
        target_from = target_to = args.date
        run_mode = "daily"
    elif args.date_from and args.date_to:
        target_from, target_to = args.date_from, args.date_to
        run_mode = "backfill"
    else:
        parser.error("provide --date or both --date-from and --date-to")
    if target_to < target_from:
        parser.error("--date-to must not precede --date-from")
    configured_start = pipeline_start_date()
    if configured_start and target_to < configured_start:
        print(json.dumps({
            "run_id": args.run_id or _run_id(target_from, target_to),
            "market_date_from": str(target_from),
            "market_date_to": str(target_to),
            "run_status": "skipped_before_pipeline_start",
            "pipeline_start_date": str(configured_start),
            "eligible_sections": 0,
            "attempted_sections": 0,
            "completed_sections": 0,
            "pending_sections": 0,
            "documents_with_eligible_sections": 0,
            "documents_attempted": 0,
            "documents_covered": 0,
            "documents_completed": 0,
            "facts_created": 0,
            "facts_updated": 0,
            "price_facts_created": 0,
            "failed_retryable_sections": 0,
            "failed_terminal_sections": 0,
            "skipped_sections": 0,
            "reason_breakdown": {"SKIPPED_BEFORE_PIPELINE_START_DATE": 1},
        }, ensure_ascii=False))
        return
    target_from = clamp_to_pipeline_start(target_from)
    if args.max_sections < 1 or args.max_sections_per_document < 1 or args.batch_size < 1:
        parser.error("section budgets must be positive")

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    pipeline_mode = os.getenv("MARKET_PIPELINE_MODE", "shadow")
    base_url = os.getenv("DIFY_BASE_URL", "http://127.0.0.1")
    api_key = os.getenv("DIFY_WORKFLOW_API_KEY_EXTRACT", "")
    if not args.dry_run and not args.recover_expired_only and not api_key:
        raise SystemExit("DIFY_WORKFLOW_API_KEY_EXTRACT is required")
    run_id = args.run_id or _run_id(target_from, target_to)
    lease_owner = f"{socket.gethostname()}:{os.getpid()}:{run_id}"
    attempted = facts_created = facts_updated = price_facts_created = failures = 0

    with connect_fact_database(database_url) as connection:
        if args.dry_run:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    SELECT section.section_title,section.section_text,section.section_type,document.id document_id
                    FROM document_sections section JOIN source_documents document
                      ON document.id=section.source_document_id
                    WHERE document.market_date BETWEEN %s AND %s
                      AND document.source_verified AND document.processing_status='parsed'
                      AND NOT document.needs_review AND length(trim(section.section_text))>=80
                      AND section.fact_extraction_status IN ('pending','failed_retryable')
                    """,
                    (target_from, target_to),
                )
                candidates = list(cursor.fetchall())
            decisions = [triage_section(row["section_title"], row["section_text"], row["section_type"]) for row in candidates]
            eligible = sum(decision.dify_eligible for decision in decisions)
            eligible_document_ids = {
                str(row["document_id"]) for row, decision in zip(candidates, decisions) if decision.dify_eligible
            }
            print(json.dumps({"market_date_from":str(target_from),"market_date_to":str(target_to),
                "eligible_sections":eligible,"documents_with_eligible_sections":len(eligible_document_ids),
                "projected_skipped_sections":len(candidates)-eligible,
                "max_sections":args.max_sections,"max_sections_per_document":args.max_sections_per_document,
                "merged_groups":0,"reopened_terminal":0,"reopened_contract_invalid":0,
                "dry_run":True},ensure_ascii=False))
            return
        recovered_expired = recover_expired_section_leases(connection,target_from,target_to)
        if args.recover_expired_only:
            print(json.dumps({"market_date_from":str(target_from),"market_date_to":str(target_to),
                "recovered_expired":recovered_expired,"recover_only":True},ensure_ascii=False))
            return
        ensure_fact_runs(connection, pipeline_mode, target_from, target_to)
        reopened_terminal = reopen_terminal_sections(connection,target_from,target_to) if args.retry_terminal else 0
        reopened_contract_invalid = (
            reopen_contract_invalid_sections(connection,target_from,target_to)
            if args.retry_contract_invalid else 0
        )
        triage_counts = prepare_fact_sections(connection, target_from, target_to)
        merged_groups=merge_pending_sections(connection,target_from,target_to)
        dossier_count = 0
        dossier_date = target_from
        while dossier_date <= target_to:
            dossier_count += len(load_and_persist_source_dossiers(connection, dossier_date, "telegram:platts-digits"))
            dossier_date += timedelta(days=1)

        skipped_non_energy = 0
        create_extraction_run(
            connection, run_id=run_id, market_date_from=target_from, market_date_to=target_to,
            pipeline_mode=pipeline_mode, run_mode=run_mode, lease_owner=lease_owner,
            max_sections=args.max_sections, max_sections_per_document=args.max_sections_per_document,
        )
        rows = claim_fact_sections(
            connection, market_date_from=target_from, market_date_to=target_to,
            document_id=args.document_id, source_id=args.source_id,
            section_id=args.section_id,
            max_sections=args.max_sections, max_sections_per_document=args.max_sections_per_document,
            max_attempts=config["max_retry_attempts"], lease_owner=lease_owner,
            lease_minutes=config["lease_minutes"], run_id=run_id,
            retry_failed=args.retry_failed or args.retry_terminal,
        )
        for batch_start in range(0, len(rows), args.batch_size):
            batch = rows[batch_start:batch_start+args.batch_size]
            renew_run_leases(
                connection,run_id=run_id,lease_owner=lease_owner,
                lease_minutes=config["lease_minutes"],
            )
            contexts: list[dict[str, Any]] = []
            for row in batch:
                attempted += 1
                started_at = datetime.now(timezone.utc)
                mark_section_processing(connection, str(row["document_section_id"]), lease_owner)
                step_id = mark_step_running(connection, row, _input_audit(row, run_id))
                contexts.append({"row": row, "started_at": started_at, "step_id": step_id})
            with ThreadPoolExecutor(max_workers=min(args.batch_size, len(batch))) as executor:
                futures = [
                    executor.submit(_extract_row, context["row"], base_url=base_url, api_key=api_key, retry_config=config)
                    for context in contexts
                ]
                for context, future in zip(contexts, futures):
                    row = context["row"]
                    started_at = context["started_at"]
                    step_id = context["step_id"]
                    result = future.result()
                    for attempt_log in result["attempts"]:
                        if attempt_log["attempt_number"] > 1:
                            increment_section_attempt(connection, str(row["document_section_id"]))
                        record_extraction_attempt(
                            connection, run_id=run_id, section_id=str(row["document_section_id"]),
                            attempt_number=attempt_log["attempt_number"], reason_code=attempt_log["reason_code"],
                            workflow_run_id=attempt_log["workflow_run_id"], raw_response=attempt_log["payload"],
                            error_message=str(attempt_log["error"]) if attempt_log["error"] else None,
                            started_at=attempt_log["started_at"], duration_ms=attempt_log["duration_ms"],
                        )
                    error = result["error"]
                    if error is None:
                        facts = result["facts"]
                        persisted = persist_fact_result(
                            connection, row=row, step_id=step_id, workflow_run_id=result["workflow_run_id"],
                            output_json=result["payload"], facts=facts, started_at=started_at,
                        )
                        mark_section_completed(
                            connection,
                            str(row["document_section_id"]),
                            facts_count=len(facts),
                            reason_code=completion_reason(result["payload"], facts),
                        )
                        facts_created += persisted["created"]
                        facts_updated += persisted["updated"]
                        price_facts_created += persisted["price_created"]
                        print(f"{row['section_id']} facts={len(facts)} run_id={run_id}",flush=True)
                    else:
                        failures += 1
                        reason_code = classify_extraction_error(error)
                        mark_step_failed(connection,step_id=step_id,error_message=str(error),started_at=started_at)
                        mark_section_failed(
                            connection,str(row["document_section_id"]),reason_code=reason_code,
                            error_message=str(error),max_attempts=config["max_retry_attempts"],
                        )
                        print(f"{row['section_id']} failed reason={reason_code}: {error}",flush=True)
        refresh_fact_run_statuses(connection)
        summary = finalize_extraction_run(
            connection,run_id=run_id,market_date_from=target_from,market_date_to=target_to,
            attempted_sections=attempted,facts_created=facts_created,facts_updated=facts_updated,
            price_facts_created=price_facts_created,failed=False,
        )
    output = {key:summary[key] for key in (
        "run_id","market_date_from","market_date_to","eligible_sections","attempted_sections",
        "completed_sections","failed_retryable_sections","failed_terminal_sections",
        "skipped_sections","pending_sections","documents_with_eligible_sections",
        "documents_attempted","documents_covered","documents_completed",
        "facts_created","facts_updated","price_facts_created","run_status",
        "reason_breakdown",
    )}
    output["worker_failures"] = failures
    output["reopened_contract_invalid"] = reopened_contract_invalid
    output["skipped_non_energy"] = skipped_non_energy
    output["source_dossiers"] = dossier_count
    output["triage"] = triage_counts
    output["merged_groups"] = merged_groups
    output["recovered_expired"] = recovered_expired
    print(json.dumps(output,ensure_ascii=False,default=str),flush=True)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

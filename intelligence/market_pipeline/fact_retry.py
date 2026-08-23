"""Strict retry classification for Dify source-fact extraction."""

from __future__ import annotations

import time
from typing import Any, Callable

import httpx


RETRYABLE_REASON_CODES = {
    "DIFY_TIMEOUT", "DIFY_RATE_LIMIT", "DIFY_SCHEMA_MISSING_FACTS",
    "DIFY_SCHEMA_INVALID", "DIFY_NETWORK_ERROR", "DIFY_CONTRACT_ALL_REJECTED",
}


def completion_reason(payload: dict[str, Any], facts: list[Any]) -> str:
    local_rejections = payload.get("_local_validation", {}).get("rejected_facts", [])
    contract_filter = payload.get("_dify_contract_filter", {})
    model_count = int(contract_filter.get("model_facts_count") or 0)
    accepted_count = int(contract_filter.get("accepted_facts_count") or 0)
    if facts and (local_rejections or int(contract_filter.get("rejected_facts_count") or 0) > 0):
        return "COMPLETED_WITH_PARTIAL_REJECTIONS"
    if facts:
        return "COMPLETED_WITH_FACTS"
    if model_count > 0 and accepted_count == 0:
        return "NO_VALID_FACTS_AFTER_FILTER"
    if local_rejections:
        return "NO_VALID_FACTS_AFTER_LOCAL_VALIDATION"
    return "NO_FACTS_FOUND"


def classify_extraction_error(error: Exception) -> str:
    message = str(error).casefold()
    if isinstance(error, httpx.TimeoutException):
        return "DIFY_TIMEOUT"
    if isinstance(error, httpx.HTTPStatusError) and error.response.status_code == 429:
        return "DIFY_RATE_LIMIT"
    if isinstance(error, httpx.TransportError):
        return "DIFY_NETWORK_ERROR"
    if "does not contain a facts array" in message:
        return "DIFY_SCHEMA_MISSING_FACTS"
    if "contract filter rejected all" in message:
        return "DIFY_CONTRACT_ALL_REJECTED"
    if "schema validation" in message or "json" in message:
        return "DIFY_SCHEMA_INVALID"
    if "database" in message or "sql" in message:
        return "DATABASE_WRITE_FAILED"
    return "DIFY_SCHEMA_INVALID"


def run_with_retry(
    operation: Callable[[], tuple[dict[str, Any], str | None, list[Any]]], *,
    max_attempts: int, initial_delay_seconds: float, backoff_multiplier: float,
    on_attempt: Callable[[int, str, str | None, dict[str, Any] | None, Exception | None], None],
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[dict[str, Any], str | None, list[Any]]:
    delay = initial_delay_seconds
    for attempt_number in range(1, max_attempts + 1):
        payload: dict[str, Any] | None = None
        workflow_run_id: str | None = None
        try:
            payload, workflow_run_id, facts = operation()
            reason_code = completion_reason(payload, facts)
            on_attempt(attempt_number, reason_code, workflow_run_id, payload, None)
            return payload, workflow_run_id, facts
        except Exception as error:
            payload = getattr(error,"raw_payload",payload)
            workflow_run_id = getattr(error,"workflow_run_id",workflow_run_id)
            reason_code = classify_extraction_error(error)
            on_attempt(attempt_number, reason_code, workflow_run_id, payload, error)
            if attempt_number >= max_attempts or reason_code not in RETRYABLE_REASON_CODES:
                raise
            sleep(delay)
            delay *= backoff_multiplier
    raise RuntimeError("unreachable retry state")

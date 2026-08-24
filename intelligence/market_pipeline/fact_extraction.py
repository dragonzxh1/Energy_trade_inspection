"""Dify source-fact contract, parsing, evidence checks, and stable IDs."""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import date, datetime
from typing import Any

import httpx
from pydantic import ValidationError

from .contracts import (
    MARKET_FACT_SCHEMA_VERSION,
    FactClass,
    ExtractedFact,
    FactExtractionResult,
    FactRiskLevel,
    FactType,
    MarketFact,
    VerificationStatus,
)


FACT_NAMESPACE = uuid.UUID("ffccfd44-60df-45df-a7d2-321ecf773767")
FACT_EXTRACTION_PROMPT_VERSION = "source-fact-prompt.v7"
THINK_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
FENCE_PATTERN = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


FACT_EXTRACTION_TASK = """Extract atomic facts from raw_text. Return only template_schema JSON.
OMIT facts that break a rule:
1. evidence_text is one exact contiguous raw_text excerpt.
2. One claim each. Split price from price_change.
3. Copy every number, sign and unit verbatim; never calculate, convert or guess.
4. Use schema fact_type only; benchmark is not fact_type.
5. direction: up/down/flat/mixed/unknown, never null.
6. Preserve attribution and uncertainty.
7. Max 12 facts; none means {"facts":[]}. No markdown or think text."""

def fact_extraction_schema_json() -> str:
    return json.dumps(FactExtractionResult.model_json_schema(), ensure_ascii=False)


def strip_model_wrappers(value: str) -> str:
    return FENCE_PATTERN.sub("", THINK_PATTERN.sub("", value or "")).strip()


def _json_candidates(value: str) -> list[str]:
    cleaned = strip_model_wrappers(value)
    candidates = [cleaned]
    for start, end in (("{", "}"), ("[", "]")):
        left, right = cleaned.find(start), cleaned.rfind(end)
        if left >= 0 and right > left:
            candidates.append(cleaned[left : right + 1])
    return candidates


def normalize_dify_outputs(payload: dict[str, Any]) -> dict[str, Any]:
    outputs = payload.get("data", {}).get("outputs", payload.get("outputs", payload))
    if isinstance(outputs, dict) and isinstance(outputs.get("facts"), list):
        normalized = dict(outputs)
        normalized.setdefault("schema_version", MARKET_FACT_SCHEMA_VERSION)
        return normalized
    values = outputs.values() if isinstance(outputs, dict) else [outputs]
    for value in values:
        if isinstance(value, dict) and isinstance(value.get("facts"), list):
            normalized = dict(value)
            normalized.setdefault("schema_version", MARKET_FACT_SCHEMA_VERSION)
            return normalized
        if isinstance(value, list):
            return {"schema_version": MARKET_FACT_SCHEMA_VERSION, "facts": value}
        if isinstance(value, str):
            for candidate in _json_candidates(value):
                try:
                    decoded = json.loads(candidate)
                except json.JSONDecodeError:
                    continue
                if isinstance(decoded, list):
                    return {"schema_version": MARKET_FACT_SCHEMA_VERSION, "facts": decoded}
                if isinstance(decoded, dict) and isinstance(decoded.get("facts"), list):
                    decoded.setdefault("schema_version", MARKET_FACT_SCHEMA_VERSION)
                    return decoded
    raise ValueError("Dify output does not contain a facts array")


def extract_contract_filter(payload: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_dify_outputs(payload)
    value = normalized.get("contract_filter")
    return dict(value) if isinstance(value, dict) else {}


def parse_fact_extraction(payload: dict[str, Any]) -> FactExtractionResult:
    try:
        return FactExtractionResult.model_validate(normalize_dify_outputs(payload))
    except ValidationError as error:
        raise ValueError(f"Dify fact output failed schema validation: {error}") from error


def parse_fact_extraction_partial(payload: dict[str,Any]) -> tuple[FactExtractionResult,list[str]]:
    normalized=normalize_dify_outputs(payload)
    schema_version=normalized.get("schema_version",MARKET_FACT_SCHEMA_VERSION)
    if schema_version!=MARKET_FACT_SCHEMA_VERSION:
        raise ValueError(f"Dify fact output failed schema validation: invalid schema_version {schema_version}")
    accepted: list[ExtractedFact]=[]
    rejected: list[str]=[]
    for index,item in enumerate(normalized["facts"]):
        try: accepted.append(ExtractedFact.model_validate(item))
        except ValidationError as error: rejected.append(f"facts[{index}]: {error}")
    return FactExtractionResult(schema_version=schema_version,facts=accepted),rejected


def _normalized_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def _fact_hash(source_id: str, section_id: str, fact: Any, market_date: date) -> str:
    if fact.value is not None:
        value_role = "value"
        numeric_identity = format(fact.value, ".12g")
        unit_identity = fact.unit or ""
    elif fact.change_value is not None:
        value_role = "change"
        numeric_identity = format(fact.change_value, ".12g")
        unit_identity = fact.change_unit or ""
    else:
        value_role = "text"
        numeric_identity = _normalized_text(fact.evidence_text).casefold()
        unit_identity = ""
    parts = (
        source_id, section_id, market_date.isoformat(), fact.benchmark or "", value_role,
        numeric_identity, unit_identity,
    )
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def bind_and_validate_facts(
    result: FactExtractionResult,
    *,
    source_id: str,
    section_id: str,
    section_text: str,
    market_date: date,
    published_at: datetime | None,
    page_number: int | None,
) -> list[MarketFact]:
    normalized_section = _normalized_text(section_text)
    facts: list[MarketFact] = []
    for extracted in result.facts:
        evidence = _normalized_text(extracted.evidence_text)
        if evidence not in normalized_section:
            raise ValueError(f"evidence_text is not an exact section excerpt: {extracted.evidence_text[:120]}")
        if extracted.fact_type == FactType.PRICE and extracted.value is None:
            raise ValueError("price requires value and its original unit")
        if extracted.fact_type == FactType.PRICE and extracted.change_value is not None:
            raise ValueError("price must not include change_value; emit a separate price_change fact")
        if extracted.fact_type == FactType.PRICE_CHANGE and extracted.change_value is None:
            raise ValueError("price_change requires change_value and its original change_unit")
        if extracted.fact_type == FactType.PRICE_CHANGE and extracted.value is not None:
            raise ValueError("price_change must not include value; emit a separate price fact")
        if extracted.value is not None and extracted.unit is None:
            raise ValueError("numeric value requires its original unit")
        if extracted.value is not None and extracted.unit and extracted.unit.casefold() not in evidence.casefold():
            raise ValueError("numeric unit must appear verbatim in evidence_text")
        if extracted.change_value is not None and extracted.change_unit is None:
            raise ValueError("numeric change_value requires its original change_unit")
        if (
            extracted.change_value is not None
            and extracted.change_unit
            and extracted.change_unit.casefold() not in evidence.casefold()
        ):
            raise ValueError("numeric change_unit must appear verbatim in evidence_text")
        fact_hash = _fact_hash(source_id, section_id, extracted, market_date)
        facts.append(
            MarketFact(
                fact_id=f"FACT-{uuid.uuid5(FACT_NAMESPACE, fact_hash)}", fact_hash=fact_hash,
                source_id=source_id, section_id=section_id, market_date=market_date,
                published_at=published_at, region=extracted.region, country=extracted.country,
                commodity=extracted.commodity, benchmark=extracted.benchmark,
                fact_type=extracted.fact_type, fact_class=FactClass.SOURCE_FACT,
                statement=_normalized_text(extracted.statement), value=extracted.value,
                unit=extracted.unit, change_value=extracted.change_value,
                change_unit=extracted.change_unit, direction=extracted.direction,
                time_basis=extracted.time_basis, evidence_text=extracted.evidence_text,
                page_number=page_number, attribution=extracted.attribution,
                uncertainty=extracted.uncertainty, confidence=extracted.confidence,
                verification_status=VerificationStatus.PENDING, risk_level=FactRiskLevel.NORMAL,
                metadata=extracted.metadata,
            )
        )
    return facts


def bind_and_validate_facts_partial(
    result: FactExtractionResult, **context: Any,
) -> tuple[list[MarketFact],list[str]]:
    accepted: list[MarketFact]=[]
    rejected: list[str]=[]
    for index,extracted in enumerate(result.facts):
        single=FactExtractionResult(schema_version=result.schema_version,facts=[extracted])
        try:
            accepted.extend(bind_and_validate_facts(single,**context))
        except ValueError as error:
            rejected.append(f"facts[{index}]: {error}")
    return accepted,rejected


def build_fact_extraction_task(section_id: str, validation_feedback: str | None = None) -> str:
    correction = ""
    if validation_feedback:
        lowered=validation_feedback.casefold()
        if "input_value=" in lowered or "type=enum" in lowered: feedback_code="INVALID_ENUM"
        elif "exact section excerpt" in lowered: feedback_code="EVIDENCE_NOT_EXACT"
        elif "unit must appear verbatim" in lowered: feedback_code="UNIT_NOT_VERBATIM"
        elif "requires its original unit" in lowered: feedback_code="MISSING_UNIT"
        elif "separate price_change" in lowered or "separate price fact" in lowered:
            feedback_code="PRICE_CHANGE_NOT_ATOMIC"
        elif "price requires value" in lowered or "price_change requires change_value" in lowered:
            feedback_code="MISSING_REQUIRED_NUMBER"
        elif "direction" in lowered: feedback_code="INVALID_DIRECTION"
        else: feedback_code="SCHEMA_INVALID"
        correction=(f"\nFIX {feedback_code}. Re-extract. Exact evidence_text only. "
            "Copy numbers and units. benchmark is not fact_type. "
            "Split price from price_change. Use direction up/down/flat/mixed/unknown. "
            "Omit invalid facts.")
    task = FACT_EXTRACTION_TASK + f"\nsection_id={section_id}." + correction
    if len(task) > 1023:
        raise ValueError("fact extraction task exceeds Dify input limit")
    return task


def call_dify_fact_workflow(
    *,
    base_url: str,
    api_key: str,
    filename: str,
    market_date: date,
    section_id: str,
    section_text: str,
    validation_feedback: str | None = None,
    timeout_seconds: float = 300,
) -> tuple[dict[str, Any], str | None]:
    inputs = {
        "mode": "source_fact",
        "filename": filename,
        "date": market_date.isoformat(),
        "raw_text": section_text,
        "template_id": MARKET_FACT_SCHEMA_VERSION,
        "template_task": build_fact_extraction_task(section_id, validation_feedback),
        "template_schema": fact_extraction_schema_json(),
    }
    response = httpx.post(
        f"{base_url.rstrip('/')}/v1/workflows/run",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"inputs": inputs, "response_mode": "blocking", "user": "market-fact-worker"},
        timeout=timeout_seconds,
    )
    if response.is_error:
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            detail=response.text[:1200]
            raise httpx.HTTPStatusError(
                f"Dify workflow returned HTTP {response.status_code}: {detail}",
                request=error.request,response=error.response,
            ) from error
    payload = response.json()
    workflow_run_id = payload.get("workflow_run_id") or payload.get("data", {}).get("id")
    return payload, workflow_run_id

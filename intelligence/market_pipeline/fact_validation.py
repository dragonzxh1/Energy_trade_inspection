"""Deterministic fact validation, risk classification, and conflict detection."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Iterable

from .contracts import (
    ConflictType,
    FactConflict,
    FactDirection,
    FactRiskLevel,
    FactType,
    FactValidationIssue,
    ValidationSeverity,
)
from .fact_scheduling import DEFAULT_ENERGY_KEYWORDS,is_energy_relevant_section


FACT_VALIDATION_VERSION = "fact-validation.v2"
SUPPORTED_UNITS = {
    "usd/bbl", "usd/mt", "usd/mmbtu", "cents/gal", "eur/mwh", "gbp/therm",
    "barrels", "b/d", "million barrels", "%", "mt", "kt", "million mt",
    "cubic meters", "million cubic meters", "ws points", "usd/day",
    "million barrels a day", "million barrels of crude a day", "billion barrels",
    "barrels a day", "$/mmbtu", "$per barrel", "percent", "points",
}
HIGH_RISK_PATTERNS = (
    r"\bsanction(?:s|ed)?\b", r"\bport (?:closure|closed|shutdown)\b",
    r"\bpipeline (?:rupture|shutdown|disruption|attack)\b", r"\brefinery (?:fire|explosion)\b",
    r"\bmilitary (?:attack|strike|statement)\b", r"\bsupply (?:halt|outage|disruption)\b",
)
CRITICAL_RISK_PATTERNS = (
    r"\bwar\b", r"\bmissile strike\b", r"\bport closed\b",
    r"\bpipeline explosion\b", r"\brefinery explosion\b",
)
NUMBER_PATTERN = re.compile(r"(?<![A-Za-z])[-+]?\d+(?:,\d{3})*(?:\.\d+)?")


@dataclass(frozen=True)
class FactValidationContext:
    source_market_date: date
    telegram_message_date: datetime
    parse_method: str
    source_verified: bool
    section_text: str
    publisher: str | None = None


def _evidence_has_number(evidence: str, value: float) -> bool:
    for token in NUMBER_PATTERN.findall(evidence):
        try:
            parsed = float(token.replace(",", ""))
        except ValueError:
            continue
        if abs(abs(parsed) - abs(value)) <= max(abs(value), 1) * 1e-9:
            return True
    return False


def classify_fact_risk(fact: Any) -> FactRiskLevel:
    text = f"{fact.statement}\n{fact.evidence_text}".casefold()
    direct_event_types = {
        FactType.GEOPOLITICAL_EVENT, FactType.SANCTION, FactType.REFINERY_OUTAGE,
    }
    if fact.fact_type in direct_event_types and any(
        re.search(pattern, text) for pattern in CRITICAL_RISK_PATTERNS
    ):
        return FactRiskLevel.CRITICAL
    if any(re.search(pattern, text) for pattern in HIGH_RISK_PATTERNS):
        return FactRiskLevel.HIGH
    if fact.fact_type in direct_event_types:
        return FactRiskLevel.HIGH
    if fact.fact_type in {FactType.POLICY, FactType.WEATHER}:
        return FactRiskLevel.ELEVATED
    return FactRiskLevel.NORMAL


def validate_fact(fact: Any, context: FactValidationContext) -> tuple[list[FactValidationIssue], FactRiskLevel]:
    issues: list[FactValidationIssue] = []
    evidence = re.sub(r"\s+", " ", fact.evidence_text).strip()
    section = re.sub(r"\s+", " ", context.section_text).strip()
    fact_topic = " ".join(str(value or "") for value in (
        fact.commodity, fact.benchmark, fact.statement, fact.evidence_text,
    ))
    if not is_energy_relevant_section(None, fact_topic, list(DEFAULT_ENERGY_KEYWORDS)):
        issues.append(FactValidationIssue(
            rule_id="content.non_energy", severity=ValidationSeverity.BLOCKING,
            message="Fact is not about an energy or power market.", field_name="commodity",
        ))
    boilerplate = ("all rights reserved", "unauthorized use", "is part of s&p global")
    if fact.fact_type == FactType.SOURCE_COMMENTARY and any(marker in evidence.casefold() for marker in boilerplate):
        issues.append(FactValidationIssue(
            rule_id="content.boilerplate", severity=ValidationSeverity.BLOCKING,
            message="Publisher boilerplate is not a market fact.", field_name="evidence_text",
        ))
    structured_table_evidence=(
        fact.metadata.get("structured_table") is True
        and re.sub(r"\s+"," ",str(fact.metadata.get("table_cell") or "")).strip()==evidence
        and float(fact.metadata.get("table_parse_confidence") or 0)>=0.8
    )
    required_numeric_field = {
        FactType.PRICE: ("value", fact.value),
        FactType.PRICE_CHANGE: ("change_value", fact.change_value),
    }.get(fact.fact_type)
    if required_numeric_field and required_numeric_field[1] is None:
        issues.append(FactValidationIssue(
            rule_id="number.required", severity=ValidationSeverity.BLOCKING,
            message=f"{fact.fact_type.value} requires {required_numeric_field[0]}.",
            field_name=required_numeric_field[0],
        ))
    if evidence not in section and not structured_table_evidence:
        issues.append(FactValidationIssue(
            rule_id="evidence.exact", severity=ValidationSeverity.BLOCKING,
            message="Evidence is not an exact excerpt of the source section.", field_name="evidence_text",
        ))
    for field_name, value, unit in (
        ("value", fact.value, fact.unit), ("change_value", fact.change_value, fact.change_unit),
    ):
        if value is None:
            continue
        if not _evidence_has_number(fact.evidence_text, float(value)):
            issues.append(FactValidationIssue(
                rule_id="number.evidence", severity=ValidationSeverity.BLOCKING,
                message=f"{field_name} is not present in evidence with the same precision.",
                field_name=field_name, actual=str(value),
            ))
        normalized_unit = (unit or "").casefold().strip()
        if not normalized_unit or normalized_unit not in SUPPORTED_UNITS:
            issues.append(FactValidationIssue(
                rule_id="unit.supported", severity=ValidationSeverity.BLOCKING,
                message=f"Unsupported or missing original unit for {field_name}.",
                field_name="unit" if field_name == "value" else "change_unit", actual=unit,
            ))
        table_header=(str(fact.metadata.get("table_header") or "")+" "+str(fact.metadata.get("unit_evidence") or "")).casefold()
        structured_unit_supported=bool(fact.metadata.get("structured_table")) and (
            (normalized_unit=="usd/bbl" and "$/bbl" in table_header)
            or (normalized_unit=="usd/mt" and "$/mt" in table_header)
            or (normalized_unit=="cents/gal" and "\u00a2/gal" in table_header)
        )
        if normalized_unit in SUPPORTED_UNITS and normalized_unit not in evidence.casefold() and not structured_unit_supported:
            issues.append(FactValidationIssue(
                rule_id="unit.evidence", severity=ValidationSeverity.BLOCKING,
                message=f"Unit for {field_name} does not appear in evidence.", actual=unit,
            ))
    if fact.change_value is not None:
        decrease_words = (
            "cut", "fell", "declined", "down", "decreased", "lower",
            "reduced", "curtailed", "dropped", "minus",
        )
        positive_magnitude_down = (
            fact.change_value > 0
            and fact.direction == FactDirection.DOWN
            and any(word in evidence.casefold() for word in decrease_words)
        )
        if fact.change_value > 0 and fact.direction == FactDirection.DOWN and not positive_magnitude_down:
            issues.append(FactValidationIssue(
                rule_id="direction.sign", severity=ValidationSeverity.BLOCKING,
                message="Positive change conflicts with down direction.", field_name="direction",
            ))
        if fact.change_value < 0 and fact.direction == FactDirection.UP:
            issues.append(FactValidationIssue(
                rule_id="direction.sign", severity=ValidationSeverity.BLOCKING,
                message="Negative change conflicts with up direction.", field_name="direction",
            ))
    if fact.market_date != context.source_market_date:
        issues.append(FactValidationIssue(
            rule_id="date.market", severity=ValidationSeverity.BLOCKING,
            message="Fact market_date differs from SourceDocument market_date.", field_name="market_date",
            expected=context.source_market_date.isoformat(), actual=fact.market_date.isoformat(),
        ))
    if abs((fact.market_date - context.telegram_message_date.date()).days) > 370:
        issues.append(FactValidationIssue(
            rule_id="date.telegram_range", severity=ValidationSeverity.WARNING,
            message="Fact date is more than 370 days from Telegram ingestion date.",
        ))
    if fact.benchmark and fact.value is not None and fact.benchmark.casefold() not in evidence.casefold():
        issues.append(FactValidationIssue(
            rule_id="benchmark.evidence", severity=ValidationSeverity.BLOCKING,
            message="Numeric benchmark does not appear in evidence.", field_name="benchmark",
            actual=fact.benchmark,
        ))
    if fact.value is not None and abs(float(fact.value)) > 1_000_000:
        issues.append(FactValidationIssue(
            rule_id="number.extreme", severity=ValidationSeverity.BLOCKING,
            message="Numeric value exceeds the configured sanity range.", field_name="value",
            actual=str(fact.value),
        ))
    if fact.confidence < 0.75:
        issues.append(FactValidationIssue(
            rule_id="confidence.minimum", severity=ValidationSeverity.BLOCKING,
            message="Fact confidence is below 0.75.", field_name="confidence", actual=str(fact.confidence),
        ))
    if not context.source_verified:
        issues.append(FactValidationIssue(
            rule_id="source.verified", severity=ValidationSeverity.BLOCKING,
            message="Source publisher has not been verified.",
        ))
    if context.parse_method in {"image_only", "ocr", "platts_table"} or fact.metadata.get("ocr"):
        issues.append(FactValidationIssue(
            rule_id="source.ocr", severity=ValidationSeverity.BLOCKING,
            message="OCR-derived fact requires manual review.",
        ))
    risk = classify_fact_risk(fact)
    if risk in {FactRiskLevel.HIGH, FactRiskLevel.CRITICAL}:
        publisher_attribution = (
            (context.publisher or "").strip()
            if context.source_verified and (context.publisher or "").strip().casefold() != "unknown"
            else ""
        )
        if not fact.attribution and not publisher_attribution:
            issues.append(FactValidationIssue(
                rule_id="risk.attribution", severity=ValidationSeverity.BLOCKING,
                message="High-risk fact lacks explicit attribution.", field_name="attribution",
            ))
        if risk == FactRiskLevel.CRITICAL:
            issues.append(FactValidationIssue(
                rule_id="risk.manual_review", severity=ValidationSeverity.BLOCKING,
                message="critical fact requires manual review and independent corroboration.",
            ))
        else:
            issues.append(FactValidationIssue(
                rule_id="risk.source_reported", severity=ValidationSeverity.WARNING,
                message="High-risk reporting may be published only with explicit source attribution.",
            ))
    return issues, risk


def _conflict_key(left: Any, right: Any, conflict_type: ConflictType) -> str:
    seed = "\x1f".join(sorted((left.fact_id, right.fact_id))) + f"\x1f{conflict_type.value}"
    return hashlib.sha256(seed.encode("utf-8")).hexdigest()


def detect_fact_conflicts(facts: Iterable[Any]) -> list[FactConflict]:
    facts_list = list(facts)
    conflicts: list[FactConflict] = []
    for index, left in enumerate(facts_list):
        for right in facts_list[index + 1 :]:
            same_market = (
                left.market_date == right.market_date
                and left.fact_type == right.fact_type
                and (left.commodity or "").casefold() == (right.commodity or "").casefold()
                and (left.benchmark or "").casefold() == (right.benchmark or "").casefold()
                and (getattr(left,"region",None) or "").casefold() == (getattr(right,"region",None) or "").casefold()
                and (getattr(left,"time_basis",None) or "").casefold() == (getattr(right,"time_basis",None) or "").casefold()
            )
            if not same_market or left.source_id == right.source_id:
                continue
            left_value = left.value if left.value is not None else left.change_value
            right_value = right.value if right.value is not None else right.change_value
            left_unit = left.unit if left.value is not None else left.change_unit
            right_unit = right.unit if right.value is not None else right.change_unit
            conflict_type: ConflictType | None = None
            details: dict[str, Any] = {}
            comparable_numeric = bool(left.benchmark) and bool(right.benchmark)
            if comparable_numeric and left_value is not None and right_value is not None and left_unit != right_unit:
                conflict_type = ConflictType.UNIT
                details = {"left_unit": left_unit, "right_unit": right_unit}
            elif comparable_numeric and left_value is not None and right_value is not None:
                tolerance = max(abs(float(left_value)), abs(float(right_value)), 1) * 0.005
                if abs(float(left_value) - float(right_value)) > tolerance:
                    conflict_type = ConflictType.VALUE
                    details = {
                        "left_value": float(left_value), "right_value": float(right_value), "unit": left_unit
                    }
            elif (
                left.direction in {FactDirection.UP, FactDirection.DOWN}
                and right.direction in {FactDirection.UP, FactDirection.DOWN}
                and left.direction != right.direction
            ):
                conflict_type = ConflictType.DIRECTION
                details = {"left_direction": left.direction.value, "right_direction": right.direction.value}
            if conflict_type:
                conflicts.append(FactConflict(
                    conflict_type=conflict_type, severity=FactRiskLevel.HIGH,
                    left_fact_id=left.fact_id, right_fact_id=right.fact_id,
                    conflict_key=_conflict_key(left, right, conflict_type), details=details,
                ))
    return conflicts

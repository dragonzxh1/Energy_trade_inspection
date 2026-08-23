"""Deterministic, zero-token ranking of parsed document sections."""

from __future__ import annotations

import re
from dataclasses import dataclass


TRIAGE_VERSION = "section-triage.v2"
ELIGIBLE_CATEGORIES = {
    "price_assessment", "market_summary", "supply_disruption", "refinery_inventory",
    "trade_flow", "sanctions_policy",
}


@dataclass(frozen=True)
class SectionTriage:
    score: int
    category: str
    reasons: tuple[str, ...]
    dify_eligible: bool
    reason_code: str


_BOILERPLATE_TYPES = {"disclaimer", "methodology", "table_of_contents", "advertisement", "header_footer"}
_BOILERPLATE = re.compile(
    r"(?:copyright|all rights reserved|methodology|table of contents|for subscription information|"
    r"for editorial comments|contact us|advertisement|unauthorized use)", re.I,
)
_NUMBER = re.compile(r"(?<![A-Za-z])[-+]?\d+(?:[,. ]\d+)?")
_PRICE_VALUE = re.compile(
    r"(?:[$€£]\s*\d|\d[\d,. ]*\s*(?:usd|cents?|/bbl|/barrel|/mt|/tonne|bbl|mt))", re.I,
)
_PRICE_ACTION = re.compile(r"\b(?:assess(?:ed|ments?)?|bids?|offers?|premium|discount|spread|settled|closed|traded)\b", re.I)
_SUMMARY_HEADING = re.compile(r"(?:market summary|market wrap|highlights|overview|daily summary|commentary)", re.I)
_SUPPLY = re.compile(r"\b(?:outage|shutdown|disruption|force majeure|halted|cut|restart|offline|attack)\b", re.I)
_REFINERY = re.compile(r"\b(?:refinery|refining|inventory|inventories|stocks?|stock draw|stock build|utilization|run rates?)\b", re.I)
_TRADE = re.compile(r"\b(?:shipment|cargo|export|import|tender|freight|vessel|trade flow|loading|discharge)\b", re.I)
_POLICY = re.compile(r"\b(?:sanction|embargo|tariff|quota|regulation|policy|ban|waiver)\b", re.I)
_ENERGY_SUBJECT = re.compile(
    r"\b(?:crude|oil|brent|wti|gasoline|diesel|ulsd|gasoil|jet|kerosene|naphtha|fuel oil|lng|"
    r"natural gas|refinery|opec|barrels?|cargo|tanker|pipeline|petrochemical)\b", re.I,
)


def triage_section(title: str | None, text: str, section_type: str | None = None) -> SectionTriage:
    title_text = (title or "").strip()
    body = (text or "").strip()
    content = f"{title_text}\n{body[:5000]}"
    normalized_type = (section_type or "").casefold()
    if not body:
        return SectionTriage(0, "boilerplate", ("empty_text",), False, "SKIPPED_BOILERPLATE")
    if normalized_type in _BOILERPLATE_TYPES or _BOILERPLATE.search(title_text):
        return SectionTriage(0, "boilerplate", ("boilerplate_marker",), False, "SKIPPED_BOILERPLATE")
    if len(body) < 80:
        return SectionTriage(
            0,
            "low_editorial_value",
            ("below_minimum_text_length",),
            False,
            "SKIPPED_TOO_SHORT",
        )

    has_energy = bool(_ENERGY_SUBJECT.search(content))
    has_number = bool(_NUMBER.search(content))
    candidates: list[tuple[int, str, tuple[str, ...]]] = []
    if has_energy and _PRICE_ACTION.search(content) and _PRICE_VALUE.search(content):
        candidates.append((100, "price_assessment", ("price_action", "price_value", "energy_subject")))
    if has_energy and _SUPPLY.search(content):
        candidates.append((94, "supply_disruption", ("supply_action", "energy_subject")))
    if has_energy and _POLICY.search(content) and (has_number or len(body) >= 180):
        candidates.append((92, "sanctions_policy", ("policy_action", "energy_subject")))
    if has_energy and _REFINERY.search(content) and (has_number or len(body) >= 180):
        candidates.append((88, "refinery_inventory", ("refinery_inventory", "energy_subject")))
    if has_energy and _TRADE.search(content) and (has_number or len(body) >= 180):
        candidates.append((82, "trade_flow", ("trade_action", "energy_subject")))
    if has_energy and _SUMMARY_HEADING.search(f"{title_text}\n{body[:300]}") and len(body) >= 180:
        candidates.append((78, "market_summary", ("summary_heading", "energy_subject")))
    if candidates:
        score, category, reasons = max(candidates, key=lambda item: item[0])
        return SectionTriage(score, category, reasons, True, "ELIGIBLE_HIGH_VALUE")
    if has_energy and (has_number or len(body) >= 300):
        return SectionTriage(50, "general_market_news", ("energy_context",), False, "SKIPPED_LOW_EDITORIAL_VALUE")
    reason = "missing_concrete_evidence" if has_energy else "no_high_value_energy_evidence"
    return SectionTriage(20, "low_editorial_value", (reason,), False, "SKIPPED_NO_CONCRETE_EVIDENCE")

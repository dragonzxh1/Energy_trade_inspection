"""Deterministic reference scheduler used by tests and diagnostics."""

from __future__ import annotations

from collections import defaultdict
from typing import Any


DEFAULT_ENERGY_KEYWORDS = (
    "crude", "oil", "petroleum", "gasoline", "diesel", "gasoil", "jet fuel",
    "kerosene", "naphtha", "fuel oil", "lng", "natural gas", "coal", "refinery",
    "refining", "petrochemical", "barrel", "tanker", "pipeline", "opec", "energy",
    "electricity", "power market", "utility", "solar", "wind power", "battery storage",
    "carbon", "emissions", "biofuel", "sustainable aviation fuel", "propane", "butane",
    "lpg", "ethylene", "aromatics", "brent", "wti", "platts", "argus",
    "electric vehicle", "oil facility", "strait of hormuz", "bab al-mandab",
    "red sea", "suez canal",
)

FINANCIAL_TABLE_MARKERS = (
    "coupon", "yield", "maturity", "high-yield issues", "investment-grade",
    "credit spread", "bond price", "fixed income indices", "treasurys",
    "tracking bond benchmarks", "mortgage-backed",
)

ENERGY_TABLE_START_MARKERS = (
    "weekly demand",
    "weekly supply",
    "natural gas storage",
    "watching the gauges",
    "inventories, imports and demand",
    "crude oil and petroleum",
)


def extraction_text_for_section(title: str | None, text: str) -> str:
    """Focus a mixed market-data section without changing its source evidence."""
    content = f"{title or ''}\n{text}".casefold()
    if sum(marker in content for marker in FINANCIAL_TABLE_MARKERS) < 3:
        return text
    lowered_text = text.casefold()
    starts = [lowered_text.find(marker) for marker in ENERGY_TABLE_START_MARKERS]
    starts = [position for position in starts if position >= 0]
    if not starts:
        return text
    return text[min(starts):].lstrip()


def is_energy_relevant_section(title: str | None, text: str, keywords: list[str]) -> bool:
    content = f"{title or ''}\n{text}".casefold()
    financial_table_markers = FINANCIAL_TABLE_MARKERS + (
        "largest price decrease", "largest price increase",
    )
    core_market_terms = (
        "crude", "lng", "gasoline", "diesel", "gasoil", "jet fuel", "naphtha",
        "fuel oil", "refinery", "barrel", "tanker", "opec", "platts", "argus",
    )
    if sum(marker in content for marker in financial_table_markers) >= 3:
        if sum(term in content for term in core_market_terms) < 2:
            return False
    return any(keyword.casefold() in content for keyword in keywords)


def section_focus(title: str | None, text: str) -> tuple[str, int]:
    content = f"{title or ''}\n{text[:800]}".casefold()
    rules = (
        ("disruption_policy", 1, ("outage", "shutdown", "disruption", "sanction", "policy")),
        ("fundamentals", 2, ("supply", "demand", "inventory", "refinery", "production")),
        ("trade_flow", 3, ("trade flow", "shipment", "cargo", "export", "import", "tender", "freight", "vessel")),
        ("market_summary", 4, ("summary", "overview", "highlights", "market wrap", "commentary")),
        ("price", 0, ("price", "assessment", "derivative", "bid", "offer", "premium", "discount", "spread", "$/")),
    )
    for focus, priority, terms in rules:
        if any(term in content for term in terms):
            return focus, priority
    return "other", 5


def fair_schedule(
    sections: list[dict[str, Any]], *, max_sections: int, max_sections_per_document: int,
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for section in sections:
        grouped[str(section["source_document_id"])].append(section)
    for document_id, values in list(grouped.items()):
        focus_groups: dict[tuple[str, int], list[dict[str, Any]]] = defaultdict(list)
        for item in values:
            focus = item.get("section_focus")
            focus_priority = item.get("focus_priority")
            if focus is None or focus_priority is None:
                focus, focus_priority = section_focus(item.get("section_title"), item.get("section_text", ""))
            focus_groups[(str(focus), int(focus_priority))].append(item)
        for focus_values in focus_groups.values():
            focus_values.sort(key=lambda item: (-int(item["section_priority"]), int(item.get("retry_count",0)), int(item["section_index"])))
        diversified: list[dict[str, Any]] = []
        focus_round = 0
        while len(diversified) < max_sections_per_document:
            round_items = [
                (focus_priority, focus_values[focus_round])
                for (_focus, focus_priority), focus_values in focus_groups.items()
                if len(focus_values) > focus_round
            ]
            if not round_items:
                break
            round_items.sort(key=lambda pair: (pair[0], -int(pair[1]["section_priority"]), int(pair[1]["section_index"])))
            diversified.extend(item for _, item in round_items)
            focus_round += 1
        grouped[document_id] = diversified[:max_sections_per_document]
    selected: list[dict[str, Any]] = []
    round_number = 0
    while len(selected) < max_sections:
        round_items = [values[round_number] for values in grouped.values() if len(values) > round_number]
        if not round_items:
            break
        round_items.sort(key=lambda item: (-int(item["section_priority"]), str(item["source_document_id"]), int(item["section_index"])))
        selected.extend(round_items[: max_sections-len(selected)])
        round_number += 1
    return selected

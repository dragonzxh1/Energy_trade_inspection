"""Configuration-driven market signal generation and scoring."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

import yaml

from .contracts import (
    MARKET_SIGNAL_SCHEMA_VERSION,
    FactDirection,
    FactType,
    MarketSignal,
    SignalDirection,
    SignalStatus,
)


SIGNAL_NAMESPACE = uuid.UUID("cc66bde9-dd78-4547-86e8-5f3ef022040e")
DEFAULT_CONFIG_PATH = Path(__file__).parent.parent / "config" / "market_signal_weights.yaml"


def load_signal_config(path: Path = DEFAULT_CONFIG_PATH) -> dict[str, Any]:
    config = yaml.safe_load(path.read_text(encoding="utf-8"))
    required = {"version", "positive", "deductions", "thresholds", "rules"}
    if not isinstance(config, dict) or not required.issubset(config):
        raise ValueError("invalid market signal scoring config")
    return config


def _signal_type(fact: Any) -> str:
    if fact.fact_type == FactType.DEMAND:
        return "demand_weakening" if fact.direction == FactDirection.DOWN else "demand_strengthening"
    if fact.fact_type in {FactType.SUPPLY, FactType.PRODUCTION, FactType.REFINERY_RUN}:
        return "supply_recovery" if fact.direction == FactDirection.UP else "supply_tightening"
    if fact.fact_type == FactType.INVENTORY:
        return "inventory_build" if fact.direction == FactDirection.UP else "inventory_draw"
    if fact.fact_type in {FactType.SANCTION, FactType.GEOPOLITICAL_EVENT}:
        return "geopolitical_risk_premium"
    if fact.fact_type in {FactType.REFINERY_OUTAGE, FactType.WEATHER}:
        return "temporary_disruption"
    if fact.fact_type == FactType.ARBITRAGE:
        return "arbitrage_closing" if fact.direction == FactDirection.DOWN else "arbitrage_opening"
    if fact.fact_type in {FactType.SPREAD, FactType.PREMIUM_DISCOUNT}:
        return "margin_compression" if fact.direction == FactDirection.DOWN else "margin_expansion"
    if fact.fact_type in {FactType.PRICE, FactType.PRICE_CHANGE, FactType.FREIGHT}:
        return "cost_driven_move"
    return "local_fundamental_move"


def _direction(facts: list[Any]) -> SignalDirection:
    up = sum(fact.direction == FactDirection.UP for fact in facts)
    down = sum(fact.direction == FactDirection.DOWN for fact in facts)
    if up and down:
        return SignalDirection.MIXED
    if up:
        return SignalDirection.BULLISH
    if down:
        return SignalDirection.BEARISH
    return SignalDirection.NEUTRAL


def _dimensions(facts: list[Any], metrics: list[Any]) -> set[str]:
    dimensions: set[str] = set()
    types = {fact.fact_type for fact in facts}
    if types & {FactType.PRICE, FactType.PRICE_CHANGE, FactType.SPREAD, FactType.PREMIUM_DISCOUNT}:
        dimensions.add("price")
    if types & {FactType.SPREAD, FactType.PREMIUM_DISCOUNT, FactType.REFINERY_RUN}:
        dimensions.add("margin")
    if types & {FactType.SHIPMENT, FactType.ARRIVAL, FactType.TRADE_FLOW, FactType.INVENTORY}:
        dimensions.add("flow_inventory")
    if types & {FactType.REFINERY_OUTAGE, FactType.SANCTION, FactType.POLICY, FactType.GEOPOLITICAL_EVENT}:
        dimensions.add("disruption_policy")
    independent_publishers = {
        (getattr(fact, "publisher", None) or fact.source_id).strip().casefold()
        for fact in facts
    }
    if len(independent_publishers) >= 2:
        dimensions.add("cross_source")
    if any(metric.metric_type.startswith("consecutive_") and (metric.value or 0) >= 2 for metric in metrics):
        dimensions.add("persistence")
    if any(metric.metric_type in {"z_score_20d", "daily_change_pct"} and metric.value is not None for metric in metrics):
        dimensions.add("historical_move")
    return dimensions


def _score(facts: list[Any], metrics: list[Any], config: dict[str, Any]) -> tuple[int, dict[str, int], set[str]]:
    positive = config["positive"]
    deductions = config["deductions"]
    dimensions = _dimensions(facts, metrics)
    breakdown: dict[str, int] = {}
    change_metric = next((metric for metric in metrics if metric.metric_type == "daily_change_pct"), None)
    magnitude = min(positive["price_magnitude"], int(abs(change_metric.value) * 3)) if change_metric and change_metric.value is not None else (8 if "price" in dimensions else 0)
    breakdown["price_magnitude"] = magnitude
    breakdown["margin_confirmation"] = positive["margin_confirmation"] if "margin" in dimensions else 0
    spot_terms=("trade","trading","bid","offer","transaction","market on close","moc")
    breakdown["spot_trade_confirmation"] = positive["spot_trade_confirmation"] if any(
        any(term in fact.evidence_text.casefold() for term in spot_terms) for fact in facts
    ) else 0
    breakdown["flow_inventory_confirmation"] = positive["flow_inventory_confirmation"] if "flow_inventory" in dimensions else 0
    breakdown["disruption_policy_impact"] = positive["disruption_policy_impact"] if "disruption_policy" in dimensions else 0
    breakdown["cross_source_confirmation"] = positive["cross_source_confirmation"] if "cross_source" in dimensions else 0
    breakdown["persistence"] = positive["persistence"] if "persistence" in dimensions else 0
    if len(facts) == 1 and facts[0].fact_type in {FactType.PRICE, FactType.PRICE_CHANGE, FactType.SPREAD, FactType.PREMIUM_DISCOUNT}:
        breakdown["single_quote_only"] = deductions["single_quote_only"]
    if all(fact.fact_type == FactType.SOURCE_COMMENTARY for fact in facts):
        breakdown["media_narrative_only"] = deductions["media_narrative_only"]
    if any(getattr(fact, "has_unresolved_conflict", False) for fact in facts):
        breakdown["unresolved_conflict"] = deductions["unresolved_conflict"]
    if any(getattr(fact, "parse_confidence", 1) < 0.7 for fact in facts):
        breakdown["low_parse_confidence"] = deductions["low_parse_confidence"]
    score = max(0, min(100, sum(breakdown.values())))
    return score, breakdown, dimensions


def generate_market_signals(
    facts: list[Any], metrics: list[Any], config: dict[str, Any] | None = None
) -> list[MarketSignal]:
    config = config or load_signal_config()
    metric_groups: dict[tuple[date, str, str | None], list[Any]] = defaultdict(list)
    for metric in metrics:
        metric_groups[(metric.market_date, metric.commodity, None)].append(metric)
        if metric.region is not None:
            metric_groups[(metric.market_date, metric.commodity, metric.region)].append(metric)
    groups: dict[tuple[date, str, str | None], list[Any]] = defaultdict(list)
    for fact in facts:
        commodity = fact.commodity or "market"
        groups[(fact.market_date, commodity, None)].append(fact)
        if fact.region is not None:
            groups[(fact.market_date, commodity, fact.region)].append(fact)

    candidates: list[MarketSignal] = []
    signal_priority = {
        "geopolitical_risk_premium": 0, "supply_tightening": 1, "temporary_disruption": 2,
        "inventory_draw": 3, "demand_strengthening": 4, "margin_expansion": 5,
        "supply_recovery": 6, "inventory_build": 7, "demand_weakening": 8,
    }
    for (market_date, commodity, region), grouped_facts in groups.items():
        signal_type = min(
            (_signal_type(fact) for fact in grouped_facts),
            key=lambda value: (signal_priority.get(value, 50), value),
        )
        grouped_metrics = metric_groups.get((market_date, commodity, region), [])
        score, breakdown, dimensions = _score(grouped_facts, grouped_metrics, config)
        thresholds = config["thresholds"]
        if score >= thresholds["top_signal"] and len(dimensions) >= config["rules"]["top_signal_min_dimensions"]:
            status = SignalStatus.TOP
        elif score >= thresholds["secondary_signal"]:
            status = SignalStatus.SECONDARY
        elif score >= thresholds["weak_signal"]:
            status = SignalStatus.WEAK
        else:
            status = SignalStatus.DISCARD
        direction = _direction(grouped_facts)
        seed = f"{market_date}|{commodity}|{region}|{signal_type}|{config['version']}"
        candidates.append(MarketSignal(
            signal_id=f"SIGNAL-{uuid.uuid5(SIGNAL_NAMESPACE, seed)}", market_date=market_date,
            commodity=commodity, region=region, signal_type=signal_type,
            title=f"{commodity}: {signal_type.replace('_', ' ')}",
            summary="; ".join(fact.statement for fact in grouped_facts[:3]), direction=direction,
            supporting_fact_ids=[fact.fact_id for fact in grouped_facts], counter_fact_ids=[],
            metric_ids=[metric.metric_id for metric in grouped_metrics],
            confidence=sum(fact.confidence for fact in grouped_facts) / len(grouped_facts),
            score=score, score_breakdown=breakdown, support_dimensions=sorted(dimensions),
            status=status, scoring_version=config["version"],
        ))

    by_date: dict[date, list[MarketSignal]] = defaultdict(list)
    for candidate in candidates:
        by_date[candidate.market_date].append(candidate)
    output: list[MarketSignal] = []
    fact_dates = sorted({fact.market_date for fact in facts})
    for market_date in fact_dates:
        dated = sorted(by_date.get(market_date, []), key=lambda signal: (-signal.score, signal.signal_id))
        top_seen = False
        for candidate in dated:
            if candidate.status == SignalStatus.TOP:
                if top_seen:
                    candidate.status = SignalStatus.SECONDARY
                top_seen = True
            output.append(candidate)
        if not any(signal.status in {SignalStatus.TOP, SignalStatus.SECONDARY} for signal in dated):
            seed = f"{market_date}|low_signal|{config['version']}"
            output.append(MarketSignal(
                signal_id=f"SIGNAL-{uuid.uuid5(SIGNAL_NAMESPACE, seed)}", market_date=market_date,
                commodity="market", signal_type="low_signal", title="No sufficiently supported market signal",
                summary="Verified facts do not provide two independent supporting dimensions.",
                direction=SignalDirection.NEUTRAL, supporting_fact_ids=[], counter_fact_ids=[], metric_ids=[],
                confidence=1, score=0, score_breakdown={}, support_dimensions=[],
                status=SignalStatus.LOW, scoring_version=config["version"],
            ))
    return output

"""PostgreSQL access for code-computed metrics and scored market signals."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from types import SimpleNamespace
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .contracts import FactDirection, FactType, MarketMetric, MetricStatus
from .metrics import PricePoint, calculate_price_metrics
from .signals import generate_market_signals, load_signal_config
from .knowledge import load_knowledge_cards,retrieve_knowledge_card


def canonicalize_commodity(value: str | None) -> str:
    if not value: return "market"
    card=retrieve_knowledge_card(value,load_knowledge_cards())
    return card.commodity_id if card else value.strip().casefold()


def compute_metrics(connection: Connection[Any]) -> list[MarketMetric]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT fact.fact_id, price.market_date, price.commodity, price.region, price.benchmark,
                   price.price, price.unit
            FROM market_prices price
            JOIN market_facts fact ON fact.id = price.market_fact_id
            WHERE fact.is_current = true AND fact.verification_status = 'verified'
              AND fact.publication_blocked = false AND price.price IS NOT NULL
            ORDER BY price.market_date
            """
        )
        price_rows = list(cursor.fetchall())
        cursor.execute(
            """
            SELECT fact_id, market_date, commodity, region, benchmark, fact_type, value, unit
            FROM market_facts
            WHERE is_current = true AND verification_status = 'verified'
              AND publication_blocked = false
              AND fact_type IN ('spread', 'premium_discount', 'arbitrage') AND value IS NOT NULL
            """
        )
        structural_rows = list(cursor.fetchall())

    groups: dict[tuple[str, str | None, str, str], list[PricePoint]] = defaultdict(list)
    for row in price_rows:
        if not row["commodity"] or not row["benchmark"] or not row["unit"]:
            continue
        key = (row["commodity"], row["region"], row["benchmark"], row["unit"])
        groups[key].append(PricePoint(row["market_date"], float(row["price"]), row["unit"], row["fact_id"]))
    metrics: list[MarketMetric] = []
    for (commodity, region, benchmark, _unit), points in groups.items():
        metrics.extend(calculate_price_metrics(points, commodity=commodity, region=region, benchmark=benchmark))
    for row in structural_rows:
        metric_type = {"spread": "calendar_spread", "premium_discount": "spot_premium", "arbitrage": "freight_adjusted_arbitrage"}[row["fact_type"]]
        seed_points = [PricePoint(row["market_date"], float(row["value"]), row["unit"], row["fact_id"])]
        from .metrics import _metric
        metrics.append(_metric(
            market_date=row["market_date"], commodity=row["commodity"] or "market",
            region=row["region"], benchmark=row["benchmark"] or "unspecified",
            metric_type=metric_type, value=float(row["value"]), unit=row["unit"], required=1,
            points=seed_points, method="direct verified source fact; no unit conversion",
        ))
    return metrics


def persist_metrics(connection: Connection[Any], metrics: list[MarketMetric]) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute("DELETE FROM market_metrics")
        for metric in metrics:
            cursor.execute(
                """
                INSERT INTO market_metrics (
                  metric_id, schema_version, market_date, commodity, region, benchmark,
                  metric_type, metric_value, unit, metric_status, calculation_method,
                  calculation_version, source_fact_ids, metadata
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (metric_id) DO UPDATE SET
                  metric_value = EXCLUDED.metric_value, unit = EXCLUDED.unit,
                  metric_status = EXCLUDED.metric_status, source_fact_ids = EXCLUDED.source_fact_ids,
                  metadata = EXCLUDED.metadata, updated_at = now()
                """,
                (
                    metric.metric_id, metric.schema_version, metric.market_date, metric.commodity,
                    metric.region, metric.benchmark, metric.metric_type, metric.value, metric.unit,
                    metric.status.value, metric.calculation_method, metric.calculation_version,
                    Jsonb(metric.source_fact_ids), Jsonb(metric.metadata),
                ),
            )


def _load_signal_inputs(connection: Connection[Any]) -> tuple[list[Any], list[Any]]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT fact.*, document.parse_confidence, document.publisher,
                   EXISTS (
                     SELECT 1 FROM fact_conflicts conflict
                     WHERE conflict.conflict_status = 'unresolved'
                       AND (conflict.left_market_fact_id = fact.id OR conflict.right_market_fact_id = fact.id)
                   ) AS has_unresolved_conflict
            FROM market_facts fact
            JOIN source_documents document ON document.id = fact.source_document_id
            WHERE fact.is_current = true AND fact.verification_status = 'verified'
              AND fact.publication_blocked = false
            """
        )
        fact_rows = list(cursor.fetchall())
        cursor.execute("SELECT * FROM market_metrics")
        metric_rows = list(cursor.fetchall())
    facts = []
    for row in fact_rows:
        values = dict(row)
        values["fact_type"] = FactType(row["fact_type"])
        values["direction"] = FactDirection(row["direction"])
        values["confidence"] = float(row["confidence"])
        values["commodity_original"] = row["commodity"]
        values["commodity"] = canonicalize_commodity(row["commodity"])
        facts.append(SimpleNamespace(**values))
    metrics = [SimpleNamespace(
        metric_id=row["metric_id"], market_date=row["market_date"], commodity=canonicalize_commodity(row["commodity"]),
        region=row["region"], benchmark=row["benchmark"], metric_type=row["metric_type"],
        value=row["metric_value"], status=MetricStatus(row["metric_status"]),
    ) for row in metric_rows]
    return facts, metrics


def compute_and_persist_signals(connection: Connection[Any]) -> list[Any]:
    facts, metrics = _load_signal_inputs(connection)
    signals = generate_market_signals(facts, metrics, load_signal_config())
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute("DELETE FROM market_signals")
        for signal in signals:
            cursor.execute(
                """
                INSERT INTO market_signals (
                  signal_id, schema_version, market_date, commodity, region, signal_type,
                  title, summary, direction, supporting_fact_ids, counter_fact_ids, metric_ids,
                  confidence, score, score_breakdown, support_dimensions, signal_status, scoring_version
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (signal_id) DO UPDATE SET
                  title = EXCLUDED.title, summary = EXCLUDED.summary, direction = EXCLUDED.direction,
                  supporting_fact_ids = EXCLUDED.supporting_fact_ids,
                  counter_fact_ids = EXCLUDED.counter_fact_ids, metric_ids = EXCLUDED.metric_ids,
                  confidence = EXCLUDED.confidence, score = EXCLUDED.score,
                  score_breakdown = EXCLUDED.score_breakdown,
                  support_dimensions = EXCLUDED.support_dimensions,
                  signal_status = EXCLUDED.signal_status, updated_at = now()
                """,
                (
                    signal.signal_id, signal.schema_version, signal.market_date, signal.commodity,
                    signal.region, signal.signal_type, signal.title, signal.summary,
                    signal.direction.value, Jsonb(signal.supporting_fact_ids), Jsonb(signal.counter_fact_ids),
                    Jsonb(signal.metric_ids), signal.confidence, signal.score,
                    Jsonb(signal.score_breakdown), Jsonb(signal.support_dimensions),
                    signal.status.value, signal.scoring_version,
                ),
            )
    return signals

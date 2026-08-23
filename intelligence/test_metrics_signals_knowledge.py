from __future__ import annotations

import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

from intelligence.market_pipeline.contracts import FactDirection, FactType, SignalStatus
from intelligence.market_pipeline.knowledge import (
    load_knowledge_cards,
    retrieve_knowledge_card,
    sync_cards_to_obsidian,
)
from intelligence.market_pipeline.analysis_repository import canonicalize_commodity
from intelligence.market_pipeline.metrics import PricePoint, calculate_price_metrics
from intelligence.market_pipeline.signals import generate_market_signals, load_signal_config


class MetricCalculationTest(unittest.TestCase):
    def test_analysis_rebuilds_derived_tables_without_stale_rows(self):
        from pathlib import Path
        source=Path("intelligence/market_pipeline/analysis_repository.py").read_text(encoding="utf-8")
        self.assertIn('cursor.execute("DELETE FROM market_metrics")',source)
        self.assertIn('cursor.execute("DELETE FROM market_signals")',source)

    def test_twenty_day_metrics_are_deterministic(self) -> None:
        start = date(2026, 6, 10)
        points = [
            PricePoint(start + timedelta(days=index), 80 + index, "USD/bbl", f"FACT-{index}")
            for index in range(21)
        ]
        metrics = calculate_price_metrics(points, commodity="crude", region="Global", benchmark="Brent")
        by_type = {metric.metric_type: metric for metric in metrics}
        self.assertEqual(by_type["daily_change"].value, 1)
        self.assertEqual(by_type["change_3d"].value, 3)
        self.assertEqual(by_type["rolling_mean_20d"].value, 90.5)
        self.assertEqual(by_type["percentile_20d"].value, 100)
        self.assertEqual(by_type["new_20d_high"].value, 1)
        self.assertEqual(by_type["consecutive_up_days"].value, 20)
        repeated = calculate_price_metrics(points, commodity="crude", region="Global", benchmark="Brent")
        self.assertEqual([item.model_dump() for item in metrics], [item.model_dump() for item in repeated])

    def test_missing_history_is_explicit(self) -> None:
        points = [PricePoint(date(2026, 7, day), 80 + day, "USD/bbl", f"F-{day}") for day in (1, 2, 3)]
        metrics = calculate_price_metrics(points, commodity="crude", region=None, benchmark="Brent")
        by_type = {metric.metric_type: metric for metric in metrics}
        self.assertEqual(by_type["rolling_mean_20d"].status.value, "insufficient_data")
        self.assertIsNone(by_type["rolling_mean_20d"].value)


class SignalScoringTest(unittest.TestCase):
    def test_same_publisher_is_not_cross_source_confirmation(self):
        facts = [
            self.fact("F1", "S1", FactType.PRICE, FactDirection.UP, "A trade moved higher."),
            self.fact("F2", "S2", FactType.TRADE_FLOW, FactDirection.UP, "Trade flow increased."),
        ]
        for fact in facts:
            fact.publisher = "Platts"
        signal = [item for item in generate_market_signals(facts, [], load_signal_config()) if item.region is None][0]
        self.assertNotIn("cross_source", signal.support_dimensions)
        self.assertEqual(signal.score_breakdown["cross_source_confirmation"], 0)

    def test_spot_confirmation_recognizes_bid_offer_language(self):
        fact=SimpleNamespace(fact_id="F1",market_date=date(2026,7,7),commodity="gasoline",region=None,
            fact_type=FactType.PRICE,direction=FactDirection.UP,source_id="S1",confidence=0.9,
            statement="A bid was shown.",evidence_text="A firm bid was shown in the MOC.",
            has_unresolved_conflict=False,parse_confidence=1)
        signal=[item for item in generate_market_signals([fact],[],load_signal_config()) if item.commodity=="gasoline"][0]
        self.assertEqual(signal.score_breakdown["spot_trade_confirmation"],15)
    def test_global_candidate_combines_cross_region_dimensions(self):
        facts=[
            SimpleNamespace(fact_id="F1",market_date=date(2026,7,7),commodity="crude_oil",region="Asia",
                fact_type=FactType.PRICE,direction=FactDirection.UP,source_id="S1",confidence=0.9,
                statement="Price strengthened.",evidence_text="trade price strengthened",has_unresolved_conflict=False,parse_confidence=1),
            SimpleNamespace(fact_id="F2",market_date=date(2026,7,7),commodity="crude_oil",region="Middle East",
                fact_type=FactType.SHIPMENT,direction=FactDirection.DOWN,source_id="S2",confidence=0.9,
                statement="Flow declined.",evidence_text="trade flow declined",has_unresolved_conflict=False,parse_confidence=1),
            SimpleNamespace(fact_id="F3",market_date=date(2026,7,7),commodity="crude_oil",region="Europe",
                fact_type=FactType.POLICY,direction=FactDirection.UP,source_id="S3",confidence=0.9,
                statement="Policy changed.",evidence_text="trade policy changed",has_unresolved_conflict=False,parse_confidence=1),
            SimpleNamespace(fact_id="F4",market_date=date(2026,7,7),commodity="crude_oil",region="Global",
                fact_type=FactType.SPREAD,direction=FactDirection.UP,source_id="S4",confidence=0.9,
                statement="Spread widened.",evidence_text="trade spread widened",has_unresolved_conflict=False,parse_confidence=1),
        ]
        signals=generate_market_signals(facts,[],load_signal_config())
        top=[signal for signal in signals if signal.status==SignalStatus.TOP]
        self.assertEqual(len(top),1)
        self.assertIsNone(top[0].region)
        self.assertGreaterEqual(top[0].score,70)
    def fact(self, fact_id: str, source_id: str, fact_type: FactType, direction: FactDirection, evidence: str):
        return SimpleNamespace(
            fact_id=fact_id, source_id=source_id, market_date=date(2026, 7, 9),
            commodity="gasoline", region="Europe", fact_type=fact_type, direction=direction,
            evidence_text=evidence, statement=evidence, confidence=0.9,
            has_unresolved_conflict=False, parse_confidence=0.95,
        )

    def test_top_signal_requires_two_dimensions_and_only_one_per_day(self) -> None:
        facts = [
            self.fact("F1", "S1", FactType.REFINERY_OUTAGE, FactDirection.DOWN, "A refinery outage disrupted supply."),
            self.fact("F2", "S2", FactType.TRADE_FLOW, FactDirection.DOWN, "Cargo trade flows declined."),
            self.fact("F3", "S3", FactType.PREMIUM_DISCOUNT, FactDirection.UP, "Spot premium trade strengthened."),
        ]
        metric = SimpleNamespace(
            metric_id="M1", market_date=date(2026, 7, 9), commodity="gasoline", region="Europe",
            metric_type="daily_change_pct", value=5.0,
        )
        signals = generate_market_signals(facts, [metric], load_signal_config())
        top = [signal for signal in signals if signal.status == SignalStatus.TOP]
        self.assertEqual(len(top), 1)
        self.assertGreaterEqual(len(top[0].support_dimensions), 2)
        self.assertGreaterEqual(top[0].score, 70)

    def test_single_quote_cannot_be_main_signal(self) -> None:
        signals = generate_market_signals(
            [self.fact("F1", "S1", FactType.PRICE, FactDirection.UP, "One quote moved higher.")],
            [], load_signal_config(),
        )
        self.assertFalse(any(signal.status == SignalStatus.TOP for signal in signals))
        self.assertTrue(any(signal.status == SignalStatus.LOW for signal in signals))


class KnowledgeCardTest(unittest.TestCase):
    def test_analysis_canonicalizes_commodity_aliases(self):
        self.assertEqual(canonicalize_commodity("crude oil shipping"),"crude_oil")
        self.assertEqual(canonicalize_commodity("0.5% fuel oil"),"fuel_oil")
    def test_all_first_wave_cards_validate_and_retrieve(self) -> None:
        cards = load_knowledge_cards()
        self.assertEqual(len(cards), 10)
        self.assertEqual(retrieve_knowledge_card("CFR Japan naphtha", cards).commodity_id, "naphtha")
        self.assertEqual(retrieve_knowledge_card("JKM LNG", cards).commodity_id, "lng")
        for card in cards.values():
            self.assertTrue(card.validation_metrics)
            self.assertTrue(card.common_misreads)
            self.assertTrue(card.invalidation_conditions)

    def test_obsidian_sync_is_idempotent(self) -> None:
        cards = load_knowledge_cards()
        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory)
            first = sync_cards_to_obsidian(target, cards)
            first_contents = {path.name: path.read_bytes() for path in first}
            second = sync_cards_to_obsidian(target, cards)
            self.assertEqual(first_contents, {path.name: path.read_bytes() for path in second})


if __name__ == "__main__":
    unittest.main()

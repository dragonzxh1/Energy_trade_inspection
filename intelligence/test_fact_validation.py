from __future__ import annotations

import unittest
from datetime import date, datetime, timezone
from types import SimpleNamespace

from intelligence.market_pipeline.contracts import (
    FactDirection,
    FactRiskLevel,
    FactType,
)
from intelligence.market_pipeline.fact_validation import (
    FactValidationContext,
    detect_fact_conflicts,
    validate_fact,
)


def sample_fact(**overrides):
    values = {
        "fact_id": "FACT-1",
        "source_id": "SRC-1",
        "section_id": "SEC-1",
        "market_date": date(2026, 7, 6),
        "statement": "The assessment was NYMEX August RBOB futures minus 14.00 cents/gal.",
        "evidence_text": "NYMEX August RBOB futures minus 14.00 cents/gal.",
        "fact_type": FactType.PREMIUM_DISCOUNT,
        "commodity": "gasoline",
        "benchmark": "NYMEX August RBOB futures",
        "value": 14.0,
        "unit": "cents/gal",
        "change_value": None,
        "change_unit": None,
        "direction": FactDirection.DOWN,
        "confidence": 0.95,
        "attribution": "Platts",
        "metadata": {},
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def sample_context(**overrides):
    values = {
        "source_market_date": date(2026, 7, 6),
        "telegram_message_date": datetime(2026, 7, 10, tzinfo=timezone.utc),
        "parse_method": "pdf_text",
        "source_verified": True,
        "section_text": "NYMEX August RBOB futures minus 14.00 cents/gal.",
    }
    values.update(overrides)
    return FactValidationContext(**values)


class FactValidationTest(unittest.TestCase):
    def test_valid_numeric_fact_passes(self) -> None:
        issues, risk = validate_fact(sample_fact(), sample_context())
        self.assertEqual(issues, [])
        self.assertEqual(risk, FactRiskLevel.NORMAL)

    def test_non_energy_market_fact_is_blocked(self) -> None:
        fact=sample_fact(
            fact_type=FactType.PRICE,commodity="gold",benchmark="Gold",
            statement="Gold was 4104.10 $per troy oz.",
            evidence_text="Gold was 4104.10 $per troy oz.",value=4104.10,unit="$per troy oz.",
        )
        issues,_=validate_fact(fact,sample_context(section_text=fact.evidence_text))
        self.assertIn("content.non_energy",{issue.rule_id for issue in issues})

    def test_energy_unit_synonyms_are_supported_verbatim(self) -> None:
        fact=sample_fact(
            fact_type=FactType.SUPPLY,commodity="crude oil",benchmark=None,
            statement="Global oil supply rose by 4.1 million barrels a day.",
            evidence_text="Global oil supply rose by 4.1 million barrels a day.",
            value=4.1,unit="million barrels a day",direction=FactDirection.UP,
        )
        issues,_=validate_fact(fact,sample_context(section_text=fact.evidence_text))
        self.assertNotIn("unit.supported",{issue.rule_id for issue in issues})

    def test_price_requires_value(self) -> None:
        fact = sample_fact(fact_type=FactType.PRICE, value=None, unit=None, benchmark=None)
        issues, _ = validate_fact(fact, sample_context())
        self.assertIn("number.required", {issue.rule_id for issue in issues})

    def test_price_change_requires_change_value(self) -> None:
        fact = sample_fact(
            fact_type=FactType.PRICE_CHANGE, value=None, unit=None,
            change_value=None, change_unit=None, benchmark=None,
        )
        issues, _ = validate_fact(fact, sample_context())
        self.assertIn("number.required", {issue.rule_id for issue in issues})

    def test_wrong_direction_and_unit_are_blocking(self) -> None:
        fact = sample_fact(
            value=None, unit=None, change_value=14.0, change_unit="USD/bbl",
            direction=FactDirection.DOWN,
            evidence_text="The benchmark changed by 14.00 cents/gal.",
        )
        issues, _ = validate_fact(fact, sample_context(section_text=fact.evidence_text))
        rules = {issue.rule_id for issue in issues}
        self.assertIn("direction.sign", rules)
        self.assertIn("unit.evidence", rules)

    def test_positive_decrease_magnitude_matches_down_direction(self) -> None:
        fact = sample_fact(
            value=None, unit=None, change_value=40.0, change_unit="%",
            direction=FactDirection.DOWN, commodity="crude oil", benchmark=None,
            statement="China cut crude imports by 40%.",
            evidence_text="China cut crude imports by 40%.",
        )
        issues, _ = validate_fact(fact, sample_context(section_text=fact.evidence_text))
        self.assertNotIn("direction.sign", {issue.rule_id for issue in issues})

    def test_common_crude_inventory_units_are_supported(self) -> None:
        for value, unit, evidence in (
            (1.1, "billion barrels", "Storage held 1.1 billion barrels of crude."),
            (11.6, "million barrels of crude a day", "China imported 11.6 million barrels of crude a day."),
        ):
            fact = sample_fact(
                fact_type=FactType.INVENTORY, commodity="crude oil", benchmark=None,
                value=value, unit=unit, evidence_text=evidence, statement=evidence,
            )
            issues, _ = validate_fact(fact, sample_context(section_text=evidence))
            self.assertNotIn("unit.supported", {issue.rule_id for issue in issues})

    def test_date_mismatch_is_blocking(self) -> None:
        issues, _ = validate_fact(sample_fact(market_date=date(2026, 7, 5)), sample_context())
        self.assertIn("date.market", {issue.rule_id for issue in issues})

    def test_ocr_numeric_fact_requires_review(self) -> None:
        issues, _ = validate_fact(sample_fact(), sample_context(parse_method="ocr"))
        self.assertIn("source.ocr", {issue.rule_id for issue in issues})

    def test_high_risk_single_source_requires_attribution_and_review(self) -> None:
        fact = sample_fact(
            fact_type=FactType.GEOPOLITICAL_EVENT, value=None, unit=None, benchmark=None,
            statement="A military strike closed the port.", evidence_text="A military strike closed the port.",
            attribution=None,
        )
        context = sample_context(section_text=fact.evidence_text)
        issues, risk = validate_fact(fact, context)
        rules = {issue.rule_id for issue in issues}
        self.assertEqual(risk, FactRiskLevel.HIGH)
        self.assertIn("risk.attribution", rules)
        self.assertNotIn("risk.manual_review", rules)

    def test_verified_publisher_can_attribute_high_risk_reporting(self) -> None:
        fact = sample_fact(
            fact_type=FactType.GEOPOLITICAL_EVENT, value=None, unit=None, benchmark=None,
            statement="Iran fired missiles at oil tankers.",
            evidence_text="Iran fired missiles at oil tankers.", attribution=None,
        )
        issues, risk = validate_fact(
            fact,
            sample_context(section_text=fact.evidence_text, publisher="The New York Times"),
        )
        self.assertEqual(risk, FactRiskLevel.HIGH)
        self.assertFalse([issue for issue in issues if issue.severity.value == "blocking"])
        self.assertIn("risk.source_reported", {issue.rule_id for issue in issues})

    def test_war_context_does_not_make_trade_flow_critical(self) -> None:
        fact = sample_fact(
            fact_type=FactType.TRADE_FLOW, value=None, unit=None, benchmark=None,
            commodity="crude oil", statement="China curtailed oil imports amid the Iran war.",
            evidence_text="China curtailed oil imports amid the Iran war.",
        )
        issues, risk = validate_fact(fact, sample_context(section_text=fact.evidence_text))
        self.assertEqual(risk, FactRiskLevel.NORMAL)
        self.assertNotIn("risk.manual_review", {issue.rule_id for issue in issues})

    def test_publisher_boilerplate_is_rejected(self) -> None:
        fact = sample_fact(
            fact_type=FactType.SOURCE_COMMENTARY, value=None, unit=None, benchmark=None,
            statement="Platts is part of S&P Global Energy.",
            evidence_text="Platts is part of S&P Global Energy.",
        )
        issues, _ = validate_fact(fact, sample_context(section_text=fact.evidence_text))
        self.assertIn("content.boilerplate", {issue.rule_id for issue in issues})

    def test_value_conflict_keeps_both_fact_ids(self) -> None:
        left = sample_fact()
        right = sample_fact(fact_id="FACT-2", source_id="SRC-2", value=15.0)
        conflicts = detect_fact_conflicts([left, right])
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0].conflict_type.value, "value_conflict")
        self.assertEqual({conflicts[0].left_fact_id, conflicts[0].right_fact_id}, {"FACT-1", "FACT-2"})

    def test_different_fact_types_are_not_conflicts(self) -> None:
        left=sample_fact(fact_type=FactType.PRODUCTION)
        right=sample_fact(fact_id="FACT-2",source_id="SRC-2",fact_type=FactType.SHIPMENT,value=500)
        self.assertEqual(detect_fact_conflicts([left,right]),[])

    def test_verified_native_table_cell_supports_header_unit(self) -> None:
        fact=sample_fact(value=0.4,unit="usd/bbl",benchmark="ALCEJ00",
            evidence_text="Gasoline ALCEJ00 0.400",metadata={"structured_table":True,
            "table_cell":"Gasoline ALCEJ00 0.400","table_header":"Daily Premium Asia $/bbl",
            "unit_evidence":"Daily Premium Asia $/bbl","table_parse_confidence":0.95})
        issues,_=validate_fact(fact,sample_context(section_text="different page layout"))
        self.assertFalse([issue for issue in issues if issue.severity.value=="blocking"])


if __name__ == "__main__":
    unittest.main()

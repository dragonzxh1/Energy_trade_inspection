from __future__ import annotations

import unittest
from datetime import date

from intelligence.market_pipeline.fact_extraction import (
    bind_and_validate_facts,
    bind_and_validate_facts_partial,
    build_fact_extraction_task,
    parse_fact_extraction,
    parse_fact_extraction_partial,
)
from intelligence.market_pipeline.contracts import FactType


class FactExtractionContractTest(unittest.TestCase):
    def test_retry_correction_is_not_truncated(self) -> None:
        task = build_fact_extraction_task(
            "SEC-1",
            "fact_type Input should be enum [type=enum, input_value='benchmark']",
        )
        self.assertLessEqual(len(task), 1023)
        self.assertIn("FIX INVALID_ENUM", task)
        self.assertIn("benchmark is not fact_type", task)
        self.assertIn("Split price from price_change", task)

    def payload(self) -> dict:
        return {
            "data": {
                "outputs": {
                    "text": """<think>hidden</think>```json
                    {"schema_version":"market-fact.v1","facts":[
                      {"fact_type":"price","statement":"CFR Japan naphtha was assessed at $700/mt.",
                       "region":"Asia","commodity":"naphtha","benchmark":"CFR Japan",
                       "value":700,"unit":"USD/mt","direction":"up",
                       "evidence_text":"CFR Japan naphtha was assessed at $700 USD/mt.","confidence":0.98},
                      {"fact_type":"supply","statement":"The source attributed strength to tighter prompt supply.",
                       "region":"Asia","commodity":"naphtha","direction":"unknown",
                       "evidence_text":"Traders said tighter prompt supply supported the market.",
                       "attribution":"Traders","confidence":0.85}
                    ]}
                    ```"""
                }
            }
        }

    def test_parses_wrapped_json_and_binds_traceability(self) -> None:
        result = parse_fact_extraction(self.payload())
        facts = bind_and_validate_facts(
            result, source_id="SRC-1", section_id="SEC-1",
            section_text=(
                "CFR Japan naphtha was assessed at $700 USD/mt. "
                "Traders said tighter prompt supply supported the market."
            ),
            market_date=date(2026, 7, 9), published_at=None, page_number=2,
        )
        self.assertEqual(len(facts), 2)
        self.assertEqual(facts[0].source_id, "SRC-1")
        self.assertEqual(facts[0].page_number, 2)
        self.assertEqual(facts[0].verification_status.value, "pending")
        self.assertNotEqual(facts[0].fact_hash, facts[1].fact_hash)

    def test_same_fact_has_stable_id(self) -> None:
        result = parse_fact_extraction(self.payload())
        kwargs = dict(
            source_id="SRC-1", section_id="SEC-1",
            section_text=(
                "CFR Japan naphtha was assessed at $700 USD/mt. "
                "Traders said tighter prompt supply supported the market."
            ),
            market_date=date(2026, 7, 9), published_at=None, page_number=2,
        )
        first = bind_and_validate_facts(result, **kwargs)
        second = bind_and_validate_facts(result, **kwargs)
        self.assertEqual(first[0].fact_id, second[0].fact_id)
        self.assertEqual(first[0].fact_hash, second[0].fact_hash)
        result.facts[0].statement = "The assessed CFR Japan naphtha value was $700/mt."
        paraphrased = bind_and_validate_facts(result, **kwargs)
        self.assertEqual(first[0].fact_hash, paraphrased[0].fact_hash)
        result.facts[0].fact_type = FactType.PREMIUM_DISCOUNT
        reclassified = bind_and_validate_facts(result, **kwargs)
        self.assertEqual(first[0].fact_hash, reclassified[0].fact_hash)

    def test_rejects_evidence_not_present_in_section(self) -> None:
        result = parse_fact_extraction(self.payload())
        with self.assertRaisesRegex(ValueError, "exact section excerpt"):
            bind_and_validate_facts(
                result, source_id="SRC-1", section_id="SEC-1", section_text="Different text.",
                market_date=date(2026, 7, 9), published_at=None, page_number=1,
            )

    def test_rejects_numeric_value_without_unit(self) -> None:
        payload = {"facts": [{
            "fact_type": "inventory", "statement": "Stocks were 50.", "value": 50,
            "evidence_text": "Stocks were 50.", "confidence": 0.9,
        }]}
        result = parse_fact_extraction(payload)
        with self.assertRaisesRegex(ValueError, "requires its original unit"):
            bind_and_validate_facts(
                result, source_id="SRC-1", section_id="SEC-1", section_text="Stocks were 50.",
                market_date=date(2026, 7, 9), published_at=None, page_number=1,
            )

    def test_price_and_price_change_require_their_numeric_roles(self) -> None:
        cases = (
            ({"fact_type":"price","statement":"Prices rose.","evidence_text":"Prices rose.","confidence":0.9}, "price requires value"),
            ({"fact_type":"price_change","statement":"Prices rose.","evidence_text":"Prices rose.","confidence":0.9}, "price_change requires change_value"),
        )
        for payload, message in cases:
            with self.subTest(message=message):
                result = parse_fact_extraction({"facts":[payload]})
                with self.assertRaisesRegex(ValueError, message):
                    bind_and_validate_facts(
                        result, source_id="SRC-1", section_id="SEC-1", section_text="Prices rose.",
                        market_date=date(2026,7,9), published_at=None, page_number=1,
                    )

    def test_price_and_change_must_be_separate_atomic_facts(self) -> None:
        combined = parse_fact_extraction({"facts": [{
            "fact_type": "price", "statement": "Price was 70 USD/bbl, up 2 USD/bbl.",
            "value": 70, "unit": "USD/bbl", "change_value": 2, "change_unit": "USD/bbl",
            "evidence_text": "Price was 70 USD/bbl, up 2 USD/bbl.", "confidence": 0.9,
        }]})
        with self.assertRaisesRegex(ValueError, "separate price_change"):
            bind_and_validate_facts(
                combined, source_id="SRC-1", section_id="SEC-1",
                section_text="Price was 70 USD/bbl, up 2 USD/bbl.",
                market_date=date(2026, 7, 9), published_at=None, page_number=1,
            )

    def test_rejects_unit_invented_outside_evidence(self) -> None:
        result = parse_fact_extraction({"facts": [{
            "fact_type": "price", "statement": "Price was 70 USD/bbl.", "value": 70,
            "unit": "USD/bbl", "evidence_text": "The assessment was 70.", "confidence": 0.9,
        }]})
        with self.assertRaisesRegex(ValueError, "appear verbatim"):
            bind_and_validate_facts(
                result, source_id="SRC-1", section_id="SEC-1",
                section_text="The assessment was 70.", market_date=date(2026, 7, 9),
                published_at=None, page_number=1,
            )

    def test_partial_validation_keeps_only_compliant_facts(self) -> None:
        result=parse_fact_extraction({"facts":[
            {"fact_type":"supply","statement":"Supply tightened.","direction":"unknown",
             "evidence_text":"Supply tightened.","confidence":0.9},
            {"fact_type":"price","statement":"Price was 70 USD/bbl.","value":70,"unit":"USD/bbl",
             "direction":"up","evidence_text":"The assessment was 70.","confidence":0.9},
        ]})
        facts,rejections=bind_and_validate_facts_partial(
            result,source_id="SRC-1",section_id="SEC-1",
            section_text="Supply tightened. The assessment was 70.",
            market_date=date(2026,7,9),published_at=None,page_number=1,
        )
        self.assertEqual(len(facts),1)
        self.assertEqual(len(rejections),1)
        self.assertIn("appear verbatim",rejections[0])

    def test_rejects_unknown_fact_type(self) -> None:
        with self.assertRaisesRegex(ValueError, "schema validation"):
            parse_fact_extraction({"facts": [{
                "fact_type": "forecast_magic", "statement": "Prices will rise.",
                "evidence_text": "Prices will rise.", "confidence": 0.5,
            }]})

    def test_partial_schema_validation_keeps_valid_items(self) -> None:
        result,rejections=parse_fact_extraction_partial({"facts":[
            {"fact_type":"supply","statement":"Supply tightened.","direction":"unknown",
             "evidence_text":"Supply tightened.","confidence":0.9},
            {"fact_type":"spread_change","statement":"Spread changed.","direction":"up",
             "evidence_text":"Spread changed.","confidence":0.8},
        ]})
        self.assertEqual(len(result.facts),1)
        self.assertEqual(len(rejections),1)
        self.assertIn("fact_type",rejections[0])


if __name__ == "__main__":
    unittest.main()

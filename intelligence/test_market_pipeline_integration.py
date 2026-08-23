from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from intelligence.market_pipeline.contracts import FactDirection, FactType, SignalStatus
from intelligence.market_pipeline.document_parser import parse_telegram_document
from intelligence.market_pipeline.editorial import build_editorial_view
from intelligence.market_pipeline.feedback import build_feedback_diff
from intelligence.market_pipeline.knowledge import retrieve_knowledge_card
from intelligence.market_pipeline.signals import generate_market_signals, load_signal_config
from intelligence.market_pipeline.telegram_adapter import adapt_legacy_payload


class MarketPipelineIntegrationTest(unittest.TestCase):
    def test_observability_separates_content_quality_and_execution(self):
        from pathlib import Path
        source=Path("intelligence/market_pipeline/observability.py").read_text(encoding="utf-8")
        self.assertIn("content_ready",source)
        self.assertIn("quality_gate_passed",source)
        self.assertIn("publish_execution_allowed",source)
        self.assertIn("high_risk_fact_review",source)
        self.assertIn("fact_quality_review",source)

    def test_manifest_covers_required_regression_cases(self):
        manifest=json.loads((Path(__file__).parent/"fixtures"/"market_pipeline"/"manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(len(manifest["cases"]),15)
        covered={item for case in manifest["cases"] for item in case["covers"]}
        self.assertIn("no_publish",covered); self.assertIn("conflict_record",covered); self.assertIn("no_production_ocr",covered)

    def test_telegram_to_low_signal_editorial_chain(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path=Path(temporary_directory)/"Platts report 2026-07-09.txt"
            text="S&P Global Commodity Insights\nAssessment date: 2026-07-09\nNaphtha market commentary remained mixed."
            path.write_text(text,encoding="utf-8")
            payload={"source_channel":"telegram:platts","telegram_message_id":"1","telegram_message_date":"2026-07-10T00:00:00+00:00",
                     "media_type":"text/plain","file_name":path.name,"file_hash":"a"*64,"storage_path":str(path),"file_size_bytes":path.stat().st_size}
            telegram=adapt_legacy_payload(payload)
            source=parse_telegram_document(telegram)
            self.assertEqual(source.document.publisher,"Platts"); self.assertEqual(source.document.market_date,date(2026,7,9))
            fact=SimpleNamespace(fact_id="FACT-1",source_id=source.source_id,market_date=date(2026,7,9),commodity="naphtha",region="Asia",
                 fact_type=FactType.SOURCE_COMMENTARY,direction=FactDirection.UNKNOWN,evidence_text="Naphtha market commentary remained mixed.",
                 statement="Naphtha market commentary remained mixed.",confidence=.9,has_unresolved_conflict=False,parse_confidence=.95)
            signals=generate_market_signals([fact],[],load_signal_config())
            self.assertTrue(any(signal.status==SignalStatus.LOW for signal in signals))
            view=build_editorial_view(date(2026,7,9),signals,previous_signals=[],knowledge_card=retrieve_knowledge_card("naphtha"),allowed_fact_ids={"FACT-1"},unresolved_fact_ids=set())
            self.assertFalse(view.publishable)

    def test_editor_feedback_diff_is_reproducible(self):
        first=build_feedback_diff("line one\nline two","line one\nline revised",["wrong_fact"])
        second=build_feedback_diff("line one\nline two","line one\nline revised",["wrong_fact"])
        self.assertEqual(first,second); self.assertEqual(first["added_lines"],1); self.assertEqual(first["deleted_lines"],1)


if __name__=="__main__": unittest.main()

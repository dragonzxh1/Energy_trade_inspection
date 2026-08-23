from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from platts_ocr.trials.adapters import template_payload_records
from platts_ocr.trials.contracts import PlattsSummaryRecord
from platts_ocr.trials.evaluation import evaluate_parser
from platts_ocr.trials.normalization import (
    detect_duplicate_records,market_date_from_title_text,normalize_numeric,
)


class TrialNormalizationTest(unittest.TestCase):
    def test_title_date_comes_from_image_heading(self):
        self.assertEqual(market_date_from_title_text("PLATTS SUMMARY July 10, 2026"),"2026-07-10")
        self.assertIsNone(market_date_from_title_text("photo_20260711.jpg"))

    def test_numeric_formats_and_na(self):
        self.assertEqual(normalize_numeric("$1 051,25"),1051.25)
        self.assertEqual(normalize_numeric("-$14,00",change=True),-14.0)
        self.assertIsNone(normalize_numeric("N/A"))

    def test_duplicate_identity_is_reported(self):
        records=[PlattsSummaryRecord("price","ULSD","FOB Med"),
                 PlattsSummaryRecord("price","ULSD","FOB Med")]
        self.assertEqual(len(detect_duplicate_records(records)),1)

    def test_template_payload_maps_raw_and_normalized_values(self):
        records=template_payload_records({"prices":[{
            "table_id":"ULSD_10ppm","row_name":"FOB Med","code":"AAWYY00",
            "raw_mid":"$1 051,25","mid":1051.25,"raw_change":"-$14,00","change":-14.0,
            "confidence_code":99,"confidence_mid":98,"confidence_change":97,
        }],"spreads":[],"conversions":[]})
        self.assertEqual(records[0].unit,"USD/MT")
        self.assertEqual(records[0].mid_raw,"$1 051,25")
        self.assertEqual(records[0].change,-14.0)
        self.assertEqual(records[0].confidence,97)


class TrialEvaluationTest(unittest.TestCase):
    def test_unverified_ground_truth_can_never_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); truth=root/"truth"; truth.mkdir()
            (truth/"one.json").write_text(json.dumps({
                "verification_status":"pending_manual","market_date":"2026-07-10","records":[],
            }),encoding="utf-8")
            result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
            self.assertFalse(result["passed"])
            self.assertEqual(result["recommendation"],"do_not_integrate_production")

    def test_ten_exact_human_verified_samples_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); truth=root/"truth"; truth.mkdir()
            run1=root/"run1"/"template_tesseract"; run1.mkdir(parents=True)
            run2=root/"run2"/"template_tesseract"; run2.mkdir(parents=True)
            record={"record_type":"price","product":"ULSD_10ppm","location":"FOB Med",
                    "code":"AAWYY00","mid":1051.25,"change":-14.0,"unit":"USD/MT"}
            for index in range(10):
                image=f"image_{index}"
                ground={"verification_status":"human_verified","market_date":"2026-07-10","records":[record]}
                output={"schema_version":"platts-summary-trial.v1","image_id":image,"image_sha256":"x",
                        "market_date":"2026-07-10","market_date_source":"image_title",
                        "parser":"template_tesseract","duration_ms":1,"records":[record],
                        "review_reasons":[],"raw_output_path":"","peak_memory_mb":1}
                (truth/f"{image}.json").write_text(json.dumps(ground),encoding="utf-8")
                (run1/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
                (run2/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
            result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
            self.assertTrue(result["passed"])
            self.assertEqual(result["metrics"]["critical_numeric_accuracy"],1.0)


if __name__=="__main__": unittest.main()

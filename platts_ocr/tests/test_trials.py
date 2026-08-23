from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from platts_ocr.trials.adapters import Img2TablePaddleAdapter, template_payload_records
from platts_ocr.trials.contracts import PlattsSummaryRecord
from platts_ocr.trials.cli import _validate_workers, initialize_ground_truth
from platts_ocr.trials.evaluation import _template_cell_bbox, evaluate_parser
from platts_ocr.trials.normalization import (
    detect_duplicate_records,market_date_from_title_text,normalize_numeric,
)
from platts_ocr.src.ocr_engines import _infer_change_tint_sign


class TrialNormalizationTest(unittest.TestCase):
    def test_paddle_parsers_cannot_run_in_parallel(self):
        with self.assertRaises(ValueError):
            _validate_workers(["img2table_paddle"],2)
        _validate_workers(["template_tesseract"],2)

    def test_title_date_comes_from_image_heading(self):
        self.assertEqual(market_date_from_title_text("PLATTS SUMMARY July 10, 2026"),"2026-07-10")
        self.assertIsNone(market_date_from_title_text("photo_20260711.jpg"))

    def test_numeric_formats_and_na(self):
        self.assertEqual(normalize_numeric("$1 051,25"),1051.25)
        self.assertEqual(normalize_numeric("$1,051.25"),1051.25)
        self.assertEqual(normalize_numeric("-$14,00",change=True),-14.0)
        self.assertIsNone(normalize_numeric("N/A"))

    def test_change_tint_sign_detects_green_and_red(self):
        import numpy as np

        green=np.full((10,10,3),(200,240,200),dtype=np.uint8)
        red=np.full((10,10,3),(200,200,240),dtype=np.uint8)
        self.assertEqual(_infer_change_tint_sign(green),1)
        self.assertEqual(_infer_change_tint_sign(red),-1)

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

    def test_template_payload_maps_spread_and_conversion(self):
        records=template_payload_records({"prices":[],"spreads":[{
            "left_market":"CIF Med","right_market":"FOB Med",
            "raw_ULSD":"$14,00","ULSD":14.0,"confidence_ULSD":96,
        }],"conversions":[{
            "product":"ULSD_10ppm","raw_text":"7,45","mt_bbl":7.45,"confidence":99,
        }]})
        self.assertEqual(records[0].record_type,"spread")
        self.assertEqual(records[0].from_market,"CIF Med")
        self.assertEqual(records[0].to_market,"FOB Med")
        self.assertEqual(records[1].record_type,"conversion")
        self.assertEqual(records[1].unit,"MT/bbl")

    def test_qr_regions_are_masked_before_generic_ocr(self):
        import cv2
        import numpy as np

        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            source=np.zeros((530,1280,3),dtype=np.uint8)
            image=root/"sample.png"
            cv2.imwrite(str(image),source)
            masked=Img2TablePaddleAdapter()._masked_image(image,root)
            result=cv2.imread(str(masked))
            self.assertTrue((result[350:520,940:1090] == 255).all())
            self.assertTrue((result[350:520,1120:1270] == 255).all())

    def test_ground_truth_template_includes_review_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); samples=root/"samples"; samples.mkdir()
            (samples/"image.png").write_bytes(b"not an image")
            output=root/"truth"
            initialize_ground_truth(samples,output)
            template=json.loads((output/"image.json").read_text(encoding="utf-8"))
            self.assertEqual(template["verification_status"],"pending_manual")
            self.assertIsNone(template["reviewer"])
            self.assertIsNone(template["verified_at"])


class TrialEvaluationTest(unittest.TestCase):
    def test_template_error_bbox_maps_back_to_original_scale(self):
        with tempfile.TemporaryDirectory() as directory:
            run=Path(directory); segments=run/"raw"/"template_tesseract"/"image"/"debug"/"segments"
            segments.mkdir(parents=True)
            (segments/"cells_image.json").write_text(json.dumps([{
                "region_id":"ULSD_10ppm","row_name":"FOB Med","field_name":"mid",
                "bbox":[300,150,600,240],
            }]),encoding="utf-8")
            bbox=_template_cell_bbox(run,"image",("price","ULSD_10ppm","FOB Med","",""),"mid")
            self.assertEqual(bbox,[100,50,200,80])

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
                ground={"verification_status":"human_verified","reviewer":"tester",
                        "verified_at":"2026-07-13T00:00:00Z","market_date":"2026-07-10","records":[record]}
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

    def test_missing_parser_output_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); truth=root/"truth"; truth.mkdir()
            run1=root/"run1"/"template_tesseract"; run1.mkdir(parents=True)
            run2=root/"run2"/"template_tesseract"; run2.mkdir(parents=True)
            record={"record_type":"price","product":"ULSD_10ppm","location":"FOB Med"}
            for index in range(10):
                image=f"image_{index}"
                (truth/f"{image}.json").write_text(json.dumps({
                    "verification_status":"human_verified","reviewer":"tester",
                    "verified_at":"2026-07-13T00:00:00Z","market_date":"2026-07-10",
                    "records":[record],
                }),encoding="utf-8")
                output={"market_date":"2026-07-10","records":[record],"review_reasons":[]}
                (run1/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
                if index != 9:
                    (run2/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
            result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
            self.assertFalse(result["passed"])
            self.assertEqual(result["evaluated_samples"],9)
            self.assertEqual(result["missing_output_files"],[str(run2/"image_9.json")])

    def test_null_ground_truth_field_rejects_non_null_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); truth=root/"truth"; truth.mkdir()
            run1=root/"run1"/"template_tesseract"; run1.mkdir(parents=True)
            run2=root/"run2"/"template_tesseract"; run2.mkdir(parents=True)
            truth_record={"record_type":"price","product":"ULSD_10ppm","location":"FOB Med","mid":None}
            output_record={**truth_record,"mid":123.45}
            for index in range(10):
                image=f"image_{index}"
                (truth/f"{image}.json").write_text(json.dumps({
                    "verification_status":"human_verified","reviewer":"tester",
                    "verified_at":"2026-07-13T00:00:00Z","market_date":"2026-07-10",
                    "records":[truth_record],
                }),encoding="utf-8")
                records=[output_record if index == 0 else truth_record]
                output={"market_date":"2026-07-10","records":records,"review_reasons":[]}
                (run1/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
                (run2/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
            result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
            self.assertFalse(result["passed"])
            self.assertEqual(result["hallucinated_non_null_fields"],1)

    def test_extra_output_record_rejects_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); truth=root/"truth"; truth.mkdir()
            run1=root/"run1"/"template_tesseract"; run1.mkdir(parents=True)
            run2=root/"run2"/"template_tesseract"; run2.mkdir(parents=True)
            record={"record_type":"price","product":"ULSD_10ppm","location":"FOB Med"}
            extra={"record_type":"price","product":"JET","location":"FOB Med"}
            for index in range(10):
                image=f"image_{index}"
                (truth/f"{image}.json").write_text(json.dumps({
                    "verification_status":"human_verified","reviewer":"tester",
                    "verified_at":"2026-07-13T00:00:00Z","market_date":"2026-07-10",
                    "records":[record],
                }),encoding="utf-8")
                records=[record,extra] if index == 0 else [record]
                output={"market_date":"2026-07-10","records":records,"review_reasons":[]}
                (run1/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
                (run2/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
            result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
            self.assertFalse(result["passed"])
            self.assertEqual(result["extra_record_count"],1)

    def test_human_verified_ground_truth_requires_review_metadata(self):
        missing_fields=("reviewer","verified_at","market_date","records")
        for missing_field in missing_fields:
            with self.subTest(missing_field=missing_field), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); truth=root/"truth"; truth.mkdir()
                run1=root/"run1"/"template_tesseract"; run1.mkdir(parents=True)
                run2=root/"run2"/"template_tesseract"; run2.mkdir(parents=True)
                record={"record_type":"price","product":"ULSD_10ppm","location":"FOB Med"}
                for index in range(10):
                    image=f"image_{index}"
                    ground={
                        "verification_status":"human_verified","reviewer":"tester",
                        "verified_at":"2026-07-13T00:00:00Z","market_date":"2026-07-10",
                        "records":[record],
                    }
                    ground[missing_field]=None if missing_field != "records" else []
                    (truth/f"{image}.json").write_text(json.dumps(ground),encoding="utf-8")
                    output={"market_date":"2026-07-10","records":[record],"review_reasons":[]}
                    (run1/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
                    (run2/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
                result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
                self.assertFalse(result["passed"])
                self.assertEqual(len(result["invalid_ground_truth_files"]),10)

    def test_invalid_ground_truth_and_missing_output_are_both_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); truth=root/"truth"; truth.mkdir()
            run1=root/"run1"/"template_tesseract"; run1.mkdir(parents=True)
            run2=root/"run2"/"template_tesseract"; run2.mkdir(parents=True)
            ground_path=truth/"image.json"
            ground_path.write_text(json.dumps({
                "verification_status":"pending_manual","market_date":None,"records":[],
            }),encoding="utf-8")
            result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
            self.assertFalse(result["passed"])
            self.assertEqual(result["invalid_ground_truth_files"],[str(ground_path)])
            self.assertEqual(result["missing_output_files"],[
                str(run1/"image.json"),str(run2/"image.json"),
            ])

    def test_non_image_title_date_source_fails_closed(self):
        for source in ("filename",None):
            with self.subTest(source=source), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); truth=root/"truth"; truth.mkdir()
                run1=root/"run1"/"template_tesseract"; run1.mkdir(parents=True)
                run2=root/"run2"/"template_tesseract"; run2.mkdir(parents=True)
                record={"record_type":"price","product":"ULSD_10ppm","location":"FOB Med",
                        "code":"AAWYY00","mid":1051.25,"change":-14.0,"unit":"USD/MT"}
                for index in range(10):
                    image=f"image_{index}"
                    ground={"verification_status":"human_verified","reviewer":"tester",
                            "verified_at":"2026-07-13T00:00:00Z","market_date":"2026-07-10",
                            "records":[record]}
                    (truth/f"{image}.json").write_text(json.dumps(ground),encoding="utf-8")
                    output={"market_date":"2026-07-10","market_date_source":source,
                            "records":[record],"review_reasons":[]}
                    (run1/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
                    (run2/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
                result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
                self.assertFalse(result["passed"])
                self.assertTrue(any(
                    error["code"]=="MARKET_DATE_SOURCE_INVALID" for error in result["errors"]
                ))

    def test_malformed_extra_record_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); truth=root/"truth"; truth.mkdir()
            run1=root/"run1"/"template_tesseract"; run1.mkdir(parents=True)
            run2=root/"run2"/"template_tesseract"; run2.mkdir(parents=True)
            record={"record_type":"price","product":"ULSD_10ppm","location":"FOB Med"}
            for index in range(10):
                image=f"image_{index}"
                (truth/f"{image}.json").write_text(json.dumps({
                    "verification_status":"human_verified","reviewer":"tester",
                    "verified_at":"2026-07-13T00:00:00Z","market_date":"2026-07-10",
                    "records":[record],
                }),encoding="utf-8")
                records=[record,{}] if index == 0 else [record]
                output={"market_date":"2026-07-10","market_date_source":"image_title",
                        "records":records,"review_reasons":[]}
                (run1/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
                (run2/f"{image}.json").write_text(json.dumps(output),encoding="utf-8")
            result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
            self.assertFalse(result["passed"])
            self.assertEqual(result["extra_record_count"],1)
            self.assertTrue(any(
                error["code"]=="MALFORMED_EXTRA_RECORD" for error in result["errors"]
            ))

    def test_missing_record_reduces_row_column_accuracy(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); truth=root/"truth"; truth.mkdir()
            run1=root/"run1"/"template_tesseract"; run1.mkdir(parents=True)
            run2=root/"run2"/"template_tesseract"; run2.mkdir(parents=True)
            record={"record_type":"price","product":"ULSD_10ppm","location":"FOB Med"}
            (truth/"image.json").write_text(json.dumps({
                "verification_status":"human_verified","reviewer":"tester",
                "verified_at":"2026-07-13T00:00:00Z","market_date":"2026-07-10","records":[record],
            }),encoding="utf-8")
            output={"market_date":"2026-07-10","records":[],"review_reasons":[]}
            (run1/"image.json").write_text(json.dumps(output),encoding="utf-8")
            (run2/"image.json").write_text(json.dumps(output),encoding="utf-8")
            result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
            self.assertEqual(result["metrics"]["row_column_accuracy"],0.0)

    def test_unrelated_review_reason_does_not_capture_numeric_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); truth=root/"truth"; truth.mkdir()
            run1=root/"run1"/"template_tesseract"; run1.mkdir(parents=True)
            run2=root/"run2"/"template_tesseract"; run2.mkdir(parents=True)
            expected={"record_type":"price","product":"ULSD_10ppm","location":"FOB Med","mid":100.0}
            actual={**expected,"mid":101.0}
            (truth/"image.json").write_text(json.dumps({
                "verification_status":"human_verified","reviewer":"tester",
                "verified_at":"2026-07-13T00:00:00Z","market_date":"2026-07-10","records":[expected],
            }),encoding="utf-8")
            output={"market_date":"2026-07-10","records":[actual],"review_reasons":["DATE_NOT_READ_FROM_IMAGE_TITLE"]}
            (run1/"image.json").write_text(json.dumps(output),encoding="utf-8")
            (run2/"image.json").write_text(json.dumps(output),encoding="utf-8")
            result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
            self.assertEqual(result["metrics"]["review_capture_rate"],0.0)

    def test_duplicate_output_prevents_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); truth=root/"truth"; truth.mkdir()
            run1=root/"run1"/"template_tesseract"; run1.mkdir(parents=True)
            run2=root/"run2"/"template_tesseract"; run2.mkdir(parents=True)
            record={"record_type":"price","product":"ULSD_10ppm","location":"FOB Med",
                    "code":"AAWYY00","mid":100.0,"change":-1.0,"unit":"USD/MT"}
            for index in range(10):
                name=f"image_{index}"
                (truth/f"{name}.json").write_text(json.dumps({
                    "verification_status":"human_verified","reviewer":"tester",
                    "verified_at":"2026-07-13T00:00:00Z","market_date":"2026-07-10","records":[record],
                }),encoding="utf-8")
                output={"market_date":"2026-07-10","records":[record,record],"review_reasons":[]}
                (run1/f"{name}.json").write_text(json.dumps(output),encoding="utf-8")
                (run2/f"{name}.json").write_text(json.dumps(output),encoding="utf-8")
            result=evaluate_parser(truth,root/"run1",root/"run2","template_tesseract")
            self.assertFalse(result["passed"])
            self.assertEqual(result["metrics"]["duplicate_free_rate"],0.0)


if __name__=="__main__": unittest.main()

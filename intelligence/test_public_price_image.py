import hashlib
import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
import yaml

from intelligence import public_price_image
from intelligence.public_price_image import PublicPriceImageError, create_public_price_image
from intelligence.daily_prices import promote_image_candidates
from intelligence.summary_image_support import PlattsSummaryRecord, PlattsSummaryTrialResult


ROOT = Path(__file__).resolve().parent.parent
SOURCE: Path
QR: Path
CONFIG = yaml.safe_load((ROOT / "intelligence" / "config" / "daily_prices.yaml").read_text(encoding="utf-8"))[
    "public_reference_image"
]
EXPECTED_QR_URL = "http://weixin.qq.com/r/mp/jDgnPxzEDUFyrVhc922e"
EXPECTED_TEMPLATE_VERSION = "platts-summary-adaptive-promo.v3"


class PublicPriceImageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture_directory = tempfile.TemporaryDirectory()
        fixture_root = Path(cls.fixture_directory.name)

        global SOURCE, QR
        SOURCE = fixture_root / "summary-source.png"
        source = np.full((532, 1280, 3), 244, dtype=np.uint8)
        cv2.rectangle(source, (35, 30), (880, 90), (55, 65, 75), -1)
        for row in range(130, 500, 42):
            cv2.line(source, (45, row), (885, row), (170, 170, 170), 2)
        if not cv2.imwrite(str(SOURCE), source):
            raise RuntimeError("Unable to create synthetic Summary fixture")

        QR = fixture_root / "wechat-qr.png"
        encoded = cv2.QRCodeEncoder_create().encode(EXPECTED_QR_URL)
        encoded = cv2.copyMakeBorder(
            encoded, 4, 4, 4, 4, cv2.BORDER_CONSTANT, value=255
        )
        encoded = cv2.resize(encoded, (344, 344), interpolation=cv2.INTER_NEAREST)
        if not cv2.imwrite(str(QR), encoded):
            raise RuntimeError("Unable to create synthetic QR fixture")
        if cv2.QRCodeDetector().detectAndDecode(encoded)[0] != EXPECTED_QR_URL:
            raise RuntimeError("Synthetic QR fixture is not decodable")

    @classmethod
    def tearDownClass(cls) -> None:
        cls.fixture_directory.cleanup()

    def assert_no_artifacts(self, output_path: Path) -> None:
        self.assertFalse(output_path.exists())
        self.assertFalse(output_path.with_name(f"{output_path.stem}_transform.json").exists())

    def test_creates_lossless_png_without_changing_pixels_outside_promo_roi(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "public_reference.png"

            result = create_public_price_image(SOURCE, QR, output_path, CONFIG)

            source = cv2.imread(str(SOURCE), cv2.IMREAD_COLOR)
            output = cv2.imread(str(output_path), cv2.IMREAD_COLOR)
            self.assertIsNotNone(source)
            self.assertIsNotNone(output)
            left, top, right, bottom = result.promo_roi
            self.assertGreaterEqual(left, int(source.shape[1] * 0.68))
            self.assertGreaterEqual(top, int(source.shape[0] * 0.55))
            self.assertEqual((right, bottom), (source.shape[1], source.shape[0]))
            self.assertEqual(output_path.suffix, ".png")
            self.assertEqual(output.shape, source.shape)
            self.assertTrue(np.array_equal(source[:top, :, :], output[:top, :, :]))
            self.assertTrue(np.array_equal(source[top:, :left, :], output[top:, :left, :]))
            self.assertEqual(result.qr_decoded_url, EXPECTED_QR_URL)
            self.assertEqual(result.template_version, EXPECTED_TEMPLATE_VERSION)
            self.assertEqual(cv2.QRCodeDetector().detectAndDecode(output)[0], EXPECTED_QR_URL)
            self.assertEqual(result.output_path, str(output_path))
            self.assertTrue(Path(result.output_path).is_file())

            manifest_path = output_path.with_name("public_reference_transform.json")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["promo_roi"], list(result.promo_roi))
            self.assertEqual(manifest["qr_decoded_url"], EXPECTED_QR_URL)
            self.assertEqual(manifest["template_version"], EXPECTED_TEMPLATE_VERSION)
            self.assertEqual(manifest["output_sha256"], result.output_sha256)

    def test_persisted_validation_rejects_tampered_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "public_reference.png"
            result = create_public_price_image(SOURCE, QR, output_path, CONFIG)
            output_path.write_bytes(b"not-a-png")

            with self.assertRaises(PublicPriceImageError):
                public_price_image.validate_public_price_image(
                    output_path,
                    CONFIG,
                    expected_source_sha256=result.source_sha256,
                    source_path=SOURCE,
                    qr_path=QR,
                )

    def test_persisted_validation_rejects_changes_outside_promo_roi_even_with_updated_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "public_reference.png"
            result = create_public_price_image(SOURCE, QR, output_path, CONFIG)
            image = cv2.imread(str(output_path), cv2.IMREAD_COLOR)
            image[0, 0] = (0, 0, 0)
            self.assertTrue(cv2.imwrite(str(output_path), image))
            manifest_path = output_path.with_name("public_reference_transform.json")
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["output_sha256"] = hashlib.sha256(output_path.read_bytes()).hexdigest()
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            with self.assertRaises(PublicPriceImageError):
                public_price_image.validate_public_price_image(
                    output_path,
                    CONFIG,
                    expected_source_sha256=result.source_sha256,
                    source_path=SOURCE,
                    qr_path=QR,
                )

    def test_accepts_supported_height_without_resizing_source(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            trimmed_source = temporary_path / "trimmed.png"
            source = cv2.imread(str(SOURCE), cv2.IMREAD_COLOR)
            self.assertTrue(cv2.imwrite(str(trimmed_source), source[:-2]))
            output_path = temporary_path / "public_reference.png"

            create_public_price_image(trimmed_source, QR, output_path, CONFIG)

            output = cv2.imread(str(output_path), cv2.IMREAD_COLOR)
            self.assertEqual((output.shape[1], output.shape[0]), (1280, source.shape[0] - 2))
            public_price_image.validate_public_price_image(
                output_path,
                CONFIG,
                expected_source_sha256=hashlib.sha256(trimmed_source.read_bytes()).hexdigest(),
                source_path=trimmed_source,
                qr_path=QR,
            )

    def test_accepts_taller_summary_layout_and_covers_promotion_to_bottom(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            taller_source = temporary_path / "taller.png"
            source = cv2.imread(str(SOURCE), cv2.IMREAD_COLOR)
            taller = cv2.copyMakeBorder(
                source, 0, 22, 0, 0, cv2.BORDER_CONSTANT, value=[255, 255, 255],
            )
            self.assertTrue(cv2.imwrite(str(taller_source), taller))
            output_path = temporary_path / "public_reference.png"

            result = create_public_price_image(taller_source, QR, output_path, CONFIG)
            output = cv2.imread(str(output_path), cv2.IMREAD_COLOR)

            left, top, right, bottom = result.promo_roi
            self.assertEqual((right, bottom), (1280, 554))
            self.assertEqual(output.shape, taller.shape)
            self.assertTrue(np.array_equal(taller[:top], output[:top]))
            self.assertTrue(np.array_equal(taller[top:, :left], output[top:, :left]))

    def test_accepts_scaled_summary_and_detects_promotion_area(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            scaled_source = temporary_path / "scaled.png"
            source = cv2.imread(str(SOURCE), cv2.IMREAD_COLOR)
            scaled = cv2.resize(source, (1267, 528), interpolation=cv2.INTER_AREA)
            self.assertTrue(cv2.imwrite(str(scaled_source), scaled))
            output_path = temporary_path / "public_reference.png"

            result = create_public_price_image(scaled_source, QR, output_path, CONFIG)
            output = cv2.imread(str(output_path), cv2.IMREAD_COLOR)

            self.assertEqual(output.shape, scaled.shape)
            self.assertLess(result.promo_roi[0], 950)
            self.assertEqual(result.promo_roi[2:], (1267, 528))
            left, top, _, _ = result.promo_roi
            self.assertTrue(np.array_equal(scaled[:top], output[:top]))
            self.assertTrue(np.array_equal(scaled[top:, :left], output[top:, :left]))
            self.assertEqual(cv2.QRCodeDetector().detectAndDecode(output)[0], EXPECTED_QR_URL)

    def test_accepts_1255_by_525_summary_layout(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            scaled_source = temporary_path / "scaled-1255x525.png"
            source = cv2.imread(str(SOURCE), cv2.IMREAD_COLOR)
            scaled = cv2.resize(source, (1255, 525), interpolation=cv2.INTER_AREA)
            self.assertTrue(cv2.imwrite(str(scaled_source), scaled))
            output_path = temporary_path / "public_reference.png"

            result = create_public_price_image(scaled_source, QR, output_path, CONFIG)

            self.assertEqual(result.promo_roi[2:], (1255, 525))
            self.assertEqual(
                cv2.QRCodeDetector().detectAndDecode(cv2.imread(str(output_path)))[0],
                EXPECTED_QR_URL,
            )

    def test_rejects_invalid_source_size_without_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            invalid_source = temporary_path / "wrong-size.png"
            source = cv2.imread(str(SOURCE), cv2.IMREAD_COLOR)
            self.assertTrue(cv2.imwrite(str(invalid_source), source[:-80]))
            output_path = temporary_path / "public_reference.png"

            with self.assertRaises(PublicPriceImageError):
                create_public_price_image(invalid_source, QR, output_path, CONFIG)

            self.assert_no_artifacts(output_path)

    def test_rejects_missing_qr_without_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "public_reference.png"

            with self.assertRaises(PublicPriceImageError):
                create_public_price_image(SOURCE, Path(temporary_directory) / "missing.jpg", output_path, CONFIG)

            self.assert_no_artifacts(output_path)

    def test_rejects_undecodable_qr_without_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            invalid_qr = temporary_path / "invalid-qr.png"
            self.assertTrue(cv2.imwrite(str(invalid_qr), np.full((344, 344, 3), 255, dtype=np.uint8)))
            output_path = temporary_path / "public_reference.png"

            with self.assertRaises(PublicPriceImageError):
                create_public_price_image(SOURCE, invalid_qr, output_path, CONFIG)

            self.assert_no_artifacts(output_path)

    def test_rejects_missing_chinese_font_without_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "public_reference.png"
            config = {**CONFIG, "font_candidates": [str(output_path.parent / "missing-font.ttc")]}

            with self.assertRaises(PublicPriceImageError):
                create_public_price_image(SOURCE, QR, output_path, config)

            self.assert_no_artifacts(output_path)

    def test_rejects_jpeg_output_without_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "public_reference.jpg"

            with self.assertRaises(PublicPriceImageError):
                create_public_price_image(SOURCE, QR, output_path, CONFIG)

            self.assert_no_artifacts(output_path)

    def test_atomic_write_failure_leaves_no_success_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "public_reference.png"

            with patch("intelligence.public_price_image.os.replace", side_effect=OSError("disk failure")):
                with self.assertRaises(PublicPriceImageError):
                    create_public_price_image(SOURCE, QR, output_path, CONFIG)

            self.assert_no_artifacts(output_path)

    def test_explicit_ocr_promotion_generates_public_reference_image(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            price_root = Path(temporary_directory) / "prices"
            trial_path = Path(temporary_directory) / "trial.json"
            trial = PlattsSummaryTrialResult(
                image_id="photo_169_20260711_114854",
                image_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                market_date="2026-07-10",
                parser="template_tesseract",
                duration_ms=100,
                records=[],
            )
            trial_path.write_text(json.dumps(trial.to_dict()), encoding="utf-8")

            promoted = promote_image_candidates(
                date(2026, 7, 10),
                trial_path,
                price_root,
                source_image=SOURCE,
                qr_image=QR,
            )

            target = price_root / "2026-07-10"
            self.assertEqual(promoted, target / "image_candidates.json")
            self.assertEqual(json.loads(promoted.read_text(encoding="utf-8")), [])
            self.assertTrue((target / "public_reference.png").is_file())
            manifest = json.loads((target / "public_reference_transform.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["source_sha256"], trial.image_sha256)

    def test_successful_generation_removes_stale_error_marker(self) -> None:
        from intelligence.daily_prices import _generate_public_reference

        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory)
            error_path = target / "public_reference_error.json"
            error_path.write_text('{"message":"old failure"}', encoding="utf-8")

            _generate_public_reference(SOURCE, QR, target)

            self.assertTrue((target / "public_reference.png").is_file())
            self.assertFalse(error_path.exists())

    def test_unresolved_review_reasons_promote_summary_arrival_but_not_ocr_numbers(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            price_root = Path(temporary_directory) / "prices"
            trial_path = Path(temporary_directory) / "trial.json"
            trial = PlattsSummaryTrialResult(
                image_id="photo_169_20260711_114854",
                image_sha256=hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
                market_date="2026-07-10",
                parser="template_tesseract",
                duration_ms=100,
                records=[PlattsSummaryRecord(
                    record_type="price",
                    product="Naphtha",
                    location="FOB Med",
                    mid_raw="650.50",
                    mid=650.5,
                    change_raw="-19.50",
                    change=-19.5,
                    currency="USD",
                    unit="USD/MT",
                    confidence=90,
                )],
                review_reasons=["FIELD_NEEDS_REVIEW:Naphtha:code"],
            )
            trial_path.write_text(json.dumps(trial.to_dict()), encoding="utf-8")

            promoted = promote_image_candidates(
                date(2026, 7, 10),
                trial_path,
                price_root,
                source_image=SOURCE,
                qr_image=QR,
            )

            self.assertEqual(json.loads(promoted.read_text(encoding="utf-8")), [])
            metadata = json.loads((promoted.parent / "image_promotion.json").read_text(encoding="utf-8"))
            self.assertEqual(metadata["review_status"], "blocked_unresolved_review")
            self.assertEqual(metadata["ocr_candidates_promoted"], 0)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import unittest
import tempfile
import hashlib
import json
import os
from datetime import date
from pathlib import Path
from unittest.mock import patch

import numpy as np

from intelligence.summary_image_worker import (
    article_content_signature,
    build_summary_article,
    find_existing_summary_draft,
    process_item,
    SummaryImageItem,
    verify_summary_draft,
)
from intelligence.telegram_ingest import CollectorConfig, build_dify_workflow_request
from intelligence.market_pipeline.digit_publication_scheduler import (
    publication_index_failed,
)
from intelligence.summary_image_support import (
    SUMMARY_TITLE_DATE_VERSION,
    SummaryTitleDateDetection,
    detect_market_date_from_image_title,
    market_date_from_title_text,
)


class SummaryTitleDateTests(unittest.TestCase):
    def test_strict_title_format_requires_comma(self) -> None:
        self.assertEqual(
            market_date_from_title_text("PLATTS SUMMARY July 24, 2026"),
            "2026-07-24",
        )
        self.assertIsNone(
            market_date_from_title_text("PLATTS SUMMARY July 24 2026")
        )
        self.assertEqual(
            market_date_from_title_text("PLATTS SUMMARY July &, 2026"),
            "2026-07-08",
        )
        self.assertIsNone(
            market_date_from_title_text("PLATTS SUMMARY February 30, 2026")
        )

    def test_consensus_reads_only_top_twelve_percent(self) -> None:
        image = np.zeros((1000, 1000, 3), dtype=np.uint8)
        outputs = [
            "PLATTS SUMMARY July 24, 2026",
            "PLATTS SUMMARY July 24, 2026",
            "noise",
            "noise",
            "noise",
            "noise",
        ]
        seen_shapes: list[tuple[int, ...]] = []

        def fake_ocr(candidate: np.ndarray, config: str) -> str:
            seen_shapes.append(candidate.shape)
            return outputs[len(seen_shapes) - 1]

        with patch(
            "intelligence.summary_image_support.configure_tesseract"
        ), patch("cv2.imread", return_value=image), patch(
            "pytesseract.image_to_string", side_effect=fake_ocr
        ):
            result = detect_market_date_from_image_title("fixture.jpg")

        self.assertEqual(result.market_date, "2026-07-24")
        self.assertEqual(result.version, SUMMARY_TITLE_DATE_VERSION)
        self.assertEqual(result.matched_count, 2)
        self.assertEqual(len(seen_shapes), 6)
        self.assertTrue(all(shape[0] == 360 for shape in seen_shapes))
        self.assertEqual(
            result.recognized_titles,
            (
                "PLATTS SUMMARY July 24, 2026",
                "PLATTS SUMMARY July 24, 2026",
            ),
        )

    def test_conflicting_dates_fail_closed(self) -> None:
        image = np.zeros((1000, 1000, 3), dtype=np.uint8)
        outputs = [
            "PLATTS SUMMARY July 24, 2026",
            "PLATTS SUMMARY July 24, 2026",
            "PLATTS SUMMARY July 25, 2026",
            "noise",
            "noise",
            "noise",
        ]
        with patch(
            "intelligence.summary_image_support.configure_tesseract"
        ), patch("cv2.imread", return_value=image), patch(
            "pytesseract.image_to_string", side_effect=outputs
        ):
            result = detect_market_date_from_image_title("fixture.jpg")

        self.assertIsNone(result.market_date)
        self.assertEqual(result.failure_reason, "MARKET_DATE_CONFLICT")


class SummaryDraftTests(unittest.TestCase):
    def test_article_embeds_uploaded_body_image(self) -> None:
        article = build_summary_article(
            {"content_source_url": "", "need_open_comment": 0},
            "2026-07-24",
            "https://mmbiz.qpic.cn/body-image",
            "thumb-media-id",
        )
        self.assertEqual(article["author"], "能见社")
        self.assertIn("每日普氏价格", article["title"])
        self.assertIn('<img src="https://mmbiz.qpic.cn/body-image"', article["content"])
        self.assertNotIn("涨跌", article["content"])
        self.assertNotIn("历史比较", article["content"])
        self.assertIn("资料来源：</strong>Platts Summary 报价图片", article["content"])
        self.assertIn("免责声明：</strong>", article["content"])

    def test_draft_readback_checks_title_author_date_image_and_hash(self) -> None:
        article = build_summary_article(
            {"content_source_url": "", "need_open_comment": 0},
            "2026-07-24",
            "https://mmbiz.qpic.cn/body-image",
            "thumb-media-id",
        )
        with patch(
            "intelligence.summary_image_worker.get_draft",
            return_value={"news_item": [{
                "title": article["title"],
                "author": article["author"],
                "content": article["content"],
            }]},
        ):
            result = verify_summary_draft("token", "media-id", article)
        self.assertTrue(result["verified"])
        self.assertTrue(result["content_hash"])

    def test_existing_matching_draft_is_recovered_before_create(self) -> None:
        article = build_summary_article(
            {"content_source_url": "", "need_open_comment": 0},
            "2026-07-24",
            "https://mmbiz.qpic.cn/body-image",
            "thumb-media-id",
        )
        with patch(
            "intelligence.summary_image_worker.batch_get_drafts",
            return_value={"item": [{
                "media_id": "existing-media-id",
                "content": {"news_item": [{
                    "title": article["title"],
                    "author": article["author"],
                    "content": article["content"],
                }]},
            }]},
        ):
            media_id = find_existing_summary_draft("token", article)
        self.assertEqual(media_id, "existing-media-id")

    def test_wechat_attribute_normalization_keeps_content_signature(self) -> None:
        local = (
            '<section><p>市场日期：2026-07-24</p>'
            '<img src="https://mmbiz.qpic.cn/body-image"></section>'
        )
        remote = (
            '<section class="js_darkmode__1"><p style="margin:0;">'
            '市场日期：2026-07-24</p><img data-ratio="1" '
            'src="https://mmbiz.qpic.cn/rewritten-body-image"></section>'
        )
        self.assertEqual(
            article_content_signature(local),
            article_content_signature(remote),
        )

    def test_market_dates_before_start_are_skipped_before_qr_or_wechat(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "summary.jpg"
            source.write_bytes(b"fixture")
            item = SummaryImageItem(
                attachment_id=None,
                source_path=source,
                source_sha256=hashlib.sha256(b"fixture").hexdigest(),
            )
            with patch(
                "intelligence.summary_image_worker.detect_market_date_from_image_title",
                return_value=SummaryTitleDateDetection(
                    market_date="2026-07-25",
                    version=SUMMARY_TITLE_DATE_VERSION,
                    matched_count=2,
                    unique_dates=("2026-07-25",),
                    recognized_titles=("PLATTS SUMMARY July 25, 2026",) * 2,
                ),
            ), patch(
                "intelligence.summary_image_worker.promote_summary_image_quote"
            ) as promote:
                result = process_item(
                    item,
                    connection=None,
                    action="draft",
                    dry_run=False,
                    config_path=Path("unused.json"),
                    market_date_from=date(2026, 7, 26),
                )
            self.assertEqual(result["status"], "skipped_before_start_date")
            promote.assert_not_called()


class DownstreamDifyContractTests(unittest.TestCase):
    def test_queued_worker_contract_keeps_inputs_and_top_level_files(self) -> None:
        config = CollectorConfig(
            content_type="documents",
            dify_file_type="document",
            dify_user="collector",
        )
        request = build_dify_workflow_request(
            config,
            {
                "source_channel": "telegram:platts-digital",
                "source_message_id": "123",
                "sender_label": "publisher",
                "media_type": "application/pdf",
                "file_name": "report.pdf",
                "file_hash": "a" * 64,
                "file_size_bytes": 100,
                "message_timestamp": "2026-07-24T10:00:00+00:00",
                "storage_path": "/tmp/report.pdf",
                "source_url": None,
                "raw_payload_json": {"caption": "caption"},
            },
            {"id": "queue-id"},
            {"id": "upload-id"},
            raw_text="document text",
        )
        self.assertEqual(request["inputs"]["raw_text"], "document text")
        self.assertIn("template_id", request["inputs"])
        self.assertIn("template_task", request["inputs"])
        self.assertIn("template_schema", request["inputs"])
        self.assertEqual(request["files"], [request["inputs"]["source_file"]])


class DigitSchedulerTests(unittest.TestCase):
    def test_failed_publication_index_is_a_scheduler_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            index = vault / "reports" / "digit" / "2026-07-27" / "index.json"
            index.parent.mkdir(parents=True)
            index.write_text(json.dumps({"status": "failed"}), encoding="utf-8")
            with patch.dict(os.environ, {"OBSIDIAN_VAULT": str(vault)}):
                self.assertTrue(publication_index_failed(date(2026, 7, 27)))
            index.write_text(json.dumps({"status": "complete"}), encoding="utf-8")
            with patch.dict(os.environ, {"OBSIDIAN_VAULT": str(vault)}):
                self.assertFalse(publication_index_failed(date(2026, 7, 27)))

    def test_quality_rejection_is_not_a_system_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            vault = Path(directory)
            index = vault / "reports" / "digit" / "2026-08-14" / "index.json"
            index.parent.mkdir(parents=True)
            index.write_text(json.dumps({
                "status": "failed",
                "articles": [{"publication_status": "review_rejected"}],
            }), encoding="utf-8")
            with patch.dict(os.environ, {"OBSIDIAN_VAULT": str(vault)}):
                self.assertFalse(publication_index_failed(date(2026, 8, 14)))

            index.write_text(json.dumps({
                "status": "failed",
                "articles": [{"publication_status": "generation_failed"}],
            }), encoding="utf-8")
            with patch.dict(os.environ, {"OBSIDIAN_VAULT": str(vault)}):
                self.assertTrue(publication_index_failed(date(2026, 8, 14)))


if __name__ == "__main__":
    unittest.main()

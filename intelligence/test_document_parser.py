from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from intelligence.market_pipeline.contracts import (
    MARKET_PIPELINE_SCHEMA_VERSION,
    AttachmentMessageType,
    DateCandidateSource,
    DocumentProcessingStatus,
    MarketPipelineMode,
    ParseMethod,
    TelegramAttachment,
    TelegramInput,
    TelegramMessage,
)
from intelligence.market_pipeline.document_parser import (
    _split_sections,
    _looks_like_price_table_page,
    _supports_structured_pdf_tables,
    _detect_publisher,
    _select_market_date,
    collect_date_candidates,
    parse_telegram_document,
)


class DocumentParserTest(unittest.TestCase):
    def telegram_input(self, path: Path, mime: str, content_hash: str = "a" * 64) -> TelegramInput:
        return TelegramInput(
            schema_version=MARKET_PIPELINE_SCHEMA_VERSION,
            pipeline_version=MARKET_PIPELINE_SCHEMA_VERSION,
            pipeline_mode=MarketPipelineMode.SHADOW,
            source_channel="telegram:platts",
            message=TelegramMessage(
                telegram_chat_id="-1001",
                telegram_message_id="42",
                telegram_message_date=datetime(2026, 7, 11, 1, 0, tzinfo=timezone.utc),
                message_type=AttachmentMessageType.DOCUMENT,
                ingested_at=datetime(2026, 7, 11, 1, 1, tzinfo=timezone.utc),
            ),
            attachment=TelegramAttachment(
                attachment_name=path.name,
                attachment_path=str(path),
                attachment_mime_type=mime,
                attachment_hash=content_hash,
                attachment_size_bytes=path.stat().st_size,
            ),
        )

    def test_date_priority_preserves_all_candidates(self) -> None:
        candidates = collect_date_candidates(
            "Market Report 2026-07-09\nAssessment date: 2026-07-08\n"
            "Published on 2026-07-10\nBody context dated 2026-07-07",
            "report-20260706.txt",
            datetime(2026, 7, 11, tzinfo=timezone.utc),
        )
        self.assertEqual(candidates[0].source, DateCandidateSource.ASSESSMENT)
        self.assertEqual(str(candidates[0].value), "2026-07-08")
        self.assertIn(DateCandidateSource.FILENAME, {item.source for item in candidates})
        self.assertIn(DateCandidateSource.TELEGRAM, {item.source for item in candidates})

    def test_short_newspaper_filename_uses_telegram_year(self) -> None:
        candidates = collect_date_candidates(
            "No explicit date", "NYT 0907.pdf", datetime(2026, 7, 10, tzinfo=timezone.utc)
        )
        filename = next(item for item in candidates if item.source == DateCandidateSource.FILENAME)
        self.assertEqual(str(filename.value), "2026-07-09")

    def test_issue_date_later_in_document_beats_telegram_date(self) -> None:
        text = "\n".join(["LPG price table"] * 120) + "\nVolume 48 / Issue 105 / June 1, 2026\nMarket Commentary"
        telegram_date = datetime(2026, 6, 2, tzinfo=timezone.utc)
        candidates = collect_date_candidates(text, "LPGaswire.pdf", telegram_date)
        selected, _ = _select_market_date(candidates, telegram_date)
        self.assertEqual(selected.source, DateCandidateSource.BODY)
        self.assertEqual(str(selected.value), "2026-06-01")

    def test_stale_inner_date_does_not_override_current_issue_filename(self) -> None:
        telegram_date = datetime(2026, 7, 10, tzinfo=timezone.utc)
        candidates = collect_date_candidates(
            "The Guardian May 1, 2024\nMorning edition", "The Guardian UK - 8 July 2026.pdf", telegram_date
        )
        selected, reason = _select_market_date(candidates, telegram_date)
        self.assertEqual(str(selected.value), "2026-07-08")
        self.assertIn("rejected stale", reason)

    def test_filename_publisher_beats_syndicated_article_credit(self) -> None:
        publisher, confidence = _detect_publisher(
            "The Wall Street Journal - July 8, 2026.pdf",
            "A Reuters dispatch appeared inside the issue.",
            None,
        )
        self.assertEqual(publisher, "The Wall Street Journal")
        self.assertGreater(confidence, 0.9)
        ft_publisher, _ = _detect_publisher("FT0807US.pdf", "", None)
        self.assertEqual(ft_publisher, "Financial Times")

    def test_text_parsing_identifies_publisher_sections_and_date(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "platts-marketscan-20260710.txt"
            path.write_text(
                "S&P Global Commodity Insights\nAssessment date: 2026-07-09\n"
                "ASIA NAPHTHA\nNaphtha strengthened as regional supply tightened.\n"
                "EUROPE GASOIL\nGasoil cracks weakened on refinery restarts.",
                encoding="utf-8",
            )
            output = Path(temporary_directory) / "parsed"
            source = parse_telegram_document(self.telegram_input(path, "text/plain"), parsed_text_dir=output)
            self.assertEqual(source.document.publisher, "Platts")
            self.assertEqual(str(source.document.market_date), "2026-07-09")
            self.assertEqual(source.content.parse_method, ParseMethod.PLAIN_TEXT)
            self.assertGreaterEqual(len(source.content.sections), 2)
            self.assertTrue(Path(source.content.raw_text_path or "").exists())
            self.assertEqual(source.status.processing_status, DocumentProcessingStatus.PARSED)

    def test_html_uses_visible_text_only(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "argus-20260710.html"
            path.write_text(
                "<html><body><h1>Argus Oil Market 2026-07-10</h1>"
                "<p>EUROPE CRUDE</p><p>North Sea supply tightened.</p></body></html>",
                encoding="utf-8",
            )
            source = parse_telegram_document(self.telegram_input(path, "text/html", "b" * 64))
            self.assertEqual(source.document.publisher, "Argus")
            self.assertEqual(source.content.parse_method, ParseMethod.HTML)
            self.assertNotIn("<p>", source.content.parsed_text)

    def test_image_is_never_sent_to_ocr(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "scan.png"
            path.write_bytes(b"not-an-image-parser-input")
            source = parse_telegram_document(self.telegram_input(path, "image/png", "c" * 64))
            self.assertEqual(source.content.parse_method, ParseMethod.IMAGE_ONLY)
            self.assertTrue(source.status.needs_review)
            self.assertIn("production OCR is disabled", source.status.review_reasons[0])

    def test_low_text_pdf_needs_review(self) -> None:
        import fitz

        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "scan-20260710.pdf"
            document = fitz.open()
            document.new_page().insert_text((72, 72), "Platts")
            document.save(path)
            document.close()
            source = parse_telegram_document(self.telegram_input(path, "application/pdf", "d" * 64))
            self.assertEqual(source.content.parse_method, ParseMethod.PDF_TEXT)
            self.assertEqual(source.status.processing_status, DocumentProcessingStatus.NEEDS_REVIEW)
            self.assertTrue(any("low-text PDF" in reason for reason in source.status.review_reasons))

    def test_source_id_is_idempotent_for_same_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            first = Path(temporary_directory) / "first.txt"
            second = Path(temporary_directory) / "second.txt"
            text = "Reuters Oil Report 2026-07-10\n" + "Crude supply remained tight. " * 20
            first.write_text(text, encoding="utf-8")
            second.write_text(text, encoding="utf-8")
            first_source = parse_telegram_document(self.telegram_input(first, "text/plain", "e" * 64))
            second_source = parse_telegram_document(self.telegram_input(second, "text/plain", "e" * 64))
            self.assertEqual(first_source.source_id, second_source.source_id)

    def test_table_detection_only_targets_numeric_price_pages(self) -> None:
        self.assertFalse(_looks_like_price_table_page("Market commentary with one price at 81.20"))
        self.assertTrue(
            _looks_like_price_table_page(
                "Assessment low high change\nNaphtha 700.10 702.20 +1.20\nGasoil 810.00 812.00 -2.00"
            )
        )
        self.assertTrue(_supports_structured_pdf_tables("US Marketscan_07 Jul 2026.pdf"))
        self.assertFalse(_supports_structured_pdf_tables("NYT International 0907.pdf"))

    def test_page_internal_market_headings_create_separate_sections(self) -> None:
        from intelligence.market_pipeline.document_parser import PageText

        sections = _split_sections("SRC-test", [PageText(1, """
Executive Summary
Supply risks increased after the refinery outage.
1. Market Review
Diesel assessments rose to $92.45/mt.
Trade Flows
Cargo exports slowed during the week.
Page 1
""")])
        self.assertEqual([section.section_title for section in sections], [
            "Executive Summary", "1. Market Review", "Trade Flows",
        ])
        self.assertTrue(all("Page 1" not in section.text for section in sections))

    def test_heading_detector_rejects_page_headers_and_sentences(self) -> None:
        from intelligence.market_pipeline.document_parser import _looks_like_heading

        self.assertFalse(_looks_like_heading("Page 3"))
        self.assertFalse(_looks_like_heading("www.example.com 3"))
        self.assertFalse(_looks_like_heading("The market strengthened after the outage."))
        self.assertFalse(_looks_like_heading("2024. Venture capital investment recovered"))


if __name__ == "__main__":
    unittest.main()

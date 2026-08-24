import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from intelligence.content_streams import (
    ArticleLocator,
    build_publication_key,
    resolve_article_paths,
)
from intelligence import wechat_publish


class ContentStreamTests(unittest.TestCase):
    def test_summary_and_digit_paths_never_collide(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory) / "reports"
            summary = resolve_article_paths(ArticleLocator("summary", date(2026, 7, 10)), root)
            digit = resolve_article_paths(
                ArticleLocator("digit", date(2026, 7, 10), "crude-supply"), root
            )

        self.assertEqual(summary.markdown, root / "summary" / "2026-07-10.md")
        self.assertEqual(digit.markdown, root / "digit" / "2026-07-10" / "crude-supply.md")
        self.assertEqual(summary.wechat_html, root / "summary" / "2026-07-10_wechat.html")
        self.assertEqual(digit.wechat_html, root / "digit" / "2026-07-10" / "crude-supply_wechat.html")
        self.assertNotEqual(summary.publish_state_dir, digit.publish_state_dir)

    def test_publication_keys_include_the_stream_specific_identity(self) -> None:
        self.assertEqual(
            build_publication_key(ArticleLocator("summary", date(2026, 7, 10))),
            "summary-image:2026-07-10",
        )
        self.assertEqual(
            build_publication_key(ArticleLocator("digit", date(2026, 7, 10), "crude-supply")),
            "digit:2026-07-10:crude-supply",
        )

    def test_locator_requires_the_correct_slug_shape_for_each_stream(self) -> None:
        with self.assertRaisesRegex(ValueError, "summary stream does not accept article_slug"):
            ArticleLocator("summary", date(2026, 7, 10), "crude-supply")
        with self.assertRaisesRegex(ValueError, "digit stream requires article_slug"):
            ArticleLocator("digit", date(2026, 7, 10))

    def test_digit_slug_rejects_linux_and_windows_path_traversal(self) -> None:
        invalid_slugs = (
            ".", "..", "../outside", r"..\outside", "/tmp/outside",
            r"C:\outside", r"\\server\share", "crude.md", "crude/supply", r"crude\supply",
        )
        for article_slug in invalid_slugs:
            with self.subTest(article_slug=article_slug), self.assertRaisesRegex(
                ValueError, "article_slug"
            ):
                ArticleLocator("digit", date(2026, 7, 10), article_slug)

    def test_locator_rejects_unknown_stream(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported content stream"):
            ArticleLocator("other", date(2026, 7, 10))  # type: ignore[arg-type]

    def test_same_day_digit_slugs_have_distinct_article_and_quality_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory) / "reports"
            crude_supply = resolve_article_paths(
                ArticleLocator("digit", date(2026, 7, 10), "crude-supply"), root
            )
            refinery_outages = resolve_article_paths(
                ArticleLocator("digit", date(2026, 7, 10), "refinery-outages"), root
            )

        self.assertEqual(crude_supply.markdown, root / "digit" / "2026-07-10" / "crude-supply.md")
        self.assertEqual(
            refinery_outages.markdown,
            root / "digit" / "2026-07-10" / "refinery-outages.md",
        )
        self.assertNotEqual(
            crude_supply.publish_state_path("draft"),
            refinery_outages.publish_state_path("draft"),
        )
        self.assertNotEqual(crude_supply.quality_audit, refinery_outages.quality_audit)
        self.assertNotEqual(crude_supply.llm_review, refinery_outages.llm_review)

    def test_quality_loaders_keep_summary_and_digit_files_separate(self) -> None:
        summary_locator = ArticleLocator("summary", date(2026, 7, 10))
        digit_locator = ArticleLocator("digit", date(2026, 7, 10), "crude-supply")
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory) / "reports"
            legacy_quality_dir = root / "quality"
            summary_paths = resolve_article_paths(summary_locator, root)
            digit_paths = resolve_article_paths(digit_locator, root)
            for path, payload in (
                (summary_paths.quality_audit, '{"status": "summary"}'),
                (summary_paths.llm_review, '{"status": "summary-review"}'),
                (digit_paths.quality_audit, '{"status": "digit"}'),
                (digit_paths.llm_review, '{"status": "digit-review"}'),
                (legacy_quality_dir / "2026-07-10.json", '{"status": "legacy"}'),
                (legacy_quality_dir / "2026-07-10_llm_review.json", '{"status": "legacy-review"}'),
            ):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(payload, encoding="utf-8")

            with patch.object(wechat_publish, "REPORTS_DIR", root), patch.object(
                wechat_publish, "QUALITY_DIR", legacy_quality_dir
            ):
                summary_quality = wechat_publish.load_quality_audit(summary_locator)
                digit_quality = wechat_publish.load_quality_audit(digit_locator)
                summary_review = wechat_publish.load_llm_review(summary_locator)
                digit_review = wechat_publish.load_llm_review(digit_locator)
                legacy_quality = wechat_publish.load_quality_audit(None, "2026-07-10")
                legacy_review = wechat_publish.load_llm_review(None, "2026-07-10")

        self.assertNotEqual(summary_paths.quality_audit, digit_paths.quality_audit)
        self.assertEqual(summary_quality["status"], "summary")
        self.assertEqual(digit_quality["status"], "digit")
        self.assertEqual(summary_review["status"], "summary-review")
        self.assertEqual(digit_review["status"], "digit-review")
        self.assertEqual(legacy_quality["status"], "legacy")
        self.assertEqual(legacy_review["status"], "legacy-review")

    def test_wechat_publisher_uses_locator_for_stream_artifacts(self) -> None:
        locator = ArticleLocator("digit", date(2026, 7, 10), "crude-supply")
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory) / "reports"
            paths = resolve_article_paths(locator, root)
            paths.markdown.parent.mkdir(parents=True)
            paths.markdown.write_text("# Crude supply", encoding="utf-8")
            paths.wechat_html.write_text("<p>Crude supply</p>", encoding="utf-8")

            original_reports_dir = wechat_publish.REPORTS_DIR
            wechat_publish.REPORTS_DIR = root
            try:
                bundle = wechat_publish.read_report_bundle(locator, "daily")
                state_path = wechat_publish.build_publish_state_path(locator, "draft")
                preview_path = wechat_publish.build_preview_html_path(locator, "draft")
                payload_path = wechat_publish.build_payload_path(locator, "draft")
            finally:
                wechat_publish.REPORTS_DIR = original_reports_dir

        self.assertEqual(bundle["md_path"], paths.markdown)
        self.assertEqual(bundle["html_path"], paths.wechat_html)
        self.assertEqual(state_path, root / "wechat_publish" / "digit" / "2026-07-10_crude-supply_draft.json")
        self.assertEqual(preview_path, root / "wechat_publish" / "digit" / "2026-07-10_crude-supply_draft_preview.html")
        self.assertEqual(payload_path, root / "wechat_publish" / "digit" / "2026-07-10_crude-supply_draft_payload.json")

    def test_wechat_publisher_uses_locator_for_summary_artifacts(self) -> None:
        locator = ArticleLocator("summary", date(2026, 7, 10))
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory) / "reports"
            paths = resolve_article_paths(locator, root)
            paths.markdown.parent.mkdir(parents=True)
            paths.markdown.write_text("# Summary", encoding="utf-8")
            paths.wechat_html.write_text("<p>Summary</p>", encoding="utf-8")

            with patch.object(wechat_publish, "REPORTS_DIR", root):
                bundle = wechat_publish.read_report_bundle(locator, "daily")
                state_path = wechat_publish.build_publish_state_path(locator, "draft")
                preview_path = wechat_publish.build_preview_html_path(locator, "draft")
                payload_path = wechat_publish.build_payload_path(locator, "draft")

        self.assertEqual(bundle["md_path"], paths.markdown)
        self.assertEqual(bundle["html_path"], paths.wechat_html)
        self.assertEqual(state_path, root / "wechat_publish" / "summary" / "2026-07-10_draft.json")
        self.assertEqual(preview_path, root / "wechat_publish" / "summary" / "2026-07-10_draft_preview.html")
        self.assertEqual(payload_path, root / "wechat_publish" / "summary" / "2026-07-10_draft_payload.json")

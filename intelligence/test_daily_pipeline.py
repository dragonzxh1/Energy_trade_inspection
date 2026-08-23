import tempfile
import unittest
import sys
import hashlib
import json
import os
import re
import subprocess
from datetime import date, datetime
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import daily_report
import wechat_publish
from intelligence import pending_wechat_publish
from intelligence.content_streams import ArticleLocator, build_publication_key, resolve_article_paths


def sample_report(markdown: str) -> dict:
    return {
        "report_markdown": markdown,
        "report_wechat_html": "",
        "summary": "市场摘要",
        "publishable": True,
        "publish_reason": "",
    }


def approved_artifact_identity(
    locator: ArticleLocator,
    markdown: str,
    wechat_html: str,
    summary: str,
) -> dict:
    return {
        "publication_key": build_publication_key(locator),
        "artifact_sha256": {
            "markdown": hashlib.sha256(markdown.encode("utf-8")).hexdigest(),
            "wechat_html": hashlib.sha256(wechat_html.encode("utf-8")).hexdigest(),
            "summary": hashlib.sha256(summary.encode("utf-8")).hexdigest(),
        },
    }


class TranslationSelectionTests(unittest.TestCase):
    def test_strategic_chokepoint_ranks_before_generic_price(self) -> None:
        extractions = [{
            "_source": {"filename": "news.pdf"},
            "items": [
                {
                    "category": "原油",
                    "signal_type": "价格",
                    "raw_text": "Brent crude moved by 2 percent during the session as traders adjusted positions.",
                    "key_data": "2 percent",
                    "confidence": "高",
                },
                {
                    "category": "航运",
                    "signal_type": "事件",
                    "raw_text": "Ships transiting the Strait of Hormuz may be required to pay a new service fee, changing the cost of moving Gulf oil and gas.",
                    "key_data": "new service fee",
                    "confidence": "高",
                },
            ],
        }]
        candidates = daily_report.collect_translation_candidates(extractions, 2)
        self.assertEqual(candidates[0][0], "0:1")


class ReviewContractTests(unittest.TestCase):
    def test_review_requires_score_and_no_blockers(self) -> None:
        passing = daily_report.normalize_review_result({
            "decision": "pass",
            "score": 90,
            "dimension_scores": {
                "factuality": 23,
                "translation_fidelity": 18,
                "analytical_depth": 23,
                "readability": 13,
                "publication_safety": 13,
            },
            "blocking_issues": [],
        })
        blocked = daily_report.normalize_review_result({
            "decision": "pass",
            "score": 96,
            "blocking_issues": ["数字与原文不一致"],
        })
        self.assertTrue(daily_report.review_result_passes(passing))
        self.assertFalse(daily_report.review_result_passes(blocked))

    def test_pass_with_advisory_defect_is_rejected(self) -> None:
        review = daily_report.normalize_review_result({
            "decision": "pass",
            "score": 90,
            "dimension_scores": {
                "factuality": 23,
                "translation_fidelity": 18,
                "analytical_depth": 23,
                "readability": 13,
                "publication_safety": 13,
            },
            "blocking_issues": [],
            "revision_instructions": [],
            "summary": "一处表述与证据不完全吻合，建议修正。",
        })
        self.assertFalse(daily_report.review_result_passes(review))

    def test_markdown_renderer_escapes_dangerous_html(self) -> None:
        markdown = "# 能源市场日报｜2026-07-01\n\n> 摘要\n\n## 关键事实\n- <script>alert(1)</script>"
        rendered = wechat_publish.markdown_to_report_html(markdown, "摘要", "2026-07-01")
        self.assertNotIn("<script>", rendered)
        self.assertIn("&lt;script&gt;", rendered)


class WeChatPriceRenderingTests(unittest.TestCase):
    def test_summary_payload_uses_pre_rendered_summary_html_without_news_renderer(self) -> None:
        locator = ArticleLocator("summary", date(2026, 7, 10))
        summary_html = '<article><h1>价格表</h1><table><tr><td>1,051.25</td></tr></table></article>'
        bundle = {
            "markdown": "# 价格表\n\n市场日期：2026年7月10日\n\n单位：美元/吨",
            "html": summary_html,
            "summary": "",
        }

        with patch.object(wechat_publish, "build_wechat_content", side_effect=AssertionError), \
                patch("intelligence.daily_prices.validate_public_reference", return_value=(True, [])), \
                patch.object(wechat_publish, "compute_file_sha256", return_value="a" * 64):
            article = wechat_publish.build_article_payload({}, bundle, "2026-07-10", locator=locator)

        self.assertIn(summary_html.removesuffix("</article>"), article["content"])
        self.assertIn("data-eti-price-reference", article["content"])
        self.assertTrue(article["reference_image_present"])

    def test_summary_preflight_uses_summary_quality_without_news_article_requirements(self) -> None:
        locator = ArticleLocator("summary", date(2026, 7, 10))
        summary_html = '<article><h1>能源市场价格表｜2026-07-10</h1><table><tr><td>1,051.25</td></tr></table></article>'
        bundle = {
            "markdown": "# 能源市场价格表｜2026-07-10\n\n市场日期：2026年7月10日\n\n单位：美元/吨",
            "html": summary_html,
            "summary": "",
            "md_path": Path("summary.md"),
            "html_path": Path("summary.html"),
            "summary_path": Path("summary.txt"),
        }
        with tempfile.TemporaryDirectory() as temporary_directory, patch.object(
            wechat_publish, "REPORTS_DIR", Path(temporary_directory) / "reports"
        ), patch("intelligence.daily_prices.validate_public_reference", return_value=(True, [])), patch.object(
            wechat_publish, "compute_file_sha256", return_value="a" * 64
        ):
            paths = resolve_article_paths(locator, wechat_publish.REPORTS_DIR)
            paths.quality_audit.parent.mkdir(parents=True)
            paths.quality_audit.write_text('{"status":"pass","issues":[]}', encoding="utf-8")
            article = wechat_publish.build_article_payload({}, bundle, "2026-07-10", locator=locator)
            preview = wechat_publish.build_preflight_report({}, bundle, article, "2026-07-10", "draft", locator)

        self.assertEqual(preview["quality_status"], "pass")
        self.assertFalse(any("article body too short" in issue for issue in preview["issues"]))
        self.assertFalse(any("section headings" in issue for issue in preview["issues"]))
    def test_renders_grouped_mobile_price_blocks_without_tables_and_escapes_fields(self) -> None:
        sections = [{
            "title": "今日价格速览",
            "paragraphs": ["市场日期：2026年7月10日｜单位：美元/吨"],
            "items": [
                "欧洲市场｜低硫<柴油>｜FOB & Med｜1,051.25｜-14.00",
                "欧洲市场｜石脑油｜CIF NWE｜935.57｜+11.32",
                "亚太与中东｜航空煤油｜Singapore｜88.00｜+0.00",
            ],
        }]

        rendered = wechat_publish.render_wechat_body(
            "能源市场日报｜2026-07-10",
            "摘要",
            "导语",
            sections,
            "2026-07-10",
            preview=False,
            include_price_reference=True,
        )

        self.assertEqual(rendered.count(">欧洲市场<"), 1)
        self.assertEqual(rendered.count(">亚太与中东<"), 1)
        self.assertIn("text-align:right", rendered)
        self.assertIn("-14.00", rendered)
        self.assertIn("+11.32", rendered)
        self.assertIn("涨跌 -14.00", rendered)
        self.assertIn('aria-label="涨跌 -14.00" style="font-size:12px;color:#b91c1c;"', rendered)
        self.assertIn('aria-label="涨跌 +11.32" style="font-size:12px;color:#047857;"', rendered)
        self.assertIn('aria-label="涨跌 +0.00" style="font-size:12px;color:#374151;"', rendered)
        self.assertIn("低硫&lt;柴油&gt;", rendered)
        self.assertIn("FOB &amp; Med", rendered)
        self.assertNotIn("<table", rendered.lower())
        self.assertNotIn("<script", rendered.lower())
        self.assertNotIn("<link", rendered.lower())
        self.assertNotIn("<style", rendered.lower())
        self.assertEqual(rendered.count(wechat_publish.ARTICLE_IMAGE_TOKEN), 1)


class WeChatArticleImageTests(unittest.TestCase):
    def test_publication_leak_detection_handles_terms_next_to_chinese_text(self) -> None:
        for leaked_text in ("Telegram渠道", "OCR识别", "bot采集", "AI工具", "自动生成"):
            with self.subTest(leaked_text=leaked_text):
                self.assertTrue(wechat_publish.publication_leaks(leaked_text))

    def test_upload_uses_uploadimg_media_field_and_requires_https_url(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            image_path = Path(temporary_directory) / "public_reference.png"
            image_path.write_bytes(b"png")
            with patch.object(
                wechat_publish,
                "http_post_multipart",
                return_value={"url": "https://mmbiz.qpic.cn/example.png"},
            ) as post:
                image_url = wechat_publish.upload_article_image("access token", image_path)

        self.assertEqual(image_url, "https://mmbiz.qpic.cn/example.png")
        upload_url, field_name, uploaded_path = post.call_args.args
        self.assertIn("/cgi-bin/media/uploadimg?", upload_url)
        self.assertIn("access_token=access+token", upload_url)
        self.assertEqual(field_name, "media")
        self.assertEqual(uploaded_path, image_path)

    def test_upload_upgrades_wechat_legacy_http_url(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            image_path = Path(temporary_directory) / "public_reference.png"
            image_path.write_bytes(b"png")
            with patch.object(
                wechat_publish,
                "http_post_multipart",
                return_value={"url": "http://mmbiz.qpic.cn/example.png?from=appmsg"},
            ):
                image_url = wechat_publish.upload_article_image("access token", image_path)

        self.assertEqual(image_url, "https://mmbiz.qpic.cn/example.png?from=appmsg")

    def test_wechat_readback_accepts_data_src_and_normalized_size(self) -> None:
        expected = "https://mmbiz.qpic.cn/path/image/0?from=appmsg"
        content = f'<img data-src="https://mmbiz.qpic.cn/path/image/640?from=appmsg">'

        self.assertEqual(wechat_publish.article_image_sources(content), [
            "https://mmbiz.qpic.cn/path/image/640?from=appmsg"
        ])
        wechat_publish.ensure_final_article_content(content, expected)

    def test_upload_fails_closed_for_api_errors_and_invalid_urls(self) -> None:
        invalid_responses = [
            {"errcode": 40001, "errmsg": "invalid credential"},
            {"url": ""},
            {"url": "http://example.com/reference.png"},
            {"url": "file:///tmp/reference.png"},
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            image_path = Path(temporary_directory) / "public_reference.png"
            image_path.write_bytes(b"png")
            for response in invalid_responses:
                with self.subTest(response=response), patch.object(
                    wechat_publish, "http_post_multipart", return_value=response
                ):
                    with self.assertRaises(RuntimeError):
                        wechat_publish.upload_article_image("token", image_path)

    def test_upload_failure_omits_reference_image_but_keeps_structured_prices_and_warns(self) -> None:
        content = (
            "<h2>今日价格速览</h2><section>欧洲市场｜低硫柴油｜1,051.25｜-14.00</section>"
            f'<section data-eti-price-reference="true">{wechat_publish.ARTICLE_IMAGE_TOKEN}</section>'
        )
        article = {"content": content, "preview_html": content}

        with patch.object(wechat_publish, "upload_article_image", side_effect=RuntimeError("upload failed")):
            warnings = wechat_publish.prepare_article_image(
                article, "token", Path("public_reference.png")
            )

        self.assertIn("今日价格速览", article["content"])
        self.assertIn("1,051.25", article["content"])
        self.assertNotIn("data-eti-price-reference", article["content"])
        self.assertNotIn(wechat_publish.ARTICLE_IMAGE_TOKEN, article["content"])
        self.assertTrue(any("reference image omitted" in warning for warning in warnings))

    def test_injects_uploaded_url_without_local_artifacts(self) -> None:
        content = f'<section data-eti-price-reference="true">{wechat_publish.ARTICLE_IMAGE_TOKEN}</section>'

        injected = wechat_publish.inject_article_image(content, "https://mmbiz.qpic.cn/reference.png")

        self.assertIn('src="https://mmbiz.qpic.cn/reference.png"', injected)
        self.assertNotIn(wechat_publish.ARTICLE_IMAGE_TOKEN, injected)
        self.assertNotIn("public_reference.png", injected)
        self.assertNotIn("file://", injected)
        self.assertNotIn("base64", injected)

    def test_final_content_allows_only_the_exact_authorized_https_image_src(self) -> None:
        authorized_url = "https://mmbiz.qpic.cn/reference.png"

        wechat_publish.ensure_final_article_content(
            f'<p>正文</p><img src="{authorized_url}">',
            authorized_url,
        )

        invalid_contents = [
            '<img src="/relative.png">',
            '<img src="C:\\images\\reference.png">',
            '<img src="file:///tmp/reference.png">',
            '<img src="http://mmbiz.qpic.cn/reference.png">',
            '<img src="data:image/png;base64,AAAA">',
            '<img src="https://other.example/reference.png">',
            f'<img src="{authorized_url}"><img src="https://other.example/extra.png">',
            f'<p>{authorized_url}</p>',
            '<img alt="missing source">',
        ]
        for content in invalid_contents:
            with self.subTest(content=content), self.assertRaises(RuntimeError):
                wechat_publish.ensure_final_article_content(content, authorized_url)

    def test_final_content_without_uploaded_image_rejects_every_img(self) -> None:
        for content in (
            '<img src="https://mmbiz.qpic.cn/reference.png">',
            '<IMG SRC="/relative.png">',
            '<img alt="missing source">',
        ):
            with self.subTest(content=content), self.assertRaises(RuntimeError):
                wechat_publish.ensure_final_article_content(content, "")

    def test_short_body_fallback_rejects_unapproved_image(self) -> None:
        with patch.object(wechat_publish, "render_wechat_body", return_value="short"), patch.object(
            wechat_publish, "render_preview_html", return_value="preview"
        ):
            with self.assertRaises(RuntimeError):
                wechat_publish.build_wechat_content(
                    "# 日报",
                    '<html><body><img src="https://other.example/fallback.png"></body></html>',
                    "摘要",
                    "2026-07-10",
                )

    def test_draft_readback_requires_uploaded_image_url_and_rejects_local_artifacts(self) -> None:
        image_url = "https://mmbiz.qpic.cn/reference.png"
        remote_content = f"<p>2026-07-10</p><img src=\"{image_url}\">" + ("正文" * 260)
        article = {
            "title": "能源市场日报｜2026-07-10",
            "digest": "市场摘要",
            "content": remote_content,
            "article_image_url": image_url,
        }
        with patch.object(wechat_publish, "get_draft", return_value={
            "news_item": [{
                "title": article["title"],
                "digest": article["digest"],
                "content": remote_content,
            }],
        }):
            verification = wechat_publish.verify_created_draft(
                "token", "media-id", article, "2026-07-10"
            )

        self.assertTrue(verification["verified"])
        self.assertEqual(verification["article_image_url"], image_url)

    def test_draft_readback_rejects_url_in_plain_text_instead_of_img_src(self) -> None:
        image_url = "https://mmbiz.qpic.cn/reference.png"
        remote_content = f"<p>2026-07-10 {image_url}</p>" + ("正文" * 260)
        article = {
            "title": "能源市场日报｜2026-07-10",
            "digest": "市场摘要",
            "content": remote_content,
            "article_image_url": image_url,
        }
        with patch.object(wechat_publish, "get_draft", return_value={
            "news_item": [{
                "title": article["title"],
                "digest": article["digest"],
                "content": remote_content,
            }],
        }):
            with self.assertRaises(RuntimeError):
                wechat_publish.verify_created_draft(
                    "token", "media-id", article, "2026-07-10"
                )

    def test_draft_readback_rejects_any_additional_unapproved_img_src(self) -> None:
        image_url = "https://mmbiz.qpic.cn/reference.png"
        remote_content = (
            f'<p>2026-07-10</p><img src="{image_url}">'
            '<img src="https://other.example/extra.png">'
            + ("正文" * 260)
        )
        article = {
            "title": "能源市场日报｜2026-07-10",
            "digest": "市场摘要",
            "content": remote_content,
            "article_image_url": image_url,
        }
        with patch.object(wechat_publish, "get_draft", return_value={
            "news_item": [{
                "title": article["title"],
                "digest": article["digest"],
                "content": remote_content,
            }],
        }):
            with self.assertRaises(RuntimeError):
                wechat_publish.verify_created_draft(
                    "token", "media-id", article, "2026-07-10"
                )

    def test_draft_readback_rejects_internal_processing_terms(self) -> None:
        remote_content = "<p>2026-07-10 Telegram</p>" + ("正文" * 260)
        article = {
            "title": "能源市场日报｜2026-07-10",
            "digest": "市场摘要",
            "content": remote_content,
        }
        with patch.object(wechat_publish, "get_draft", return_value={
            "news_item": [{
                "title": article["title"],
                "digest": article["digest"],
                "content": remote_content,
            }],
        }):
            with self.assertRaises(RuntimeError):
                wechat_publish.verify_created_draft(
                    "token", "media-id", article, "2026-07-10"
                )

    def test_persisted_payload_rejects_unresolved_article_image_token(self) -> None:
        article = {
            "title": "能源市场日报｜2026-07-10",
            "author": "ETI",
            "digest": "市场摘要",
            "content": f"<p>{wechat_publish.ARTICLE_IMAGE_TOKEN}</p>",
            "preview_html": "",
            "content_source_url": "",
            "need_open_comment": 0,
            "only_fans_can_comment": 0,
        }
        with tempfile.TemporaryDirectory() as temporary_directory, patch.object(
            wechat_publish, "STATE_DIR", Path(temporary_directory)
        ):
            with self.assertRaises(RuntimeError):
                wechat_publish.persist_publish_artifacts(
                    "2026-07-10", "draft", article, {"media_id": "draft-id"}
                )


class WeChatImageStateTests(unittest.TestCase):
    def test_weekly_article_never_probes_or_injects_daily_reference_image(self) -> None:
        markdown = "# Weekly report\n\nBody\n"
        with patch.object(Path, "is_file", side_effect=AssertionError("daily image probed")):
            article = wechat_publish.build_article_payload(
                {},
                {"markdown": markdown, "html": "", "summary": "Weekly"},
                "2026-07-10",
                mode="weekly",
            )
        self.assertFalse(article["reference_image_present"])
        self.assertNotIn(wechat_publish.ARTICLE_IMAGE_TOKEN, article["content"])

    def test_build_article_records_stable_reference_image_presence_and_sha256(self) -> None:
        markdown = (
            "# 能源市场日报｜2026-07-10\n\n> 市场摘要\n\n"
            "## 今日价格速览\n\n市场日期：2026年7月10日｜单位：美元/吨\n\n"
            "- 欧洲市场｜低硫柴油｜FOB Med｜1,051.25｜-14.00\n\n"
            "## 参考资料\n\n- 数据产品\n"
        )
        with tempfile.TemporaryDirectory() as temporary_directory:
            price_root = Path(temporary_directory) / "shared-price-root"
            image_path = price_root / "2026-07-10" / "public_reference.png"
            image_path.parent.mkdir(parents=True)
            image_bytes = b"stable-reference-image"
            image_path.write_bytes(image_bytes)
            with patch.object(wechat_publish, "DAILY_PRICE_ROOT", price_root), patch(
                "intelligence.daily_prices.validate_public_reference",
                return_value=(True, []),
            ):
                article = wechat_publish.build_article_payload(
                    {},
                    {"markdown": markdown, "html": "", "summary": "市场摘要"},
                    "2026-07-10",
                )

        self.assertTrue(article["reference_image_present"])
        self.assertEqual(article["reference_image_sha256"], hashlib.sha256(image_bytes).hexdigest())
        self.assertEqual(article["article_image_status"], "pending_upload")
        self.assertEqual(article["article_image_url"], "")
        self.assertIn(wechat_publish.ARTICLE_IMAGE_TOKEN, article["content"])

    def test_build_article_omits_reference_image_without_valid_manifest(self) -> None:
        markdown = "# Energy report 2026-07-10\n\n## 今日价格速览\n\n- row\n"
        with tempfile.TemporaryDirectory() as temporary_directory:
            price_root = Path(temporary_directory) / "prices"
            image_path = price_root / "2026-07-10" / "public_reference.png"
            image_path.parent.mkdir(parents=True)
            image_path.write_bytes(b"not-a-png")
            with patch.object(wechat_publish, "DAILY_PRICE_ROOT", price_root):
                article = wechat_publish.build_article_payload(
                    {},
                    {"markdown": markdown, "html": "", "summary": "Summary"},
                    "2026-07-10",
                )

        self.assertFalse(article["reference_image_present"])
        self.assertNotIn(wechat_publish.ARTICLE_IMAGE_TOKEN, article["content"])

    def test_digit_article_adds_reference_image_slot_after_rendering(self) -> None:
        markdown = "# Digital report 2026-07-10\n\n正文\n\n## 参考资料\n\n- 刊物标题\n"
        locator = ArticleLocator("digit", date(2026, 7, 10), "01-test")
        with tempfile.TemporaryDirectory() as temporary_directory:
            price_root = Path(temporary_directory) / "prices"
            image_path = price_root / "2026-07-10" / "public_reference.png"
            image_path.parent.mkdir(parents=True)
            image_path.write_bytes(b"stable-reference-image")
            with patch.object(wechat_publish, "DAILY_PRICE_ROOT", price_root), patch(
                "intelligence.daily_prices.validate_public_reference",
                return_value=(True, []),
            ):
                article = wechat_publish.build_article_payload(
                    {}, {"markdown": markdown, "html": "", "summary": "市场摘要"},
                    "2026-07-10", locator=locator,
                )

        self.assertIn(wechat_publish.ARTICLE_IMAGE_TOKEN, article["content"])
        self.assertIn('data-eti-price-reference="true"', article["content"])
        self.assertLess(article["content"].index(wechat_publish.ARTICLE_IMAGE_TOKEN), article["content"].index("</article>"))

    def test_fingerprint_uses_source_image_state_but_not_uploaded_url(self) -> None:
        article = {
            "title": "日报",
            "digest": "摘要",
            "content": f"正文{wechat_publish.ARTICLE_IMAGE_TOKEN}",
            "reference_image_present": True,
            "reference_image_sha256": "sha-a",
            "article_image_url": "https://mmbiz.qpic.cn/first.png",
        }

        first = wechat_publish.build_article_fingerprint(article, "daily", "draft")
        second = wechat_publish.build_article_fingerprint(
            {**article, "article_image_url": "https://mmbiz.qpic.cn/second.png"},
            "daily",
            "draft",
        )
        changed_image = wechat_publish.build_article_fingerprint(
            {**article, "reference_image_sha256": "sha-b"},
            "daily",
            "draft",
        )

        self.assertEqual(first, second)
        self.assertNotEqual(first, changed_image)

    def test_reuse_requires_current_image_state_to_be_uploaded_and_verified(self) -> None:
        base = {
            "fingerprint": "fp",
            "media_id": "draft-id",
            "reference_image_present": True,
            "reference_image_sha256": "sha-a",
            "article_image_url": "https://mmbiz.qpic.cn/reference.png",
        }

        self.assertTrue(wechat_publish.is_existing_result_reusable(
            {**base, "article_image_status": "uploaded_verified"},
            "fp",
            "draft",
            reference_image_present=True,
            reference_image_sha256="sha-a",
        ))
        self.assertFalse(wechat_publish.is_existing_result_reusable(
            {**base, "article_image_status": "upload_failed"},
            "fp",
            "draft",
            reference_image_present=True,
            reference_image_sha256="sha-a",
        ))
        self.assertFalse(wechat_publish.is_existing_result_reusable(
            {**base, "article_image_status": "uploaded_verified"},
            "fp",
            "draft",
            reference_image_present=True,
            reference_image_sha256="sha-b",
        ))
        self.assertTrue(wechat_publish.is_existing_result_reusable(
            {**base, "article_image_url": "", "article_image_status": "omitted_no_slot"},
            "fp",
            "draft",
            reference_image_present=True,
            reference_image_sha256="sha-a",
        ))

    def test_restore_existing_image_state_requires_verified_url_when_image_is_expected(self) -> None:
        article = {
            "content": f"<p>正文</p>{wechat_publish.ARTICLE_IMAGE_TOKEN}",
            "preview_html": f"<p>预览</p>{wechat_publish.ARTICLE_IMAGE_TOKEN}",
            "reference_image_present": True,
            "reference_image_sha256": "sha-a",
        }
        with self.assertRaises(RuntimeError):
            wechat_publish.restore_existing_article_image_state(article.copy(), {
                "reference_image_present": True,
                "reference_image_sha256": "sha-a",
                "article_image_status": "uploaded_verified",
            })

        restored = article.copy()
        image_url = "https://mmbiz.qpic.cn/reference.png"
        wechat_publish.restore_existing_article_image_state(restored, {
            "reference_image_present": True,
            "reference_image_sha256": "sha-a",
            "article_image_status": "uploaded_verified",
            "article_image_url": image_url,
        })

        self.assertEqual(restored["article_image_url"], image_url)
        self.assertEqual(restored["article_image_status"], "uploaded_verified")
        self.assertIn(f'src="{image_url}"', restored["content"])
        self.assertNotIn(wechat_publish.ARTICLE_IMAGE_TOKEN, restored["content"])

        omitted = article.copy()
        wechat_publish.restore_existing_article_image_state(omitted, {
            "reference_image_present": True,
            "reference_image_sha256": "sha-a",
            "article_image_status": "omitted_no_slot",
            "article_image_url": "",
        })
        self.assertEqual(omitted["article_image_status"], "omitted_no_slot")
        self.assertNotIn(wechat_publish.ARTICLE_IMAGE_TOKEN, omitted["content"])


class WeChatMainIntegrationTests(unittest.TestCase):
    def article_with_reference_image(self) -> dict:
        image_section = (
            '<section data-eti-price-reference="true">'
            f'{wechat_publish.ARTICLE_IMAGE_TOKEN}</section>'
        )
        return {
            "title": "能源市场日报｜2026-07-10",
            "author": "ETI",
            "digest": "市场摘要",
            "content": "<p>2026-07-10</p>" + ("正文" * 260) + image_section,
            "preview_html": "<html><body>" + ("预览" * 60) + image_section + "</body></html>",
            "content_source_url": "",
            "need_open_comment": 0,
            "only_fans_can_comment": 0,
            "reference_image_present": True,
            "reference_image_sha256": "sha-a",
            "article_image_url": "",
            "article_image_status": "pending_upload",
        }

    def common_main_patches(self, article_factory, existing_loader):
        return (
            patch.object(sys, "argv", [
                "wechat_publish.py", "--date", "2026-07-10", "--action", "draft"
            ]),
            patch.object(wechat_publish, "read_publish_config", return_value={}),
            patch.object(
                wechat_publish, "load_price_release_state", return_value={"status": "ready_without_prices"}
            ),
            patch.object(wechat_publish, "prepare_thumb_image"),
            patch.object(wechat_publish, "read_report_bundle", return_value={
                "md_path": Path("report.md"),
                "html_path": Path("report.html"),
                "summary_path": Path("summary.txt"),
            }),
            patch.object(wechat_publish, "build_article_payload", side_effect=article_factory),
            patch.object(wechat_publish, "load_quality_audit", return_value={"status": "pass"}),
            patch.object(wechat_publish, "load_llm_review", return_value={"status": "pass"}),
            patch.object(wechat_publish, "build_preflight_report", return_value={"issues": []}),
            patch.object(wechat_publish, "validate_article_for_publish", return_value=([], [])),
            patch.object(wechat_publish, "ensure_publish_config"),
            patch.object(wechat_publish, "get_access_token", return_value="access-token"),
            patch.object(wechat_publish, "ensure_thumb_media_id", return_value="thumb-id"),
            patch.object(wechat_publish, "load_existing_result", side_effect=existing_loader),
            patch("builtins.print"),
        )

    def enter_patches(self, stack: ExitStack, patches) -> None:
        for patcher in patches:
            stack.enter_context(patcher)

    def test_force_never_bypasses_summary_local_or_digit_llm_quality_gates(self) -> None:
        cases = (
            ("summary", "", "fail", "pass", "local quality=fail"),
            ("digit", "01-crude", "fail", "pass", "local quality=fail"),
            ("digit", "01-crude", "pass", "reject", "llm review=reject"),
        )
        for stream, article_slug, quality_status, review_status, expected_error in cases:
            argv = [
                "wechat_publish.py", "--date", "2026-07-10", "--stream", stream,
                "--action", "draft", "--dry-run", "--force",
            ]
            if article_slug:
                argv.extend(("--article-slug", article_slug))
            with self.subTest(stream=stream, quality=quality_status, review=review_status), ExitStack() as stack:
                stack.enter_context(patch.object(sys, "argv", argv))
                stack.enter_context(patch.object(wechat_publish, "read_publish_config", return_value={}))
                stack.enter_context(patch.object(
                    wechat_publish, "load_price_release_state", return_value={
                        "status": "ready_with_prices", "image_quote_ready": True,
                    }
                ))
                stack.enter_context(patch.object(wechat_publish, "prepare_thumb_image"))
                stack.enter_context(patch.object(wechat_publish, "read_report_bundle", return_value={
                    "md_path": Path("report.md"),
                    "html_path": Path("report.html"),
                    "summary_path": Path("summary.txt"),
                }))
                stack.enter_context(patch.object(
                    wechat_publish, "build_article_payload", return_value=self.article_without_reference_image()
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "load_quality_audit", return_value={"status": quality_status}
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "load_llm_review", return_value={"status": review_status}
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "build_preflight_report", return_value={"ready": True, "issues": []}
                ))
                with self.assertRaisesRegex(RuntimeError, expected_error):
                    wechat_publish.main()

    def test_summary_preflight_exits_nonzero_when_release_state_is_not_ready(self) -> None:
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys, "argv", [
                "wechat_publish.py", "--date", "2026-07-10", "--stream", "summary",
                "--action", "draft", "--dry-run", "--preflight",
            ]))
            stack.enter_context(patch.object(wechat_publish, "read_publish_config", return_value={}))
            stack.enter_context(patch.object(
                wechat_publish, "load_price_release_state", return_value={"status": "waiting_for_prices"}
            ))
            report_bundle = stack.enter_context(patch.object(
                wechat_publish, "read_report_bundle", side_effect=AssertionError("release gate opened")
            ))
            printed = stack.enter_context(patch("builtins.print"))

            with self.assertRaises(SystemExit) as raised:
                wechat_publish.main()

        self.assertEqual(raised.exception.code, 1)
        report_bundle.assert_not_called()
        payload = json.loads(printed.call_args.args[0])
        self.assertFalse(payload["ready"])
        self.assertEqual(payload["issues"], ["summary_image_quote_not_ready"])

    def test_reviewed_summary_and_digit_are_blocked_after_one_character_change(self) -> None:
        locators = (
            ArticleLocator("summary", date(2026, 7, 10)),
            ArticleLocator("digit", date(2026, 7, 10), "01-crude"),
        )
        for locator in locators:
            with self.subTest(stream=locator.stream), tempfile.TemporaryDirectory() as temporary_directory:
                reports_dir = Path(temporary_directory) / "reports"
                paths = resolve_article_paths(locator, reports_dir)
                paths.markdown.parent.mkdir(parents=True, exist_ok=True)
                paths.quality_audit.parent.mkdir(parents=True, exist_ok=True)
                markdown = f"# Reviewed {locator.stream}｜2026-07-10\n\n" + ("正文" * 260)
                wechat_html = "<article><p>2026-07-10</p>" + ("正文" * 260) + "</article>"
                summary = "Reviewed summary"
                paths.markdown.write_text(markdown, encoding="utf-8")
                paths.wechat_html.write_text(wechat_html, encoding="utf-8")
                paths.summary.write_text(summary, encoding="utf-8")
                identity = approved_artifact_identity(locator, markdown, wechat_html, summary)
                paths.quality_audit.write_text(json.dumps({
                    "status": "pass", "publishable": True, **identity,
                }), encoding="utf-8")
                if locator.stream == "digit":
                    paths.llm_review.write_text(json.dumps({"status": "pass", **identity}), encoding="utf-8")
                paths.markdown.write_text(markdown + "X", encoding="utf-8")
                argv = [
                    "wechat_publish.py", "--date", "2026-07-10", "--stream", locator.stream,
                    "--action", "draft", "--dry-run", "--force",
                ]
                if locator.article_slug:
                    argv.extend(("--article-slug", locator.article_slug))
                with ExitStack() as stack:
                    stack.enter_context(patch.object(sys, "argv", argv))
                    stack.enter_context(patch.object(wechat_publish, "REPORTS_DIR", reports_dir))
                    stack.enter_context(patch.object(wechat_publish, "read_publish_config", return_value={}))
                    stack.enter_context(patch.object(
                        wechat_publish, "load_price_release_state", return_value={
                            "status": "ready_with_prices", "image_quote_ready": True,
                        }
                    ))
                    stack.enter_context(patch.object(wechat_publish, "prepare_thumb_image"))
                    stack.enter_context(patch.object(
                        wechat_publish, "build_article_payload", return_value=self.article_without_reference_image()
                    ))
                    stack.enter_context(patch.object(
                        wechat_publish, "build_preflight_report", return_value={"ready": True, "issues": []}
                    ))
                    with self.assertRaisesRegex(RuntimeError, "artifact identity"):
                        wechat_publish.main()

    def test_summary_publish_reads_only_summary_quality_audit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            locator = ArticleLocator("summary", date(2026, 7, 10))
            quality = {
                "status": "pass",
                "publishable": True,
                **approved_artifact_identity(locator, "", "", ""),
            }
            with ExitStack() as stack:
                stack.enter_context(patch.object(sys, "argv", [
                    "wechat_publish.py", "--date", "2026-07-10", "--stream", "summary",
                    "--action", "draft", "--dry-run",
                ]))
                stack.enter_context(patch.object(wechat_publish, "REPORTS_DIR", reports_dir))
                stack.enter_context(patch.object(wechat_publish, "read_publish_config", return_value={}))
                stack.enter_context(patch.object(
                    wechat_publish, "load_price_release_state", return_value={
                        "status": "ready_with_prices", "image_quote_ready": True,
                    }
                ))
                stack.enter_context(patch.object(wechat_publish, "prepare_thumb_image"))
                stack.enter_context(patch.object(wechat_publish, "read_report_bundle", return_value={
                    "md_path": Path("summary.md"),
                    "html_path": Path("summary.html"),
                    "summary_path": Path("summary.txt"),
                }))
                stack.enter_context(patch.object(
                    wechat_publish, "build_article_payload", return_value=self.article_without_reference_image()
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "load_quality_audit", return_value=quality
                ))
                llm_review = stack.enter_context(patch.object(
                    wechat_publish, "load_llm_review", side_effect=AssertionError("summary read Digit review")
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "build_preflight_report", return_value={"issues": []}
                ))
                printed = stack.enter_context(patch("builtins.print"))

                wechat_publish.main()

        llm_review.assert_not_called()
        payload = json.loads(printed.call_args.args[0])
        self.assertNotIn("skipped", payload)

    def test_digit_publish_bypasses_summary_price_release_backlog(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            locator = ArticleLocator("digit", date(2026, 7, 10), "01-crude")
            quality = {
                "status": "pass",
                "publishable": True,
                **approved_artifact_identity(locator, "", "", ""),
            }
            with ExitStack() as stack:
                stack.enter_context(patch.object(sys, "argv", [
                    "wechat_publish.py", "--date", "2026-07-10", "--stream", "digit",
                    "--article-slug", "01-crude", "--action", "draft", "--dry-run",
                ]))
                stack.enter_context(patch.object(wechat_publish, "REPORTS_DIR", reports_dir))
                stack.enter_context(patch.object(wechat_publish, "read_publish_config", return_value={}))
                stack.enter_context(patch.object(
                    wechat_publish, "load_price_release_state", return_value={"status": "waiting_for_prices"}
                ))
                stack.enter_context(patch.object(wechat_publish, "prepare_thumb_image"))
                report_bundle = stack.enter_context(patch.object(
                    wechat_publish, "read_report_bundle", return_value={
                        "md_path": Path("digit.md"),
                        "html_path": Path("digit.html"),
                        "summary_path": Path("digit-summary.txt"),
                    }
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "build_article_payload", return_value=self.article_without_reference_image()
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "load_quality_audit", return_value=quality
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "load_llm_review", return_value=quality
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "build_preflight_report", return_value={"issues": []}
                ))
                printed = stack.enter_context(patch("builtins.print"))

                wechat_publish.main()

        report_bundle.assert_called_once()
        payload = json.loads(printed.call_args.args[0])
        self.assertNotIn("skipped", payload)

    def article_without_reference_image(self) -> dict:
        return {
            "title": "能源市场日报｜2026-07-10",
            "author": "ETI",
            "digest": "市场摘要",
            "content": "<p>2026-07-10</p>" + ("正文" * 260),
            "preview_html": "<html><body>预览</body></html>",
            "content_source_url": "",
            "need_open_comment": 0,
            "only_fans_can_comment": 0,
            "reference_image_present": False,
            "reference_image_sha256": "",
            "article_image_url": "",
            "article_image_status": "not_expected",
        }

    def test_main_orders_build_fingerprint_reuse_prepare_and_create(self) -> None:
        events: list[str] = []
        fingerprint_impl = wechat_publish.build_article_fingerprint
        reuse_impl = wechat_publish.is_existing_result_reusable
        prepare_impl = wechat_publish.prepare_article_image

        def build_article(*_args, **_kwargs):
            events.append("build")
            return self.article_with_reference_image()

        def fingerprint(article, mode, action):
            events.append("fingerprint")
            return fingerprint_impl(article, mode, action)

        def reuse(existing, fingerprint_value, action, **kwargs):
            events.append("reuse")
            return reuse_impl(existing, fingerprint_value, action, **kwargs)

        def prepare(article, access_token, path):
            events.append("prepare")
            return prepare_impl(article, access_token, path)

        def create(_access_token, article):
            events.append("create")
            wechat_publish.ensure_final_article_content(
                article["content"], article["article_image_url"]
            )
            return {"media_id": "draft-id"}

        patches = self.common_main_patches(build_article, lambda *_args: {})
        with ExitStack() as stack:
            self.enter_patches(stack, patches)
            stack.enter_context(patch.object(
                wechat_publish, "build_article_fingerprint", side_effect=fingerprint
            ))
            stack.enter_context(patch.object(
                wechat_publish, "is_existing_result_reusable", side_effect=reuse
            ))
            stack.enter_context(patch.object(
                wechat_publish, "prepare_article_image", side_effect=prepare
            ))
            stack.enter_context(patch.object(
                wechat_publish, "upload_article_image", return_value="https://mmbiz.qpic.cn/reference.png"
            ))
            stack.enter_context(patch.object(wechat_publish, "create_draft", side_effect=create))
            stack.enter_context(patch.object(
                wechat_publish, "verify_created_draft", return_value={"verified": True}
            ))
            stack.enter_context(patch.object(
                wechat_publish, "persist_publish_artifacts", return_value={}
            ))
            wechat_publish.main()

        self.assertEqual(events, ["build", "fingerprint", "reuse", "prepare", "create"])

    def test_upload_failure_is_retried_then_verified_success_is_reused(self) -> None:
        state: dict[str, dict] = {"existing": {}}
        persisted_statuses: list[str] = []

        def build_article(*_args, **_kwargs):
            return self.article_with_reference_image()

        def load_existing(*_args):
            return state["existing"]

        def persist(_date, _action, _article, result, _locator):
            state["existing"] = dict(result)
            persisted_statuses.append(result["article_image_status"])
            return {}

        def verify(_token, _media_id, article, _date):
            wechat_publish.ensure_final_article_content(
                article["content"], article["article_image_url"]
            )
            return {"verified": True, "article_image_url": article["article_image_url"]}

        patches = self.common_main_patches(build_article, load_existing)
        with ExitStack() as stack:
            self.enter_patches(stack, patches)
            upload = stack.enter_context(patch.object(
                wechat_publish,
                "upload_article_image",
                side_effect=[RuntimeError("upload failed"), "https://mmbiz.qpic.cn/reference.png"],
            ))
            create = stack.enter_context(patch.object(
                wechat_publish, "create_draft", return_value={"media_id": "draft-id"}
            ))
            stack.enter_context(patch.object(
                wechat_publish, "verify_created_draft", side_effect=verify
            ))
            stack.enter_context(patch.object(
                wechat_publish, "persist_publish_artifacts", side_effect=persist
            ))
            wechat_publish.main()
            wechat_publish.main()
            wechat_publish.main()

        self.assertEqual(
            persisted_statuses,
            ["upload_failed", "upload_failed", "uploaded", "uploaded_verified"],
        )
        self.assertEqual(upload.call_count, 2)
        self.assertEqual(create.call_count, 2)

    def test_successful_publish_is_terminal_after_image_upload_failure(self) -> None:
        state: dict[str, dict] = {"existing": {}}

        def load_existing(*_args):
            return state["existing"]

        def persist(_date, _action, _article, result, _locator):
            state["existing"] = dict(result)
            return {}

        patches = self.common_main_patches(
            lambda *_args, **_kwargs: self.article_with_reference_image(),
            load_existing,
        )
        publish_argv = patch.object(sys, "argv", [
            "wechat_publish.py", "--date", "2026-07-10", "--action", "publish"
        ])
        with ExitStack() as stack:
            stack.enter_context(publish_argv)
            self.enter_patches(stack, patches[1:-1])
            print_mock = stack.enter_context(patches[-1])
            stack.enter_context(patch.object(
                wechat_publish, "upload_article_image", side_effect=RuntimeError("upload failed")
            ))
            create = stack.enter_context(patch.object(
                wechat_publish, "create_draft", return_value={"media_id": "draft-id"}
            ))
            stack.enter_context(patch.object(
                wechat_publish, "verify_created_draft", return_value={
                    "verified": True,
                    "article_image_url": "",
                }
            ))
            submit = stack.enter_context(patch.object(
                wechat_publish, "submit_publish", return_value={"publish_id": "publish-id"}
            ))
            stack.enter_context(patch.object(
                wechat_publish, "wait_publish_result", return_value={"publish_status": 0}
            ))
            stack.enter_context(patch.object(
                wechat_publish, "persist_publish_artifacts", side_effect=persist
            ))

            wechat_publish.main()
            wechat_publish.main()

        json_outputs = [
            json.loads(call.args[0])
            for call in print_mock.call_args_list
            if call.args and str(call.args[0]).lstrip().startswith("{")
        ]
        self.assertEqual(create.call_count, 1)
        self.assertEqual(submit.call_count, 1)
        self.assertTrue(json_outputs[-1]["skipped"])
        self.assertEqual(
            json_outputs[-1]["reason"],
            "existing publish already completed successfully",
        )

    def test_reused_terminal_auto_publish_does_not_record_rollout_again(self) -> None:
        existing = {
            "media_id": "draft-id",
            "publish_id": "publish-id",
            "publish_status_response": {"publish_status": 0},
        }
        patches = self.common_main_patches(
            lambda *_args, **_kwargs: self.article_with_reference_image(),
            lambda *_args: existing,
        )
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys, "argv", [
                "wechat_publish.py", "--date", "2026-07-10", "--action", "auto"
            ]))
            self.enter_patches(stack, patches[1:])
            stack.enter_context(patch.object(
                wechat_publish, "resolve_auto_action", return_value=("publish", {"history": []})
            ))
            stack.enter_context(patch.object(
                wechat_publish, "is_existing_result_reusable", return_value=True
            ))
            stack.enter_context(patch.object(
                wechat_publish, "is_successful_publish_terminal", return_value=True
            ))
            record = stack.enter_context(patch.object(
                wechat_publish, "record_auto_success", return_value={}
            ))
            wechat_publish.main()
        record.assert_not_called()

    def test_verify_existing_restores_verified_image_metadata_before_readback(self) -> None:
        image_url = "https://mmbiz.qpic.cn/reference.png"
        existing = {
            "media_id": "draft-id",
            "reference_image_present": True,
            "reference_image_sha256": "sha-a",
            "article_image_status": "uploaded_verified",
            "article_image_url": image_url,
        }

        def verify(_token, _media_id, article, _date):
            self.assertEqual(article["article_image_url"], image_url)
            self.assertEqual(article["article_image_status"], "uploaded_verified")
            self.assertIn(f'src="{image_url}"', article["content"])
            return {"verified": True, "article_image_url": image_url}

        patches = self.common_main_patches(
            lambda *_args, **_kwargs: self.article_with_reference_image(),
            lambda *_args: existing,
        )
        verify_argv = patch.object(sys, "argv", [
            "wechat_publish.py", "--date", "2026-07-10", "--action", "draft", "--verify-existing"
        ])
        with ExitStack() as stack:
            stack.enter_context(verify_argv)
            self.enter_patches(stack, patches[1:])
            readback = stack.enter_context(patch.object(
                wechat_publish, "verify_created_draft", side_effect=verify
            ))
            wechat_publish.main()

        self.assertEqual(readback.call_count, 1)

    def test_verify_existing_fails_when_expected_image_has_no_verified_url(self) -> None:
        existing = {
            "media_id": "draft-id",
            "reference_image_present": True,
            "reference_image_sha256": "sha-a",
            "article_image_status": "uploaded_verified",
        }
        patches = self.common_main_patches(
            lambda *_args, **_kwargs: self.article_with_reference_image(),
            lambda *_args: existing,
        )
        verify_argv = patch.object(sys, "argv", [
            "wechat_publish.py", "--date", "2026-07-10", "--action", "draft", "--verify-existing"
        ])
        with ExitStack() as stack:
            stack.enter_context(verify_argv)
            self.enter_patches(stack, patches[1:])
            stack.enter_context(patch.object(
                wechat_publish, "verify_created_draft", return_value={"verified": True}
            ))
            with self.assertRaises(RuntimeError):
                wechat_publish.main()

    def test_dry_run_persists_no_token_and_no_img(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            state_dir = Path(temporary_directory)
            dry_run_patches = (
                patch.object(sys, "argv", [
                    "wechat_publish.py", "--date", "2026-07-10", "--action", "draft", "--dry-run"
                ]),
                patch.object(wechat_publish, "STATE_DIR", state_dir),
                patch.object(wechat_publish, "read_publish_config", return_value={}),
                patch.object(
                    wechat_publish, "load_price_release_state", return_value={"status": "ready_without_prices"}
                ),
                patch.object(wechat_publish, "prepare_thumb_image"),
                patch.object(wechat_publish, "read_report_bundle", return_value={
                    "md_path": Path("report.md"),
                    "html_path": Path("report.html"),
                    "summary_path": Path("summary.txt"),
                }),
                patch.object(
                    wechat_publish, "build_article_payload", return_value=self.article_with_reference_image()
                ),
                patch.object(wechat_publish, "load_quality_audit", return_value={"status": "pass"}),
                patch.object(wechat_publish, "load_llm_review", return_value={"status": "pass"}),
                patch.object(wechat_publish, "build_preflight_report", return_value={"issues": []}),
                patch("builtins.print"),
            )
            with ExitStack() as stack:
                self.enter_patches(stack, dry_run_patches)
                wechat_publish.main()

            payload = json.loads(
                (state_dir / "2026-07-10_draft_payload.json").read_text(encoding="utf-8")
            )

        self.assertNotIn(wechat_publish.ARTICLE_IMAGE_TOKEN, payload["content"])
        self.assertEqual(wechat_publish.article_image_sources(payload["content"]), [])


class ReviewCycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_reject_then_revision_passes(self) -> None:
        original = "# 能源市场日报｜2026-07-01\n\n> 原摘要"
        revised = "# 能源市场日报｜2026-07-01\n\n> 修订摘要"
        workflow = AsyncMock(side_effect=[
            {"decision": "reject", "score": 70, "blocking_issues": ["分析不足"], "revision_instructions": ["补充传导"]},
            {"revised_markdown": revised},
            {"decision": "pass", "score": 90, "blocking_issues": []},
        ])
        with patch.object(daily_report, "call_review_workflow", workflow), patch.object(
            daily_report, "audit_report_quality", return_value=[]
        ):
            final_report, issues, record = await daily_report.review_and_revise_report(
                object(), "2026-07-01", sample_report(original), []
            )
        self.assertEqual(final_report["report_markdown"], revised)
        self.assertEqual(issues, [])
        self.assertEqual(record["status"], "pass")
        self.assertEqual(workflow.await_count, 3)

    async def test_second_rejection_fails_closed(self) -> None:
        original = "# 能源市场日报｜2026-07-01\n\n> 原摘要"
        revised = "# 能源市场日报｜2026-07-01\n\n> 修订摘要"
        workflow = AsyncMock(side_effect=[
            {"decision": "reject", "score": 70, "blocking_issues": ["分析不足"]},
            {"revised_markdown": revised},
            {"decision": "reject", "score": 82, "blocking_issues": ["翻译失真"]},
        ])
        with patch.object(daily_report, "call_review_workflow", workflow), patch.object(
            daily_report, "audit_report_quality", return_value=[]
        ):
            _, issues, record = await daily_report.review_and_revise_report(
                object(), "2026-07-01", sample_report(original), []
            )
        self.assertEqual(record["status"], "reject")
        self.assertTrue(any("翻译失真" in issue for issue in issues))


class RolloutStateTests(unittest.TestCase):
    def test_historical_action_is_always_forced_to_draft(self) -> None:
        self.assertEqual(wechat_publish.normalize_historical_action("publish", True), "draft")
        self.assertEqual(wechat_publish.normalize_historical_action("auto", True), "draft")
        self.assertEqual(wechat_publish.normalize_historical_action("publish", False), "publish")

    def test_three_shadow_days_arm_fourth_day_publish(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "rollout.json"
            with patch.object(wechat_publish, "ROLLOUT_STATE_PATH", state_path):
                state = wechat_publish.load_rollout_state()
                for target_date in ("2026-07-01", "2026-07-02", "2026-07-03"):
                    action, state = wechat_publish.resolve_auto_action({}, historical=False)
                    self.assertEqual(action, "draft")
                    state = wechat_publish.record_auto_success(target_date, action, state, 3)
                action, state = wechat_publish.resolve_auto_action({}, historical=False)
                self.assertEqual(action, "publish")
                self.assertTrue(state["armed_for_publish"])

    def test_historical_run_never_counts_or_publishes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            state_path = Path(temp_dir) / "rollout.json"
            with patch.object(wechat_publish, "ROLLOUT_STATE_PATH", state_path):
                action, state = wechat_publish.resolve_auto_action({}, historical=True)
                self.assertEqual(action, "draft")
                self.assertEqual(state["consecutive_passes"], 0)

    def test_summary_and_digit_rollout_state_paths_are_independent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            summary = wechat_publish.load_rollout_state("summary", reports_dir=reports_dir)
            wechat_publish.record_auto_success(
                "2026-07-10", "draft", summary, 3, stream="summary", reports_dir=reports_dir,
            )

            digit = wechat_publish.load_rollout_state("digit", reports_dir=reports_dir)

            self.assertEqual(digit["consecutive_passes"], 0)
            self.assertTrue(
                (reports_dir / "wechat_publish" / "summary" / "rollout_state.json").is_file()
            )
            self.assertFalse(
                (reports_dir / "wechat_publish" / "digit" / "rollout_state.json").exists()
            )

    def test_counted_date_keeps_draft_action_when_rollout_arms(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            state = {
                "consecutive_passes": 3,
                "armed_for_publish": True,
                "counted_dates": ["2026-07-10"],
                "history": [{"date": "2026-07-10", "event": "shadow_pass"}],
            }
            wechat_publish.save_rollout_state(state, "summary", reports_dir=reports_dir)

            action, _ = wechat_publish.resolve_auto_action(
                {}, historical=False, stream="summary", target_date="2026-07-10",
                reports_dir=reports_dir,
            )

        self.assertEqual(action, "draft")


class DailyPriceCoordinationTests(unittest.TestCase):
    def report(self) -> dict:
        return sample_report("# Daily report\n\nBody\n\n## References\n\n- Source\n")

    def test_price_mode_off_does_not_touch_price_pipeline(self) -> None:
        report = self.report()
        with patch("intelligence.daily_prices.reconcile_saved_report") as reconcile:
            coordinated, status = daily_report.coordinate_daily_prices(
                "2026-07-10", "daily", "off", report
            )
        reconcile.assert_not_called()
        self.assertEqual(coordinated, report)
        self.assertEqual(status, "disabled")

    def test_weekly_report_never_runs_price_pipeline(self) -> None:
        with patch("intelligence.daily_prices.reconcile_saved_report") as reconcile:
            coordinated, status = daily_report.coordinate_daily_prices(
                "2026-07-10", "weekly", "append", self.report()
            )
        reconcile.assert_not_called()
        self.assertEqual(status, "not_daily")
        self.assertNotIn("\u4eca\u65e5\u4ef7\u683c\u901f\u89c8", coordinated["report_markdown"])

    def test_shadow_reconciles_without_changing_report_body(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            prices_dir = reports_dir / "prices"
            report = self.report()
            with patch(
                "intelligence.daily_prices.reconcile_saved_report",
                return_value=SimpleNamespace(status="ready_with_prices"),
            ) as reconcile:
                coordinated, status = daily_report.coordinate_daily_prices(
                    "2026-07-10",
                    "daily",
                    "shadow",
                    report,
                    reports_dir=reports_dir,
                    prices_dir=prices_dir,
                )
        reconcile.assert_called_once()
        self.assertEqual(status, "ready_with_prices")
        self.assertEqual(coordinated, report)

    def test_append_mode_reconciles_prices_without_rewriting_news_report(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            prices_dir = reports_dir / "prices"
            report = self.report()
            with patch(
                "intelligence.daily_prices.reconcile_saved_report",
                return_value=SimpleNamespace(status="ready_with_prices"),
            ):
                coordinated, status = daily_report.coordinate_daily_prices(
                    "2026-07-10",
                    "daily",
                    "append",
                    report,
                    reports_dir=reports_dir,
                    prices_dir=prices_dir,
                )
        self.assertEqual(status, "ready_with_prices")
        self.assertEqual(coordinated, report)

    def test_append_mode_does_not_remove_stale_prices_from_news_report(self) -> None:
        report = self.report()
        report["report_markdown"] = (
            "# Daily report\n\nBody\n\n"
            "## \u4eca\u65e5\u4ef7\u683c\u901f\u89c8\n\n- stale price\n\n"
            "## References\n\n- Source\n"
        )
        with tempfile.TemporaryDirectory() as temporary_directory, patch(
            "intelligence.daily_prices.reconcile_saved_report",
            return_value=SimpleNamespace(status="ready_without_prices"),
        ):
            coordinated, status = daily_report.coordinate_daily_prices(
                "2026-07-10",
                "daily",
                "append",
                report,
                reports_dir=Path(temporary_directory) / "reports",
            )
        self.assertEqual(status, "ready_without_prices")
        self.assertEqual(coordinated, report)

    def test_reconcile_pending_runs_without_a_legacy_article(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            prices_dir = reports_dir / "prices"
            reports_dir.mkdir(parents=True)
            (prices_dir / "2026-07-10").mkdir(parents=True)
            with patch(
                "intelligence.daily_prices.reconcile_saved_report",
                return_value=SimpleNamespace(status="ready_with_prices"),
            ):
                results = daily_report.reconcile_pending_prices(
                    7,
                    reports_dir=reports_dir,
                    prices_dir=prices_dir,
                    now=datetime.fromisoformat("2026-07-14T18:40:00+08:00"),
                )
            self.assertEqual(results["2026-07-10"]["status"], "ready_with_prices")

    def test_reconcile_pending_off_skips_reconcile_and_never_writes_article(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            reports_dir.mkdir(parents=True)
            markdown = reports_dir / "2026-07-10.md"
            html_path = reports_dir / "2026-07-10_wechat.html"
            markdown.write_text("original markdown", encoding="utf-8")
            html_path.write_text("original html", encoding="utf-8")
            with patch("intelligence.daily_prices.reconcile_saved_report") as reconcile:
                daily_report.reconcile_pending_prices(
                    7,
                    price_mode="off",
                    reports_dir=reports_dir,
                    now=datetime.fromisoformat("2026-07-14T18:40:00+08:00"),
                )
            reconcile.assert_not_called()
            self.assertEqual(markdown.read_text(encoding="utf-8"), "original markdown")
            self.assertEqual(html_path.read_text(encoding="utf-8"), "original html")

    def test_reconcile_pending_shadow_refreshes_artifacts_without_writing_article(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            reports_dir.mkdir(parents=True)
            prices_dir = reports_dir / "prices"
            (prices_dir / "2026-07-10").mkdir(parents=True)
            markdown = reports_dir / "2026-07-10.md"
            html_path = reports_dir / "2026-07-10_wechat.html"
            markdown.write_text("original markdown", encoding="utf-8")
            html_path.write_text("original html", encoding="utf-8")
            with patch(
                "intelligence.daily_prices.reconcile_saved_report",
                return_value=SimpleNamespace(status="ready_with_prices"),
            ) as reconcile:
                daily_report.reconcile_pending_prices(
                    7,
                    price_mode="shadow",
                    reports_dir=reports_dir,
                    now=datetime.fromisoformat("2026-07-14T18:40:00+08:00"),
                )
            reconcile.assert_called_once()
            self.assertEqual(markdown.read_text(encoding="utf-8"), "original markdown")
            self.assertEqual(html_path.read_text(encoding="utf-8"), "original html")

    def test_reconcile_pending_append_does_not_rewrite_legacy_article(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            reports_dir.mkdir(parents=True)
            prices_dir = reports_dir / "prices"
            (prices_dir / "2026-07-10").mkdir(parents=True)
            markdown = reports_dir / "2026-07-10.md"
            html_path = reports_dir / "2026-07-10_wechat.html"
            markdown.write_text(
                "# Daily\n\nBody\n\n## \u4eca\u65e5\u4ef7\u683c\u901f\u89c8\n\n- stale\n\n## References\n",
                encoding="utf-8",
            )
            html_path.write_text("stale html", encoding="utf-8")
            with patch(
                "intelligence.daily_prices.reconcile_saved_report",
                return_value=SimpleNamespace(status="ready_without_prices"),
            ):
                daily_report.reconcile_pending_prices(
                    7,
                    price_mode="append",
                    reports_dir=reports_dir,
                    now=datetime.fromisoformat("2026-07-14T18:40:00+08:00"),
                )
            self.assertIn("\u4eca\u65e5\u4ef7\u683c\u901f\u89c8", markdown.read_text(encoding="utf-8"))
            self.assertEqual(html_path.read_text(encoding="utf-8"), "stale html")


class PriceReleaseGateTests(unittest.TestCase):
    def test_waiting_for_prices_skips_before_publish_and_rollout(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory)
            release_dir = reports_dir / "prices" / "2026-07-10"
            release_dir.mkdir(parents=True)
            (release_dir / "release_state.json").write_text(
                json.dumps({"status": "waiting_for_prices"}), encoding="utf-8"
            )
            with ExitStack() as stack:
                stack.enter_context(patch.object(sys, "argv", [
                    "wechat_publish.py", "--date", "2026-07-10", "--action", "auto"
                ]))
                stack.enter_context(patch.object(wechat_publish, "REPORTS_DIR", reports_dir))
                stack.enter_context(patch.object(wechat_publish, "DAILY_PRICE_ROOT", reports_dir / "prices"))
                stack.enter_context(patch.object(wechat_publish, "read_publish_config", return_value={}))
                create_draft = stack.enter_context(patch.object(wechat_publish, "create_draft"))
                rollout = stack.enter_context(patch.object(wechat_publish, "record_auto_success"))
                printed = stack.enter_context(patch("builtins.print"))
                wechat_publish.main()
        create_draft.assert_not_called()
        rollout.assert_not_called()
        payload = json.loads(printed.call_args.args[0])
        self.assertTrue(payload["skipped"])
        self.assertEqual(payload["reason"], "waiting_for_prices")

    def test_historical_draft_bypasses_waiting_gate(self) -> None:
        decision = wechat_publish.price_release_gate(
            {"status": "waiting_for_prices"}, mode="daily", historical=True
        )
        self.assertIsNone(decision)

    def test_ready_without_prices_allows_body_only_publish_path(self) -> None:
        decision = wechat_publish.price_release_gate(
            {"status": "ready_without_prices"}, mode="daily", historical=False, price_mode="append"
        )
        self.assertIsNone(decision)

    def test_missing_release_state_blocks_when_price_mode_is_enabled(self) -> None:
        self.assertEqual(
            wechat_publish.price_release_gate(
                {}, mode="daily", historical=False, price_mode="shadow"
            ),
            "price_release_state_missing",
        )
        self.assertIsNone(wechat_publish.price_release_gate(
            {}, mode="daily", historical=False, price_mode="off"
        ))


class DailyPriceCronTests(unittest.TestCase):
    def test_cron_runner_has_isolated_five_minute_price_tasks(self) -> None:
        runner = (Path(__file__).parents[1] / "scripts" / "cron-runner.sh").read_text(encoding="utf-8")
        for slot in ("morning", "afternoon", "evening"):
            self.assertIn(f"eti-fuelsight-prices-{slot}.lock", runner)
        self.assertIn("eti-price-reconcile.lock", runner)
        self.assertGreaterEqual(runner.count("timeout 5m"), 2)
        self.assertIn("reconcile-pending", runner)

    def test_cron_runner_uses_package_module_entrypoints(self) -> None:
        runner = (Path(__file__).parents[1] / "scripts" / "cron-runner.sh").read_text(encoding="utf-8")
        self.assertIn("-m intelligence.market_pipeline.daily_scheduler", runner)
        self.assertIn("-m intelligence.summary_image_worker", runner)
        self.assertIn("-m intelligence.market_pipeline.digit_publication_scheduler", runner)
        self.assertNotIn("-m intelligence.daily_report", runner)
        self.assertNotIn("intelligence/daily_report.py", runner)
        self.assertNotIn("intelligence/wechat_publish.py", runner)

    def test_price_reconcile_publishes_ready_delayed_summary_drafts(self) -> None:
        runner = (Path(__file__).parents[1] / "scripts" / "cron-runner.sh").read_text(encoding="utf-8")
        self.assertIn("-m intelligence.daily_prices reconcile-pending", runner)
        self.assertIn("-m intelligence.pending_wechat_publish --lookback-days 7 --action draft", runner)
        self.assertTrue((Path(__file__).parent / "pending_wechat_publish.py").is_file())


class PendingWeChatPublishTests(unittest.TestCase):
    def _write_release(self, prices_dir: Path, target_date: str, status: str) -> None:
        target = prices_dir / target_date
        target.mkdir(parents=True, exist_ok=True)
        (target / "release_state.json").write_text(json.dumps({"status": status}), encoding="utf-8")

    def test_append_selects_summary_stream_without_a_legacy_article(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            prices_dir = reports_dir / "prices"
            reports_dir.mkdir(parents=True)
            for target_date, status in (
                ("2026-07-14", "ready_with_prices"),
                ("2026-07-13", "ready_without_prices"),
                ("2026-07-12", "waiting_for_prices"),
            ):
                self._write_release(prices_dir, target_date, status)
            summary = reports_dir / "summary" / "2026-07-14.md"
            summary.parent.mkdir(parents=True)
            summary.write_text("# Summary", encoding="utf-8")
            calls: list[list[str]] = []

            def runner(command, **_kwargs):
                calls.append(command)
                return subprocess.CompletedProcess(command, 0, "ok", "")

            results = pending_wechat_publish.publish_ready_reports(
                3,
                "auto",
                price_mode="append",
                reports_dir=reports_dir,
                prices_dir=prices_dir,
                now=datetime.fromisoformat("2026-07-14T18:40:00+08:00"),
                runner=runner,
            )

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][calls[0].index("--date") + 1], "2026-07-14")
        self.assertEqual(calls[0][calls[0].index("--stream") + 1], "summary")
        self.assertEqual(results["2026-07-14"]["stream"], "summary")
        self.assertNotIn("2026-07-12", results)

    def test_shadow_never_invokes_delayed_publisher(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            runner = unittest.mock.Mock()
            results = pending_wechat_publish.publish_ready_reports(
                7,
                "draft",
                price_mode="shadow",
                reports_dir=Path(temporary_directory),
                prices_dir=Path(temporary_directory) / "prices",
                runner=runner,
            )
        self.assertEqual(results, {})
        runner.assert_not_called()

    def test_successfully_published_date_is_not_invoked_again(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            prices_dir = reports_dir / "prices"
            reports_dir.mkdir(parents=True)
            summary = reports_dir / "summary" / "2026-07-14.md"
            summary.parent.mkdir(parents=True)
            summary.write_text("# Summary", encoding="utf-8")
            self._write_release(prices_dir, "2026-07-14", "ready_with_prices")
            state_path = reports_dir / "wechat_publish" / "summary" / "2026-07-14_publish.json"
            state_path.parent.mkdir(parents=True)
            state_path.write_text(json.dumps({
                "publish_id": "publish-id",
                "publish_status_response": {"publish_status": 0},
            }), encoding="utf-8")
            runner = unittest.mock.Mock()

            results = pending_wechat_publish.publish_ready_reports(
                1,
                "publish",
                price_mode="append",
                reports_dir=reports_dir,
                prices_dir=prices_dir,
                now=datetime.fromisoformat("2026-07-14T18:40:00+08:00"),
                runner=runner,
            )

        self.assertTrue(results["2026-07-14"]["published"])
        runner.assert_not_called()

    def test_delayed_publisher_failure_is_not_silenced(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_dir = Path(temporary_directory) / "reports"
            prices_dir = reports_dir / "prices"
            reports_dir.mkdir(parents=True)
            summary = reports_dir / "summary" / "2026-07-14.md"
            summary.parent.mkdir(parents=True)
            summary.write_text("# Summary", encoding="utf-8")
            self._write_release(prices_dir, "2026-07-14", "ready_with_prices")

            with self.assertRaises(RuntimeError):
                pending_wechat_publish.publish_ready_reports(
                    1,
                    "auto",
                    price_mode="append",
                    reports_dir=reports_dir,
                    prices_dir=prices_dir,
                    now=datetime.fromisoformat("2026-07-14T18:40:00+08:00"),
                    runner=lambda command, **_kwargs: subprocess.CompletedProcess(command, 1, "", "failed"),
                )


class DailyPriceCronRemainingTests(unittest.TestCase):
    def test_cron_runner_mode_off_skips_collection_and_reconcile(self) -> None:
        runner = (Path(__file__).parents[1] / "scripts" / "cron-runner.sh").read_text(encoding="utf-8")
        self.assertGreaterEqual(runner.count('DAILY_PRICE_MODE:-shadow'), 2)
        self.assertIn("fuelsight-prices skipped: DAILY_PRICE_MODE=off", runner)
        self.assertIn("price-reconcile skipped: DAILY_PRICE_MODE=off", runner)

    def test_crontab_uses_singapore_timezone_and_four_fixed_slots(self) -> None:
        installer = (Path(__file__).parents[1] / "scripts" / "setup-crontab.sh").read_text(encoding="utf-8")
        self.assertIn("CRON_TZ=Asia/Singapore", installer)
        self.assertIn("30 10 * * 1-5", installer)
        self.assertIn("30 14 * * 1-5", installer)
        self.assertIn("15 18 * * 1-5", installer)
        self.assertIn("40 18 * * 1-5", installer)
        self.assertIn("fuelsight-prices morning", installer)
        self.assertIn("fuelsight-prices afternoon", installer)
        self.assertIn("fuelsight-prices evening", installer)
        self.assertIn("price-reconcile", installer)



if __name__ == "__main__":
    unittest.main()

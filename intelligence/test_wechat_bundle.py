import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from intelligence.wechat_bundle import bundle_fingerprint, discover_bundle_articles
from intelligence.wechat_publish import (
    build_wechat_content,
    create_multi_article_draft,
    validate_article_for_publish,
    verify_created_multi_article_draft,
)


def write_component(root: Path, stream: str, stem: str, title: str) -> None:
    directory = root / "wechat_publish" / stream
    directory.mkdir(parents=True, exist_ok=True)
    image_url = "https://mmbiz.qpic.cn/summary.jpg" if stream == "summary" else ""
    payload = {
        "title": title,
        "author": "能见社",
        "digest": "摘要",
        "content": (
            "<p>2026-07-24</p>"
            + (f'<img src="{image_url}">' if image_url else "")
            + "<p>正文</p>" * 80
        ),
        "content_source_url": "",
        "thumb_media_id": f"thumb-{stem}",
        "need_open_comment": 0,
        "only_fans_can_comment": 0,
    }
    state = {
        "ok": True,
        "media_id": f"media-{stem}",
        "article_image_url": image_url,
        "draft_verification": {"verified": True},
    }
    (directory / f"{stem}_draft_payload.json").write_text(json.dumps(payload), encoding="utf-8")
    (directory / f"{stem}_draft.json").write_text(json.dumps(state), encoding="utf-8")
    market_date = stem[:10]
    if stream == "digit":
        slug = stem[11:]
        index_directory = root / "digit" / market_date
        index_directory.mkdir(parents=True, exist_ok=True)
        (index_directory / "index.json").write_text(json.dumps({
            "articles": [{
                "article_slug": slug,
                "publication_status": "draft_created",
                "local_audit_status": "pass",
                "llm_review_status": "pass",
            }]
        }), encoding="utf-8")
    else:
        quality_directory = root / "summary" / "quality"
        quality_directory.mkdir(parents=True, exist_ok=True)
        (quality_directory / f"{market_date}.json").write_text(json.dumps({
            "schema_version": "summary-image-article.v1",
            "article_variant": "image_quote",
            "status": "pass",
            "publishable": True,
        }), encoding="utf-8")


class WeChatBundleTests(unittest.TestCase):
    def test_non_template_longform_keeps_body_and_blockquotes(self) -> None:
        body = "这是一段基于权威原文的完整中文论述，保留主体、条件和论证顺序。" * 8
        markdown = (
            "# 长文标题｜2026-08-14\n\n"
            f"{body}\n\n{body}\n\n{body}\n\n"
            "## 原文摘选\n**《The Wall Street Journal》写道：**\n"
            f"> {body}\n\n## 参考资料\n- The Wall Street Journal\n"
        )
        content, _ = build_wechat_content(
            markdown, "", "摘要", "2026-08-14",
        )
        issues, warnings = validate_article_for_publish({
            "title": "长文标题｜2026-08-14",
            "digest": "摘要",
            "content": content,
        }, "2026-08-14")
        self.assertEqual(issues, [])
        self.assertNotIn("article does not visibly identify sources", warnings)
        self.assertGreaterEqual(content.count("<h2"), 3)
        self.assertIn("<blockquote", content)
        self.assertIn("资料来源：</strong>The Wall Street Journal", content)
        self.assertIn("免责声明：</strong>", content)
        self.assertEqual(content.count('data-eti-publication-footer="true"'), 1)

    def test_discovers_digit_first_and_optional_summary(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            write_component(root, "digit", "2026-07-24_crude", "原油")
            write_component(root, "summary", "2026-07-24", "每日普氏价格")
            articles = discover_bundle_articles(root, "2026-07-24")
        self.assertEqual([item["stream"] for item in articles], ["digit", "summary"])
        self.assertEqual(len(bundle_fingerprint(articles)), 64)

    def test_missing_stream_does_not_block_available_stream(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            write_component(root, "summary", "2026-07-24", "每日普氏价格")
            articles = discover_bundle_articles(root, "2026-07-24")
        self.assertEqual(len(articles), 1)
        self.assertEqual(articles[0]["stream"], "summary")

    def test_stale_digit_payload_is_not_bundled(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            write_component(root, "digit", "2026-07-24_crude", "原油")
            index_path = root / "digit" / "2026-07-24" / "index.json"
            index_path.write_text(json.dumps({
                "articles": [{
                    "article_slug": "crude",
                    "publication_status": "review_rejected",
                    "local_audit_status": "reject",
                    "llm_review_status": "reject",
                }]
            }), encoding="utf-8")
            articles = discover_bundle_articles(root, "2026-07-24")
        self.assertEqual(articles, [])

    def test_structured_summary_table_is_not_used_as_image_quote(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            write_component(root, "summary", "2026-07-24", "每日普氏价格")
            quality_path = root / "summary" / "quality" / "2026-07-24.json"
            quality_path.write_text(json.dumps({
                "schema_version": "summary-price-article.v1",
                "status": "pass",
                "publishable": True,
            }), encoding="utf-8")
            articles = discover_bundle_articles(root, "2026-07-24")
        self.assertEqual(articles, [])

    @patch("intelligence.wechat_publish.http_post_json")
    def test_multi_article_draft_uses_one_articles_array(self, post_json) -> None:
        post_json.return_value = {"media_id": "bundle-media"}
        article = {
            "title": "标题",
            "author": "能见社",
            "digest": "摘要",
            "content": "<p>正文</p>" * 80,
            "content_source_url": "",
            "thumb_media_id": "thumb",
            "need_open_comment": 0,
            "only_fans_can_comment": 0,
        }
        result = create_multi_article_draft("token", [article, article])
        self.assertEqual(result["media_id"], "bundle-media")
        self.assertEqual(len(post_json.call_args.args[1]["articles"]), 2)

    @patch("intelligence.wechat_publish.get_draft")
    def test_multi_article_verification_checks_order(self, get_draft) -> None:
        content = "<p>2026-07-24</p>" + "<p>正文</p>" * 80
        articles = [
            {"title": "A", "digest": "", "content": content, "market_date": "2026-07-24"},
            {"title": "B", "digest": "", "content": content, "market_date": "2026-07-24"},
        ]
        get_draft.return_value = {
            "news_item": [
                {"title": "A", "digest": "", "content": content},
                {"title": "B", "digest": "", "content": content},
            ]
        }
        result = verify_created_multi_article_draft("token", "media", articles)
        self.assertTrue(result["verified"])
        self.assertEqual(result["article_count"], 2)


if __name__ == "__main__":
    unittest.main()

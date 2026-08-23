from datetime import date
from types import SimpleNamespace
import unittest

from intelligence.market_pipeline.article import (
    audit_article,
    delete_review_blocked_sentences,
    sanitize_article_markdown,
)
from intelligence.market_pipeline.faithful_translation import (
    append_faithful_translations,
)
from intelligence.market_pipeline.contracts import ArticleMode


class EditorialQualityTests(unittest.TestCase):
    def test_canonical_translation_replaces_all_translation_sections(self) -> None:
        markdown = (
            "# 标题\n\n"
            "## 原文摘选\n旧摘选\n\n"
            "## 原文逐句\n旧逐句\n\n"
            "## 参考资料\n- Platts\n"
        )
        rendered = append_faithful_translations(markdown, [{
            "source_title": "Platts",
            "original_excerpt": "Diesel supply tightened.",
            "translated_excerpt": "柴油供应收紧。",
        }])
        self.assertEqual(rendered.count("## 原文摘选"), 1)
        self.assertNotIn("## 原文逐句", rendered)
        self.assertNotIn("旧摘选", rendered)
        self.assertNotIn("旧逐句", rendered)
        self.assertIn("**《Platts》写道：**", rendered)
        self.assertIn("> 柴油供应收紧。", rendered)
        self.assertNotIn("译文：", rendered)
        self.assertNotIn("Diesel supply tightened.", rendered)

    def test_canonical_translation_removes_writer_rendered_duplicate_quotes(self) -> None:
        translation = {
            "source_title": "The Wall Street Journal",
            "original_excerpt": "Washington paused the blockade.",
            "translated_excerpt": "华盛顿暂停了封锁。",
        }
        rendered = append_faithful_translations(
            "# 标题\n\n正文。\n\n**《The Wall Street Journal》写道：**\n\n"
            "> 华盛顿暂停了封锁。\n\n## 参考资料\n- The Wall Street Journal\n",
            [translation],
        )
        self.assertEqual(rendered.count("华盛顿暂停了封锁。"), 1)
        self.assertEqual(rendered.count("**《The Wall Street Journal》写道：**"), 1)

    def test_audit_rejects_multiple_translation_sections(self) -> None:
        markdown = "# 标题\n\n## 原文摘选\n摘选\n\n## 原文逐句\n逐句\n"
        view = SimpleNamespace(market_date=date(2026, 7, 24), article_mode="")
        issues = audit_article(markdown, view, [], [])
        self.assertTrue(any("duplicate translation sections" in issue for issue in issues))

    def test_audit_rejects_complete_translation_repeated_in_newsroom_body(self) -> None:
        translated = "华盛顿宣布暂停海上封锁，但相关措施尚未换取明确让步，后续安排仍取决于谈判进展。"
        markdown = (
            f"# 标题｜2026-07-24\n\n{translated}\n\n"
            f"## 原文摘选\n> {translated}\n\n## 参考资料\n- The Wall Street Journal\n"
        )
        view = SimpleNamespace(
            market_date=date(2026, 7, 24), article_mode=ArticleMode.EVENT_BRIEF,
        )
        issues = audit_article(markdown, view, [], [{
            "source_title": "The Wall Street Journal",
            "original_excerpt": "Washington paused the naval blockade.",
            "translated_excerpt": translated,
        }])
        self.assertIn("article newsroom body repeats a complete translated excerpt", issues)

    def test_audit_rejects_single_commodity_title_with_broad_evidence(self) -> None:
        markdown = "# 亚洲柴油贸易流\n"
        view = SimpleNamespace(market_date=date(2026, 7, 24), article_mode="")
        facts = [
            SimpleNamespace(
                commodity="diesel", statement="Diesel exports fell.",
                evidence_text="Diesel exports fell.", market_date=date(2026, 7, 24),
            ),
            SimpleNamespace(
                commodity="naphtha", statement="Naphtha cracks rose.",
                evidence_text="Naphtha cracks rose.", market_date=date(2026, 7, 24),
            ),
            SimpleNamespace(
                commodity="coal", statement="Coal demand weakened.",
                evidence_text="Coal demand weakened.", market_date=date(2026, 7, 24),
            ),
        ]
        issues = audit_article(markdown, view, facts, [])
        self.assertTrue(any("evidence bundle is dominated" in issue for issue in issues))

    def test_audit_accepts_focused_diesel_evidence(self) -> None:
        markdown = "# 亚洲柴油贸易流\n"
        view = SimpleNamespace(market_date=date(2026, 7, 24), article_mode="")
        facts = [
            SimpleNamespace(
                commodity="diesel", statement="Diesel exports fell.",
                evidence_text="Diesel exports fell.", market_date=date(2026, 7, 24),
            ),
            SimpleNamespace(
                commodity="gasoil", statement="Gasoil supply tightened.",
                evidence_text="Gasoil supply tightened.", market_date=date(2026, 7, 24),
            ),
        ]
        issues = audit_article(markdown, view, facts, [])
        self.assertFalse(any("evidence bundle is dominated" in issue for issue in issues))

    def test_audit_accepts_explicit_broad_market_title(self) -> None:
        markdown = "# 全球成品油市场：航煤与汽油供需变化\n"
        view = SimpleNamespace(market_date=date(2026, 7, 24), article_mode="")
        facts = [
            SimpleNamespace(
                commodity="jet fuel", statement="Jet demand rose.",
                evidence_text="Jet demand rose.", market_date=date(2026, 7, 24),
            ),
            SimpleNamespace(
                commodity="gasoline", statement="Gasoline supply increased.",
                evidence_text="Gasoline supply increased.", market_date=date(2026, 7, 24),
            ),
        ]
        issues = audit_article(markdown, view, facts, [])
        self.assertFalse(any("evidence bundle is dominated" in issue for issue in issues))

    def test_deterministic_cleanup_removes_mistranslation_and_conflicting_conclusion(self) -> None:
        markdown = (
            "# 日报\n\n"
            "译文：普氏提议不推出该评估。\n\n"
            "eWindow上线时间取决于技术准备和市场接受度。\n"
        )
        review = {
            "blocking_issues": [
                "material_mistranslation: “普氏提议不推出该评估”属于实质性误译。",
                "unsupported_conclusion: “eWindow上线时间取决于技术准备和市场接受度”与证据冲突。",
            ],
        }

        cleaned, removed = delete_review_blocked_sentences(markdown, review)

        self.assertNotIn("提议不推出", cleaned)
        self.assertNotIn("取决于技术准备", cleaned)
        self.assertEqual(len(removed), 2)

    def test_cleanup_prefers_the_full_claim_identified_by_review(self) -> None:
        markdown = (
            "# 燃料油日报\n\n"
            "2026年7月29日，意大利燃料油市场无交易发生，Trades: None。保留后续说明。\n\n"
            "- **Platts**：Trades: None.\n"
        )
        review = {
            "blocking_issues": [
                "文章声称：‘2026年7月29日，意大利燃料油市场无交易发生，Trades: None。’"
                "但证据未提及意大利，该地点信息属于虚构或不可追溯事实，构成主体错误。"
            ]
        }

        cleaned, removed = delete_review_blocked_sentences(markdown, review)

        self.assertNotIn("意大利燃料油市场", cleaned)
        self.assertIn("保留后续说明", cleaned)
        self.assertIn("- **Platts**：Trades: None.", cleaned)
        self.assertEqual(removed, ["2026年7月29日，意大利燃料油市场无交易发生，Trades: None。"])

    def test_cleanup_removes_cross_topic_sentence(self) -> None:
        markdown = (
            "# 中国原油进口\n\n"
            "中国原油进口下降。美国科技界正在追赶人工智能。保留石油市场信息。\n"
        )
        review = {
            "blocking_issues": [
                "topic_mixing；跨主题事实混入；原句：“美国科技界正在追赶人工智能。”"
            ]
        }

        cleaned, removed = delete_review_blocked_sentences(markdown, review)

        self.assertNotIn("人工智能", cleaned)
        self.assertIn("中国原油进口下降", cleaned)
        self.assertIn("保留石油市场信息", cleaned)
        self.assertEqual(removed, ["美国科技界正在追赶人工智能。"])

    def test_deterministic_cleanup_removes_internal_trace_id_line(self) -> None:
        markdown = "# 日报\n\n内部依据 FACT-1234-abcd 不得展示。\n\n普通正文。\n"
        view = SimpleNamespace(market_date=date(2026, 7, 24))

        cleaned, removed = sanitize_article_markdown(markdown, view, [], [])

        self.assertNotIn("FACT-1234-abcd", cleaned)
        self.assertIn("普通正文", cleaned)
        self.assertEqual(removed, ["内部依据 FACT-1234-abcd 不得展示。"])

    def test_market_analysis_does_not_require_directional_pricing_section(self) -> None:
        markdown = (
            "# 市场综述\n\n"
            "## 核心变化\n变化。\n\n"
            "## 关键数据与事实\n事实。\n\n"
            "## 供应、需求或贸易流传导\n传导。\n\n"
            "## 不确定因素\n尚待确认。\n\n"
            "## 参考资料\n- Platts\n"
        )
        view = SimpleNamespace(
            market_date=date(2026, 7, 24),
            article_mode=ArticleMode.MARKET_VIEW,
        )

        issues = audit_article(markdown, view, [], [])

        self.assertFalse(any("市场可能如何定价" in issue for issue in issues))


if __name__ == "__main__":
    unittest.main()

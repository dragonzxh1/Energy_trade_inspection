from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from intelligence import daily_prices
from intelligence.daily_prices import record_image_draft_verified
from intelligence.market_pipeline.article import (
    EVENT_BRIEF_HEADINGS, MAX_WRITER_EVIDENCE_PAYLOAD_CHARACTERS, audit_article,
    call_dify_writer, delete_review_blocked_sentences, quantitative_qualifier_issues,
    sanitize_article_markdown, source_title_matches_line,
)
from intelligence.market_pipeline.article_review import compact_review_evidence
from intelligence.market_pipeline.contracts import ArticleMode, FactType
from intelligence.market_pipeline.editorial_candidates import build_editorial_candidates
from intelligence.market_pipeline.faithful_translation import append_faithful_translations
from intelligence.market_pipeline.publication_worker import repair_empty_source_description
from intelligence.market_pipeline.source_dossier import build_source_dossier
from intelligence.wechat_publish import price_release_gate


TARGET_DATE = date(2026, 7, 21)


def fact(
    index: int,
    fact_type: FactType,
    *,
    source: str = "SRC-A",
    article_section_id: str = "",
    article_section_title: str = "",
    commodity: str = "diesel",
    region: str | None = "asia",
) -> SimpleNamespace:
    return SimpleNamespace(
        fact_id=f"FACT-{index}", source_id=source, market_date=TARGET_DATE,
        fact_type=fact_type, commodity=commodity, region=region, country=None,
        article_section_id=article_section_id,
        article_section_title=article_section_title,
        statement=f"Verified market statement {index}",
        evidence_text=(
            f"Publisher evidence sentence {index} identifies the actor, action, timing, "
            "affected market, quantity and uncertainty without adding interpretation."
        ),
        confidence=0.95,
    )


class DigitalArticleModeTests(unittest.TestCase):
    def test_empty_source_description_uses_passed_translation(self) -> None:
        markdown = (
            "# 标题\n\n## 来源如何描述\n\n## 可能影响的市场环节\n影响。\n"
        )
        repaired = repair_empty_source_description(markdown, "event_brief", [{
            "source_title": "The Wall Street Journal",
            "translated_excerpt": "中国原油进口下降了40%。",
        }])

        self.assertIn(
            "The Wall Street Journal写道：“中国原油进口下降了40%。”",
            repaired,
        )

    def test_single_authority_longform_selects_faithful_translation(self) -> None:
        facts = [fact(index, FactType.SOURCE_COMMENTARY) for index in range(1, 6)]
        for item in facts:
            item.evidence_text = " ".join([item.evidence_text] * 3)
        candidates = build_editorial_candidates(TARGET_DATE, facts, directional_signal_available=False)
        self.assertEqual(candidates[0][0].article_mode, ArticleMode.FAITHFUL_TRANSLATION)

    def test_short_single_source_material_uses_event_brief(self) -> None:
        facts = [fact(index, FactType.SOURCE_COMMENTARY) for index in range(1, 6)]
        candidates = build_editorial_candidates(TARGET_DATE, facts, directional_signal_available=False)
        self.assertEqual(candidates[0][0].article_mode, ArticleMode.EVENT_BRIEF)

    def test_single_fact_major_event_is_not_padded_into_an_article(self) -> None:
        candidates = build_editorial_candidates(
            TARGET_DATE, [fact(1, FactType.REFINERY_OUTAGE)], directional_signal_available=False,
        )
        self.assertEqual(candidates, [])

    def test_empty_legacy_event_section_is_not_a_fixed_contract_failure(self) -> None:
        markdown = """# Event｜2026-07-21

## 发生了什么
Event.
## 已确认细节
Details.
## 来源如何描述
Source.
## 可能影响的市场环节
Impact is not established.
## 尚未确认的信息

## 参考资料
- Source
"""
        issues = audit_article(
            markdown,
            SimpleNamespace(market_date=TARGET_DATE, article_mode=ArticleMode.EVENT_BRIEF),
            [],
            [],
        )
        self.assertNotIn("empty section: 尚未确认的信息", issues)

    def test_missing_legacy_heading_is_not_a_fixed_contract_failure(self) -> None:
        missing_heading = EVENT_BRIEF_HEADINGS[2]
        sections = [
            f"## {heading}\n正文内容。"
            for heading in EVENT_BRIEF_HEADINGS
            if heading != missing_heading
        ]
        markdown = "# 市场事件\n\n正文提到了" + missing_heading + "，但它不是栏目标题。\n\n" + "\n\n".join(sections)
        issues = audit_article(
            markdown,
            SimpleNamespace(market_date=TARGET_DATE, article_mode=ArticleMode.EVENT_BRIEF),
            [],
            [],
        )
        self.assertNotIn(f"missing section: {missing_heading}", issues)

    def test_distinct_newspaper_sections_are_not_combined_into_one_event(self) -> None:
        candidates = build_editorial_candidates(
            TARGET_DATE,
            [
                fact(1, FactType.POLICY, article_section_id="SEC-PAGE-7"),
                fact(2, FactType.SUPPLY, article_section_id="SEC-PAGE-7"),
                fact(3, FactType.SUPPLY, article_section_id="SEC-PAGE-7"),
                fact(4, FactType.SOURCE_COMMENTARY, article_section_id="SEC-PAGE-29"),
            ],
            directional_signal_available=False,
        )
        self.assertEqual(len(candidates), 1)
        self.assertEqual(set(candidates[0][0].fact_ids), {"FACT-1", "FACT-2", "FACT-3"})

    def test_directional_material_selects_market_analysis(self) -> None:
        facts = [
            fact(1, FactType.SUPPLY, source="SRC-A"),
            fact(2, FactType.DEMAND, source="SRC-A"),
            fact(3, FactType.TRADE_FLOW, source="SRC-B"),
            fact(4, FactType.PRICE_CHANGE, source="SRC-B"),
        ]
        candidates = build_editorial_candidates(TARGET_DATE, facts, directional_signal_available=True)
        self.assertEqual(candidates[0][0].article_mode, ArticleMode.MARKET_ANALYSIS)

    def test_same_article_normalizes_oil_aliases_and_infers_china(self) -> None:
        facts = [
            fact(1, FactType.DEMAND, commodity="oil", region="China", article_section_title="China oil demand"),
            fact(2, FactType.SUPPLY, commodity="crude oil", region=None, article_section_title="China oil demand"),
            fact(3, FactType.INVENTORY, commodity="oil", region="China", article_section_title="China oil demand"),
            fact(4, FactType.TRADE_FLOW, commodity="crude", region="China", article_section_title="China oil demand"),
            fact(5, FactType.MARKET_SENTIMENT, commodity="oil", region="China", article_section_title="China oil demand"),
        ]
        facts[1].statement = "Beijing can suppress crude imports for six months."
        facts[1].evidence_text = "Beijing can suppress crude imports for another six months based on inventories."

        candidates = build_editorial_candidates(
            TARGET_DATE, facts, directional_signal_available=False,
        )

        self.assertEqual(len(candidates), 1)
        self.assertEqual(set(candidates[0][0].fact_ids), {f"FACT-{index}" for index in range(1, 6)})

    def test_writer_uses_article_specific_dify_contract(self) -> None:
        captured = {}

        class Response:
            is_error = False
            def raise_for_status(self):
                return None
            def json(self):
                return {"data": {"outputs": {"report_markdown": "# x", "title": "x", "summary": "x"}}}

        def fake_post(_url, **kwargs):
            captured.update(kwargs["json"]["inputs"])
            return Response()

        payload = {
            "article_mode": "event_brief", "editorial_view": {}, "verified_facts": [],
            "source_excerpts": [], "source_dossiers": [],
        }
        with patch("intelligence.market_pipeline.article.httpx.post", side_effect=fake_post):
            call_dify_writer("http://dify", "key", TARGET_DATE, payload)
        self.assertEqual(captured["article_mode"], "event_brief")
        self.assertIn("event_brief", captured["article_contract"])
        writer_input = json.loads(captured["evidence_payload"])
        self.assertTrue(writer_input["evidence_policy"]["single_event_required"])
        self.assertFalse(writer_input["evidence_policy"]["cross_event_linking_allowed"])

    def test_writer_maps_legacy_market_view_to_market_analysis(self) -> None:
        captured = {}

        class Response:
            def raise_for_status(self):
                return None
            def json(self):
                return {"data": {"outputs": {
                    "report_markdown": "# x", "title": "x", "summary": "x",
                }}}

        def fake_post(_url, **kwargs):
            captured.update(kwargs["json"]["inputs"])
            return Response()

        with patch("intelligence.market_pipeline.article.httpx.post", side_effect=fake_post):
            call_dify_writer(
                "http://dify", "key", TARGET_DATE,
                {"article_mode": "market_view", "verified_facts": []},
            )

        self.assertEqual(captured["article_mode"], "market_analysis")

    def test_writer_rejects_oversized_evidence_before_http_call(self) -> None:
        payload = {
            "article_mode": "event_brief",
            "verified_facts": [{
                "fact_type": "supply",
                "statement": "x" * (MAX_WRITER_EVIDENCE_PAYLOAD_CHARACTERS + 1),
                "evidence_text": "evidence",
            }],
        }
        with patch("intelligence.market_pipeline.article.httpx.post") as post:
            with self.assertRaisesRegex(ValueError, "exceeds local budget"):
                call_dify_writer("http://dify", "key", TARGET_DATE, payload)
        post.assert_not_called()

    def test_writer_http_error_includes_response_and_payload_size(self) -> None:
        response = SimpleNamespace(
            is_error=True,
            status_code=400,
            text='{"code":"invalid_param","message":"evidence_payload too long"}',
        )
        with patch("intelligence.market_pipeline.article.httpx.post", return_value=response):
            with self.assertRaisesRegex(
                RuntimeError, "invalid_param.*evidence_payload_characters",
            ):
                call_dify_writer(
                    "http://dify", "key", TARGET_DATE,
                    {"article_mode": "event_brief", "verified_facts": []},
                )

    def test_internal_label_style_title_is_rejected(self) -> None:
        markdown = "# Oil · China｜2026-07-30\n\n正文内容。"
        issues = audit_article(
            markdown,
            SimpleNamespace(market_date=TARGET_DATE, article_mode=ArticleMode.EVENT_BRIEF),
            [],
            [],
        )
        self.assertIn("article title must be a natural Chinese reader-facing title", issues)

    def test_review_contract_is_specific_to_article_mode(self) -> None:
        expected = {
            "faithful_translation": (4, False, "preserve the source thesis and argument order"),
            "event_brief": (1, False, "identify the dated actor, action and affected market"),
            "market_analysis": (0, False, "explain at least one evidence-bound transmission chain"),
        }
        for article_mode, (excerpt_count, directional, semantic_requirement) in expected.items():
            compact = compact_review_evidence({
                "editorial_view": {"article_mode": article_mode},
                "verified_facts": [], "source_excerpts": [], "source_mapping": {},
            })
            contract = compact["publication_policy"]["article_contract"]
            self.assertEqual(contract["minimum_translated_excerpts"], excerpt_count)
            self.assertEqual(contract["directional_conclusion_required"], directional)
            self.assertIn(semantic_requirement, contract["semantic_requirements"])
            self.assertNotIn("required_sections", contract)
            self.assertIn(
                "unrelated_event_or_topic_mixed_into_article",
                compact["publication_policy"]["blocking"],
            )
    def test_publication_alias_matches_global_critical_minerals(self) -> None:
        self.assertTrue(source_title_matches_line(
            "Global Critical Minerals", "- **全球关键矿产**：原文摘录",
        ))

    def test_excerpt_month_name_allows_equivalent_chinese_month_number(self) -> None:
        headings = (
            "原文讨论的核心问题", "原文论述脉络", "原文摘选",
            "必要背景", "原文结论与保留意见", "参考资料",
        )
        markdown = "# 印尼2025年10月政策更新｜2026-07-21\n\n" + "\n\n".join(
            f"## {heading}\n正文" for heading in headings
        )
        view = SimpleNamespace(market_date=TARGET_DATE, article_mode=ArticleMode.FAITHFUL_TRANSLATION)
        issues = audit_article(markdown, view, [], [{
            "source_title": "Global Critical Minerals",
            "original_excerpt": "This framework was revised in October 2025.",
            "translated_excerpt": "该框架于2025年10月修订。",
        }])
        self.assertFalse([issue for issue in issues if "unsupported numbers" in issue])

    def test_unsupported_chinese_duration_in_title_is_blocked_before_revision(self) -> None:
        headings = (
            "原文讨论的核心问题", "原文论述脉络", "原文摘选",
            "必要背景", "原文结论与保留意见", "参考资料",
        )
        markdown = "# 铜矿品位四十年下降40%｜2026-07-21\n\n" + "\n\n".join(
            f"## {heading}\n正文" for heading in headings
        )
        view = SimpleNamespace(market_date=TARGET_DATE, article_mode=ArticleMode.FAITHFUL_TRANSLATION)
        issues = audit_article(markdown, view, [], [{
            "source_title": "Global Critical Minerals",
            "original_excerpt": "The average grade decreased by 40% since 1991.",
            "translated_excerpt": "平均品位自1991年以来下降40%。",
        }])
        self.assertTrue([issue for issue in issues if "unsupported duration" in issue])

    def test_wrongly_attributed_quote_line_is_removed_deterministically(self) -> None:
        markdown, removed = sanitize_article_markdown(
            "# Test\n\n## 原文摘选\n- **错误来源**：“The market changed materially after the outage.”\n",
            SimpleNamespace(market_date=TARGET_DATE), [], [{
                "source_title": "正确来源",
                "original_excerpt": "The market changed materially after the outage.",
                "translated_excerpt": "停产后市场出现明显变化。",
            }],
        )
        self.assertNotIn("The market changed", markdown)
        self.assertTrue(any("错误来源" in line for line in removed))
    def test_average_qualifier_is_required_for_matching_number(self) -> None:
        headings = (
            "原文讨论的核心问题", "原文论述脉络", "原文摘选",
            "必要背景", "原文结论与保留意见", "参考资料",
        )
        markdown = "# 铜项目资本变化｜2026-07-21\n\n" + "\n\n".join(
            f"## {heading}\n资本密集度自2020年以来上升65%。" for heading in headings
        )
        view = SimpleNamespace(market_date=TARGET_DATE, article_mode=ArticleMode.FAITHFUL_TRANSLATION)
        issues = audit_article(markdown, view, [], [{
            "source_title": "Global Critical Minerals",
            "original_excerpt": "The average capital intensity increased by 65% since 2020.",
            "translated_excerpt": "平均资本密集度自2020年以来上升65%。",
        }])
        self.assertTrue([issue for issue in issues if "required qualifier 'average'" in issue])
    def test_role_markers_are_removed_without_deleting_background(self) -> None:
        markdown, removed = sanitize_article_markdown(
            "# Test\n\n## 必要背景\n[background_context] 这是不引入新数字的背景说明。\n",
            SimpleNamespace(market_date=TARGET_DATE), [], [],
        )
        self.assertIn("这是不引入新数字的背景说明", markdown)
        self.assertNotIn("[background_context]", markdown)
        self.assertEqual(removed, [])


    def test_percent_word_and_symbol_are_numeric_equivalents(self) -> None:
        markdown = "# Brent move｜2026-07-21\n\n" + "\n\n".join(
            f"## {heading}\nBrent crude rose 11%." for heading in EVENT_BRIEF_HEADINGS
        )
        view = SimpleNamespace(market_date=TARGET_DATE, article_mode=ArticleMode.EVENT_BRIEF)
        fact_item = SimpleNamespace(
            statement="Brent crude rose 11 percent on Monday.",
            evidence_text="The price of Brent crude rose 11 percent on Monday.",
            market_date=TARGET_DATE,
        )
        issues = audit_article(markdown, view, [fact_item], [])
        self.assertFalse([issue for issue in issues if "unsupported numbers" in issue])

    def test_temporal_over_does_not_require_exceeds_wording(self) -> None:
        issues = quantitative_qualifier_issues(
            "过去35年发现的矿床中，只有5%发现于最近十年。",
            ["Of deposits discovered over the last 35 years, only 5% were found in the last decade."],
        )
        self.assertEqual(issues, [])

    def test_refining_country_cannot_be_rendered_as_oil_refining_country(self) -> None:
        markdown = "# Critical minerals｜2026-07-21\n\n" + "\n\n".join(
            f"## {heading}\n最大炼油国的份额达到72%。" for heading in EVENT_BRIEF_HEADINGS
        )
        view = SimpleNamespace(market_date=TARGET_DATE, article_mode=ArticleMode.EVENT_BRIEF)
        fact_item = SimpleNamespace(
            statement="The top refining country had an average share of 72%.",
            evidence_text="The average share of the top refining country rose to 72%.",
            market_date=TARGET_DATE,
        )
        issues = audit_article(markdown, view, [fact_item], [])
        self.assertTrue([issue for issue in issues if "mistranslates refining country" in issue])


    def test_model_translation_sections_are_replaced_by_canonical_cards(self) -> None:
        translations = [{
            "source_title": "Global Critical Minerals",
            "original_excerpt": "The average grade declined by 40%.",
            "translated_excerpt": "平均品位下降40%。",
        }]
        markdown = append_faithful_translations(
            "# Test\n\n### 忠实摘译\n重复内容\n\n**忠实摘译**\n另一份重复内容\n\n## 参考资料\n- Source\n",
            translations,
        )
        self.assertEqual(markdown.count("## 原文摘选"), 1)
        self.assertNotIn("## 忠实摘译", markdown)
        self.assertNotIn("重复内容", markdown)
        self.assertNotIn("另一份重复内容", markdown)

    def test_sanitizer_normalizes_refining_term_and_drops_unqualified_average(self) -> None:
        fact_item = SimpleNamespace(
            statement="The average share of the top refining country rose to 72%.",
            evidence_text="The average share of the top refining country rose to 72%.",
            market_date=TARGET_DATE,
        )
        markdown, removed = sanitize_article_markdown(
            "# Test\n\n## 已确认细节\n最大炼油国的平均份额达到72%。\n\n## 可能影响的市场环节\n精炼环节集中度升至72%，供应链风险上升。\n",
            SimpleNamespace(market_date=TARGET_DATE), [fact_item], [],
        )
        self.assertIn("最大精炼国的平均份额达到72%", markdown)
        self.assertNotIn("集中度升至72%", markdown)
        self.assertTrue(any("集中度升至72%" in line for line in removed))


    def test_review_quoted_unsupported_sentence_is_deleted_without_rewrite(self) -> None:
        markdown, removed = delete_review_blocked_sentences(
            "# Test\n\n已确认事实。该风险资本变化证明市场正在重新定价。保留句。\n",
            {"blocking_issues": [{
                "type": "unsupported_conclusion",
                "detail": "文章中的‘该风险资本变化证明市场正在重新定价。’没有证据支持。",
            }]},
        )
        self.assertNotIn("重新定价", markdown)
        self.assertIn("已确认事实", markdown)
        self.assertIn("保留句", markdown)
        self.assertEqual(removed, ["该风险资本变化证明市场正在重新定价。"])


class SourceDossierTests(unittest.TestCase):
    def test_quick_read_uses_document_date_and_high_value_sections(self) -> None:
        document = {
            "id": "DOC-1", "source_id": "SRC-1", "market_date": TARGET_DATE,
            "report_title": "Platts Asia Diesel Review", "report_family": "Platts",
        }
        sections = [
            {"section_id": "SEC-1", "section_index": 0, "section_title": "Contents", "section_type": "table_of_contents", "section_text": "Contents"},
            {"section_id": "SEC-2", "section_index": 1, "section_title": "Supply", "section_type": "market_summary", "triage_category": "supply_disruption", "dify_eligible": True, "section_text": "A refinery outage may temporarily reduce diesel supply in Asia by an uncertain amount."},
            {"section_id": "SEC-3", "section_index": 2, "section_title": "Conclusion", "section_type": "market_summary", "triage_category": "market_summary", "dify_eligible": True, "section_text": "The source concludes that replacement cargo availability remains the key condition."},
        ]
        dossier = build_source_dossier(document, sections)
        self.assertEqual(dossier.market_date, TARGET_DATE)
        self.assertIn("SEC-2", dossier.high_value_section_ids)
        self.assertTrue(dossier.quick_read_inputs)
        self.assertIn("may", dossier.qualifications)


class SummaryImagePromotionTests(unittest.TestCase):
    def test_title_date_promotion_does_not_require_price_ocr(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "platts_summary.jpg"
            source.write_bytes(b"complete-image-fixture")
            with patch(
                "intelligence.summary_image_support.detect_market_date_from_image_title",
                return_value=SimpleNamespace(
                    market_date=TARGET_DATE.isoformat(),
                    version="summary-title-date.v2",
                    recognized_titles=("PLATTS SUMMARY JULY 21, 2026",) * 2,
                    matched_count=2,
                    unique_dates=(TARGET_DATE.isoformat(),),
                    failure_reason=None,
                ),
            ), patch.object(daily_prices, "_generate_public_reference"):
                promotion_path = daily_prices.promote_summary_image_quote(None, source, root)
            payload = json.loads(promotion_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["market_date_source"], "image_title")
            self.assertEqual(payload["parser"], "title_tesseract_consensus")
            self.assertEqual(payload["date_detection_version"], "summary-title-date.v2")
            self.assertEqual(payload["ocr_candidates_promoted"], 0)

    def test_title_date_mismatch_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "platts_summary.jpg"
            source.write_bytes(b"complete-image-fixture")
            with patch(
                "intelligence.summary_image_support.detect_market_date_from_image_title",
                return_value=SimpleNamespace(
                    market_date="2026-07-20",
                    version="summary-title-date.v2",
                    recognized_titles=("PLATTS SUMMARY JULY 20, 2026",) * 2,
                    matched_count=2,
                    unique_dates=("2026-07-20",),
                    failure_reason=None,
                ),
            ):
                with self.assertRaisesRegex(ValueError, "does not match"):
                    daily_prices.promote_summary_image_quote(TARGET_DATE, source, root)
            self.assertFalse((root / TARGET_DATE.isoformat() / "image_promotion.json").exists())

class SummaryImageGateTests(unittest.TestCase):
    def test_image_quote_ready_bypasses_delayed_bot_confirmation(self) -> None:
        state = {
            "image_quote_ready": True, "structured_price_verified": False,
            "bot_confirmation_received": False, "blocking_reasons": [],
        }
        self.assertIsNone(price_release_gate(
            state, mode="daily", historical=False, price_mode="append", stream="summary",
        ))

    def test_verified_draft_updates_file_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_path = root / TARGET_DATE.isoformat() / "release_state.json"
            state_path.parent.mkdir(parents=True)
            state_path.write_text(json.dumps({
                "target_market_date": TARGET_DATE.isoformat(),
                "image_quote_ready": True,
                "image_quote_status": "ready",
            }), encoding="utf-8")
            with patch("intelligence.daily_prices.resolve_daily_price_root", return_value=root), \
                    patch("intelligence.daily_prices.persist_summary_publication_state"):
                updated = record_image_draft_verified(TARGET_DATE.isoformat(), "MEDIA-1")
            self.assertTrue(updated["image_draft_created"])
            self.assertEqual(updated["image_draft_media_id"], "MEDIA-1")
            self.assertEqual(updated["image_quote_status"], "draft_verified")


if __name__ == "__main__":
    unittest.main()

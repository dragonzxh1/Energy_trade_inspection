from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from intelligence import daily_prices
from intelligence.market_pipeline.article_topics import plan_article_topics_with_diagnostics
from intelligence.market_pipeline.faithful_translation import _translation_issues, translate_excerpts
from intelligence.market_pipeline.numeric_equivalence import numeric_values
from intelligence.market_pipeline.publication_worker import publication_index_status
from intelligence.pending_wechat_publish import _successful_publication_exists
from intelligence.wechat_publish import publication_leaks


class Iteration13TranslationTests(unittest.TestCase):
    def test_english_and_chinese_scale_words_are_exactly_equivalent(self):
        self.assertEqual(numeric_values("1.8 million barrels"), numeric_values("180万桶"))
        self.assertEqual(numeric_values("$14.5 billion"), numeric_values("145亿美元"))
        self.assertEqual(_translation_issues("Output was 1.8 million barrels.", "产量为180万桶。"), [])

    def test_local_semantic_guard_detects_scope_and_irony(self):
        original = "A one-year (yeah, right) pause on new large data centers may continue."
        translation = "大型数据中心暂停一年，并将继续。"
        issues = _translation_issues(original, translation)
        self.assertIn("missing semantic marker: yeah, right", issues)
        self.assertIn("missing semantic marker: new", issues)
        self.assertIn("missing semantic marker: may", issues)

    def test_independent_review_correction_is_persisted(self):
        responses = [
            {"translations": [{"id": "0", "translation": "新建的大型数据中心可能暂停一年（才怪）。"}]},
            {"translations": [{"id": "0", "translation": "大型数据中心暂停一年（没错）。"}]},
            {"reviews": [{
                "id": "0", "decision": "reject", "issues": ["讽刺和范围限定误译"],
                "corrected_translation": "新的大型数据中心可能暂停一年（才怪）。",
                "preserved_terms": ["new", "may", "yeah, right"],
            }]},
        ]

        def fake_post(*args, **kwargs):
            payload = responses.pop(0)
            return SimpleNamespace(
                raise_for_status=lambda: None,
                json=lambda: {"data": {"outputs": {"result": json.dumps(payload, ensure_ascii=False)}}},
            )

        with patch("intelligence.market_pipeline.faithful_translation.httpx.post", side_effect=fake_post):
            result = translate_excerpts("http://dify", "key", [{
                "source_title": "Source", "source_fact_ids": ["FACT-1"],
                "original_excerpt": "New large data centers may pause for one year (yeah, right).",
            }])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["review_decision"], "reject")
        self.assertEqual(result[0]["translation_review_status"], "pass")
        self.assertIn("才怪", result[0]["translated_excerpt"])
    def test_rejected_translation_without_correction_stays_rejected(self):
        excerpt = {
            "source_title": "Source",
            "source_fact_ids": ["FACT-1"],
            "original_excerpt": "Supply may remain tight.",
        }
        with patch(
            "intelligence.market_pipeline.faithful_translation._workflow_translations",
            return_value={"0": "供应可能保持紧张。"},
        ), patch(
            "intelligence.market_pipeline.faithful_translation._workflow_reviews",
            return_value={"0": {
                "decision": "reject",
                "issues": ["主体范围不准确"],
                "corrected_translation": "",
            }},
        ):
            result = translate_excerpts("http://dify", "key", [excerpt])
        self.assertEqual(result[0]["translation_review_status"], "reject")

    def test_semantic_markers_match_words_not_substrings(self):
        issues = _translation_issues(
            "Malaysia news was notably calm.",
            "马来西亚的新闻整体平静。",
        )
        self.assertNotIn("missing semantic marker: may", issues)
        self.assertNotIn("missing semantic marker: new", issues)
        self.assertNotIn("missing semantic marker: not", issues)


class Iteration13TopicTests(unittest.TestCase):
    def test_same_source_and_policy_subjects_merge(self):
        facts = [
            SimpleNamespace(
                fact_id="FACT-1", source_id="SRC-1", fact_type="policy", commodity="crude",
                region="uk", confidence=0.9,
                statement="UK Labour government blocks new North Sea licences",
                evidence_text="The UK Labour government said it would block all new North Sea oil licences after taking office.",
            ),
            SimpleNamespace(
                fact_id="FACT-2", source_id="SRC-1", fact_type="policy", commodity="natural gas",
                region="north sea", confidence=0.9,
                statement="UK Labour government keeps North Sea licence pledge",
                evidence_text="The UK Labour government is unlikely to abandon its pledge on new North Sea licences this year.",
            ),
        ]
        view = SimpleNamespace(
            editorially_publishable=True, article_mode="factual_brief", market_date=date(2026, 7, 17),
        )
        plan = plan_article_topics_with_diagnostics(view, facts, [])
        self.assertEqual(len(plan.topics), 1)
        self.assertEqual(len(plan.topics[0].merged_candidate_ids), 2)
        self.assertEqual(plan.topics[0].merge_reasons, ["same_source_and_subject"])

    def test_partial_success_is_not_daily_failure(self):
        entries = [
            {"publication_status": "draft_created"},
            {"publication_status": "review_rejected"},
        ]
        self.assertEqual(publication_index_status(entries), "partial_success")


class Iteration13PriceStateTests(unittest.TestCase):
    def test_next_poll_uses_configured_singapore_slot(self):
        config = daily_prices._load_config()
        value = daily_prices._next_poll_at(
            datetime.fromisoformat("2026-07-20T11:00:00+08:00"), config,
        )
        self.assertEqual(value, "2026-07-20T14:30:00+08:00")

    def test_existing_draft_prevents_delayed_duplicate(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "draft.json"
            path.write_text(json.dumps({
                "media_id": "MEDIA-1", "publication_stage": "draft_created",
            }), encoding="utf-8")
            self.assertTrue(_successful_publication_exists(path, "draft"))

    def test_legitimate_ai_market_subject_is_not_ai_disclosure(self):
        self.assertNotIn("AI wording", publication_leaks("纽约州暂停新建大型AI数据中心。"))
        self.assertIn("AI wording", publication_leaks("本文由AI生成。"))


if __name__ == "__main__":
    unittest.main()

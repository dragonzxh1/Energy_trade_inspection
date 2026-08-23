from __future__ import annotations

import unittest
from datetime import date
from types import SimpleNamespace

from intelligence.market_pipeline.article import reader_safe_writer_payload, sanitize_article_markdown
from intelligence.market_pipeline.article_topics import plan_article_topics
from intelligence.market_pipeline.contracts import ArticleMode, FactType
from intelligence.market_pipeline.editorial import build_editorial_view
from intelligence.market_pipeline.editorial_candidates import build_editorial_candidates
from intelligence.market_pipeline.publication_worker import ensure_reference_section


def fact(
    index: int, fact_type: FactType, *, source: str, commodity: str = "diesel",
    region: str = "asia", evidence: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        fact_id=f"FACT-{index}", source_id=source, market_date=date(2026, 7, 17),
        fact_type=fact_type, commodity=commodity, region=region,
        statement=f"Verified statement {index}",
        evidence_text=evidence or (
            f"Publisher evidence sentence {index} identifies the actor, market event, "
            "timing, affected region and explicitly stated uncertainty for readers."
        ),
        confidence=0.95, uncertainty=None,
    )


class Iteration12PublicationTest(unittest.TestCase):
    def test_verified_news_without_top_signal_becomes_factual_brief(self):
        facts = [
            fact(1, FactType.SUPPLY, source="SRC-A"),
            fact(2, FactType.DEMAND, source="SRC-A"),
            fact(3, FactType.TRADE_FLOW, source="SRC-B"),
            fact(4, FactType.PRICE_CHANGE, source="SRC-B"),
        ]
        view = build_editorial_view(
            date(2026, 7, 17), [], previous_signals=[], knowledge_card=None,
            allowed_fact_ids={item.fact_id for item in facts}, unresolved_fact_ids=set(),
            facts=facts,
        )
        self.assertEqual(view.article_mode, ArticleMode.EVENT_BRIEF)
        self.assertTrue(view.evidence_ready)
        self.assertTrue(view.editorially_publishable)
        self.assertFalse(view.directional_signal_available)
        topics = plan_article_topics(view, facts, [])
        self.assertEqual(len(topics), 1)
        self.assertEqual(topics[0].article_mode, ArticleMode.EVENT_BRIEF)

    def test_insufficient_evidence_remains_archive_only(self):
        facts = [fact(1, FactType.SOURCE_COMMENTARY, source="SRC-A")]
        view = build_editorial_view(
            date(2026, 7, 17), [], previous_signals=[], knowledge_card=None,
            allowed_fact_ids={"FACT-1"}, unresolved_fact_ids=set(), facts=facts,
        )
        self.assertEqual(view.article_mode, ArticleMode.ARCHIVE_ONLY)
        self.assertFalse(view.editorially_publishable)
        self.assertEqual(plan_article_topics(view, facts, []), [])

    def test_evidence_bundle_enforces_fact_quotas_and_total_limit(self):
        types = [
            FactType.GEOPOLITICAL_EVENT, FactType.SANCTION, FactType.POLICY,
            FactType.REFINERY_OUTAGE, FactType.PRODUCTION, FactType.SUPPLY,
            FactType.DEMAND, FactType.INVENTORY, FactType.TRADE_FLOW,
            FactType.PRICE, FactType.PRICE_CHANGE, FactType.SPREAD,
            FactType.SOURCE_COMMENTARY, FactType.MARKET_SENTIMENT,
        ]
        facts = [fact(index, fact_type, source=f"SRC-{index % 3}") for index, fact_type in enumerate(types, 1)]
        candidates = build_editorial_candidates(
            date(2026, 7, 17), facts, directional_signal_available=False,
        )
        candidate, bundle = candidates[0]
        self.assertLessEqual(len(candidate.fact_ids), 15)
        self.assertLessEqual(len(bundle.core_fact_ids), 5)
        self.assertLessEqual(len(bundle.supply_trade_fact_ids), 4)
        self.assertLessEqual(len(bundle.price_fact_ids), 3)
        self.assertLessEqual(len(bundle.commentary_fact_ids), 3)
        self.assertLessEqual(len(bundle.excerpt_fact_ids), 6)

    def test_two_single_fact_events_remain_archived_instead_of_being_padded(self):
        facts = [
            fact(
                1, FactType.POLICY, source="SRC-A",
                commodity="electricity", region="uk",
            ),
            fact(
                2, FactType.REFINERY_OUTAGE, source="SRC-B",
                commodity="refining", region="europe",
            ),
        ]
        view = build_editorial_view(
            date(2026, 7, 17), [], previous_signals=[], knowledge_card=None,
            allowed_fact_ids={item.fact_id for item in facts},
            unresolved_fact_ids=set(), facts=facts,
        )

        topics = plan_article_topics(view, facts, [])

        self.assertEqual(topics, [])

    def test_major_event_includes_same_source_named_entity_context(self):
        def scoped(
            index: int, fact_type: FactType, statement: str, section_id: str,
            article_text: str = "",
        ):
            return SimpleNamespace(
                fact_id=f"FACT-{index}", source_id="SRC-WSJ", section_id=section_id,
                article_section_id=section_id, article_section_title="",
                article_section_text=article_text,
                market_date=date(2026, 8, 1), fact_type=fact_type,
                commodity="natural gas" if index == 1 else "oil", region="global",
                statement=statement, evidence_text=f"Evidence: {statement}",
                confidence=0.95, uncertainty=None,
            )

        facts = [
            scoped(
                1, FactType.GEOPOLITICAL_EVENT,
                "Iranian strikes damaged Qatari facilities in which Exxon has a stake.", "SEC-1",
                "Exxon output rose while the Strait of Hormuz remained closed after the Iran conflict.",
            ),
            scoped(2, FactType.PRODUCTION, "Exxon output reached 1.8 million barrels a day.", "SEC-2"),
            scoped(3, FactType.REFINERY_RUN, "Exxon refineries helped lift quarterly earnings.", "SEC-3"),
            scoped(4, FactType.SOURCE_COMMENTARY, "Ford discussed a new electric truck.", "SEC-4"),
            scoped(5, FactType.SUPPLY, "The Strait of Hormuz remained closed.", "SEC-5"),
        ]

        candidates = build_editorial_candidates(
            date(2026, 8, 1), facts, directional_signal_available=False,
        )

        event_candidate = next(item for item, _bundle in candidates if "FACT-1" in item.fact_ids)
        self.assertIn("FACT-2", event_candidate.fact_ids)
        self.assertIn("FACT-3", event_candidate.fact_ids)
        self.assertIn("FACT-5", event_candidate.fact_ids)
        self.assertNotIn("FACT-4", event_candidate.fact_ids)

    def test_reader_payload_does_not_expose_fact_ids(self):
        safe = reader_safe_writer_payload({
            "article_mode": "factual_brief",
            "article_topic": {"title_hint": "Supply disruption", "rationale": "major event"},
            "editorial_view": {"article_mode": "factual_brief"},
            "verified_facts": [{"fact_id": "FACT-1", "statement": "Event", "source_title": "Platts"}],
            "source_excerpts": [{
                "source_title": "Platts", "source_fact_ids": ["FACT-1"],
                "original_excerpt": "Original evidence", "translation_requirement": "faithful",
            }],
        })
        self.assertNotIn("FACT-1", str(safe))

    def test_deterministic_cleanup_removes_unsupported_numeric_sentence(self):
        allowed = fact(
            1, FactType.SUPPLY, source="SRC-A",
            evidence="The source reported supply of 20,000 b/d with uncertainty.",
        )
        view = SimpleNamespace(market_date=date(2026, 7, 17))
        markdown, removed = sanitize_article_markdown(
            "# Test\n\n## 发生了什么\nSupply was 99,000 b/d.\nSupply was 20,000 b/d.\n",
            view, [allowed], [],
        )
        self.assertNotIn("99,000", markdown)
        self.assertIn("20,000", markdown)
        self.assertTrue(any("99,000" in line for line in removed))

    def test_reference_section_is_normalized_and_deduplicated(self):
        markdown = (
            "# Test\n\n参考资料：\n- The Wall Street Journal\n\n"
            "## 原文摘选\n正文\n\nThe Wall Street Journal\n"
        )
        normalized = ensure_reference_section(markdown, [{"source_title": "The Wall Street Journal"}])
        self.assertEqual(normalized.count("参考资料"), 1)
        self.assertEqual(normalized.count("- The Wall Street Journal"), 1)
        self.assertIn("## 原文摘选", normalized)


if __name__ == "__main__":
    unittest.main()

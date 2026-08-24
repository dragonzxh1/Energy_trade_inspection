from __future__ import annotations

import unittest
import os
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from intelligence.market_pipeline.article import reader_safe_writer_payload, select_source_excerpts
from intelligence.market_pipeline.article_review import article_review_contract
from intelligence.market_pipeline.article_review import call_review
from intelligence.market_pipeline.contracts import (
    ArticleMode,
    ArticleTopic,
    ClaimLedgerEntry,
    ClaimType,
    EvidenceRelationship,
    ExternalEvidenceCandidate,
    ExtractedFact,
    FactDirection,
    FactType,
    StoryBrief,
    StoryForm,
)
from intelligence.market_pipeline.external_research import (
    build_claim_ledger,
    build_story_brief,
    canonicalize_url,
    normalize_external_candidate,
    source_tier,
    verify_external_candidates,
)
from intelligence.market_pipeline.editorial_style import audit_editorial_style
from intelligence.market_pipeline.article import sanitize_article_markdown
from intelligence.market_pipeline.source_dossier import (
    build_source_dossier, clean_reader_excerpt_text, paragraph_excerpts_for_topic,
)
from intelligence.market_pipeline.article import select_contextual_source_excerpts
from intelligence.market_pipeline.faithful_translation import _apply_domain_terminology
from intelligence.market_pipeline.publication_worker import (
    attach_approved_translations,
    promote_source_close_reading_topic,
    scoped_writer_claims,
)


MARKET_DATE = date(2026, 7, 30)


def candidate(
    *,
    url: str,
    publisher: str,
    relationship: str = "supports",
    claim: str = "The refinery cut crude runs after a power outage.",
    event_date: date = MARKET_DATE,
    internal_fact_ids: list[str] | None = None,
) -> ExternalEvidenceCandidate:
    fact = ExtractedFact(
        fact_type=FactType.REFINERY_OUTAGE,
        statement=claim,
        commodity="crude",
        direction=FactDirection.DOWN,
        evidence_text=claim,
        attribution=publisher,
        confidence=0.92,
    )
    return normalize_external_candidate({
        "canonical_url": url,
        "source_title": "Refinery operating update",
        "source_publisher": publisher,
        "relationship": relationship,
        "claim_text": claim,
        "evidence_text": claim,
        "page_text": f"Opening. {claim} Closing.",
        "event_date": event_date.isoformat(),
        "retrieved_at": datetime(2026, 7, 30, tzinfo=timezone.utc).isoformat(),
        "supporting_internal_fact_ids": internal_fact_ids or [],
        "fact": fact.model_dump(mode="json"),
    }, MARKET_DATE)


class ExternalResearchBoundaryTests(unittest.TestCase):
    def test_private_and_non_http_urls_are_rejected(self):
        for value in ("http://127.0.0.1/admin", "http://10.0.0.8/", "file:///etc/passwd"):
            with self.assertRaises(ValueError):
                canonicalize_url(value)

    def test_source_tiers_are_deterministic(self):
        self.assertEqual(source_tier("https://www.eia.gov/todayinenergy/"), 1)
        self.assertEqual(source_tier("https://www.reuters.com/markets/commodities/"), 2)
        self.assertEqual(source_tier("https://example.net/repost"), 3)

    def test_tier_three_is_only_a_lead(self):
        item = candidate(url="https://example.net/repost", publisher="Example blog")
        verified = verify_external_candidates([item], set())
        self.assertEqual(verified[0].verification_status, "lead_only")
        self.assertIn("TIER_3_LEAD_ONLY", verified[0].review_reasons)

    def test_single_tier_two_source_needs_corroboration(self):
        item = candidate(url="https://www.reuters.com/world/example", publisher="Reuters")
        verified = verify_external_candidates([item], set())
        self.assertEqual(verified[0].verification_status, "needs_review")
        self.assertIn("TIER_2_NEEDS_CORROBORATION", verified[0].review_reasons)

    def test_two_independent_tier_two_sources_can_verify(self):
        items = [
            candidate(url="https://www.reuters.com/world/example", publisher="Reuters"),
            candidate(url="https://www.ft.com/content/example", publisher="Financial Times"),
        ]
        verified = verify_external_candidates(items, set())
        self.assertEqual([item.verification_status for item in verified], ["verified", "verified"])

    def test_event_date_mismatch_needs_review(self):
        item = candidate(
            url="https://www.eia.gov/example", publisher="EIA",
            event_date=date(2026, 7, 29),
        )
        verified = verify_external_candidates([item], set())
        self.assertEqual(verified[0].verification_status, "needs_review")
        self.assertIn("EVENT_DATE_MISMATCH", verified[0].review_reasons)

    def test_verification_only_evidence_can_confirm_an_internal_fact(self):
        item = candidate(
            url="https://www.exxonmobil.com/news/example", publisher="ExxonMobil",
            internal_fact_ids=["FACT-1"],
        ).model_copy(update={"fact": None})
        verified = verify_external_candidates([item], {"FACT-1"})
        self.assertEqual(verified[0].verification_status, "verified")


class EditorialStyleContractTests(unittest.TestCase):
    def setUp(self):
        self.fact = SimpleNamespace(
            fact_id="FACT-1", source_id="SRC-1", statement="Refinery runs fell after the outage.",
            evidence_text="Refinery runs fell after the outage.", attribution="Platts",
            report_title="Platts Oilgram News", value=None,
        )
        self.topic = ArticleTopic(
            slug="refinery-outage", title_hint="停电如何影响炼厂开工",
            fact_ids=["FACT-1"], rationale="dated refinery event",
            article_mode=ArticleMode.EVENT_BRIEF, candidate_id="CAND-1",
            topic_cluster_key="refinery:outage",
        )

    def test_source_dossier_v2_preserves_argument_roles_and_context(self):
        dossier = build_source_dossier(
            {
                "id": "DOC-1", "source_id": "SRC-1", "market_date": MARKET_DATE,
                "report_title": "Platts Oilgram News", "document_type": "news",
            },
            [{
                "section_id": "SEC-1", "section_index": 0,
                "section_title": "Refinery outage reshapes prompt supply",
                "section_type": "market_summary", "triage_category": "market_summary",
                "dify_eligible": True,
                "section_text": (
                    "The market opened with an uncomfortable question: how long would the refinery remain offline, "
                    "and how quickly could nearby suppliers replace its output? Traders said prompt availability was "
                    "already limited before the incident, making the timing of the restart unusually important.\n\n"
                    "The operator said crude runs fell after a power outage, but it may restore one unit this week. "
                    "The statement did not provide a firm restart hour and warned that electrical inspections were "
                    "still under way, leaving the operating schedule conditional rather than confirmed.\n\n"
                    "Traders questioned that timetable because regional inventories were already below normal. "
                    "Several participants said replacement barrels would need to travel farther, while others argued "
                    "that scheduled imports could soften the immediate effect if they arrived without delay.\n\n"
                    "The report concluded that prompt supply would remain tight unless the restart held. It also "
                    "stressed that the outage alone did not establish a lasting shortage, because the balance would "
                    "depend on repair progress, import timing and the response of competing refiners."
                ),
            }],
        )
        self.assertEqual(dossier.schema_version, "source-dossier.v2")
        self.assertGreaterEqual(len(dossier.paragraph_excerpt_candidates), 3)
        roles = {item.paragraph_role.value for item in dossier.paragraph_excerpt_candidates}
        self.assertIn("opening", roles)
        self.assertTrue(dossier.uncertainty_language)
        self.assertTrue(any(item.next_context or item.previous_context for item in dossier.paragraph_excerpt_candidates))

        selected = paragraph_excerpts_for_topic(
            [dossier], {"SRC-1"}, {"SRC-1": ["FACT-1"]},
            section_ids={"SEC-1"},
        )
        excluded = paragraph_excerpts_for_topic(
            [dossier], {"SRC-1"}, {"SRC-1": ["FACT-1"]},
            section_ids={"SEC-OTHER"},
        )
        self.assertGreaterEqual(len(selected), 3)
        self.assertEqual(excluded, [])

    def test_newspaper_dossier_uses_publication_title_and_preserves_paragraph_order(self):
        dossier = build_source_dossier(
            {
                "id": "DOC-WSJ", "source_id": "SRC-WSJ", "market_date": MARKET_DATE,
                "report_title": "Barron's 400", "report_family": "The Wall Street Journal",
                "publisher": "Dow Jones", "document_type": "market_report",
            },
            [{
                "section_id": "SEC-WSJ", "section_index": 10,
                "section_title": "Iran strategy", "section_type": "sanctions_policy",
                "triage_category": "sanctions_policy", "dify_eligible": True,
                "verified_fact_count": 2,
                "section_text": (
                    "The opening described a bargaining problem and asked why pressure had not produced a concession. "
                    "It explained that Tehran treated compromise as weakness and therefore narrowed the available terms.\n\n"
                    "The middle paragraph said Washington had stopped the blockade before extracting a meaningful concession. "
                    "It preserved the administration's estimate while warning that the estimate did not prove capitulation.\n\n"
                    "The conclusion argued that Tehran remained wounded rather than exhausted. It ended by distinguishing "
                    "survival from legitimacy and aggression from strength, preserving the source's final contrast."
                ),
            }],
        )
        self.assertEqual(dossier.source_title, "The Wall Street Journal")
        excerpts = dossier.paragraph_excerpt_candidates
        self.assertGreaterEqual(len(excerpts), 3)
        self.assertTrue(excerpts[0].original_text.startswith("The opening"))
        self.assertTrue(excerpts[-1].original_text.startswith("The conclusion"))

    def test_source_close_reading_preserves_order_without_unbound_adjacent_paragraphs(self):
        dossier = build_source_dossier(
            {
                "id": "DOC-CLOSE", "source_id": "SRC-CLOSE", "market_date": MARKET_DATE,
                "report_title": "Energy Analysis", "document_type": "analysis",
            },
            [{
                "section_id": "SEC-CLOSE", "section_index": 2,
                "section_title": "Blockade argument", "section_type": "sanctions_policy",
                "triage_category": "sanctions_policy", "dify_eligible": True,
                "verified_fact_count": 1,
                "section_text": (
                    "The source opened by describing why conventional bargaining assumptions had failed. "
                    "It presented the dispute as a contest over pain tolerance rather than military strength.\n\n"
                    "The naval blockade against Iranian oil exports cost Tehran an estimated amount each day, "
                    "but Washington paused the measure before extracting a meaningful concession.\n\n"
                    "The author then contrasted a wounded state with an exhausted one. The distinction explained "
                    "why battlefield losses had not automatically become negotiating losses.\n\n"
                    "The conclusion said survival was not legitimacy and aggression was not strength. It returned "
                    "to the opening argument and preserved the source's central qualification."
                ),
            }],
        )
        selected = paragraph_excerpts_for_topic(
            [dossier], {"SRC-CLOSE"}, {"SRC-CLOSE": ["FACT-CLOSE"]},
            section_ids={"SEC-CLOSE"}, include_adjacent=True,
            topic_facts=[{
                "fact_id": "FACT-CLOSE", "source_id": "SRC-CLOSE",
                "article_section_id": "SEC-CLOSE",
                "statement": "The naval blockade against Iranian oil exports was paused.",
                "evidence_text": "The naval blockade against Iranian oil exports was paused before a concession.",
            }],
        )
        self.assertTrue(selected)
        self.assertTrue(all("naval blockade" in item["original_excerpt"] for item in selected))
        self.assertTrue(selected[0]["original_excerpt"].startswith("The naval blockade"))

    def test_topic_paragraphs_exclude_unrelated_same_section_content(self):
        dossier = build_source_dossier(
            {
                "id": "DOC-2", "source_id": "SRC-2", "market_date": MARKET_DATE,
                "report_title": "Daily Newspaper", "document_type": "news",
            },
            [{
                "section_id": "SEC-2", "section_index": 0,
                "section_title": "Business news", "section_type": "market_summary",
                "triage_category": "market_summary", "dify_eligible": True,
                "section_text": (
                    "BP discussed a North Sea asset sale and said the process would continue through the year. "
                    "The company did not provide a completion date, and advisers are still reviewing bids. "
                    "The transaction is unrelated to current refinery operations or Qatar gas production.\n\n"
                    "Exxon reported record Permian output of 1.8 million barrels a day during the quarter. "
                    "The company said higher oil and gas production supported earnings despite disruption in the Middle East. "
                    "Its Qatari natural-gas facilities had been damaged by Iranian missile strikes in March."
                ),
            }],
        )
        selected = paragraph_excerpts_for_topic(
            [dossier], {"SRC-2"}, {"SRC-2": ["FACT-2"]}, section_ids={"SEC-2"},
            include_adjacent=True,
            topic_facts=[{
                "fact_id": "FACT-2", "source_id": "SRC-2", "article_section_id": "SEC-2",
                "statement": "Exxon reported record Permian output despite Middle East disruption.",
                "evidence_text": "Exxon reported record Permian output of 1.8 million barrels a day.",
            }],
        )
        self.assertTrue(selected)
        self.assertTrue(all("BP discussed" not in item["original_excerpt"] for item in selected))
        self.assertTrue(any("Exxon reported" in item["original_excerpt"] for item in selected))

    def test_common_reporting_verbs_do_not_bind_an_unrelated_newspaper_story(self):
        dossier = build_source_dossier(
            {
                "id": "DOC-PAGE", "source_id": "SRC-PAGE", "market_date": MARKET_DATE,
                "report_title": "The Guardian", "document_type": "news",
            },
            [{
                "section_id": "SEC-PAGE", "section_index": 0,
                "section_title": "Newspaper page", "section_type": "general_news",
                "triage_category": "general_market_news", "dify_eligible": True,
                "section_text": (
                    "Concha said that he found work at a bilingual call centre in Mexico City after deportation. "
                    "He said that the community offered support and that his family would later join him there.\n\n"
                    "Opponents said allowing oil and gas development close to Chaco would introduce toxic air pollution. "
                    "They said drilling would also risk water pollution and damage the protected dark skies."
                ),
            }],
        )
        selected = paragraph_excerpts_for_topic(
            [dossier], {"SRC-PAGE"}, {"SRC-PAGE": ["FACT-CHACO"]},
            section_ids={"SEC-PAGE"}, include_adjacent=True,
            topic_facts=[{
                "fact_id": "FACT-CHACO", "source_id": "SRC-PAGE",
                "article_section_id": "SEC-PAGE",
                "statement": "Oil and gas development close to Chaco would introduce toxic air pollution.",
                "evidence_text": "Opponents said drilling close to Chaco would introduce toxic air pollution.",
            }],
        )
        self.assertTrue(selected)
        self.assertTrue(all("Mexico" not in item["original_excerpt"] for item in selected))

    def test_fact_centred_context_does_not_send_whole_newspaper_page(self):
        fact = SimpleNamespace(
            fact_id="FACT-EXXON", source_id="SRC-WSJ",
            statement="Exxon reported record Permian output.",
            evidence_text="Exxon reported record Permian output of 1.8 million barrels a day.",
            article_section_text=(
                "BP discussed a North Sea asset sale. "
                "Exxon reported record Permian output of 1.8 million barrels a day. "
                "Exxon said the result reflected stronger operations. "
                "Chevron separately discussed production growth."
            ),
        )
        excerpts = select_contextual_source_excerpts(
            [fact], {"SRC-WSJ": "The Wall Street Journal"},
        )
        self.assertEqual(len(excerpts), 1)
        self.assertIn("Exxon reported", excerpts[0]["original_excerpt"])
        self.assertIn("stronger operations", excerpts[0]["original_excerpt"])
        self.assertNotIn("BP discussed", excerpts[0]["original_excerpt"])
        self.assertNotIn("Chevron separately", excerpts[0]["original_excerpt"])

    def test_energy_disruption_uses_interruption_terminology(self):
        corrected = _apply_domain_terminology(
            "In our markets, disruption is inevitable.",
            "在我们的市场中，颠覆是不可避免的。",
        )
        self.assertIn("中断是不可避免", corrected)
        self.assertNotIn("颠覆", corrected)

    def test_refuting_evidence_creates_unresolved_claim(self):
        support = candidate(url="https://www.eia.gov/support", publisher="EIA")
        refute = candidate(
            url="https://www.shell.com/refute", publisher="Shell",
            relationship=EvidenceRelationship.REFUTES.value,
        )
        verified = verify_external_candidates([support, refute], set())
        ledger = build_claim_ledger(MARKET_DATE, [], verified)
        self.assertEqual(len(ledger), 1)
        self.assertEqual(ledger[0].claim_type.value, "unresolved")
        self.assertFalse(ledger[0].publishable)
        self.assertTrue(ledger[0].refuting_evidence_ids)

    def test_same_claim_text_on_different_dates_has_distinct_claim_ids(self):
        first = build_claim_ledger(MARKET_DATE, [self.fact], [])
        second = build_claim_ledger(date(2026, 7, 31), [self.fact], [])

        self.assertEqual(first[0].claim_text, second[0].claim_text)
        self.assertNotEqual(first[0].claim_id, second[0].claim_id)

    def test_story_brief_claims_are_bound_to_ledger(self):
        ledger = build_claim_ledger(MARKET_DATE, [self.fact], [])
        brief, issues = build_story_brief(MARKET_DATE, self.topic, [], [self.fact], ledger)
        self.assertEqual(issues, [])
        self.assertEqual(brief.one_sentence_takeaway, self.fact.statement)
        self.assertEqual(brief.story_form.value, "event_timeline")

    def test_source_close_reading_promotes_event_topic_to_faithful_translation(self):
        dossier = build_source_dossier(
            {
                "id": "DOC-LONG", "source_id": "SRC-1", "market_date": MARKET_DATE,
                "report_title": "Long analysis", "document_type": "analysis",
            },
            [{
                "section_id": "SEC-LONG", "section_index": 1,
                "section_title": "Refinery argument", "section_type": "market_summary",
                "triage_category": "market_summary", "dify_eligible": True,
                "verified_fact_count": 1,
                "section_text": "\n\n".join([
                    "The opening framed the outage as a test of regional supply resilience and explained why restart timing mattered to traders already facing limited prompt availability.",
                    "The operator said refinery runs fell after the outage, while repair work remained conditional on electrical inspections and no firm restart hour had been confirmed.",
                    "Traders offered a counterpoint: scheduled imports could soften the prompt impact if cargoes arrived without delay and competing refiners maintained normal operating rates.",
                    "The conclusion said the outage alone did not establish a lasting shortage and preserved uncertainty around the restart, import timing and the response of nearby suppliers.",
                ]),
            }],
        )
        topic_fact = SimpleNamespace(
            **vars(self.fact), article_section_id="SEC-LONG",
        )
        ledger = build_claim_ledger(MARKET_DATE, [topic_fact], [])
        brief, issues = build_story_brief(
            MARKET_DATE, self.topic, [dossier], [topic_fact], ledger,
        )
        promoted = promote_source_close_reading_topic(self.topic, brief)
        self.assertEqual(issues, [])
        self.assertEqual(brief.story_form, StoryForm.SOURCE_CLOSE_READING)
        self.assertGreaterEqual(len(brief.must_use_excerpt_ids), 4)
        self.assertEqual(promoted.article_mode, ArticleMode.FAITHFUL_TRANSLATION)

    def test_newspaper_longform_stays_newsroom_event_story(self):
        dossier = build_source_dossier(
            {
                "id": "DOC-NEWS", "source_id": "SRC-1", "market_date": MARKET_DATE,
                "report_title": "The Guardian", "report_family": "The Guardian",
                "document_type": "news",
            },
            [{
                "section_id": "SEC-NEWS", "section_index": 1,
                "section_title": "Refinery attack", "section_type": "general_news",
                "triage_category": "general_market_news", "dify_eligible": True,
                "verified_fact_count": 5,
                "section_text": "\n\n".join([
                    "Ukraine attacked a refinery near Moscow using cruise missiles and drones.",
                    "The operator said the refinery fire was contained after several hours.",
                    "Russia confirmed it was importing refined products to stabilize supply.",
                    "A tanker from India arrived while additional cargoes came from East Asia.",
                ]),
            }],
        )
        facts = [SimpleNamespace(
            **vars(self.fact), article_section_id="SEC-NEWS",
        )]
        ledger = build_claim_ledger(MARKET_DATE, facts, [])
        faithful_topic = self.topic.model_copy(update={
            "article_mode": ArticleMode.FAITHFUL_TRANSLATION,
        })
        brief, issues = build_story_brief(
            MARKET_DATE, faithful_topic, [dossier], facts, ledger,
        )
        aligned = promote_source_close_reading_topic(faithful_topic, brief)
        self.assertEqual(issues, [])
        self.assertEqual(brief.story_form, StoryForm.EVENT_TIMELINE)
        self.assertEqual(aligned.article_mode, ArticleMode.EVENT_BRIEF)

    def test_approved_translations_are_attached_before_writer_payload(self):
        excerpts = [{
            "excerpt_id": "EXCERPT-1", "original_excerpt": "Supply tightened.",
            "source_title": "Platts",
        }]
        merged = attach_approved_translations(excerpts, [{
            "excerpt_id": "EXCERPT-1", "translation_review_status": "pass",
            "literal_translation": "供应收紧。",
            "publication_translation": "供应进一步趋紧。",
            "translated_excerpt": "供应进一步趋紧。",
        }])
        self.assertEqual(merged[0]["translated_excerpt"], "供应进一步趋紧。")
        safe = reader_safe_writer_payload({"source_excerpts": merged})
        self.assertNotIn("translated_excerpt", safe["source_excerpts"][0])
        self.assertEqual(safe["publication_voice"]["body"], "Chinese energy newsroom report")

    def test_writer_payload_contains_brief_without_internal_ids(self):
        safe = reader_safe_writer_payload({
            "story_brief": {"reader_question": "发生了什么？", "story_form": "question_led"},
            "claim_ledger": [{
                "claim_id": "CLAIM-SECRET", "claim_type": "confirmed_fact",
                "claim_text": "The refinery cut runs.", "publishable": True,
            }],
            "external_confirmations": [{
                "evidence_id": "WEBEVID-SECRET", "source_title": "Company update",
                "source_publisher": "Operator", "source_tier": 1,
                "claim_text": "The refinery cut runs.", "evidence_text": "The refinery cut runs.",
                "event_date": MARKET_DATE.isoformat(),
            }],
        })
        self.assertEqual(safe["story_brief"]["story_form"], "question_led")
        self.assertNotIn("claim_id", safe["claim_ledger"][0])
        self.assertNotIn("evidence_id", safe["external_confirmations"][0])

    def test_writer_claims_only_include_topic_evidence(self):
        matching = ClaimLedgerEntry(
            claim_id="CLAIM-MATCH", claim_type=ClaimType.CONFIRMED_FACT,
            claim_text="The refinery cut runs.", supporting_fact_ids=["FACT-MATCH"],
            market_date=MARKET_DATE, publishable=True,
        )
        unrelated = ClaimLedgerEntry(
            claim_id="CLAIM-OTHER", claim_type=ClaimType.CONFIRMED_FACT,
            claim_text="A different market moved.", supporting_fact_ids=["FACT-OTHER"],
            market_date=MARKET_DATE, publishable=True,
        )
        brief = StoryBrief(
            story_brief_id="BRIEF-1", market_date=MARKET_DATE,
            reader_question="炼厂发生了什么？",
            one_sentence_takeaway="The refinery cut runs.",
            story_form=StoryForm.EVENT_TIMELINE,
        )
        result = scoped_writer_claims(
            [matching, unrelated], {"FACT-MATCH"}, brief,
        )
        self.assertEqual([entry.claim_id for entry in result], ["CLAIM-MATCH"])

    def test_reader_excerpt_removes_unlabelled_platts_code_prefix(self):
        original = (
            "AAHXE00 83.685 +2.325 It added that available volumes at Yanbu "
            "and Sidi Kerir are limited."
        )
        self.assertEqual(
            clean_reader_excerpt_text(original),
            "It added that available volumes at Yanbu and Sidi Kerir are limited.",
        )

    def test_reader_excerpt_removes_embedded_platts_code(self):
        original = (
            "Platts FOB Fujairah Naphtha <NFJSA00 > assessment rationale: "
            "the strip value was $621.40/mt."
        )
        self.assertEqual(
            clean_reader_excerpt_text(original),
            "Platts FOB Fujairah Naphtha assessment rationale: the strip value was $621.40/mt.",
        )

    def test_fact_excerpt_removes_unlabelled_platts_code_prefix(self):
        source_fact = SimpleNamespace(
            fact_id="FACT-PRICE", source_id="SRC-PLATTS",
            fact_type=SimpleNamespace(value="supply"), confidence=0.95,
            evidence_text=(
                "AAHXE00 83.685 +2.325 It added that available volumes at Yanbu "
                "and Sidi Kerir are limited."
            ),
        )
        excerpts = select_source_excerpts(
            [source_fact], {"SRC-PLATTS": "Platts"},
        )
        self.assertEqual(
            excerpts[0]["original_excerpt"],
            "It added that available volumes at Yanbu and Sidi Kerir are limited.",
        )

    def test_review_contract_uses_semantic_coverage_not_fixed_sections(self):
        contract = article_review_contract("event_brief")
        self.assertIn("semantic_requirements", contract)
        self.assertNotIn("required_sections", contract)

    def test_review_contract_failure_retries_non_thinking_workflow_once(self):
        calls: list[str] = []
        responses = [
            {"data": {"outputs": {"result": "not-json"}}},
            {"data": {"outputs": {
                "decision": "pass", "score": 91, "blocking_issues": [],
            }}},
        ]

        def fake_post(*args, **kwargs):
            calls.append(kwargs["headers"]["Authorization"])
            payload = responses.pop(0)
            return SimpleNamespace(is_error=False, json=lambda: payload)

        with patch.dict(os.environ, {"DIFY_WORKFLOW_API_KEY_REVIEW_REPAIR": "repair-key"}), patch(
            "intelligence.market_pipeline.article_review.httpx.post", side_effect=fake_post,
        ):
            result = call_review(
                "http://dify", "thinking-key", mode="review",
                market_date=MARKET_DATE.isoformat(), markdown="# Test\n\nText",
                evidence_payload={"editorial_view": {"article_mode": "event_brief"}},
            )
        self.assertEqual(result["decision"], "pass")
        self.assertEqual(calls, ["Bearer thinking-key", "Bearer repair-key"])

    def test_style_audit_blocks_vague_filler_and_repeated_paragraphs(self):
        repeated = (
            "这次停电使炼厂减少原油加工量，运营方仍在检查供电系统，恢复时间因此保留条件，"
            "区域现货供应能否及时补位取决于进口到港和其他炼厂的开工安排。"
        )
        result = audit_editorial_style(
            f"# 新稿\n\n{repeated}\n\n值得关注。\n\n## 参考资料\n- Platts",
            [f"# 旧稿\n\n{repeated}\n\n## 参考资料\n- Platts"],
        )
        self.assertIn("article repeats a paragraph from a recent publication", result.blocking_issues)
        self.assertTrue(any("值得关注" in item for item in result.blocking_issues))

    def test_style_audit_allows_distinct_source_specific_prose(self):
        result = audit_editorial_style(
            "# 新稿\n\n运营方称停电后一个蒸馏装置仍在检查，复产取决于周四的电气测试。\n\n## 参考资料\n- Company update",
            ["# 旧稿\n\n港口公告称两艘船因大雾延后靠泊。\n\n## 参考资料\n- Port notice"],
        )
        self.assertEqual(result.blocking_issues, [])

    def test_deterministic_cleanup_removes_vague_sentence_only(self):
        markdown = "# 标题\n\n封锁影响尚待观察。目前缺乏出口量变化数据。\n"
        cleaned, removed = sanitize_article_markdown(
            markdown,
            SimpleNamespace(market_date=MARKET_DATE),
            [],
            [],
        )
        self.assertNotIn("尚待观察", cleaned)
        self.assertIn("目前缺乏出口量变化数据", cleaned)
        self.assertTrue(any("尚待观察" in item for item in removed))


if __name__ == "__main__":
    unittest.main()

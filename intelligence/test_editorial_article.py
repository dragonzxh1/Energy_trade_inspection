from __future__ import annotations

import hashlib
import inspect
import json
import os
import re
import sys
import tempfile
import unittest
from contextlib import ExitStack
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from intelligence.market_pipeline.article import (
    article_disclosure_warnings,audit_article,build_writer_payload,normalize_article_markdown,
    reader_safe_writer_payload,select_source_excerpts,
)
from intelligence.market_pipeline.article_review import (
    compact_review_evidence,
    review_passes,
    validate_review_against_final_markdown,
)
from intelligence.market_pipeline.publication_worker import knowledge_commodity,repair_empty_lead_section
from intelligence.market_pipeline.article import WRITER_TASK
from intelligence.market_pipeline.publication_worker import publication_result_status,source_display_title
from intelligence.market_pipeline.contracts import ArticleTopic, SignalDirection, SignalStatus
from intelligence.market_pipeline.editorial import build_editorial_view
from intelligence.market_pipeline.knowledge import retrieve_knowledge_card
from intelligence.market_pipeline.rollout import evaluate_rollout


def signal(signal_id, status, direction, score, fact_ids, summary="Supply tightened."):
    return SimpleNamespace(
        signal_id=signal_id, signal_type="supply_tightening", direction=direction,
        confidence=0.9, score=score, summary=summary, supporting_fact_ids=fact_ids,
        support_dimensions=["flow_inventory", "disruption_policy"], status=status,
        commodity="naphtha", region="Asia",
    )


class LeadSectionRepairTest(unittest.TestCase):
    def test_empty_market_analysis_lead_uses_verified_key_fact(self):
        markdown = """# 标题

## 核心变化

## 关键数据与事实
已验证的市场事实。

第二段事实。

## 不确定因素
仍需观察。
"""
        repaired = repair_empty_lead_section(markdown, "market_analysis")
        self.assertIn("## 核心变化\n\n已验证的市场事实。", repaired)

    def test_market_analysis_conjunction_heading_is_normalized(self):
        markdown = """# 标题

## 供应、需求与贸易流传导
已验证的传导关系。
"""
        normalized = normalize_article_markdown(markdown, "标题")
        self.assertIn("## 供应、需求或贸易流传导", normalized)


def published_article_connection(markdown_path, market_date=date(2026, 7, 10)):
    class Cursor:
        def __init__(self):
            self.results = iter([[], [], [], [], [{
                "market_date": market_date,
                "markdown_path": markdown_path,
            }]])
        def execute(self, query, parameters=None):
            return None
        def fetchall(self):
            return next(self.results)

    class Context:
        def __enter__(self):
            return Cursor()
        def __exit__(self, exc_type, exc_value, traceback):
            return False

    class Connection:
        def cursor(self, row_factory=None):
            return Context()

    return Connection()


class DigitRepositoryBoundaryTests(unittest.TestCase):
    def test_stale_translation_blocker_does_not_reject_final_markdown(self) -> None:
        review = {
            "decision": "reject",
            "score": 79,
            "blocking_issues": [
                "译文“埃尼以溢价向BP出售汽油”误译了 PREM，应为优质无铅。"
            ],
        }
        markdown = "# 日报\n\n埃尼向BP出售优质无铅10ppm汽油。\n"

        normalized = validate_review_against_final_markdown(review, markdown)

        self.assertEqual(normalized["decision"], "pass")
        self.assertGreaterEqual(normalized["score"], 85)
        self.assertEqual(normalized["blocking_issues"], [])
        self.assertEqual(len(normalized["unsupported_blocking_issues"]), 1)
        self.assertTrue(review_passes(normalized))

    def test_translation_blocker_remains_when_quoted_wording_exists(self) -> None:
        review = {
            "decision": "reject",
            "score": 79,
            "blocking_issues": ["译文“埃尼以溢价向BP出售汽油”存在误译。"],
        }
        markdown = "# 日报\n\n埃尼以溢价向BP出售汽油。\n"

        normalized = validate_review_against_final_markdown(review, markdown)

        self.assertEqual(normalized["decision"], "reject")
        self.assertEqual(normalized["blocking_issues"], review["blocking_issues"])

    def test_false_missing_original_blocker_is_demoted_when_original_is_adjacent(self) -> None:
        review = {
            "decision": "reject",
            "score": 95,
            "blocking_issues": [
                "出现多余译文“普氏收盘市场评估过程中无头寸”，而无对应的英文原文。"
            ],
        }
        markdown = (
            "# 日报\n\n"
            "- **Platts US Marketscan**：“There were no positions in the "
            "Platts Market on Close assessment process.”\n"
            "  译文：普氏收盘市场评估过程中无头寸。\n"
        )

        normalized = validate_review_against_final_markdown(review, markdown)

        self.assertEqual(normalized["decision"], "pass")
        self.assertEqual(normalized["blocking_issues"], [])
        self.assertTrue(review_passes(normalized))

    def test_mixed_quotes_summary_rows_are_closed_to_platts_digits_facts(self) -> None:
        from intelligence.market_pipeline import publication_worker

        target_date = date(2026, 7, 10)
        allowed_fact_ids = {"DIGIT-FACT-1", "DIGIT-FACT-2", "DIGIT-PREV-1"}
        allowed_metric_ids = {"DIGIT-METRIC"}

        def signal_row(signal_id, market_date, supporting, counter, metrics):
            return {
                "signal_id": signal_id,
                "signal_type": "supply_tightening",
                "market_date": market_date,
                "direction": "bullish",
                "confidence": 0.9,
                "score": 90,
                "summary": signal_id,
                "supporting_fact_ids": supporting,
                "counter_fact_ids": counter,
                "metric_ids": metrics,
                "title": signal_id,
                "support_dimensions": ["flow_inventory", "disruption_policy"],
                "signal_status": "top_signal",
                "commodity": "naphtha",
                "region": "Asia",
            }

        current_signals = [
            signal_row(
                "DIGIT-SIGNAL", target_date,
                ["DIGIT-FACT-1"], ["DIGIT-FACT-2"], ["DIGIT-METRIC"],
            ),
            signal_row(
                "QUOTES-SIGNAL", target_date,
                ["QUOTES-FACT-1"], [], ["QUOTES-METRIC"],
            ),
            signal_row(
                "MIXED-SIGNAL", target_date,
                ["DIGIT-FACT-1"], ["QUOTES-FACT-1"], ["DIGIT-METRIC"],
            ),
        ]
        previous_signals = [
            signal_row(
                "DIGIT-PREV", date(2026, 7, 9),
                ["DIGIT-PREV-1"], [], [],
            ),
            signal_row(
                "QUOTES-PREV", date(2026, 7, 9),
                ["QUOTES-PREV-1"], [], [],
            ),
        ]

        def fact_row(fact_id, source_id, source_channel):
            return {
                "fact_id": fact_id,
                "fact_type": "supply",
                "direction": "up",
                "source_id": source_id,
                "report_title": source_id,
                "publisher": "Platts",
                "report_family": "market_report",
                "unresolved": False,
                "source_channel": source_channel,
            }

        facts = [
            fact_row("DIGIT-FACT-1", "DIGIT-SOURCE-1", "telegram:platts-digits"),
            fact_row("DIGIT-FACT-2", "DIGIT-SOURCE-2", "telegram:platts-digits"),
            fact_row("QUOTES-FACT-1", "QUOTES-SOURCE-1", "telegram:quotes-summary"),
        ]
        metrics = [
            {"metric_id": "DIGIT-METRIC", "source_fact_ids": ["DIGIT-FACT-1", "DIGIT-FACT-2"]},
            {"metric_id": "QUOTES-METRIC", "source_fact_ids": ["QUOTES-FACT-1"]},
        ]

        class Cursor:
            def __init__(self):
                self.rows = []
                self.calls = []

            def execute(self, query, parameters=None):
                normalized = " ".join(str(query).lower().split())
                parameters = tuple(parameters or ())
                self.calls.append((normalized, parameters))
                source_closed = (
                    "telegram:platts-digits" in parameters
                    and "allowed_facts" in normalized
                    and "jsonb_array_elements_text" in normalized
                )
                if "from market_signals" in normalized:
                    candidates = previous_signals if "market_date <" in normalized else current_signals
                    if not source_closed:
                        self.rows = candidates
                        return
                    self.rows = [
                        row for row in candidates
                        if set(row["supporting_fact_ids"] + row["counter_fact_ids"]) <= allowed_fact_ids
                        and set(row["metric_ids"]) <= allowed_metric_ids
                    ]
                    return
                if "select fact.*" in normalized and "from market_facts fact" in normalized:
                    source_filtered = (
                        "telegram:platts-digits" in parameters
                        and "telegram_message_attachments" in normalized
                        and "telegram_messages" in normalized
                        and "source_origin = 'external_web'" in normalized
                    )
                    self.rows = [
                        row for row in facts
                        if not source_filtered or row["source_channel"] == "telegram:platts-digits"
                    ]
                    return
                if "from market_metrics" in normalized:
                    self.rows = [
                        row for row in metrics
                        if not source_closed or set(row["source_fact_ids"]) <= allowed_fact_ids
                    ]

            def fetchall(self):
                return self.rows

        class Context:
            def __init__(self, value):
                self.value = value

            def __enter__(self):
                return self.value

            def __exit__(self, exc_type, exc_value, traceback):
                return False

        cursor = Cursor()

        class Connection:
            def cursor(self, row_factory=None):
                return Context(cursor)

        signals, previous, returned_facts, returned_metrics, _, _ = publication_worker._rows(
            Connection(), target_date
        )

        self.assertEqual([item.signal_id for item in signals], ["DIGIT-SIGNAL"])
        self.assertEqual([item.signal_id for item in previous], ["DIGIT-PREV"])
        self.assertEqual({item.fact_id for item in returned_facts}, {"DIGIT-FACT-1", "DIGIT-FACT-2"})
        self.assertEqual([item.metric_id for item in returned_metrics], ["DIGIT-METRIC"])
        self.assertEqual(len(cursor.calls), 4)
        for query, parameters in cursor.calls:
            self.assertIn("telegram:platts-digits", parameters)
            if "market_signals" in query or "market_metrics" in query:
                self.assertIn("allowed_facts", query)
                self.assertIn("jsonb_array_elements_text", query)


class EditorialViewTest(unittest.TestCase):
    def test_article_title_and_section_heading_levels_are_normalized(self):
        markdown="# 今日结论\n内容\n# 原文摘译\n> Evidence"
        result=normalize_article_markdown(markdown,"原油市场日报")
        self.assertTrue(result.startswith("# 原油市场日报\n\n## 市场要点"))
        self.assertIn("\n## 原文摘选\n",result)
    def test_writer_payload_keeps_counter_evidence_and_excludes_unrelated_signals(self):
        top=signal("SIGNAL-TOP",SignalStatus.TOP,SignalDirection.BEARISH,83,["FACT-1"])
        counter=signal("SIGNAL-COUNTER",SignalStatus.SECONDARY,SignalDirection.BULLISH,50,["FACT-2"])
        unrelated=signal("SIGNAL-OTHER",SignalStatus.WEAK,SignalDirection.BULLISH,30,["FACT-3"])
        view=SimpleNamespace(
            top_signal=top,secondary_signals=[counter],counter_signals=[counter],
            supporting_fact_ids=["FACT-1"],model_dump=lambda mode:{"supporting_fact_ids":["FACT-1"]},
        )
        facts=[SimpleNamespace(fact_id=f"FACT-{index}",fact_type=SimpleNamespace(value="source_commentary"),
                               confidence=.9,statement=f"Supply evidence {index}",
                               evidence_text=f"Evidence {index}",source_id="SRC-1")
               for index in (1,2,3)]
        payload=build_writer_payload(view,facts,[top,counter,unrelated],[],{"SRC-1":"Platts"})
        self.assertEqual({item["fact_id"] for item in payload["verified_facts"]},{"FACT-1","FACT-2"})
        self.assertEqual({item["source_title"] for item in payload["verified_facts"]}, {"Platts"})
        self.assertEqual({item["signal_id"] for item in payload["verified_signals"]},
                         {"SIGNAL-TOP","SIGNAL-COUNTER"})

    def test_topic_writer_payload_contains_only_topic_evidence(self):
        self.assertIn("topic", inspect.signature(build_writer_payload).parameters)
        first = signal("SIGNAL-1", SignalStatus.TOP, SignalDirection.BEARISH, 90, ["FACT-1", "FACT-2"])
        second = signal("SIGNAL-2", SignalStatus.SECONDARY, SignalDirection.BULLISH, 80, ["FACT-3", "FACT-4"])
        view = SimpleNamespace(
            top_signal=first,
            secondary_signals=[second],
            counter_signals=[second],
            supporting_fact_ids=["FACT-1", "FACT-2", "FACT-3", "FACT-4"],
            model_dump=lambda mode: {
                "main_thesis": "Global thesis for all topics",
                "supporting_fact_ids": ["FACT-1", "FACT-2", "FACT-3", "FACT-4"],
                "top_signal": {"signal_id": "SIGNAL-1"},
                "secondary_signals": [{"signal_id": "SIGNAL-2"}],
                "counter_signals": [{"signal_id": "SIGNAL-2"}],
            },
        )
        facts = [
            SimpleNamespace(
                fact_id=f"FACT-{index}", fact_type=SimpleNamespace(value="supply"),
                confidence=.9, statement=f"Evidence {index}", evidence_text=f"Evidence {index}",
                source_id=f"SRC-{index}",
            )
            for index in range(1, 5)
        ]
        metrics = [
            SimpleNamespace(metric_id="METRIC-1", source_fact_ids=["FACT-1", "FACT-2"]),
            SimpleNamespace(metric_id="METRIC-2", source_fact_ids=["FACT-3", "FACT-4"]),
        ]
        topic = ArticleTopic(
            slug="crude-supply", title_hint="Crude Supply",
            fact_ids=["FACT-1", "FACT-2"], signal_ids=["SIGNAL-1"], rationale="independent",
        )
        topic_view = SimpleNamespace(
            top_signal=first, secondary_signals=[], counter_signals=[],
            model_dump=lambda mode: {
                "main_thesis": first.summary,
                "supporting_fact_ids": ["FACT-1", "FACT-2"],
                "top_signal": {"signal_id": "SIGNAL-1", "supporting_fact_ids": ["FACT-1", "FACT-2"]},
                "secondary_signals": [], "counter_signals": [],
                "invalidation_conditions": [], "validation_metrics": [], "uncertainties": [],
            },
        )

        payload = build_writer_payload(
            view, facts, [first, second], metrics,
            {f"SRC-{index}": f"Source {index}" for index in range(1, 5)},
            topic=topic, topic_view=topic_view,
        )

        self.assertEqual({item["fact_id"] for item in payload["verified_facts"]}, {"FACT-1", "FACT-2"})
        self.assertEqual(
            {item["source_title"] for item in payload["verified_facts"]}, {"Source 1", "Source 2"},
        )
        self.assertEqual({item["signal_id"] for item in payload["verified_signals"]}, {"SIGNAL-1"})
        self.assertEqual({item["metric_id"] for item in payload["metrics"]}, {"METRIC-1"})
        self.assertEqual(set(payload["source_mapping"]), {"SRC-1", "SRC-2"})
        self.assertEqual(payload["editorial_view"]["supporting_fact_ids"], ["FACT-1", "FACT-2"])
        self.assertEqual(payload["editorial_view"]["main_thesis"], first.summary)
        self.assertEqual(payload["article_topic"]["slug"], "crude-supply")

        reader_payload = reader_safe_writer_payload(payload)
        rendered = json.dumps(reader_payload, ensure_ascii=False, default=str)
        self.assertNotIn("FACT-1", rendered)
        self.assertNotIn("SIGNAL-1", rendered)
        self.assertNotIn("METRIC-1", rendered)
        self.assertNotIn("supporting_fact_ids", rendered)
        self.assertEqual(
            {item["source_title"] for item in reader_payload["verified_facts"]},
            {"Source 1", "Source 2"},
        )

    def test_topic_scoped_view_removes_foreign_editorial_evidence(self):
        from intelligence.market_pipeline import article

        self.assertTrue(hasattr(article, "build_topic_editorial_view"))
        self.assertIn("topic_view", inspect.signature(build_writer_payload).parameters)
        top = signal(
            "SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 90,
            ["FACT-1", "FACT-2"], "Local supply tightened.",
        )
        foreign_counter = signal(
            "SIGNAL-FOREIGN", SignalStatus.SECONDARY, SignalDirection.BEARISH, 80,
            ["FACT-3", "FACT-4"], "FOREIGN FACT-3 demand weakened.",
        )
        global_view = build_editorial_view(
            date(2026, 7, 10), [top, foreign_counter], previous_signals=[],
            knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2", "FACT-3", "FACT-4"},
            unresolved_fact_ids=set(),
        )
        global_view.invalidation_conditions = ["FOREIGN FACT-3 invalidation"]
        global_view.validation_metrics = ["FOREIGN FACT-4 metric", "global metric 2", "global metric 3"]
        global_view.uncertainties = ["FOREIGN FACT-3 uncertainty"]
        facts = [
            SimpleNamespace(
                fact_id=f"FACT-{index}", fact_type=SimpleNamespace(value="supply"),
                confidence=.9, statement=f"Statement {index}", evidence_text=f"Evidence {index}",
                source_id=f"SRC-{index}", market_date=date(2026, 7, 10),
                uncertainty="Local uncertainty" if index == 1 else None,
            )
            for index in range(1, 5)
        ]
        metrics = [
            SimpleNamespace(
                metric_id="METRIC-LOCAL", metric_type="inventory", benchmark="Asia stocks",
                source_fact_ids=["FACT-1", "FACT-2"], status="computed",
            ),
            SimpleNamespace(
                metric_id="METRIC-FOREIGN", metric_type="demand", benchmark="FOREIGN demand",
                source_fact_ids=["FACT-3", "FACT-4"], status="computed",
            ),
            SimpleNamespace(
                metric_id="METRIC-MISSING", metric_type="missing", benchmark="Local",
                source_fact_ids=["FACT-1", "FACT-2"], metric_status="insufficient_data",
            ),
        ]
        topic = ArticleTopic(
            slug="local-supply", title_hint="Local Supply",
            fact_ids=["FACT-1", "FACT-2"], signal_ids=["SIGNAL-TOP"], rationale="independent",
        )

        scoped_view = article.build_topic_editorial_view(
            global_view, topic, facts, [top, foreign_counter], metrics,
        )
        payload = build_writer_payload(
            global_view, facts, [top, foreign_counter], metrics,
            {f"SRC-{index}": f"Source {index}" for index in range(1, 5)},
            topic=topic, topic_view=scoped_view,
        )
        review_payload = compact_review_evidence(payload)
        writer_encoded = json.dumps(payload, ensure_ascii=False, default=str)
        encoded = json.dumps(review_payload, ensure_ascii=False, default=str)

        self.assertEqual(scoped_view.counter_signals, [])
        self.assertEqual(scoped_view.invalidation_conditions, [])
        self.assertEqual(scoped_view.validation_metrics, ["Asia stocks inventory"])
        self.assertEqual(scoped_view.uncertainties, ["Local uncertainty", "No topic-local counter-signal is available."])
        self.assertNotIn("FACT-3", writer_encoded)
        self.assertNotIn("FOREIGN", writer_encoded)
        self.assertNotIn("FACT-3", encoded)
        self.assertNotIn("FOREIGN", encoded)

    def test_topic_without_matching_directional_signal_downgrades_to_event_brief(self):
        from intelligence.market_pipeline import article
        from intelligence.market_pipeline.contracts import ArticleMode

        top = signal(
            "SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 90,
            ["FACT-3", "FACT-4"], "Foreign supply tightened.",
        )
        global_view = build_editorial_view(
            date(2026, 7, 10), [top], previous_signals=[],
            knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2", "FACT-3", "FACT-4"},
            unresolved_fact_ids=set(),
        )
        facts = [
            SimpleNamespace(
                fact_id=f"FACT-{index}", fact_type=SimpleNamespace(value="supply"),
                confidence=.9, statement=f"Evidence {index}",
                evidence_text=f"Evidence {index}", source_id=f"SRC-{index}",
                market_date=date(2026, 7, 10), uncertainty=None,
            )
            for index in range(1, 5)
        ]
        topic = ArticleTopic(
            slug="local-event", title_hint="Local Event",
            fact_ids=["FACT-1", "FACT-2"], signal_ids=[], rationale="independent",
        )

        scoped_view = article.build_topic_editorial_view(
            global_view, topic, facts, [top], [],
        )

        self.assertEqual(scoped_view.article_mode, ArticleMode.EVENT_BRIEF)
        self.assertTrue(scoped_view.publishable)
        self.assertFalse(scoped_view.directional_signal_available)

    def test_topic_local_audit_cannot_borrow_global_counter_or_metrics(self):
        from intelligence.market_pipeline import article

        self.assertTrue(hasattr(article, "build_topic_editorial_view"))
        top = signal(
            "SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 90,
            ["FACT-1", "FACT-2"], "Local supply tightened.",
        )
        foreign_counter = signal(
            "SIGNAL-FOREIGN", SignalStatus.SECONDARY, SignalDirection.BEARISH, 80,
            ["FACT-3", "FACT-4"], "Foreign demand weakened.",
        )
        global_view = build_editorial_view(
            date(2026, 7, 10), [top, foreign_counter], previous_signals=[],
            knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2", "FACT-3", "FACT-4"}, unresolved_fact_ids=set(),
        )
        facts = [
            SimpleNamespace(
                fact_id=f"FACT-{index}", fact_type=SimpleNamespace(value="supply"),
                confidence=.9, statement=f"Evidence {index}", evidence_text=f"Evidence {index}",
                source_id=f"SRC-{index}", market_date=date(2026, 7, 10), uncertainty=None,
            )
            for index in range(1, 5)
        ]
        topic = ArticleTopic(
            slug="local-supply", title_hint="Local Supply",
            fact_ids=["FACT-1", "FACT-2"], signal_ids=["SIGNAL-TOP"], rationale="independent",
        )
        scoped_view = article.build_topic_editorial_view(
            global_view, topic, facts, [top, foreign_counter], [
                SimpleNamespace(
                    metric_id="METRIC-1", metric_type="inventory", benchmark="Asia stocks",
                    source_fact_ids=["FACT-1", "FACT-2"], status="computed",
                ),
            ],
        )
        markdown = """# Local Supply
## 今日结论
Local supply tightened.
## 原文摘译
> Evidence 1
## 市场传导
Evidence remains local.
## 反向信号与风险
No local counter evidence.
## 下一交易日验证
Observe local evidence.
## 资料
- Source 1
"""

        issues = audit_article(markdown, scoped_view, facts[:2], [
            {"source_title": "Source 1", "original_excerpt": "Evidence 1"},
        ])

        self.assertEqual(issues, [])
        warnings = article_disclosure_warnings(scoped_view, [
            {"source_title": "Source 1", "original_excerpt": "Evidence 1"},
        ])
        self.assertTrue(any("no independent topic-local counter signal" in warning for warning in warnings))
        self.assertTrue(any("no topic-local invalidation condition" in warning for warning in warnings))
        self.assertTrue(any("fewer than three topic-local validation metrics" in warning for warning in warnings))
    def test_punctuation_only_source_title_falls_back_to_publisher(self):
        self.assertEqual(
            source_display_title("* * * * *","The Wall Street Journal","market_report"),
            "The Wall Street Journal",
        )
    def test_truncated_newspaper_headline_uses_publication_title(self):
        self.assertEqual(
            source_display_title(
                "ice members killed in the Iran war",
                "The New York Times",
                "The New York Times",
            ),
            "The New York Times",
        )
    def test_review_evidence_keeps_cited_facts_and_drops_bulk_lists(self):
        payload={
            "editorial_view":{"market_date":"2026-07-10","main_thesis":"T",
                              "supporting_fact_ids":["FACT-1"]},
            "verified_facts":[{"fact_id":"FACT-1","source_id":"SRC-1",
                               "statement":"S","evidence_text":"Exact evidence",
                               "metadata":{"raw":"x"*120000}}],
            "verified_signals":[{"summary":"x"*120000}],
            "metrics":[{"value":"x"*120000}],
            "source_mapping":{"SRC-1":"Platts"},
            "source_excerpts":[{"original_excerpt":"Exact evidence"}],
        }
        compact=compact_review_evidence(payload)
        encoded=__import__('json').dumps(compact,ensure_ascii=False)
        self.assertLess(len(encoded),98000)
        self.assertEqual(compact["verified_facts"][0]["evidence_text"],"Exact evidence")
        self.assertNotIn("verified_signals",compact)
        self.assertNotIn("metrics",compact)
    def test_knowledge_card_uses_top_signal_not_discarded_signal(self):
        discarded=SimpleNamespace(status=SignalStatus.DISCARD,commodity="unknown")
        top=SimpleNamespace(status=SignalStatus.TOP,commodity="crude_oil")
        self.assertEqual(knowledge_commodity([discarded,top]),"crude_oil")
    def test_top_view_has_counter_invalidation_and_three_metrics(self) -> None:
        top = signal("SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 82, ["FACT-1"])
        counter = signal("SIGNAL-COUNTER", SignalStatus.WEAK, SignalDirection.BEARISH, 35, ["FACT-2"], "Cracker runs weakened.")
        view = build_editorial_view(
            date(2026, 7, 9), [top, counter], previous_signals=[],
            knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids=set(),
        )
        self.assertTrue(view.publishable)
        self.assertEqual(view.top_signal.signal_id, "SIGNAL-TOP")
        self.assertTrue(view.counter_signals)
        self.assertTrue(view.invalidation_conditions)
        self.assertGreaterEqual(len(view.validation_metrics), 3)
        self.assertEqual(view.audit_issues, [])

    def test_low_signal_is_archive_only(self) -> None:
        weak = signal("SIGNAL-WEAK", SignalStatus.WEAK, SignalDirection.NEUTRAL, 35, ["FACT-1"])
        low = signal("SIGNAL-LOW", SignalStatus.LOW, SignalDirection.NEUTRAL, 0, [])
        view = build_editorial_view(
            date(2026, 7, 9), [weak, low], previous_signals=[], knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1"}, unresolved_fact_ids=set(),
        )
        self.assertFalse(view.publishable)
        self.assertEqual(view.view_change_type.value, "low_signal")
        self.assertEqual(view.main_thesis,"已核验信息不足以支持单一、可发布的市场主线。")

    def test_unresolved_support_blocks_view(self) -> None:
        top = signal("SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 82, ["FACT-1"])
        counter = signal("SIGNAL-COUNTER", SignalStatus.WEAK, SignalDirection.BEARISH, 35, ["FACT-2"])
        view = build_editorial_view(
            date(2026, 7, 9), [top, counter], previous_signals=[], knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids={"FACT-1"},
        )
        self.assertFalse(view.publishable)
        self.assertTrue(any("unresolved" in issue for issue in view.audit_issues))


class ArticleAuditTest(unittest.TestCase):
    def test_rows_preserves_counter_fact_ids_for_topic_scoping(self):
        from intelligence.market_pipeline import publication_worker

        signal_row = {
            "signal_id": "SIGNAL-1", "signal_type": "supply", "direction": "bullish",
            "confidence": .9, "score": 90, "summary": "Supply tightened.",
            "supporting_fact_ids": ["FACT-1"], "counter_fact_ids": ["FACT-2"],
            "support_dimensions": ["flow"], "signal_status": "top_signal",
            "commodity": "crude", "region": "Asia",
        }

        class Cursor:
            def __init__(self):
                self.results = iter([[signal_row], [], [], []])
            def execute(self, query, parameters):
                return None
            def fetchall(self):
                return next(self.results)

        class Context:
            def __init__(self, value):
                self.value = value
            def __enter__(self):
                return self.value
            def __exit__(self, exc_type, exc_value, traceback):
                return False

        class Connection:
            def cursor(self, row_factory=None):
                return Context(Cursor())

        signals, _, _, _, _, _ = publication_worker._rows(Connection(), date(2026, 7, 10))

        self.assertEqual(signals[0].counter_fact_ids, ["FACT-2"])

    def test_daily_database_aggregate_rejects_first_failure_second_success(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "build_daily_aggregate_article"))
        entries = [
            {
                "article_slug": "01-rejected", "local_audit_status": "reject",
                "llm_review_status": "not_run", "publication_status": "review_rejected",
            },
            {
                "article_slug": "02-success", "local_audit_status": "pass",
                "llm_review_status": "pass", "publication_status": "draft_created",
                "publication_reference": "MEDIA-2",
            },
        ]

        article = publication_worker.build_daily_aggregate_article(
            date(2026, 7, 10), Path("reports/digit/2026-07-10"), entries,
            {"SRC-1": "Source 1"}, is_historical=False,
        )

        self.assertFalse(article["local_audit_passed"])
        self.assertFalse(article["llm_review_passed"])
        self.assertEqual(article["publication_status"], "review_rejected")
        self.assertEqual(article["review_json"]["aggregate"]["index_status"], "partial_success")

    def test_daily_database_aggregate_marks_any_publish_failure_as_failed(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "build_daily_aggregate_article"))
        entries = [
            {
                "article_slug": "01-draft", "local_audit_status": "pass",
                "llm_review_status": "pass", "publication_status": "draft_created",
            },
            {
                "article_slug": "02-failed", "local_audit_status": "pass",
                "llm_review_status": "pass", "publication_status": "publish_failed",
            },
        ]

        article = publication_worker.build_daily_aggregate_article(
            date(2026, 7, 10), Path("reports/digit/2026-07-10"), entries, {},
            is_historical=False,
        )

        self.assertTrue(article["local_audit_passed"])
        self.assertTrue(article["llm_review_passed"])
        self.assertEqual(article["publication_status"], "publish_failed")
        self.assertEqual(article["review_json"]["aggregate"]["index_status"], "partial_success")

    def test_daily_database_aggregate_uses_least_advanced_success_state(self):
        from intelligence.market_pipeline import publication_worker

        entries = [
            {
                "article_slug": "01-shadow", "local_audit_status": "pass",
                "llm_review_status": "pass", "publication_status": "shadow_saved",
            },
            {
                "article_slug": "02-draft", "local_audit_status": "pass",
                "llm_review_status": "pass", "publication_status": "draft_created",
            },
        ]

        article = publication_worker.build_daily_aggregate_article(
            date(2026, 7, 10), Path("reports/digit/2026-07-10"), entries, {},
            is_historical=False,
        )

        self.assertEqual(article["review_json"]["aggregate"]["index_status"], "complete")
        self.assertEqual(article["publication_status"], "shadow_saved")

    def test_daily_database_aggregate_identity_is_stable_across_reordered_reruns(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "build_daily_aggregate_article"))
        successful = {
            "article_slug": "02-success", "title": "Success", "markdown_path": "success.md",
            "local_audit_status": "pass", "llm_review_status": "pass",
            "publication_status": "shadow_saved",
        }
        failed = {
            "article_slug": "01-failed", "title": "Failed", "markdown_path": "failed.md",
            "local_audit_status": "not_run", "llm_review_status": "not_run",
            "publication_status": "generation_failed",
        }

        first = publication_worker.build_daily_aggregate_article(
            date(2026, 7, 10), Path("reports/digit/2026-07-10"), [failed, successful], {},
            is_historical=False,
        )
        rerun = publication_worker.build_daily_aggregate_article(
            date(2026, 7, 10), Path("reports/digit/2026-07-10"), [successful, failed], {},
            is_historical=False,
        )

        for field_name in ("article_id", "title", "markdown_path", "html_path"):
            self.assertEqual(first[field_name], rerun[field_name])
        self.assertEqual(first["article_id"], "ARTICLE-" + str(
            __import__("uuid").uuid5(publication_worker.ARTICLE_NAMESPACE, "2026-07-10")
        ))

    def test_daily_aggregate_writes_real_markdown_html_and_db_paths(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "write_daily_aggregate_artifacts"))
        with tempfile.TemporaryDirectory() as temporary_directory:
            date_dir = Path(temporary_directory)
            topic_markdown = date_dir / "01-crude-supply.md"
            topic_html = date_dir / "01-crude-supply_wechat.html"
            topic_markdown.write_text("# Crude Supply\n", encoding="utf-8")
            topic_html.write_text("<html>Crude Supply</html>", encoding="utf-8")
            entries = [{
                "article_slug": "01-crude-supply", "title": "Crude Supply",
                "markdown_path": str(topic_markdown), "html_path": str(topic_html),
                "local_audit_status": "pass", "llm_review_status": "pass",
                "publication_status": "draft_created",
            }]

            markdown_path, html_path = publication_worker.write_daily_aggregate_artifacts(
                date(2026, 7, 10), date_dir, entries,
            )
            article = publication_worker.build_daily_aggregate_article(
                date(2026, 7, 10), date_dir, entries, {}, is_historical=False,
            )
            markdown = markdown_path.read_text(encoding="utf-8")
            html = html_path.read_text(encoding="utf-8")

        self.assertTrue(markdown.startswith("# ETI Digit 日级索引｜2026-07-10"))
        self.assertIn("Crude Supply", markdown)
        self.assertIn("状态：draft_created", markdown)
        self.assertIn("(01-crude-supply.md)", markdown)
        self.assertFalse(markdown.lstrip().startswith("{"))
        self.assertIn("<html", html.lower())
        self.assertEqual(article["markdown_path"], str(markdown_path))
        self.assertEqual(article["html_path"], str(html_path))

    def test_obsidian_sync_reads_daily_aggregate_markdown_not_manifest(self):
        from intelligence.market_pipeline import publication_worker
        from intelligence.market_pipeline.obsidian_sync import sync_database_to_obsidian

        self.assertTrue(hasattr(publication_worker, "write_daily_aggregate_artifacts"))
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            date_dir = root / "reports" / "digit" / "2026-07-10"
            date_dir.mkdir(parents=True)
            topic_markdown = date_dir / "01-crude.md"
            topic_html = date_dir / "01-crude_wechat.html"
            topic_markdown.write_text("# Crude Theme\n", encoding="utf-8")
            topic_html.write_text("<article>Crude Theme</article>", encoding="utf-8")
            entries = [{
                "article_slug": "01-crude", "title": "Crude Theme",
                "markdown_path": str(topic_markdown), "html_path": str(topic_html),
                "local_audit_status": "pass", "llm_review_status": "pass",
                "publication_status": "shadow_saved",
            }]
            markdown_path, html_path = publication_worker.write_daily_aggregate_artifacts(
                date(2026, 7, 10), date_dir, entries,
            )
            article = publication_worker.build_daily_aggregate_article(
                date(2026, 7, 10), date_dir, entries, {}, is_historical=False,
            )
            self.assertEqual(article["markdown_path"], str(markdown_path))
            self.assertEqual(article["html_path"], str(html_path))

            class Cursor:
                def __init__(self):
                    self.results = iter([[], [], [], [], [{
                        "market_date": date(2026, 7, 10),
                        "markdown_path": article["markdown_path"],
                    }]])
                def execute(self, query, parameters=None):
                    return None
                def fetchall(self):
                    return next(self.results)

            class Context:
                def __init__(self, value):
                    self.value = value
                def __enter__(self):
                    return self.value
                def __exit__(self, exc_type, exc_value, traceback):
                    return False

            class Connection:
                def cursor(self, row_factory=None):
                    return Context(Cursor())

            vault = root / "vault"
            sync_database_to_obsidian(Connection(), vault)
            synced = (vault / "08_Published_Daily" / "2026-07-10.md").read_text(encoding="utf-8")
            synced_links = re.findall(r"\[[^\]]+\]\(([^)]+)\)", synced)
            resolved_link_status = [
                ((vault / "08_Published_Daily" / "2026-07-10.md").parent / link).resolve().is_file()
                for link in synced_links
            ]

        self.assertTrue(synced.startswith("# ETI Digit 日级索引"))
        self.assertIn("Crude Theme", synced)
        self.assertFalse(synced.lstrip().startswith("{"))
        self.assertEqual(len(synced_links), 2)
        self.assertTrue(all(resolved_link_status))

    def test_obsidian_sync_manifest_transitions_atomically(self):
        from intelligence.market_pipeline import obsidian_sync

        observed_statuses = []

        class Cursor:
            def __init__(self):
                self.results = iter([[], [], [], [], []])

            def execute(self, query, parameters=None):
                return None

            def fetchall(self):
                return next(self.results)

        class Context:
            def __init__(self, manifest_path):
                self.manifest_path = manifest_path

            def __enter__(self):
                observed_statuses.append(json.loads(
                    self.manifest_path.read_text(encoding="utf-8")
                )["status"])
                return Cursor()

            def __exit__(self, exc_type, exc_value, traceback):
                return False

        class Connection:
            def __init__(self, manifest_path):
                self.manifest_path = manifest_path

            def cursor(self, row_factory=None):
                return Context(self.manifest_path)

        with tempfile.TemporaryDirectory() as temporary_directory:
            vault = Path(temporary_directory) / "vault"
            manifest_path = vault / "09_Evaluation" / "sync_manifest.json"
            with patch.object(obsidian_sync.os, "replace", wraps=os.replace) as replace:
                obsidian_sync.sync_database_to_obsidian(Connection(manifest_path), vault)
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        self.assertEqual(observed_statuses, ["in_progress"])
        self.assertEqual(manifest["status"], "success")
        manifest_replaces = [
            call
            for call in replace.call_args_list
            if Path(call.args[1]) == manifest_path
        ]
        self.assertEqual(len(manifest_replaces), 2)
        for call in manifest_replaces:
            source, target = map(Path, call.args)
            self.assertEqual(target, manifest_path)
            self.assertEqual(source.parent, target.parent)

    def test_obsidian_sync_fails_closed_when_published_markdown_is_missing(self):
        from intelligence.market_pipeline.obsidian_sync import sync_database_to_obsidian

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            vault = root / "vault"
            baseline = root / "baseline.md"
            baseline.write_text("# Baseline\n", encoding="utf-8")
            sync_database_to_obsidian(
                published_article_connection(str(baseline), date(2026, 7, 9)), vault,
            )
            success = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )
            missing = root / "missing.md"
            with self.assertRaises(FileNotFoundError):
                sync_database_to_obsidian(published_article_connection(str(missing)), vault)

            failed = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(success["status"], "success")
            self.assertEqual(failed["status"], "failed")
            self.assertNotEqual(success["run_id"], failed["run_id"])
            self.assertEqual(failed["error_type"], "FileNotFoundError")
            self.assertFalse((vault / "08_Published_Daily" / "2026-07-10.md").exists())
            self.assertTrue((vault / "08_Published_Daily" / "2026-07-09.md").exists())

    def test_obsidian_sync_preflights_all_rows_before_writing_cards(self):
        from intelligence.market_pipeline.obsidian_sync import sync_database_to_obsidian

        class Cursor:
            def __init__(self):
                self.results = iter([[
                    {
                        "schema_version": "1.0",
                        "source_id": "SRC-PREFLIGHT",
                        "market_date": date(2026, 7, 10),
                        "publisher": "ETI",
                        "processing_status": "parsed",
                        "content_hash": "hash",
                        "report_title": "Must not be written",
                        "parse_method": "text",
                        "parse_confidence": 1.0,
                        "needs_review": False,
                        "market_date_reason": "explicit",
                    }
                ], [], [], [], [{
                    "market_date": date(2026, 7, 10),
                    "markdown_path": "missing-daily-index.md",
                }]])

            def execute(self, query, parameters=None):
                return None

            def fetchall(self):
                return next(self.results)

        class Context:
            def __enter__(self):
                return Cursor()

            def __exit__(self, exc_type, exc_value, traceback):
                return False

        class Connection:
            def cursor(self, row_factory=None):
                return Context()

        with tempfile.TemporaryDirectory() as temporary_directory:
            vault = Path(temporary_directory) / "vault"

            with self.assertRaises(FileNotFoundError):
                sync_database_to_obsidian(Connection(), vault)

            manifest = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["status"], "failed")
            self.assertFalse((vault / "02_Source_Documents" / "SRC-PREFLIGHT.md").exists())

    def test_obsidian_sync_does_not_count_partial_publish_as_success(self):
        from intelligence.market_pipeline import obsidian_sync

        documents = []
        for source_id in ("SRC-FIRST", "SRC-SECOND"):
            documents.append({
                "schema_version": "1.0",
                "source_id": source_id,
                "market_date": date(2026, 7, 10),
                "publisher": "ETI",
                "processing_status": "parsed",
                "content_hash": source_id,
                "report_title": source_id,
                "parse_method": "text",
                "parse_confidence": 1.0,
                "needs_review": False,
                "market_date_reason": "explicit",
            })

        class Cursor:
            def __init__(self):
                self.results = iter([documents, [], [], [], []])

            def execute(self, query, parameters=None):
                return None

            def fetchall(self):
                return next(self.results)

        class Context:
            def __enter__(self):
                return Cursor()

            def __exit__(self, exc_type, exc_value, traceback):
                return False

        class Connection:
            def cursor(self, row_factory=None):
                return Context()

        original_copy = obsidian_sync._atomic_copy_file
        copy_count = 0

        def fail_second_copy(source, target):
            nonlocal copy_count
            copy_count += 1
            if copy_count == 2:
                raise OSError("simulated publish failure")
            original_copy(source, target)

        with tempfile.TemporaryDirectory() as temporary_directory:
            vault = Path(temporary_directory) / "vault"
            with patch.object(obsidian_sync, "_atomic_copy_file", side_effect=fail_second_copy):
                with self.assertRaisesRegex(OSError, "simulated publish failure"):
                    obsidian_sync.sync_database_to_obsidian(Connection(), vault)
            manifest = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )
            written_cards = list((vault / "02_Source_Documents").glob("*.md"))

        self.assertEqual(len(written_cards), 0)
        self.assertEqual(manifest["status"], "failed")
        self.assertEqual(manifest["counts"], {
            "documents": 0, "facts": 0, "signals": 0, "views": 0, "articles": 0,
        })

    def test_obsidian_sync_fails_closed_when_published_markdown_is_directory(self):
        from intelligence.market_pipeline.obsidian_sync import sync_database_to_obsidian

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            vault = root / "vault"
            baseline = root / "baseline.md"
            baseline.write_text("# Baseline\n", encoding="utf-8")
            sync_database_to_obsidian(
                published_article_connection(str(baseline), date(2026, 7, 9)), vault,
            )
            success = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )
            source_directory = root / "daily-index.md"
            source_directory.mkdir()
            with self.assertRaises(FileNotFoundError):
                sync_database_to_obsidian(
                    published_article_connection(str(source_directory)), vault,
                )

            failed = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(success["status"], "success")
            self.assertEqual(failed["status"], "failed")
            self.assertNotEqual(success["run_id"], failed["run_id"])
            self.assertEqual(failed["error_type"], "FileNotFoundError")
            self.assertFalse((vault / "08_Published_Daily" / "2026-07-10.md").exists())
            self.assertTrue((vault / "08_Published_Daily" / "2026-07-09.md").exists())

    def test_obsidian_sync_fails_closed_without_overwriting_existing_target(self):
        from intelligence.market_pipeline.obsidian_sync import sync_database_to_obsidian

        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            source = root / "daily-index.md"
            source.write_text("# Current aggregate\n", encoding="utf-8")
            vault = root / "vault"
            baseline = root / "baseline.md"
            baseline.write_text("# Baseline\n", encoding="utf-8")
            sync_database_to_obsidian(
                published_article_connection(str(baseline), date(2026, 7, 9)), vault,
            )
            success = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )
            target = vault / "08_Published_Daily" / "2026-07-10.md"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text("# Stale aggregate\n", encoding="utf-8")

            with self.assertRaises(FileExistsError):
                sync_database_to_obsidian(published_article_connection(str(source)), vault)

            self.assertEqual(target.read_text(encoding="utf-8"), "# Stale aggregate\n")
            failed = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(success["status"], "success")
            self.assertEqual(failed["status"], "failed")
            self.assertNotEqual(success["run_id"], failed["run_id"])
            self.assertEqual(failed["error_type"], "FileExistsError")
            self.assertTrue((vault / "08_Published_Daily" / "2026-07-09.md").exists())

    def test_daily_aggregate_artifacts_survive_db_failure_and_rerun_converges(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "write_daily_aggregate_artifacts"))
        entries = [{
            "article_slug": "01-crude", "title": "Crude Theme",
            "local_audit_status": "pass", "llm_review_status": "pass",
            "publication_status": "shadow_saved",
        }]

        def fail_persist(connection, view_id, article):
            raise RuntimeError("database unavailable")

        persisted = []
        with tempfile.TemporaryDirectory() as temporary_directory:
            date_dir = Path(temporary_directory)
            with self.assertRaisesRegex(RuntimeError, "database unavailable"):
                publication_worker.finalize_daily_aggregate(
                    "connection", "view-id", date(2026, 7, 10), date_dir, entries, {},
                    is_historical=False, persister=fail_persist,
                )
            first_markdown = (date_dir / "daily-index.md").read_text(encoding="utf-8")
            first_html = (date_dir / "daily-index_wechat.html").read_text(encoding="utf-8")
            first_manifest = (date_dir / "index.json").read_text(encoding="utf-8")

            article = publication_worker.finalize_daily_aggregate(
                "connection", "view-id", date(2026, 7, 10), date_dir, entries, {},
                is_historical=False, persister=lambda connection, view_id, value: persisted.append(value),
            )

            self.assertEqual((date_dir / "daily-index.md").read_text(encoding="utf-8"), first_markdown)
            self.assertEqual((date_dir / "daily-index_wechat.html").read_text(encoding="utf-8"), first_html)
            self.assertEqual((date_dir / "index.json").read_text(encoding="utf-8"), first_manifest)

        self.assertEqual(article["markdown_path"], persisted[0]["markdown_path"])
        self.assertEqual(article["html_path"], persisted[0]["html_path"])

    def test_daily_aggregate_artifacts_use_unique_same_directory_temp_files(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "write_daily_aggregate_artifacts"))
        with tempfile.TemporaryDirectory() as temporary_directory:
            date_dir = Path(temporary_directory)
            with patch.object(publication_worker.os, "replace", wraps=os.replace) as replace:
                publication_worker.write_daily_aggregate_artifacts(
                    date(2026, 7, 10), date_dir, [],
                )

        sources = [Path(call.args[0]) for call in replace.call_args_list]
        destinations = [Path(call.args[1]) for call in replace.call_args_list]
        self.assertEqual(len(sources), 2)
        self.assertEqual(len(set(sources)), 2)
        self.assertTrue(all(source.parent == destination.parent for source, destination in zip(sources, destinations)))

    def test_finalize_daily_aggregate_persists_the_same_status_as_index(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "finalize_daily_aggregate"))
        entries = [
            {
                "article_slug": "01-pass", "local_audit_status": "pass",
                "llm_review_status": "pass", "publication_status": "draft_created",
            },
            {
                "article_slug": "02-fail", "local_audit_status": "reject",
                "llm_review_status": "not_run", "publication_status": "review_rejected",
            },
        ]
        persisted = []

        def persister(connection, view_id, article):
            persisted.append((connection, view_id, article))

        with tempfile.TemporaryDirectory() as temporary_directory:
            date_dir = Path(temporary_directory)
            article = publication_worker.finalize_daily_aggregate(
                "connection", "view-id", date(2026, 7, 10), date_dir, entries, {},
                is_historical=False, persister=persister,
            )
            index = json.loads((date_dir / "index.json").read_text(encoding="utf-8"))

        self.assertEqual(index["status"], "partial_success")
        self.assertEqual(article["review_json"]["aggregate"]["index_status"], index["status"])
        self.assertEqual(article["publication_status"], "review_rejected")
        self.assertIs(persisted[0][2], article)

    def test_persist_article_upgrades_existing_row_to_stable_daily_identity(self):
        from intelligence.market_pipeline import publication_worker

        executed = []

        class Context:
            def __init__(self, value=None):
                self.value = value
            def __enter__(self):
                return self.value
            def __exit__(self, exc_type, exc_value, traceback):
                return False

        class Cursor:
            def execute(self, query, parameters):
                executed.append((query, parameters))

        class Connection:
            def transaction(self):
                return Context()
            def cursor(self):
                return Context(Cursor())

        article = publication_worker.build_daily_aggregate_article(
            date(2026, 7, 10), Path("reports/digit/2026-07-10"), [], {},
            is_historical=False,
        )

        publication_worker._persist_article(Connection(), "view-id", article)

        self.assertIn("article_id=EXCLUDED.article_id", executed[0][0])
        self.assertEqual(executed[0][1][0], article["article_id"])

    def test_topic_article_function_shares_one_scoped_view_across_all_reviews(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "build_topic_article"))
        top = signal(
            "SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 90,
            ["FACT-1"], "Local supply tightened.",
        )
        counter = signal(
            "SIGNAL-COUNTER", SignalStatus.SECONDARY, SignalDirection.BEARISH, 75,
            ["FACT-2"], "Local demand weakened.",
        )
        global_view = build_editorial_view(
            date(2026, 7, 10), [top, counter], previous_signals=[],
            knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids=set(),
        )
        facts = [
            SimpleNamespace(
                fact_id=f"FACT-{index}", fact_type=SimpleNamespace(value="supply"),
                confidence=.9, statement=f"Evidence {index}", evidence_text=f"Evidence {index}",
                source_id=f"SRC-{index}", market_date=date(2026, 7, 10), uncertainty=None,
            )
            for index in (1, 2)
        ]
        metrics = [
            SimpleNamespace(
                metric_id=f"METRIC-{index}", metric_type=f"metric-{index}", benchmark="Local",
                source_fact_ids=["FACT-1", "FACT-2"], status="computed",
            )
            for index in (1, 2, 3)
        ]
        topic = ArticleTopic(
            slug="local-theme", title_hint="Local Theme",
            fact_ids=["FACT-1", "FACT-2"],
            signal_ids=["SIGNAL-TOP", "SIGNAL-COUNTER"], rationale="independent",
        )
        observed = {
            "writer": [], "audit": [], "review": [],
            "audit_markdown": [], "review_markdown": [], "review_modes": [],
        }
        article_body = "Evidence remains local. " * 30

        def report_markdown(title):
            return f"""# {title}
## 今日结论
Local supply tightened. This unsupported causal conclusion is not in evidence.
## 原文摘译
> Evidence 1
## 市场传导
{article_body}
## 反向信号与风险
Local demand weakened.
## 下一交易日验证
Observe local metrics.
## 资料
- Source 1
"""

        def writer(base_url, api_key, market_date, payload):
            observed["writer"].append(payload["editorial_view"])
            return {
                "title": "Local Theme",
                "summary": "Local supply tightened.",
                "report_markdown": report_markdown("Local Theme"),
            }

        def auditor(markdown, scoped_view, allowed_facts, excerpts):
            observed["audit"].append(scoped_view.model_dump(mode="json"))
            observed["audit_markdown"].append(markdown)
            return ["fixture revision required"] if len(observed["audit_markdown"]) == 1 else []

        def reviewer(base_url, api_key, **kwargs):
            observed["review"].append(kwargs["evidence_payload"]["editorial_view"])
            observed["review_markdown"].append(kwargs["markdown"])
            observed["review_modes"].append(kwargs["mode"] )
            if kwargs["mode"] == "revise":
                return {"revised_markdown": report_markdown("Revised Theme")}
            review_count = observed["review_modes"].count("review")
            if review_count == 1:
                return {
                    "decision": "reject", "score": 80,
                    "blocking_issues": [{
                        "type": "unsupported_conclusion",
                        "detail": "Delete “This unsupported causal conclusion is not in evidence.”",
                    }],
                }
            return {"decision": "pass", "score": 95, "blocking_issues": []}

        with tempfile.TemporaryDirectory() as temporary_directory:
            entry = publication_worker.build_topic_article(
                topic, 1, target_date=date(2026, 7, 10), view=global_view,
                facts=facts, signals=[top, counter], metrics=metrics,
                mapping={"SRC-1": "Source 1", "SRC-2": "Source 2"},
                reports_root=Path(temporary_directory), dify_base_url="http://dify",
                writer_key="writer", review_key="review", writer=writer,
                reviewer=reviewer, auditor=auditor,
            )
            final_review = json.loads(Path(entry["llm_review_path"]).read_text(encoding="utf-8"))
            final_markdown = Path(entry["markdown_path"]).read_text(encoding="utf-8")

            from intelligence import wechat_publish

            with ExitStack() as stack:
                stack.enter_context(patch.object(sys, "argv", [
                    "wechat_publish.py", "--date", "2026-07-10", "--stream", "digit",
                    "--article-slug", "01-local-theme", "--action", "draft",
                    "--dry-run", "--preflight",
                ]))
                stack.enter_context(patch.object(wechat_publish, "REPORTS_DIR", Path(temporary_directory)))
                stack.enter_context(patch.object(wechat_publish, "read_publish_config", return_value={
                    "appid": "fixture-app", "appsecret": "fixture-secret",
                    "default_thumb_media_id": "fixture-thumb",
                }))
                stack.enter_context(patch.object(wechat_publish, "prepare_thumb_image"))
                create_draft = stack.enter_context(patch.object(
                    wechat_publish, "create_draft", side_effect=AssertionError("dry-run called API"),
                ))
                printed = stack.enter_context(patch("builtins.print"))
                wechat_publish.main()
            preflight = json.loads(printed.call_args.args[0])

        self.assertEqual(entry["local_audit_status"], "pass")
        self.assertEqual(entry["llm_review_status"], "pass")
        self.assertEqual(observed["review_modes"], ["revise", "review", "review"])
        self.assertNotIn("unsupported causal conclusion", final_markdown)
        self.assertEqual(final_review["status"], "pass")
        self.assertTrue(all(item == observed["writer"][0] for item in observed["audit"]))
        self.assertTrue(all(item == observed["writer"][0] for item in observed["review"]))
        self.assertTrue(observed["audit_markdown"][0].startswith("# Local Theme｜2026-07-10\n"))
        self.assertTrue(observed["audit_markdown"][1].startswith("# Revised Theme｜2026-07-10\n"))
        self.assertTrue(all("｜2026-07-10" in markdown.splitlines()[0] for markdown in observed["review_markdown"]))
        self.assertTrue(final_markdown.startswith("# Revised Theme｜2026-07-10\n"))
        self.assertEqual(entry["title"], "Revised Theme｜2026-07-10")
        self.assertTrue(preflight["ready"], preflight["issues"])
        self.assertEqual(preflight["issues"], [])
        create_draft.assert_not_called()

    def test_topic_article_normalizes_dify_revision_before_local_audit_and_rereview(self):
        from intelligence.market_pipeline import publication_worker

        target_date = date(2026, 7, 10)
        topic = ArticleTopic(
            slug="review-theme", title_hint="Review Theme",
            fact_ids=["FACT-1"], signal_ids=["SIGNAL-1"], rationale="fixture",
        )
        scoped_view = SimpleNamespace(
            publishable=True,
            model_dump=lambda mode=None: {"market_date": target_date.isoformat()},
        )
        payload = {
            "verified_facts": [{"fact_id": "FACT-1"}],
            "source_excerpts": [],
        }
        fact = SimpleNamespace(fact_id="FACT-1")
        audit_markdown = []
        review_calls = []

        def article_markdown(title):
            return f"""# {title}
## 今日结论
Evidence remains assigned to this topic.
## 原文摘译
Evidence remains assigned to this topic.
## 市场传导
Evidence remains assigned to this topic.
## 反向信号与风险
Evidence remains assigned to this topic.
## 下一交易日验证
Evidence remains assigned to this topic.
## 资料
- Source 1
"""

        def writer(*_args):
            return {
                "title": "Review Theme",
                "report_markdown": article_markdown("Review Theme｜2026-07-09"),
            }

        def auditor(markdown, *_args):
            audit_markdown.append(markdown)
            return []

        def reviewer(_base_url, _api_key, **kwargs):
            review_calls.append((kwargs["mode"], kwargs["markdown"]))
            if kwargs["mode"] == "revise":
                return {
                    "revised_markdown": article_markdown("Revised Review Theme｜2026-07-09"),
                }
            review_count = sum(mode == "review" for mode, _ in review_calls)
            if review_count == 1:
                return {
                    "decision": "reject", "score": 60,
                    "blocking_issues": ["fixture revision required"],
                }
            return {"decision": "pass", "score": 95, "blocking_issues": []}

        with tempfile.TemporaryDirectory() as temporary_directory, ExitStack() as stack:
            stack.enter_context(patch.object(
                publication_worker, "build_topic_editorial_view", return_value=scoped_view,
            ))
            stack.enter_context(patch.object(
                publication_worker, "build_writer_payload", return_value=payload,
            ))
            entry = publication_worker.build_topic_article(
                topic, 1, target_date=target_date, view=SimpleNamespace(),
                facts=[fact], signals=[], metrics=[], mapping={},
                reports_root=Path(temporary_directory), dify_base_url="http://dify",
                writer_key="writer", review_key="review", writer=writer,
                reviewer=reviewer, auditor=auditor,
            )
            final_markdown = Path(entry["markdown_path"]).read_text(encoding="utf-8")

        self.assertEqual([mode for mode, _ in review_calls], ["review", "revise", "review"])
        self.assertTrue(audit_markdown[0].startswith("# Review Theme｜2026-07-10\n"))
        self.assertTrue(audit_markdown[1].startswith("# Revised Review Theme｜2026-07-10\n"))
        self.assertTrue(review_calls[0][1].startswith("# Review Theme｜2026-07-10\n"))
        self.assertTrue(review_calls[1][1].startswith("# Review Theme｜2026-07-10\n"))
        self.assertTrue(review_calls[2][1].startswith("# Revised Review Theme｜2026-07-10\n"))
        self.assertEqual(
            re.findall(r"(?m)^#(?!#)\s+.+$", final_markdown),
            ["# Revised Review Theme｜2026-07-10"],
        )
        self.assertEqual(entry["llm_review_status"], "pass")

    def test_empty_reference_section_is_filled_from_source_mapping(self):
        from intelligence.market_pipeline.publication_worker import ensure_reference_section

        markdown = "# Title\n\n## 参考资料\n"
        result = ensure_reference_section(markdown, [{"source_title": "The New York Times"}])

        self.assertIn("## 参考资料\n- The New York Times", result)

    def test_topic_article_summary_ignores_writer_fabrication_and_hashes_final_markdown_digest(self):
        from intelligence.market_pipeline import publication_worker

        top = signal(
            "SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 90,
            ["FACT-1"], "Local supply tightened.",
        )
        counter = signal(
            "SIGNAL-COUNTER", SignalStatus.SECONDARY, SignalDirection.BEARISH, 75,
            ["FACT-2"], "Local demand weakened.",
        )
        global_view = build_editorial_view(
            date(2026, 7, 10), [top, counter], previous_signals=[],
            knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids=set(),
        )
        facts = [
            SimpleNamespace(
                fact_id=f"FACT-{index}", fact_type=SimpleNamespace(value="supply"),
                confidence=.9, statement=f"Evidence {index}", evidence_text=f"Evidence {index}",
                source_id=f"SRC-{index}", market_date=date(2026, 7, 10), uncertainty=None,
            )
            for index in (1, 2)
        ]
        metrics = [
            SimpleNamespace(
                metric_id=f"METRIC-{index}", metric_type=f"metric-{index}", benchmark="Local",
                source_fact_ids=["FACT-1", "FACT-2"], status="computed",
            )
            for index in (1, 2, 3)
        ]
        topic = ArticleTopic(
            slug="local-theme", title_hint="Local Theme",
            fact_ids=["FACT-1", "FACT-2"],
            signal_ids=["SIGNAL-TOP", "SIGNAL-COUNTER"], rationale="independent",
        )

        def writer(base_url, api_key, market_date, payload):
            return {
                "title": "Local Theme",
                "summary": "European jet demand collapsed by 999%, outside this topic.",
                "report_markdown": """# Local Theme
## 今日结论
Local supply tightened while local demand remains uncertain.
## 原文摘译
> Evidence 1
## 市场传导
Evidence remains local.
## 反向信号与风险
Local demand weakened.
## 下一交易日验证
Observe local metrics.
## 资料
- Source 1
""",
            }

        def reviewer(base_url, api_key, **kwargs):
            return {"decision": "pass", "score": 95, "blocking_issues": []}

        with tempfile.TemporaryDirectory() as temporary_directory:
            entry = publication_worker.build_topic_article(
                topic, 1, target_date=date(2026, 7, 10), view=global_view,
                facts=facts, signals=[top, counter], metrics=metrics,
                mapping={"SRC-1": "Source 1", "SRC-2": "Source 2"},
                reports_root=Path(temporary_directory), dify_base_url="http://dify",
                writer_key="writer", review_key="review", writer=writer,
                reviewer=reviewer, auditor=lambda *args: [],
            )
            summary_path = (
                Path(temporary_directory) / "digit" / "2026-07-10"
                / "01-local-theme_summary.txt"
            )
            summary_text = summary_path.read_text(encoding="utf-8")
            html_text = Path(entry["html_path"]).read_text(encoding="utf-8")
            quality = json.loads(Path(entry["quality_audit_path"]).read_text(encoding="utf-8"))

        expected_summary = "Local supply tightened while local demand remains uncertain."
        self.assertEqual(entry["summary"], expected_summary)
        self.assertEqual(summary_text, expected_summary + "\n")
        self.assertNotIn("999", summary_text)
        self.assertNotIn("European jet", summary_text)
        self.assertNotIn("999", html_text)
        self.assertEqual(
            quality["artifact_sha256"]["summary"],
            hashlib.sha256(summary_text.encode("utf-8")).hexdigest(),
        )

    def test_topic_runner_records_failure_without_dropping_passed_topics(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "run_topics_independently"))
        topics = [
            ArticleTopic(
                slug=slug, title_hint=slug, fact_ids=[f"FACT-{index}-1", f"FACT-{index}-2"],
                signal_ids=[f"SIGNAL-{index}"], rationale="independent",
            )
            for index, slug in enumerate(("first", "broken", "third"), start=1)
        ]

        def processor(topic, ordinal):
            if topic.slug == "broken":
                raise RuntimeError("writer unavailable")
            return {
                "article_slug": f"{ordinal:02d}-{topic.slug}",
                "local_audit_status": "pass",
                "llm_review_status": "pass",
                "publication_status": "shadow_saved",
            }

        entries = publication_worker.run_topics_independently(topics, processor)

        self.assertEqual([entry["publication_status"] for entry in entries], [
            "shadow_saved", "generation_failed", "shadow_saved",
        ])
        self.assertIn("writer unavailable", entries[1]["error"])
        self.assertEqual(entries[2]["article_slug"], "03-third")

    def test_publication_index_records_all_topics_and_partial_failure(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "write_publication_index"))
        entries = [
            {"article_slug": "01-first", "publication_status": "shadow_saved"},
            {"article_slug": "02-broken", "publication_status": "generation_failed"},
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            index_path = publication_worker.write_publication_index(
                Path(temporary_directory), date(2026, 7, 10), entries,
            )
            payload = json.loads(index_path.read_text(encoding="utf-8"))

        self.assertEqual(payload["status"], "partial_success")
        self.assertEqual(payload["articles"], entries)

    def test_publication_index_uses_unique_same_directory_temp_files(self):
        from intelligence.market_pipeline import publication_worker

        with tempfile.TemporaryDirectory() as temporary_directory:
            date_dir = Path(temporary_directory)
            with patch.object(publication_worker.os, "replace", wraps=os.replace) as replace:
                publication_worker.write_publication_index(date_dir, date(2026, 7, 10), [])
                publication_worker.write_publication_index(date_dir, date(2026, 7, 10), [])

        sources = [Path(call.args[0]) for call in replace.call_args_list]
        destinations = [Path(call.args[1]) for call in replace.call_args_list]
        self.assertEqual(len(sources), 2)
        self.assertNotEqual(sources[0], sources[1])
        self.assertTrue(all(source.parent == destination.parent for source, destination in zip(sources, destinations)))

    def test_no_topics_writes_index_and_observation_without_wechat_artifact(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "write_no_topic_archive"))
        with tempfile.TemporaryDirectory() as temporary_directory:
            date_dir = publication_worker.write_no_topic_archive(
                Path(temporary_directory), date(2026, 7, 10), "No publishable theme.",
            )
            index = json.loads((date_dir / "index.json").read_text(encoding="utf-8"))
            observation = (date_dir / "observation.md").read_text(encoding="utf-8")
            wechat_artifacts = list(date_dir.glob("*_wechat.html"))

        self.assertEqual(index["status"], "archive_only")
        self.assertEqual(index["articles"], [])
        self.assertIn("No publishable theme.", observation)
        self.assertEqual(wechat_artifacts, [])

    def test_topic_locator_uses_numbered_digit_slug(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "topic_article_locator"))
        topic = ArticleTopic(
            slug="crude-supply", title_hint="Crude Supply",
            fact_ids=["FACT-1", "FACT-2"], signal_ids=["SIGNAL-1"], rationale="independent",
        )

        locator = publication_worker.topic_article_locator(date(2026, 7, 10), topic, 1)

        self.assertEqual(locator.stream, "digit")
        self.assertEqual(locator.article_slug, "01-crude-supply")

    def test_topic_publish_command_uses_package_module_entrypoint(self):
        from intelligence.market_pipeline import publication_worker

        command = publication_worker._topic_publish_command(
            date(2026, 7, 10),
            "01-crude-supply",
            action="auto",
            historical=False,
            defer_rollout=True,
        )

        self.assertEqual(command[:3], [
            publication_worker.sys.executable,
            "-m",
            "intelligence.wechat_publish",
        ])
        self.assertEqual(command[command.index("--stream") + 1], "digit")
        self.assertEqual(command[command.index("--article-slug") + 1], "01-crude-supply")
        self.assertIn("--defer-rollout", command)
        dry_run_command = publication_worker._topic_publish_command(
            date(2026, 7, 10), "01-crude-supply", action="shadow",
            historical=False, dry_run=True,
        )
        self.assertIn("--dry-run", dry_run_command)
        self.assertIn("--preflight", dry_run_command)

    def test_publish_failure_does_not_block_other_reviewed_topics(self):
        from intelligence.market_pipeline import publication_worker

        self.assertTrue(hasattr(publication_worker, "publish_topics_independently"))
        entries = [
            {
                "article_slug": "01-first", "local_audit_status": "pass",
                "llm_review_status": "pass", "publication_status": "shadow_saved",
            },
            {
                "article_slug": "02-second", "local_audit_status": "pass",
                "llm_review_status": "pass", "publication_status": "shadow_saved",
            },
            {
                "article_slug": "03-rejected", "local_audit_status": "reject",
                "llm_review_status": "not_run", "publication_status": "review_rejected",
            },
        ]
        commands = []

        def runner(command, **kwargs):
            commands.append(command)
            if "01-first" in command:
                raise RuntimeError("WeChat unavailable")
            return SimpleNamespace(stdout=json.dumps({"action": "draft", "media_id": "MEDIA-2"}))

        results = publication_worker.publish_topics_independently(
            entries, date(2026, 7, 10), action="draft", historical=False, runner=runner,
        )

        self.assertEqual([entry["publication_status"] for entry in results], [
            "publish_failed", "draft_created", "review_rejected",
        ])
        self.assertEqual(len(commands), 2)
        self.assertIn("--stream", commands[1])
        self.assertEqual(commands[1][commands[1].index("--stream") + 1], "digit")
        self.assertEqual(commands[1][commands[1].index("--article-slug") + 1], "02-second")

    def test_digit_rollout_counts_date_once_after_all_topics_finish(self):
        from intelligence.market_pipeline import publication_worker

        entries = [
            {
                "article_slug": "01-first", "local_audit_status": "pass",
                "llm_review_status": "pass", "publication_status": "shadow_saved",
            },
            {
                "article_slug": "02-second", "local_audit_status": "pass",
                "llm_review_status": "pass", "publication_status": "shadow_saved",
            },
        ]
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_root = Path(temporary_directory) / "reports"
            state_path = reports_root / "wechat_publish" / "digit" / "rollout_state.json"
            commands: list[list[str]] = []

            def runner(command, **_kwargs):
                commands.append(command)
                self.assertFalse(state_path.exists())
                slug = command[command.index("--article-slug") + 1]
                return SimpleNamespace(stdout=json.dumps({
                    "action": "draft", "media_id": f"MEDIA-{slug}",
                }))

            publication_worker.publish_topics_independently(
                entries, date(2026, 7, 10), action="auto", historical=False,
                reports_root=reports_root, rollout_threshold=3, runner=runner,
            )
            state = json.loads(state_path.read_text(encoding="utf-8"))
            publication_worker.finalize_digit_rollout(
                [
                    {**entry, "publication_status": "draft_created", "publication_action": "draft"}
                    for entry in entries
                ],
                date(2026, 7, 10), action="auto", historical=False,
                reports_root=reports_root, rollout_threshold=3,
            )
            rerun_state = json.loads(state_path.read_text(encoding="utf-8"))

        self.assertTrue(all("--defer-rollout" in command for command in commands))
        self.assertEqual(state["consecutive_passes"], 1)
        self.assertEqual(state["counted_dates"], ["2026-07-10"])
        self.assertEqual(rerun_state["consecutive_passes"], 1)

    def test_digit_failure_resets_only_digit_rollout(self):
        from intelligence import wechat_publish
        from intelligence.market_pipeline import publication_worker

        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_root = Path(temporary_directory) / "reports"
            for stream in ("summary", "digit"):
                state = wechat_publish.load_rollout_state(stream, reports_dir=reports_root)
                wechat_publish.record_auto_success(
                    "2026-07-09", "draft", state, 3, stream=stream, reports_dir=reports_root,
                )
            publication_worker.finalize_digit_rollout(
                [
                    {
                        "article_slug": "01-pass", "local_audit_status": "pass",
                        "llm_review_status": "pass", "publication_status": "draft_created",
                        "publication_action": "draft",
                    },
                    {
                        "article_slug": "02-rejected", "local_audit_status": "reject",
                        "llm_review_status": "not_run", "publication_status": "review_rejected",
                    },
                ],
                date(2026, 7, 10), action="auto", historical=False,
                reports_root=reports_root, rollout_threshold=3,
            )
            summary = wechat_publish.load_rollout_state("summary", reports_dir=reports_root)
            digit = wechat_publish.load_rollout_state("digit", reports_dir=reports_root)

        self.assertEqual(summary["consecutive_passes"], 1)
        self.assertEqual(digit["consecutive_passes"], 0)

    def test_historical_digit_rollout_is_not_counted(self):
        from intelligence import wechat_publish
        from intelligence.market_pipeline import publication_worker

        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_root = Path(temporary_directory) / "reports"
            publication_worker.finalize_digit_rollout(
                [{
                    "article_slug": "01-pass", "local_audit_status": "pass",
                    "llm_review_status": "pass", "publication_status": "draft_created",
                    "publication_action": "draft",
                }],
                date(2026, 7, 10), action="auto", historical=True,
                reports_root=reports_root, rollout_threshold=3,
            )
            state = wechat_publish.load_rollout_state("digit", reports_dir=reports_root)

        self.assertEqual(state["consecutive_passes"], 0)
        self.assertEqual(state["counted_dates"], [])

    def test_rollout_counts_only_double_reviewed_articles(self):
        import inspect
        source=inspect.getsource(evaluate_rollout)
        self.assertIn("article.local_audit_passed=true",source)
        self.assertIn("article.llm_review_passed=true",source)
        self.assertIn("article.is_historical=false",source)

    def test_wechat_result_maps_to_persistent_release_status(self):
        self.assertEqual(publication_result_status({"action":"draft","media_id":"MEDIA"}), ("draft_created","MEDIA"))
        self.assertEqual(publication_result_status({"action":"publish","publish_id":"PUB"}), ("published","PUB"))
        with self.assertRaises(ValueError):
            publication_result_status({"action":"draft","media_id":""})

    def test_writer_contract_forbids_numeric_rescaling(self):
        self.assertIn("never convert, round or calculate",WRITER_TASK)
        self.assertIn("原文摘选", WRITER_TASK)
        self.assertLess(len(WRITER_TASK),1024)

    def test_publication_requires_dedicated_writer_key(self):
        import inspect
        from intelligence.market_pipeline import publication_worker
        source=inspect.getsource(publication_worker.main)
        self.assertIn('os.environ["DIFY_WORKFLOW_API_KEY_WRITER"]',source)
        self.assertNotIn('or os.environ["DIFY_WORKFLOW_API_KEY_EXTRACT"]',source)

    def test_source_excerpt_selection_prioritizes_market_events(self):
        facts = [
            SimpleNamespace(fact_type=SimpleNamespace(value="price"),confidence=0.99,evidence_text="Price was 70 USD/bbl.",source_id="SRC-1"),
            SimpleNamespace(fact_type=SimpleNamespace(value="refinery_outage"),confidence=0.9,evidence_text="The refinery shut one crude unit.",source_id="SRC-2"),
        ]
        excerpts = select_source_excerpts(facts,{"SRC-1":"Prices","SRC-2":"Market Report"})
        self.assertEqual(excerpts[0]["source_title"],"Market Report")
        self.assertEqual(excerpts[0]["original_excerpt"],"The refinery shut one crude unit.")
    def test_generic_issue_title_falls_back_to_publication(self):
        self.assertEqual(source_display_title("Volume 104 / Issue 126 / July 6, 2026","S&P Global Energy","Platts Oilgram News"),"Platts Oilgram News")
    def test_rejects_invented_number_and_filename(self) -> None:
        top = signal("SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 82, ["FACT-1"])
        counter = signal("SIGNAL-COUNTER", SignalStatus.WEAK, SignalDirection.BEARISH, 35, ["FACT-2"])
        view = build_editorial_view(
            date(2026, 7, 9), [top, counter], previous_signals=[], knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids=set(),
        )
        fact = SimpleNamespace(
            statement="Premium rose 14 cents/gal.", evidence_text="Premium rose 14 cents/gal.",
            market_date=date(2026, 7, 9),
        )
        markdown = """# 日报
## 今日结论
Premium rose 99 cents/gal [SRC-abc-123].
## 反向信号与风险
Risk remains.
## 下一交易日验证
- A
- B
- C
## 来源说明
secret.pdf
"""
        issues = audit_article(markdown, view, [fact])
        self.assertTrue(any("unsupported numbers" in issue for issue in issues))
        self.assertIn("article leaks attachment filenames", issues)
        self.assertIn("article leaks internal trace IDs", issues)

    def test_article_rejects_internal_field_names_and_metric_codes(self) -> None:
        top = signal("SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 82, ["FACT-1"])
        counter = signal("SIGNAL-COUNTER", SignalStatus.WEAK, SignalDirection.BEARISH, 35, ["FACT-2"])
        view = build_editorial_view(
            date(2026, 7, 9), [top, counter], previous_signals=[], knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids=set(),
        )
        fact = SimpleNamespace(statement="Premium rose 14 cents/gal.", evidence_text="Premium rose 14 cents/gal.", market_date=date(2026, 7, 9))
        issues = audit_article("counter_signals ALCEH00 spot_premium", view, [fact])
        self.assertTrue(any("internal processing terms or metric codes" in issue for issue in issues))

    def test_compliant_article_passes_local_audit(self) -> None:
        top = signal("SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 82, ["FACT-1"])
        counter = signal("SIGNAL-COUNTER", SignalStatus.WEAK, SignalDirection.BEARISH, 35, ["FACT-2"])
        view = build_editorial_view(
            date(2026, 7, 9), [top, counter], previous_signals=[], knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids=set(),
        )
        fact = SimpleNamespace(statement="Premium rose 14 cents/gal.", evidence_text="Premium rose 14 cents/gal.", market_date=date(2026, 7, 9))
        markdown = """# 日报
## 核心变化
Premium rose 14 cents/gal.
## 关键数据与事实
> Premium rose 14 cents/gal.

译文：升水上涨14美分/加仑。
## 供应、需求或贸易流传导
Evidence remains limited.
## 市场可能如何定价
Cracker runs weakened.
## 不确定因素
- Premium
- Crack
- Arrivals
## 参考资料
- Platts
"""
        self.assertEqual(audit_article(markdown, view, [fact]), [])

    def test_internal_signal_score_is_not_an_allowed_article_number(self) -> None:
        top = signal("SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 82, ["FACT-1"])
        counter = signal("SIGNAL-COUNTER", SignalStatus.WEAK, SignalDirection.BEARISH, 35, ["FACT-2"])
        view = build_editorial_view(
            date(2026, 7, 9), [top, counter], previous_signals=[], knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids=set(),
        )
        fact = SimpleNamespace(statement="Premium was 14 cents/gal.", evidence_text="Premium was 14 cents/gal.", market_date=date(2026, 7, 9))
        markdown = "# 日报\n## 今日结论\n内部评分82。\n## 反向信号与风险\n风险。\n## 下一交易日验证\n- A\n- B\n- C\n## 来源说明\n- Platts"
        self.assertTrue(any("unsupported numbers" in issue for issue in audit_article(markdown, view, [fact])))

    def test_gasoline_cannot_be_classified_as_distillate(self) -> None:
        top = signal("SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 82, ["FACT-1"])
        counter = signal("SIGNAL-COUNTER", SignalStatus.WEAK, SignalDirection.BEARISH, 35, ["FACT-2"])
        view = build_editorial_view(
            date(2026, 7, 9), [top, counter], previous_signals=[], knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids=set(),
        )
        fact = SimpleNamespace(statement="Stocks changed.", evidence_text="Stocks changed.", market_date=date(2026, 7, 9))
        markdown = "# 日报\n## 今日结论\n美国馏分油（含汽油）库存上升。\n## 原文摘译\n> Stocks changed.\n## 市场传导\n待验证。\n## 反向信号与风险\n风险。\n## 下一交易日验证\n- 库存\n## 资料\n- Platts"
        self.assertIn("article incorrectly classifies gasoline as a distillate", audit_article(markdown, view, [fact]))

    def test_list_numbers_and_decimal_format_do_not_false_positive(self) -> None:
        top = signal("SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 82, ["FACT-1"])
        counter = signal("SIGNAL-COUNTER", SignalStatus.WEAK, SignalDirection.BEARISH, 35, ["FACT-2"])
        view = build_editorial_view(
            date(2026, 7, 9), [top, counter], previous_signals=[], knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids=set(),
        )
        fact = SimpleNamespace(statement="Premium was 14.00 cents/gal.", evidence_text="Premium was 14.00 cents/gal.", market_date=date(2026, 7, 9))
        markdown = "# 日报\n## 今日结论\nPremium was 14 cents/gal.\n## 原文摘译\n> Premium was 14.00 cents/gal.\n\n译文：升水为14美分/加仑。\n## 市场传导\n1. Confirmed\n2. Unconfirmed\n## 反向信号与风险\nRisk.\n## 下一交易日验证\n- A\n- B\n- C\n## 资料\n- Platts"
        self.assertEqual(audit_article(markdown, view, [fact]), [])

    def test_excerpt_labels_are_structural_but_forecast_horizon_is_not(self) -> None:
        top = signal("SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 82, ["FACT-1"])
        counter = signal("SIGNAL-COUNTER", SignalStatus.WEAK, SignalDirection.BEARISH, 35, ["FACT-2"])
        view = build_editorial_view(
            date(2026, 7, 9), [top, counter], previous_signals=[], knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids=set(),
        )
        fact = SimpleNamespace(statement="Supply tightened.", evidence_text="Supply tightened.", market_date=date(2026, 7, 9))
        base = "# 日报\n## 今日结论\n供应收紧。\n## 原文摘译\n原文1：Supply tightened.\n译文：供应收紧。\n## 市场传导\n待验证。\n## 反向信号与风险\n风险。\n## 下一交易日验证\n观察库存。\n## 资料\n- Platts"
        self.assertEqual(audit_article(base, view, [fact]), [])
        issues = audit_article(base.replace("观察库存。", "未来1至5日观察库存。"), view, [fact])
        self.assertTrue(any("unsupported numbers" in issue for issue in issues))

    def test_exact_calendar_month_localization_is_allowed(self) -> None:
        top = signal("SIGNAL-TOP", SignalStatus.TOP, SignalDirection.BULLISH, 82, ["FACT-1"])
        counter = signal("SIGNAL-COUNTER", SignalStatus.WEAK, SignalDirection.BEARISH, 35, ["FACT-2"])
        view = build_editorial_view(
            date(2026, 7, 9), [top, counter], previous_signals=[], knowledge_card=retrieve_knowledge_card("naphtha"),
            allowed_fact_ids={"FACT-1", "FACT-2"}, unresolved_fact_ids=set(),
        )
        fact = SimpleNamespace(
            statement="The August contract was assessed.", evidence_text="The August contract was assessed.",
            market_date=date(2026, 7, 9),
        )
        markdown = "# 日报\n## 今日结论\n7月9日评估8月合约。\n## 原文摘译\n> The August contract was assessed.\n\n译文：8月合约已获评估。\n## 市场传导\n- 已确认\n## 反向信号与风险\n风险。\n## 下一交易日验证\n- A\n- B\n- C\n## 资料\n- Platts"
        self.assertEqual(audit_article(markdown, view, [fact]), [])

    def test_quote_requires_supplied_excerpt_and_matching_source_title(self) -> None:
        view = SimpleNamespace(market_date=date(2026, 7, 9))
        fact = SimpleNamespace(
            statement="Supply tightened.", evidence_text="Supply tightened.", market_date=date(2026, 7, 9),
        )
        markdown = """# 日报
## 市场要点
来源：Platts：“Supply tightened materially in Asia.”
## 原文摘选
来源：Platts：“Supply tightened materially in Asia.”
## 市场脉络
Supply tightened.
## 需要留意的变量
无。
## 接下来关注
库存。
## 参考资料
- Platts
"""
        excerpts = [{"source_title": "Platts", "original_excerpt": "Supply tightened materially in Asia."}]
        self.assertNotIn("article quote source title does not match", audit_article(markdown, view, [fact], excerpts))
        mismatched = markdown.replace("来源：Platts：", "来源：Oilgram：")
        self.assertIn("article quote source title does not match supplied excerpt", audit_article(mismatched, view, [fact], excerpts))

    def test_quote_source_title_accepts_known_chinese_alias(self):
        view = SimpleNamespace(market_date=date(2026, 7, 15))
        fact = SimpleNamespace(
            statement="A pause was announced.",
            evidence_text="A pause was announced by the governor.", market_date=date(2026, 7, 15),
        )
        markdown = "来源：《华尔街日报》：“A pause was announced by the governor.”"
        excerpts = [{
            "source_title": "The Wall Street Journal",
            "original_excerpt": "A pause was announced by the governor.",
        }]
        issues = audit_article(markdown, view, [fact], excerpts)
        self.assertNotIn("article quote source title does not match supplied excerpt", issues)


if __name__ == "__main__":
    unittest.main()

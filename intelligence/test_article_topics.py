from __future__ import annotations

import json
import re
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from markdown_it import MarkdownIt


def _planner():
    try:
        from intelligence.market_pipeline.article_topics import plan_article_topics
    except ModuleNotFoundError as error:
        raise AssertionError("article topic planner is not implemented") from error
    return plan_article_topics


def fact(
    fact_id: str,
    *,
    commodity: str,
    region: str,
    event_type: str,
    source_id: str,
):
    return SimpleNamespace(
        fact_id=fact_id,
        commodity=commodity,
        region=region,
        fact_type=SimpleNamespace(value=event_type),
        source_id=source_id,
    )


def signal(
    signal_id: str, fact_ids: list[str], *, score: int = 80, status: str = "top_signal",
):
    return SimpleNamespace(
        signal_id=signal_id,
        supporting_fact_ids=fact_ids,
        counter_fact_ids=[],
        score=score,
        status=SimpleNamespace(value=status),
    )


def view(*fact_ids: str, publishable: bool = True):
    return SimpleNamespace(
        publishable=publishable,
        supporting_fact_ids=list(fact_ids),
        top_signal=None,
        secondary_signals=[],
        counter_signals=[],
    )


class ArticleTopicPlanningTest(unittest.TestCase):
    def test_recognized_h3_sections_are_normalized_to_h2(self) -> None:
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown
        from intelligence.market_pipeline.contracts import ArticleMode

        normalized = normalize_digit_article_markdown(
            "# 标题\n\n### 发生了什么\n正文。\n\n### 已确认细节\n细节。",
            "标题",
            date(2026, 7, 30),
            ArticleMode.EVENT_BRIEF,
        )

        self.assertIn("## 发生了什么\n正文。", normalized)
        self.assertIn("## 已确认细节\n细节。", normalized)
        self.assertNotIn("### 发生了什么", normalized)

    def assert_one_canonical_h1(self, markdown: str, expected_title: str):
        canonical_h1 = f"# {expected_title}"
        tokens = MarkdownIt("commonmark").parse(markdown)
        h1_indexes = [
            index
            for index, token in enumerate(tokens)
            if token.type == "heading_open" and token.tag == "h1"
        ]

        self.assertEqual(markdown.splitlines()[0], canonical_h1)
        self.assertEqual(len(h1_indexes), 1)
        h1_index = h1_indexes[0]
        self.assertEqual(tokens[h1_index].map, [0, 1])
        self.assertEqual(tokens[h1_index].level, 0)
        self.assertEqual(tokens[h1_index + 1].content, expected_title)

    def test_initial_draft_rejects_blockquote_atx_h1(self):
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown

        with self.assertRaisesRegex(ValueError, "container H1"):
            normalize_digit_article_markdown(
                """# Writer Theme｜2026-07-09
Opening paragraph.

> # Quoted H1
> Quoted detail.
""",
                "Writer Theme｜2026-07-09",
                date(2026, 7, 10),
            )

    def test_local_revision_rejects_list_atx_h1(self):
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown

        with self.assertRaisesRegex(ValueError, "container H1"):
            normalize_digit_article_markdown(
                """Locally Revised Theme｜2026-07-09
=====================================
Opening paragraph.

- # Listed H1
  Listed detail.
""",
                None,
                date(2026, 7, 10),
            )

    def test_dify_revision_rejects_blockquote_setext_h1(self):
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown

        with self.assertRaisesRegex(ValueError, "container H1"):
            normalize_digit_article_markdown(
                """# Dify Revised Theme｜2026-07-09
Opening paragraph.

> Quoted Setext H1
> =================
""",
                None,
                date(2026, 7, 10),
            )

    def test_nested_fence_h1_is_excluded_by_commonmark_parser(self):
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown

        normalized = normalize_digit_article_markdown(
            """# Writer Theme｜2026-07-09
Opening paragraph.

> ```markdown
> # Fenced example is not a heading
> Nested fence content.
> ```
""",
            None,
            date(2026, 7, 10),
        )

        self.assert_one_canonical_h1(normalized, "Writer Theme｜2026-07-10")
        self.assertIn("> # Fenced example is not a heading", normalized)

    def test_initial_draft_normalizes_indented_atx_and_downgrades_setext_h1(self):
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown

        normalized = normalize_digit_article_markdown(
            """   # Writer Theme｜2026-07-09
Opening paragraph.

Extra analysis
===============
Detail.
""",
            "Writer Theme｜2026-07-08",
            date(2026, 7, 10),
        )

        self.assert_one_canonical_h1(normalized, "Writer Theme｜2026-07-10")
        self.assertIn("## Extra analysis", normalized)

    def test_local_revision_normalizes_setext_and_downgrades_indented_atx_h1(self):
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown

        normalized = normalize_digit_article_markdown(
            """Locally Revised Theme｜2026-07-09
=====================================
Opening paragraph.
  # Extra local heading
Detail.
""",
            None,
            date(2026, 7, 10),
        )

        self.assert_one_canonical_h1(normalized, "Locally Revised Theme｜2026-07-10")
        self.assertIn("## Extra local heading", normalized)

    def test_dify_revision_normalizes_indented_atx_and_downgrades_setext_h1(self):
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown

        normalized = normalize_digit_article_markdown(
            """  # Dify Revised Theme｜2026-07-09
Opening paragraph.

Dify extra heading
  ==================
Detail.
""",
            None,
            date(2026, 7, 10),
        )

        self.assert_one_canonical_h1(normalized, "Dify Revised Theme｜2026-07-10")
        self.assertIn("## Dify extra heading", normalized)

    def test_digit_markdown_has_one_canonical_h1_for_target_market_date(self):
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown

        markdown = """# Writer Theme｜2026-07-09
Opening paragraph.
# 今日结论
Conclusion.
# Extra heading
Detail.
"""

        normalized = normalize_digit_article_markdown(
            markdown, "Writer Theme｜2026-07-08", date(2026, 7, 10),
        )
        h1_lines = re.findall(r"(?m)^#(?!#)\s+.+$", normalized)

        self.assertEqual(h1_lines, ["# Writer Theme｜2026-07-10"])
        self.assertTrue(normalized.startswith("# Writer Theme｜2026-07-10\n"))
        self.assertIn("## 今日结论", normalized)
        self.assertIn("## Extra heading", normalized)

    def test_generic_sections_are_mapped_to_event_brief_contract(self):
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown
        from intelligence.market_pipeline.contracts import ArticleMode

        normalized = normalize_digit_article_markdown(
            """# Event Theme
## 今日结论
Event.
## 原文摘译
Source.
## 市场传导
Details.
## 反向信号与风险
Impact.
## 下一交易日验证
Unknowns.
## 资料
- Source
""",
            None,
            date(2026, 7, 10),
            ArticleMode.EVENT_BRIEF,
        )

        for heading in ("发生了什么", "已确认细节", "来源如何描述", "可能影响的市场环节", "尚未确认的信息", "参考资料"):
            self.assertIn(f"## {heading}", normalized)

    def test_market_analysis_conjunction_heading_uses_contract_heading(self):
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown
        from intelligence.market_pipeline.contracts import ArticleMode

        normalized = normalize_digit_article_markdown(
            """# Fuel oil theme
## 核心变化
Core.
## 关键数据与事实
Facts.
## 供应、需求与贸易流传导
Transmission.
## 不确定因素
Uncertainty.
## 参考资料
- Platts
""",
            None,
            date(2026, 7, 29),
            ArticleMode.MARKET_ANALYSIS,
        )

        self.assertIn("## 供应、需求或贸易流传导", normalized)
        self.assertNotIn("## 供应、需求与贸易流传导", normalized)

    def test_bold_generic_sections_are_normalized_before_mode_mapping(self):
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown
        from intelligence.market_pipeline.contracts import ArticleMode

        normalized = normalize_digit_article_markdown(
            """# Event Theme
**今日结论**
Event.
**原文摘译**
Source.
**市场传导**
Details.
**反向信号与风险**
Impact.
**下一交易日验证**
Unknowns.
**资料**
- Source
""",
            None,
            date(2026, 7, 10),
            ArticleMode.EVENT_BRIEF,
        )

        self.assertIn("## 发生了什么", normalized)
        self.assertIn("## 来源如何描述", normalized)
        self.assertNotIn("**今日结论**", normalized)

    def test_normalized_digit_markdown_passes_real_wechat_date_preflight(self):
        from intelligence import wechat_publish
        from intelligence.content_streams import ArticleLocator, resolve_article_paths
        from intelligence.market_pipeline.article_topics import normalize_digit_article_markdown

        target_date = date(2026, 7, 10)
        article_body = "Evidence remains within the assigned topic. " * 30
        markdown = normalize_digit_article_markdown(
            f"""# Revised Theme｜2026-07-09
Opening evidence remains within the assigned topic.
## 今日结论
{article_body}
## 原文摘译
{article_body}
## 市场传导
{article_body}
## 反向信号与风险
{article_body}
## 下一交易日验证
{article_body}
## 资料
- Source 1
""",
            None,
            target_date,
        )
        title = markdown.splitlines()[0].removeprefix("# ")
        html = wechat_publish.markdown_to_report_html(
            markdown, "Assigned-topic evidence summary.", target_date.isoformat(),
        )
        article = {
            "title": title,
            "digest": "Assigned-topic evidence summary.",
            "content": html,
        }
        locator = ArticleLocator("digit", target_date, "01-revised-theme")

        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_root = Path(temporary_directory)
            paths = resolve_article_paths(locator, reports_root)
            paths.quality_audit.parent.mkdir(parents=True)
            paths.quality_audit.write_text(
                json.dumps({"status": "pass", "issues": []}), encoding="utf-8",
            )
            bundle = {
                "md_path": paths.markdown,
                "html_path": paths.wechat_html,
                "summary_path": paths.summary,
            }
            config = {
                "appid": "fixture-app",
                "appsecret": "fixture-secret",
                "default_thumb_media_id": "fixture-thumb",
            }
            with patch.object(wechat_publish, "REPORTS_DIR", reports_root):
                preflight = wechat_publish.build_preflight_report(
                    config, bundle, article, target_date.isoformat(), "draft", locator,
                )

        self.assertEqual(title, "Revised Theme｜2026-07-10")
        self.assertTrue(preflight["ready"], preflight["issues"])
        self.assertEqual(preflight["issues"], [])

    def test_excess_qualified_topics_are_omitted_instead_of_merged_into_selected_topics(self):
        from intelligence.market_pipeline.article_topics import plan_article_topics_with_diagnostics

        facts = []
        signals = []
        fact_ids_by_topic = []
        for index, event_type in enumerate(("supply", "demand", "inventory", "shipment"), start=1):
            topic_fact_ids = {f"FACT-{index}-A", f"FACT-{index}-B"}
            fact_ids_by_topic.append(topic_fact_ids)
            facts.extend([
                fact(
                    f"FACT-{index}-A", commodity="crude", region="Asia",
                    event_type=event_type, source_id=f"SRC-{index}-A",
                ),
                fact(
                    f"FACT-{index}-B", commodity="crude", region="Asia",
                    event_type=event_type, source_id=f"SRC-{index}-B",
                ),
            ])
            signals.append(signal(f"SIGNAL-{index}", sorted(topic_fact_ids), score=100-index))

        plan = plan_article_topics_with_diagnostics(
            view(*(item.fact_id for item in facts)), facts, signals,
        )

        selected_fact_ids = {fact_id for topic in plan.topics for fact_id in topic.fact_ids}
        selected_signal_ids = {signal_id for topic in plan.topics for signal_id in topic.signal_ids}
        self.assertEqual(len(plan.topics), 2)
        self.assertTrue(selected_fact_ids.isdisjoint(fact_ids_by_topic[2] | fact_ids_by_topic[3]))
        self.assertTrue({"SIGNAL-3", "SIGNAL-4"}.isdisjoint(selected_signal_ids))
        self.assertEqual(len(plan.omitted_due_to_cap), 2)
        self.assertEqual(
            {fact_id for topic in plan.omitted_due_to_cap for fact_id in topic.fact_ids},
            fact_ids_by_topic[2] | fact_ids_by_topic[3],
        )
        self.assertEqual(
            {signal_id for topic in plan.omitted_due_to_cap for signal_id in topic.signal_ids},
            {"SIGNAL-3", "SIGNAL-4"},
        )

    def test_publication_index_records_topics_omitted_due_to_cap(self):
        from intelligence.market_pipeline import publication_worker

        omitted = [{
            "slug": "crude-asia-shipment",
            "title_hint": "Crude｜Asia｜Shipment",
            "fact_ids": ["FACT-4-A", "FACT-4-B"],
            "signal_ids": ["SIGNAL-4"],
            "rationale": "qualified but omitted by cap",
        }]
        with tempfile.TemporaryDirectory() as temporary_directory:
            index_path = publication_worker.write_publication_index(
                Path(temporary_directory), date(2026, 7, 10), [],
                omitted_due_to_cap=omitted,
            )
            payload = json.loads(index_path.read_text(encoding="utf-8"))

        self.assertEqual(payload["omitted_due_to_cap"], omitted)

    def test_defaults_to_one_article_and_caps_independent_topics_at_two(self):
        plan_article_topics = _planner()
        single_facts = [
            fact("FACT-1", commodity="crude", region="Asia", event_type="supply", source_id="SRC-1"),
            fact("FACT-2", commodity="crude", region="Asia", event_type="supply", source_id="SRC-2"),
        ]
        single_signals = [signal("SIGNAL-1", ["FACT-1", "FACT-2"])]
        self.assertEqual(
            len(plan_article_topics(view("FACT-1", "FACT-2"), single_facts, single_signals)),
            1,
        )

        four_facts = []
        four_signals = []
        all_fact_ids = []
        for index, event_type in enumerate(("supply", "demand", "inventory", "shipment"), start=1):
            topic_fact_ids = [f"FACT-{index}-A", f"FACT-{index}-B"]
            all_fact_ids.extend(topic_fact_ids)
            four_facts.extend([
                fact(topic_fact_ids[0], commodity="crude", region="Asia", event_type=event_type, source_id=f"SRC-{index}-A"),
                fact(topic_fact_ids[1], commodity="crude", region="Asia", event_type=event_type, source_id=f"SRC-{index}-B"),
            ])
            four_signals.append(signal(f"SIGNAL-{index}", topic_fact_ids, score=90-index))

        planned = plan_article_topics(view(*all_fact_ids), four_facts, four_signals)
        self.assertEqual(len(planned), 2)

    def test_each_topic_has_independent_evidence_and_no_fact_overlap(self):
        plan_article_topics = _planner()
        facts = [
            fact("FACT-S1", commodity="crude", region="Asia", event_type="supply", source_id="SRC-1"),
            fact("FACT-S2", commodity="crude", region="Asia", event_type="supply", source_id="SRC-2"),
            fact("FACT-D1", commodity="diesel", region="Europe", event_type="demand", source_id="SRC-3"),
            fact("FACT-D2", commodity="diesel", region="Europe", event_type="demand", source_id="SRC-4"),
        ]
        signals = [
            signal("SIGNAL-S", ["FACT-S1", "FACT-S2"], score=90),
            signal("SIGNAL-D", ["FACT-D1", "FACT-D2"], score=85),
        ]

        planned = plan_article_topics(view(*(item.fact_id for item in facts)), facts, signals)

        self.assertEqual(len(planned), 2)
        self.assertTrue(all(len(topic.fact_ids) >= 2 for topic in planned))
        self.assertTrue(set(planned[0].fact_ids).isdisjoint(planned[1].fact_ids))

    def test_does_not_split_when_only_one_theme_has_independent_evidence(self):
        plan_article_topics = _planner()
        facts = [
            fact("FACT-1", commodity="crude", region="Asia", event_type="supply", source_id="SRC-1"),
            fact("FACT-2", commodity="crude", region="Asia", event_type="supply", source_id="SRC-2"),
            fact("FACT-3", commodity="diesel", region="Europe", event_type="demand", source_id="SRC-3"),
        ]
        signals = [
            signal("SIGNAL-1", ["FACT-1", "FACT-2"], score=90),
            signal("SIGNAL-2", ["FACT-3"], score=85),
        ]

        planned = plan_article_topics(view("FACT-1", "FACT-2", "FACT-3"), facts, signals)

        self.assertEqual(len(planned), 1)
        self.assertEqual(set(planned[0].fact_ids), {"FACT-1", "FACT-2"})

    def test_returns_no_topics_for_archive_only_view(self):
        plan_article_topics = _planner()
        facts = [fact("FACT-1", commodity="crude", region="Asia", event_type="supply", source_id="SRC-1")]

        self.assertEqual(plan_article_topics(view("FACT-1", publishable=False), facts, []), [])

    def test_non_ascii_topic_dimensions_still_generate_unique_slugs(self):
        plan_article_topics = _planner()
        facts = [
            fact("FACT-A1", commodity="crude", region="亚洲", event_type="供应", source_id="SRC-A1"),
            fact("FACT-A2", commodity="crude", region="亚洲", event_type="供应", source_id="SRC-A2"),
            fact("FACT-E1", commodity="crude", region="欧洲", event_type="供应", source_id="SRC-E1"),
            fact("FACT-E2", commodity="crude", region="欧洲", event_type="供应", source_id="SRC-E2"),
        ]
        signals = [
            signal("SIGNAL-A", ["FACT-A1", "FACT-A2"], score=90),
            signal("SIGNAL-E", ["FACT-E1", "FACT-E2"], score=85),
        ]

        planned = plan_article_topics(view(*(item.fact_id for item in facts)), facts, signals)

        self.assertEqual(len({topic.slug for topic in planned}), 2)

    def test_weak_signal_theme_is_merged_instead_of_split(self):
        plan_article_topics = _planner()
        facts = [
            fact("FACT-T1", commodity="crude", region="Asia", event_type="supply", source_id="SRC-T1"),
            fact("FACT-T2", commodity="crude", region="Asia", event_type="supply", source_id="SRC-T2"),
            fact("FACT-W1", commodity="diesel", region="Europe", event_type="demand", source_id="SRC-W1"),
            fact("FACT-W2", commodity="diesel", region="Europe", event_type="demand", source_id="SRC-W2"),
        ]
        signals = [
            signal("SIGNAL-T", ["FACT-T1", "FACT-T2"], score=90),
            signal("SIGNAL-W", ["FACT-W1", "FACT-W2"], score=45, status="weak_signal"),
        ]

        planned = plan_article_topics(view(*(item.fact_id for item in facts)), facts, signals)

        self.assertEqual(len(planned), 1)
        self.assertEqual(set(planned[0].fact_ids), {"FACT-T1", "FACT-T2"})

    def test_cross_cluster_signal_cannot_create_topics_with_empty_signal_ids(self):
        plan_article_topics = _planner()
        facts = [
            fact("FACT-A1", commodity="crude", region="Asia", event_type="supply", source_id="SRC-A1"),
            fact("FACT-A2", commodity="crude", region="Asia", event_type="supply", source_id="SRC-A2"),
            fact("FACT-B1", commodity="diesel", region="Europe", event_type="demand", source_id="SRC-B1"),
            fact("FACT-B2", commodity="diesel", region="Europe", event_type="demand", source_id="SRC-B2"),
        ]
        cross_signal = signal(
            "SIGNAL-CROSS", [item.fact_id for item in facts], score=95,
        )

        planned = plan_article_topics(view(*(item.fact_id for item in facts)), facts, [cross_signal])

        self.assertEqual(len(planned), 1)
        self.assertEqual(planned[0].signal_ids, ["SIGNAL-CROSS"])
        self.assertEqual(
            set(planned[0].fact_ids),
            {"FACT-A1", "FACT-A2", "FACT-B1", "FACT-B2"},
        )

    def test_cross_cluster_signal_is_not_copied_into_split_topic_payloads(self):
        plan_article_topics = _planner()
        facts = [
            fact("FACT-A1", commodity="crude", region="Asia", event_type="supply", source_id="SRC-A1"),
            fact("FACT-A2", commodity="crude", region="Asia", event_type="supply", source_id="SRC-A2"),
            fact("FACT-B1", commodity="diesel", region="Europe", event_type="demand", source_id="SRC-B1"),
            fact("FACT-B2", commodity="diesel", region="Europe", event_type="demand", source_id="SRC-B2"),
        ]
        signals = [
            signal("SIGNAL-A", ["FACT-A1", "FACT-A2"], score=90),
            signal("SIGNAL-B", ["FACT-B1", "FACT-B2"], score=85, status="secondary_signal"),
            signal("SIGNAL-CROSS", ["FACT-A1", "FACT-B1"], score=45, status="weak_signal"),
        ]

        planned = plan_article_topics(view(*(item.fact_id for item in facts)), facts, signals)

        self.assertEqual(len(planned), 2)
        self.assertTrue(all(topic.signal_ids for topic in planned))
        self.assertNotIn("SIGNAL-CROSS", {signal_id for topic in planned for signal_id in topic.signal_ids})


if __name__ == "__main__":
    unittest.main()

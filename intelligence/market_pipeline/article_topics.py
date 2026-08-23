"""Deterministic planning for one to three evidence-isolated Digit articles."""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from typing import Any

from markdown_it import MarkdownIt

from .contracts import ArticleMode, ArticleTopic, EditorialCandidate, EvidenceBundle
from .editorial_candidates import build_editorial_candidates


MAX_ARTICLE_TOPICS = 2
INELIGIBLE_SIGNAL_STATUSES = {"discard", "discarded", "low", "low_signal"}
SPLIT_SIGNAL_STATUSES = {"top_signal", "secondary_signal"}
MARKET_DATE_SUFFIX_PATTERN = re.compile(
    r"(?:\s*[｜|]\s*\d{4}-\d{2}-\d{2})+\s*$",
)


@dataclass(frozen=True)
class _TopicCluster:
    key: tuple[str, str, str]
    fact_ids: tuple[str, ...]
    source_count: int
    signal_ids: tuple[str, ...]
    split_signal_ids: tuple[str, ...]
    signal_score: int


@dataclass(frozen=True)
class ArticleTopicPlan:
    topics: tuple[ArticleTopic, ...]
    omitted_due_to_cap: tuple[ArticleTopic, ...]


@dataclass(frozen=True)
class _H1Span:
    start: int
    end: int
    title: str
    level: int


def _topic_title(value: str) -> str:
    title = re.sub(r"\s+", " ", str(value or "").strip().lstrip("#").strip())
    return MARKET_DATE_SUFFIX_PATTERN.sub("", title).strip()


def _commonmark_h1_spans(markdown: str) -> list[_H1Span]:
    tokens = MarkdownIt("commonmark").parse(markdown)
    spans: list[_H1Span] = []
    for index, token in enumerate(tokens):
        if token.type != "heading_open" or token.tag != "h1":
            continue
        if token.map is None:
            raise ValueError("digit article H1 has no source map")
        inline = tokens[index + 1] if index + 1 < len(tokens) else None
        title = inline.content if inline is not None and inline.type == "inline" else ""
        spans.append(_H1Span(
            start=token.map[0],
            end=token.map[1] - 1,
            title=re.sub(r"\s+", " ", title).strip(),
            level=token.level,
        ))

    return spans


def normalize_digit_article_markdown(
    markdown: str,
    title: str | None,
    market_date: date,
    article_mode: ArticleMode | str | None = None,
) -> str:
    """Return Digit Markdown with one canonical, market-date-bound H1."""
    source = str(markdown or "").strip()
    lines = source.splitlines()
    h1_spans = _commonmark_h1_spans(source)
    if any(heading.level > 0 for heading in h1_spans):
        raise ValueError("digit article contains container H1")
    first_h1 = h1_spans[0].title if h1_spans else ""
    topic_title = _topic_title(title or first_h1)
    if not topic_title:
        raise ValueError("digit article topic title missing")

    normalized: list[str] = []
    consumed_document_title = False
    cursor = 0
    for heading in h1_spans:
        normalized.extend(lines[cursor:heading.start])
        if not consumed_document_title and _topic_title(heading.title) == topic_title:
            consumed_document_title = True
        elif heading.title:
            normalized.append(f"## {heading.title}")
        else:
            raise ValueError("digit article contains empty H1")
        cursor = heading.end + 1
    normalized.extend(lines[cursor:])
    recognized_headings = {
        "今日结论", "原文摘译", "市场传导", "反向信号与风险", "下一交易日验证", "资料",
        "市场要点", "原文摘选", "市场脉络", "需要留意的变量", "接下来关注", "参考资料",
        "原文讨论的核心问题", "原文论述脉络", "必要背景", "原文结论与保留意见",
        "发生了什么", "已确认细节", "来源如何描述", "可能影响的市场环节", "尚未确认的信息",
        "核心变化", "关键数据与事实", "供应、需求或贸易流传导", "市场可能如何定价", "不确定因素",
        "忠实摘译",
    }
    normalized = [
        f"## {match.group(1).strip()}"
        if (match := re.fullmatch(r"\s*\*\*([^*\n]+)\*\*\s*", line))
        and match.group(1).strip() in recognized_headings
        else line
        for line in normalized
    ]
    normalized = [
        f"## {match.group(1).strip()}"
        if (match := re.fullmatch(r"\s*#{2,6}\s+(.+?)\s*", line))
        and match.group(1).strip() in recognized_headings
        else line
        for line in normalized
    ]
    reader_heading_aliases = {
        "原文摘译": "原文摘选", "市场传导": "市场脉络",
        "反向信号与风险": "需要留意的变量", "下一交易日验证": "接下来关注", "资料": "参考资料",
    }
    normalized = [
        f"## {reader_heading_aliases.get(line.removeprefix('## ').strip(), line.removeprefix('## ').strip())}"
        if line.startswith("## ") else line
        for line in normalized
    ]
    mode_value = getattr(article_mode, "value", article_mode or "")
    mode_heading_aliases = {
        ArticleMode.FAITHFUL_TRANSLATION.value: {
            "今日结论": "原文讨论的核心问题",
            "市场要点": "原文讨论的核心问题",
            "市场脉络": "原文论述脉络",
            "需要留意的变量": "必要背景",
            "接下来关注": "原文结论与保留意见",
        },
        ArticleMode.EVENT_BRIEF.value: {
            "今日结论": "发生了什么",
            "市场要点": "发生了什么",
            "市场脉络": "已确认细节",
            "原文摘选": "来源如何描述",
            "需要留意的变量": "可能影响的市场环节",
            "接下来关注": "尚未确认的信息",
        },
        ArticleMode.MARKET_ANALYSIS.value: {
            "今日结论": "核心变化",
            "市场要点": "核心变化",
            "原文摘选": "关键数据与事实",
            "市场脉络": "供应、需求或贸易流传导",
            "供应、需求与贸易流传导": "供应、需求或贸易流传导",
            "接下来关注": "市场可能如何定价",
            "需要留意的变量": "不确定因素",
        },
    }.get(str(mode_value), {})
    normalized = [
        f"## {mode_heading_aliases.get(line.removeprefix('## ').strip(), line.removeprefix('## ').strip())}"
        if line.startswith("## ") else line
        for line in normalized
    ]

    canonical_h1 = f"# {topic_title}｜{market_date.isoformat()}"
    result = "\n".join([canonical_h1, "", *normalized]).strip() + "\n"
    result_h1_spans = _commonmark_h1_spans(result)
    if (
        len(result_h1_spans) != 1
        or result_h1_spans[0].start != 0
        or result_h1_spans[0].level != 0
        or result_h1_spans[0].title != canonical_h1.removeprefix("# ")
    ):
        raise ValueError("digit article H1 normalization failed")
    return result


def _value(item: Any, name: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value) or "").strip()


def _normalized(value: Any, fallback: str) -> str:
    normalized = re.sub(r"\s+", " ", str(value or "").strip()).casefold()
    return normalized or fallback


def _active_signals(signals: list[Any]) -> list[Any]:
    return [
        signal
        for signal in signals
        if _enum_value(_value(signal, "status")).casefold() not in INELIGIBLE_SIGNAL_STATUSES
    ]


def _signal_fact_ids(signal: Any) -> set[str]:
    return {
        str(fact_id)
        for fact_id in [
            *(_value(signal, "supporting_fact_ids", []) or []),
            *(_value(signal, "counter_fact_ids", []) or []),
        ]
        if fact_id
    }


def _relevant_fact_ids(view: Any, facts: list[Any], signals: list[Any]) -> set[str]:
    available = {str(_value(fact, "fact_id")) for fact in facts if _value(fact, "fact_id")}
    referenced = {
        str(fact_id)
        for fact_id in (_value(view, "supporting_fact_ids", []) or [])
        if fact_id
    }
    for signal in signals:
        referenced.update(_signal_fact_ids(signal))
    return available & referenced if referenced else available


def _cluster_facts(facts: list[Any], signals: list[Any], relevant_ids: set[str]) -> list[_TopicCluster]:
    grouped: dict[tuple[str, str, str], list[Any]] = defaultdict(list)
    for fact in facts:
        fact_id = str(_value(fact, "fact_id") or "")
        if fact_id not in relevant_ids:
            continue
        key = (
            _normalized(_value(fact, "commodity"), "market"),
            _normalized(_value(fact, "region"), "global"),
            _normalized(_enum_value(_value(fact, "fact_type")), "market_event"),
        )
        grouped[key].append(fact)

    clusters: list[_TopicCluster] = []
    for key, grouped_facts in grouped.items():
        fact_ids = tuple(sorted(str(_value(fact, "fact_id")) for fact in grouped_facts))
        fact_id_set = set(fact_ids)
        matched_signals = [
            signal for signal in signals
            if _signal_fact_ids(signal) and _signal_fact_ids(signal).issubset(fact_id_set)
        ]
        split_signals = [
            signal for signal in matched_signals
            if _enum_value(_value(signal,"status")).casefold() in SPLIT_SIGNAL_STATUSES
        ]
        signal_ids = tuple(sorted(
            str(_value(signal, "signal_id")) for signal in matched_signals if _value(signal, "signal_id")
        ))
        clusters.append(_TopicCluster(
            key=key,
            fact_ids=fact_ids,
            source_count=len({
                str(_value(fact, "source_id"))
                for fact in grouped_facts
                if _value(fact, "source_id")
            }),
            signal_ids=signal_ids,
            split_signal_ids=tuple(sorted(
                str(_value(signal,"signal_id")) for signal in split_signals if _value(signal,"signal_id")
            )),
            signal_score=max((int(_value(signal, "score", 0) or 0) for signal in split_signals), default=0),
        ))
    return clusters


def _cluster_rank(cluster: _TopicCluster) -> tuple[int, int, int, tuple[str, str, str]]:
    return (-cluster.signal_score, -cluster.source_count, -len(cluster.fact_ids), cluster.key)


def _signal_clusters(
    facts: list[Any],
    signals: list[Any],
    relevant_ids: set[str],
) -> list[_TopicCluster]:
    facts_by_id = {
        str(_value(fact, "fact_id")): fact
        for fact in facts
        if _value(fact, "fact_id")
    }
    clusters: list[_TopicCluster] = []
    for signal in signals:
        status = _enum_value(_value(signal, "status")).casefold()
        if status not in SPLIT_SIGNAL_STATUSES:
            continue
        fact_ids = tuple(sorted(_signal_fact_ids(signal) & relevant_ids))
        if len(fact_ids) < 2:
            continue
        signal_id = str(_value(signal, "signal_id") or "")
        first_fact = facts_by_id.get(fact_ids[0])
        key = (
            _normalized(
                _value(signal, "commodity"),
                _normalized(_value(first_fact, "commodity"), "market"),
            ),
            _normalized(
                _value(signal, "region"),
                _normalized(_value(first_fact, "region"), "global"),
            ),
            _normalized(_value(signal, "signal_type"), "market_signal"),
        )
        clusters.append(_TopicCluster(
            key=key,
            fact_ids=fact_ids,
            source_count=len({
                str(_value(facts_by_id.get(fact_id), "source_id"))
                for fact_id in fact_ids
                if _value(facts_by_id.get(fact_id), "source_id")
            }),
            signal_ids=(signal_id,) if signal_id else (),
            split_signal_ids=(signal_id,) if signal_id else (),
            signal_score=int(_value(signal, "score", 0) or 0),
        ))
    return sorted(clusters, key=_cluster_rank)


def _topics_from_signal_clusters(
    clusters: list[_TopicCluster],
) -> ArticleTopicPlan:
    selected: list[_TopicCluster] = []
    omitted: list[_TopicCluster] = []
    selected_fact_ids: set[str] = set()
    for cluster in clusters:
        if selected_fact_ids & set(cluster.fact_ids):
            omitted.append(cluster)
            continue
        if len(selected) < MAX_ARTICLE_TOPICS:
            selected.append(cluster)
            selected_fact_ids.update(cluster.fact_ids)
        else:
            omitted.append(cluster)

    def topic(cluster: _TopicCluster) -> ArticleTopic:
        return ArticleTopic(
            slug=_slug(cluster.key),
            title_hint=_title_hint(cluster.key),
            fact_ids=list(cluster.fact_ids),
            signal_ids=list(cluster.signal_ids),
            rationale=(
                f"主信号直接绑定：{len(cluster.fact_ids)} 条事实、"
                f"{cluster.source_count} 个来源，信号分数 {cluster.signal_score}。"
            ),
        )

    return ArticleTopicPlan(
        tuple(topic(cluster) for cluster in selected),
        tuple(topic(cluster) for cluster in omitted),
    )


def _slug(parts: tuple[str, str, str]) -> str:
    readable = "-".join(filter(None, (
        re.sub(r"[^a-z0-9]+", "-", part).strip("-") for part in parts
    )))
    digest = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()[:10]
    if readable:
        suffix = f"-{digest}" if any(not part.isascii() for part in parts) else ""
        return f"{readable[:80-len(suffix)].rstrip('-')}{suffix}"
    return f"market-theme-{digest}"


def _title_hint(parts: tuple[str, str, str]) -> str:
    return "｜".join(part.replace("_", " ").title() for part in parts)


def _assign_signals(topic_fact_ids: list[set[str]], signals: list[Any]) -> list[list[str]]:
    assigned: list[list[str]] = [[] for _ in topic_fact_ids]
    for signal in sorted(signals, key=lambda item: (-int(_value(item, "score", 0) or 0), str(_value(item, "signal_id", "")))):
        signal_id = str(_value(signal, "signal_id") or "")
        if not signal_id:
            continue
        supported = _signal_fact_ids(signal)
        owners = [index for index,fact_ids in enumerate(topic_fact_ids) if supported and supported.issubset(fact_ids)]
        if len(owners) == 1:
            assigned[owners[0]].append(signal_id)
    return assigned


_MERGE_STOPWORDS = {
    "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "was",
    "will", "with", "from", "by", "at", "its", "new", "market", "energy",
    "oil", "gas", "production", "supply", "price", "prices", "company", "business",
    "earnings", "quarter", "reported",
}


def _subject_tokens(value: str) -> set[str]:
    return {
        token for token in re.findall(r"[a-z0-9]{3,}", value.casefold())
        if token not in _MERGE_STOPWORDS
    }


def _should_merge_candidates(left: EditorialCandidate, right: EditorialCandidate) -> bool:
    shared_sources = set(left.source_ids) & set(right.source_ids)
    if not shared_sources:
        return False
    left_tokens = _subject_tokens(left.headline_subject)
    right_tokens = _subject_tokens(right.headline_subject)
    shared_tokens = left_tokens & right_tokens
    union = left_tokens | right_tokens
    similarity = len(shared_tokens) / len(union) if union else 0
    return len(shared_tokens) >= 2 or similarity >= 0.2


def _merge_factual_candidates(
    candidates: list[tuple[EditorialCandidate, EvidenceBundle]],
) -> list[tuple[EditorialCandidate, EvidenceBundle, list[str], list[str], str]]:
    groups: list[list[tuple[EditorialCandidate, EvidenceBundle]]] = []
    for item in candidates:
        matching = next(
            (group for group in groups if any(_should_merge_candidates(item[0], member[0]) for member in group)),
            None,
        )
        if matching is None:
            groups.append([item])
        else:
            matching.append(item)

    merged = []
    for group in groups:
        primary, primary_bundle = group[0]
        candidate_ids = [candidate.candidate_id for candidate, _ in group]
        reasons = ["same_source_and_subject"] if len(group) > 1 else []
        fact_ids = list(dict.fromkeys(
            fact_id for candidate, _ in group for fact_id in candidate.fact_ids
        ))[:15]
        source_ids = sorted({source_id for candidate, _ in group for source_id in candidate.source_ids})
        excerpt_ids = list(dict.fromkeys(
            fact_id for candidate, _ in group for fact_id in candidate.excerpt_ids if fact_id in fact_ids
        ))[:6]
        candidate = primary.model_copy(update={
            "fact_ids": fact_ids,
            "source_ids": source_ids,
            "excerpt_ids": excerpt_ids,
            "newsworthiness_score": max(candidate.newsworthiness_score for candidate, _ in group),
            "selection_reasons": list(dict.fromkeys(
                reason for candidate, _ in group for reason in candidate.selection_reasons
            )),
        })
        bundle = primary_bundle.model_copy(update={
            "core_fact_ids": list(dict.fromkeys(
                value for _, item_bundle in group for value in item_bundle.core_fact_ids if value in fact_ids
            ))[:5],
            "supply_trade_fact_ids": list(dict.fromkeys(
                value for _, item_bundle in group for value in item_bundle.supply_trade_fact_ids if value in fact_ids
            ))[:4],
            "price_fact_ids": list(dict.fromkeys(
                value for _, item_bundle in group for value in item_bundle.price_fact_ids if value in fact_ids
            ))[:3],
            "commentary_fact_ids": list(dict.fromkeys(
                value for _, item_bundle in group for value in item_bundle.commentary_fact_ids if value in fact_ids
            ))[:3],
            "source_ids": source_ids,
            "excerpt_fact_ids": excerpt_ids,
            "reader_value_score": max(item_bundle.reader_value_score for _, item_bundle in group),
        })
        cluster_key = hashlib.sha1("|".join(sorted(candidate_ids)).encode("utf-8")).hexdigest()[:12]
        merged.append((candidate, bundle, candidate_ids, reasons, f"factual-{cluster_key}"))
    return merged


def plan_article_topics_with_diagnostics(
    view: Any, facts: list[Any], signals: list[Any],
) -> ArticleTopicPlan:
    """Plan deterministic topics and preserve cap omissions for the publication index."""
    editorially_publishable = bool(
        _value(view, "editorially_publishable", _value(view, "publishable", False))
    )
    if not editorially_publishable:
        return ArticleTopicPlan((), ())

    article_mode = _enum_value(_value(view, "article_mode", ArticleMode.MARKET_VIEW))
    if article_mode in {
        ArticleMode.FACTUAL_BRIEF.value,
        ArticleMode.EVENT_BRIEF.value,
        ArticleMode.FAITHFUL_TRANSLATION.value,
    }:
        candidates = _merge_factual_candidates(build_editorial_candidates(
            _value(view, "market_date"), facts, directional_signal_available=False,
        ))
        topics = tuple(
            ArticleTopic(
                slug=_slug((
                    _normalized(candidate.headline_subject, "market"),
                    candidate.article_mode.value,
                    candidate.candidate_id[-12:],
                )),
                title_hint=candidate.headline_subject,
                fact_ids=candidate.fact_ids,
                signal_ids=[],
                rationale="; ".join(candidate.selection_reasons),
                article_mode=candidate.article_mode,
                candidate_id=candidate.candidate_id,
                evidence_bundle=bundle,
                topic_cluster_key=cluster_key,
                merged_candidate_ids=merged_candidate_ids,
                merge_reasons=merge_reasons,
            )
            for candidate, bundle, merged_candidate_ids, merge_reasons, cluster_key in candidates
        )
        return ArticleTopicPlan(topics[:MAX_ARTICLE_TOPICS], topics[MAX_ARTICLE_TOPICS:])

    active_signals = _active_signals(signals)
    relevant_ids = _relevant_fact_ids(view, facts, active_signals)
    if not relevant_ids:
        return ArticleTopicPlan((), ())

    signal_clusters = _signal_clusters(facts, active_signals, relevant_ids)
    if signal_clusters:
        return _topics_from_signal_clusters(signal_clusters)

    clusters = _cluster_facts(facts, active_signals, relevant_ids)
    qualified = sorted(
        [
            cluster
            for cluster in clusters
            if len(cluster.fact_ids) >= 2 and cluster.source_count >= 2 and cluster.split_signal_ids
        ],
        key=_cluster_rank,
    )

    if len(qualified) < 2:
        primary_cluster = qualified[0] if qualified else sorted(clusters, key=_cluster_rank)[0]
        primary_fact_ids = set(primary_cluster.fact_ids)
        signal_ids = sorted(
            str(_value(signal, "signal_id"))
            for signal in active_signals
            if _value(signal, "signal_id")
            and len(_signal_fact_ids(signal) & primary_fact_ids) >= 2
        )
        return ArticleTopicPlan((ArticleTopic(
            slug=_slug(primary_cluster.key),
            title_hint=_title_hint(primary_cluster.key),
            fact_ids=sorted(primary_fact_ids),
            signal_ids=signal_ids,
            rationale="默认单稿：不足两个具备多事实、独立来源和有效信号支持的主题。",
        ),), ())

    selected = qualified[:MAX_ARTICLE_TOPICS]
    omitted = qualified[MAX_ARTICLE_TOPICS:]
    topic_fact_ids = [set(cluster.fact_ids) for cluster in selected]
    topic_signal_ids = _assign_signals(topic_fact_ids, active_signals)
    omitted_signal_ids = _assign_signals(
        [set(cluster.fact_ids) for cluster in omitted], active_signals,
    )

    topics = tuple(
        ArticleTopic(
            slug=_slug(cluster.key),
            title_hint=_title_hint(cluster.key),
            fact_ids=sorted(topic_fact_ids[index]),
            signal_ids=topic_signal_ids[index],
            rationale=(
                f"独立主题：{len(cluster.fact_ids)} 条事实、{cluster.source_count} 个独立来源，"
                f"最强信号分数 {cluster.signal_score}。"
            ),
        )
        for index, cluster in enumerate(selected)
    )
    omitted_topics = tuple(
        ArticleTopic(
            slug=_slug(cluster.key),
            title_hint=_title_hint(cluster.key),
            fact_ids=list(cluster.fact_ids),
            signal_ids=omitted_signal_ids[index],
            rationale=(
                f"独立主题达到成稿门槛，但超过每日 {MAX_ARTICLE_TOPICS} 篇上限："
                f"{len(cluster.fact_ids)} 条事实、{cluster.source_count} 个独立来源，"
                f"最强信号分数 {cluster.signal_score}。"
            ),
        )
        for index, cluster in enumerate(omitted)
    )
    return ArticleTopicPlan(topics, omitted_topics)


def plan_article_topics(view: Any, facts: list[Any], signals: list[Any]) -> list[ArticleTopic]:
    """Plan deterministic topics without delegating article count to an LLM."""
    return list(plan_article_topics_with_diagnostics(view, facts, signals).topics)

"""Restricted article payload, deterministic fallback rendering, and final local audit."""

from __future__ import annotations

import json
import re
from datetime import date
from typing import Any

import httpx

from .contracts import ArticleMode, EditorialSignalRef, EditorialView
from .numeric_equivalence import numeric_values
from .source_dossier import clean_reader_excerpt_text, fact_excerpt_id


THINK_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
NUMBER_PATTERN = re.compile(r"(?<![A-Za-z])[-+]?\d+(?:,\d{3})*(?:\.\d+)?%?")
TRACE_ID_PATTERN = re.compile(r"\b(?:SRC|FACT|SIGNAL|METRIC|VIEW)-[A-Za-z0-9-]+\b")
FORBIDDEN_STYLE = ("AI生成", "由AI", "作为AI", "人工智能生成", "language model")
FILENAME_PATTERN = re.compile(r"\b[^\n]{1,100}\.(?:pdf|docx|xlsx)\b", re.IGNORECASE)
INTERNAL_READER_TERM_PATTERN = re.compile(
    r"\b(?:counter_signals|supporting_fact_ids|validation_metrics|"
    r"invalidation_conditions|[A-Z]{3,}\d{2,}|[a-z]+_[a-z]+)\b"
)
MECHANICAL_READER_PHRASES = (
    "未检测到主题反向信号", "counter_signals为空", "以上指标的变化有助于判断",
    "fewer than three", "No topic-local counter-signal",
)
VAGUE_FILLER_PHRASES = (
    "可能产生影响", "值得关注", "尚待观察", "后续仍需观察", "市场仍需关注",
)

SOURCE_TITLE_ALIASES = {
    "the wall street journal": ("wall street journal", "华尔街日报"),
    "wall street journal": ("the wall street journal", "华尔街日报"),
    "platts": ("sp global commodity insights", "普氏", "标普全球商品洞察"),
    "sp global commodity insights": ("platts", "普氏", "标普全球商品洞察"),
    "global critical minerals": ("全球关键矿产",),
    "全球关键矿产": ("global critical minerals",),
}


def source_title_matches_line(source_title: str, line: str) -> bool:
    normalized_line = re.sub(r"[^\w\u4e00-\u9fff]+", " ", line.casefold()).strip()
    normalized_title = re.sub(r"[^\w\u4e00-\u9fff]+", " ", source_title.casefold()).strip()
    candidates = (normalized_title, *SOURCE_TITLE_ALIASES.get(normalized_title, ()))
    return any(
        re.sub(r"[^\w\u4e00-\u9fff]+", " ", candidate.casefold()).strip() in normalized_line
        for candidate in candidates if candidate
    )
QUANTITATIVE_QUALIFIERS = (
    ("average", ("平均", "average")),
    ("approximately", ("约", "大约", "approximately")),
    ("around", ("约", "大约", "around")),
    ("more than", ("超过", "多于", "more than")),
    ("over", ("超过", "以上", "over")),
)
PERCENT_WORD_PATTERN = re.compile(
    r"([+-]?\d[\d,]*(?:\.\d+)?)\s*(?:percent|per\s+cent)\b",
    re.IGNORECASE,
)


def quantitative_qualifier_issues(markdown: str, evidence_segments: list[str]) -> list[str]:
    requirements: dict[str, set[str]] = {}
    for segment in evidence_segments:
        folded = segment.casefold()
        for source_term, _ in QUANTITATIVE_QUALIFIERS:
            start = 0
            while True:
                position = folded.find(source_term, start)
                if position < 0:
                    break
                tail = segment[position + len(source_term):position + len(source_term) + 180]
                if source_term == "average":
                    match = NUMBER_PATTERN.search(tail)
                else:
                    match = re.match(r"\s*([+-]?\d[\d,]*(?:\.\d+)?%?)", tail)
                if match:
                    token = match.group(0).strip()
                    requirements.setdefault(
                        token.replace(",", "").lstrip("+"), set(),
                    ).add(source_term)
                start = position + len(source_term)
    issues: list[str] = []
    for line in markdown.splitlines():
        for token in NUMBER_PATTERN.findall(line):
            normalized = token.replace(",", "").lstrip("+")
            for required in requirements.get(normalized, set()):
                accepted = next(values for source, values in QUANTITATIVE_QUALIFIERS if source == required)
                if not any(value.casefold() in line.casefold() for value in accepted):
                    issues.append(
                        f"number {token} drops required qualifier '{required}'"
                    )
    return list(dict.fromkeys(issues))


SEMANTIC_CONTRADICTIONS = (
    "馏分油（含汽油）", "馏分油(含汽油)",
)
ARTICLE_SECTION_HEADINGS = (
    "市场要点","原文摘选","市场脉络","需要留意的变量","接下来关注","参考资料",
)
FACTUAL_BRIEF_HEADINGS = (
    "发生了什么", "背景与市场关系", "关键数据或信息联系", "仍需确认或后续观察", "参考资料",
)
FAITHFUL_TRANSLATION_HEADINGS = (
    "原文讨论的核心问题", "原文论述脉络", "原文摘选",
    "必要背景", "原文结论与保留意见", "参考资料",
)
EVENT_BRIEF_HEADINGS = (
    "发生了什么", "已确认细节", "来源如何描述",
    "可能影响的市场环节", "尚未确认的信息", "参考资料",
)
MARKET_ANALYSIS_HEADINGS = (
    "核心变化", "关键数据与事实", "供应、需求或贸易流传导",
    "不确定因素", "参考资料",
)
ARTICLE_SECTION_ALIASES = {
    "供应、需求与贸易流传导": "供应、需求或贸易流传导",
    "今日结论": "市场要点", "原文摘译": "原文摘选", "市场传导": "市场脉络",
    "反向信号与风险": "需要留意的变量", "下一交易日验证": "接下来关注", "资料": "参考资料",
}
MAX_TOPIC_WRITER_FACTS = 15
MAX_WRITER_EVIDENCE_PAYLOAD_CHARACTERS = 80_000
TRANSLATION_SECTION_NAMES = (
    "原文摘选", "忠实摘译", "原文逐句", "原文摘译", "原文延读",
)
COMMODITY_FOCUS_PATTERNS = {
    "diesel": ("柴油", "gasoil", "diesel", "ulsd"),
    "naphtha": ("石脑油", "naphtha"),
    "jet": ("航煤", "航空煤油", "jet fuel", "jet"),
    "crude": ("原油", "crude"),
    "gasoline": ("汽油", "gasoline"),
    "fuel_oil": ("燃料油", "fuel oil", "hsfo", "vlsfo"),
    "coal": ("煤炭", "thermal coal", "coal"),
}
BROAD_MARKET_TITLE_MARKERS = (
    "能源市场", "石油市场", "成品油", "油品市场", "市场综述", "综合观察",
)


WRITER_TASK = """仅使用输入证据撰写自然、完整的中文微信公众号新闻稿，返回 JSON：title、summary、report_markdown。
以 story_brief 为唯一任务：回答 reader_question，贯彻 one_sentence_takeaway，遵守 story_form、must_use_excerpt_ids 和 prohibited_claims。无论文章模式为何，正文必须采用能源新闻编辑口吻，而不是翻译导读口吻：导语先交代谁、何时、做了什么以及为何重要，随后按新闻价值组织已确认事实、背景、各方说法和市场关联，不照搬英文段落顺序或句法。
除“参考资料”外不套固定栏目；问题稿围绕一个问题，时间线稿按事件变化，多来源稿区分各方观点，数据稿只使用已验证数字。faithful_translation 仍应形成 1800–3000 个中文字符，并保留原文的论证推进、转折和保留意见，但正文要重组为可独立阅读的新闻特稿；event_brief 目标 900–1800 字符；market_analysis 目标 1200–2500 字符。
完整出版级译文由本地统一插入“原文摘选”，正文不得复制完整译文、生成“原文/译文”清单，或连续使用“原文指出”“作者认为”“该文提到”串联段落。每个正文段落的首句应提供新的新闻信息，来源观点必须写成“某刊物报道／某机构表示”等明确归因。
段落之间解释事件、证据和背景如何连接，不得把相邻事实改写成同义反复。event_brief 陈述事件而不强制预测；market_analysis 才解释证据绑定的传导链。
严格保留主体、数字、单位、日期、条件、否定和不确定语气；事实、来源观点、外部确认和编辑推演必须清楚分开。段首使用 [source_fact]、[source_view]、[background_context] 或 [editorial_inference] 内部标记，发布前删除。
不得增加事实、原因或预测；不得换算、舍入或重算数字（never convert, round or calculate）。不得输出内部字段、ID、文件名、路径、评分、模型或 AI 措辞。参考资料只列刊物或产品标题。
禁止没有具体主体和对象的“可能产生影响”“值得关注”“尚待观察”及通用航运、保险、绕行套话。只写 primary_event；无关事实省略，证据不足时改写成较短原文精读，不得填充。"""
ROLE_MARKER_PATTERN = re.compile(
    r"(?m)^\s*\[(?:source_fact|source_view|translated_excerpt|background_context|editorial_inference)\]\s*"
)

MONTH_NUMBERS = {
    name: str(index) for index, name in enumerate(
        ("january", "february", "march", "april", "may", "june", "july", "august",
         "september", "october", "november", "december"), start=1
    )
}

CHINESE_DURATION_PATTERN = re.compile(r"[一二三四五六七八九十百]+年")


def normalize_article_markdown(markdown: str, title: str) -> str:
    lines=markdown.strip().splitlines()
    normalized=[]
    for line in lines:
        match=re.match(r"^#{1,6}\s+(.+?)\s*$",line)
        heading = ARTICLE_SECTION_ALIASES.get(match.group(1).strip(), match.group(1).strip()) if match else ""
        if match and heading in {
            *ARTICLE_SECTION_HEADINGS,
            *FACTUAL_BRIEF_HEADINGS,
            *FAITHFUL_TRANSLATION_HEADINGS,
            *EVENT_BRIEF_HEADINGS,
            *MARKET_ANALYSIS_HEADINGS,
        }:
            normalized.append(f"## {heading}")
        else:
            normalized.append(line)
    title_line=f"# {title.strip()}"
    if not normalized or normalized[0].strip() != title_line:
        normalized=[title_line,"",*normalized]
    return "\n".join(normalized).strip()+"\n"


def select_source_excerpts(
    facts: list[Any], source_mapping: dict[str, str], limit: int = 6,
    preferred_fact_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    priority = {
        "geopolitical_event": 0, "sanction": 0, "refinery_outage": 1, "supply": 2,
        "demand": 2, "inventory": 3, "trade_flow": 3, "tender": 4,
        "price_change": 5, "price": 6, "source_commentary": 7,
    }
    preferred_order = {fact_id: index for index, fact_id in enumerate(preferred_fact_ids or [])}
    ranked = sorted(
        facts,
        key=lambda fact: (
            0 if getattr(fact, "fact_id", "") in preferred_order else 1,
            preferred_order.get(getattr(fact, "fact_id", ""), len(preferred_order)),
            priority.get(
                getattr(getattr(fact, "fact_type", "source_commentary"), "value", str(getattr(fact, "fact_type", "source_commentary"))),
                8,
            ),
            -float(getattr(fact, "confidence", 0)),
        ),
    )
    excerpts: list[dict[str, str]] = []
    seen: set[str] = set()
    for fact in ranked:
        excerpt = clean_reader_excerpt_text(fact.evidence_text)
        normalized = re.sub(r"[^0-9a-z]+", "", excerpt.casefold())
        if not excerpt or normalized in seen:
            continue
        seen.add(normalized)
        excerpts.append({
            "excerpt_id": fact_excerpt_id(
                str(getattr(fact, "source_id", "")), excerpt,
            ),
            "source_title": source_mapping.get(getattr(fact, "source_id", ""), "Market publication"),
            "source_fact_ids": [str(getattr(fact, "fact_id", ""))],
            "original_excerpt": excerpt,
            "translated_excerpt": "",
            "translation_review_status": "pending",
            "translation_requirement": "faithful_translation_no_summary_or_commentary",
        })
        if len(excerpts) >= limit:
            break
    return excerpts


def select_contextual_source_excerpts(
    facts: list[Any], source_mapping: dict[str, str], limit: int = 6,
) -> list[dict[str, Any]]:
    """Build narrow, fact-centred paragraph excerpts without exposing whole newspaper pages."""
    topic_text = " ".join(
        f"{getattr(fact, 'statement', '')} {getattr(fact, 'evidence_text', '')}"
        for fact in facts
    )
    topic_casefold = topic_text.casefold()
    generic_anchors = {
        "after", "before", "company", "during", "highest", "market", "million",
        "production", "reported", "their", "which", "while", "would",
    }
    anchors = {
        token.casefold()
        for token in re.findall(r"\b[A-Z][A-Za-z]{2,}\b", topic_text)
        if token.casefold() not in generic_anchors
    }
    competitor_pattern = re.compile(r"\b(?:BP|Chevron|Ford)\b", re.IGNORECASE)

    def clean_pdf_text(value: Any) -> str:
        text = str(value or "")
        text = re.sub(r"[\ue000-\uf8ff]", " ", text)
        text = re.sub(r"\bPlease\s*turn\s*to\s*page\s*[A-Z]?\d+\b", " ", text, flags=re.IGNORECASE)
        text = re.sub(r"(?<=[A-Za-z])-\s+(?=[a-z])", "", text)
        text = re.sub(r"(?:^|(?<=[.!?]))\s*[A-Z]\d{1,3}\s+(?=[A-Z\u201c\u2018])", " ", text)
        return re.sub(r"\s+", " ", text).strip()

    def terms(value: Any) -> set[str]:
        return {
            token for token in re.findall(r"[a-z][a-z0-9]{3,}", clean_pdf_text(value).casefold())
            if token not in generic_anchors
        }

    selected: list[dict[str, Any]] = []
    seen: dict[str, int] = {}
    for fact in facts:
        evidence = clean_pdf_text(getattr(fact, "evidence_text", ""))
        section_text = clean_pdf_text(getattr(fact, "article_section_text", ""))
        if not evidence:
            continue
        sentences = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z\u201c\u2018])", section_text)
            if sentence.strip()
        ]
        evidence_terms = terms(evidence)
        evidence_folded = evidence.casefold()
        best_index = -1
        best_score = -1
        for index, sentence in enumerate(sentences):
            sentence_folded = sentence.casefold()
            overlap = len(terms(sentence) & evidence_terms)
            score = overlap + (100 if evidence_folded in sentence_folded else 0)
            if score > best_score:
                best_index, best_score = index, score
        context = evidence
        if best_index >= 0 and best_score >= 2:
            indexes = [best_index]
            for adjacent in (best_index - 1, best_index + 1):
                if adjacent < 0 or adjacent >= len(sentences):
                    continue
                sentence = sentences[adjacent]
                foreign_entities = [
                    match.group(0) for match in competitor_pattern.finditer(sentence)
                    if match.group(0).casefold() not in topic_casefold
                ]
                if foreign_entities:
                    continue
                if anchors & terms(sentence):
                    indexes.append(adjacent)
            context = " ".join(sentences[index] for index in sorted(set(indexes)))
        if len(context) > 1200:
            context = context[:1200].rsplit(" ", 1)[0].rstrip(" ,;:") + "."
        context = clean_reader_excerpt_text(context)
        if not context:
            continue
        normalized = re.sub(r"[^0-9a-z]+", "", context.casefold())
        fact_id = str(getattr(fact, "fact_id", ""))
        overlap_index = next((
            index for existing_text, index in seen.items()
            if normalized in existing_text or existing_text in normalized
        ), None)
        if overlap_index is not None:
            existing = selected[overlap_index]
            existing["source_fact_ids"] = list(dict.fromkeys([
                *existing["source_fact_ids"], fact_id,
            ]))
            if len(context) > len(str(existing["original_excerpt"])):
                old_normalized = re.sub(
                    r"[^0-9a-z]+", "", str(existing["original_excerpt"]).casefold()
                )
                seen.pop(old_normalized, None)
                existing["original_excerpt"] = context
                existing["excerpt_id"] = fact_excerpt_id(
                    str(getattr(fact, "source_id", "")), context,
                )
                seen[normalized] = overlap_index
            continue
        seen[normalized] = len(selected)
        source_id = str(getattr(fact, "source_id", ""))
        selected.append({
            "excerpt_id": fact_excerpt_id(source_id, context),
            "source_title": source_mapping.get(source_id, "Market publication"),
            "source_fact_ids": [fact_id],
            "original_excerpt": context,
            "translated_excerpt": "",
            "translation_review_status": "pending",
            "translation_requirement": "paragraph_faithful_translation_with_style_preservation",
        })
        if len(selected) >= limit:
            break
    return selected


def representative_fact_ids(signal_ref: Any, facts: list[Any], limit: int) -> set[str]:
    supported=set(signal_ref.supporting_fact_ids)
    candidates=[fact for fact in facts if fact.fact_id in supported]
    summary=re.sub(r"\s+"," ",signal_ref.summary).casefold()
    summary_terms={term for term in re.findall(r"[a-z0-9]{4,}",summary)}
    def rank(fact: Any) -> tuple[int,int,float,str]:
        statement=re.sub(r"\s+"," ",str(fact.statement)).casefold()
        terms={term for term in re.findall(r"[a-z0-9]{4,}",statement)}
        direct=0 if statement and statement in summary else 1
        return direct,-len(summary_terms & terms),-float(getattr(fact,"confidence",0)),fact.fact_id
    return {fact.fact_id for fact in sorted(candidates,key=rank)[:limit]}


def _signal_fact_ids(signal: Any) -> set[str]:
    return {
        str(fact_id)
        for fact_id in [
            *(getattr(signal,"supporting_fact_ids",[]) or []),
            *(getattr(signal,"counter_fact_ids",[]) or []),
        ]
        if fact_id
    }


def _topic_signal_ref(signal: Any, allowed_ids: set[str]) -> EditorialSignalRef:
    return EditorialSignalRef(
        signal_id=signal.signal_id,
        signal_type=signal.signal_type,
        direction=signal.direction,
        confidence=signal.confidence,
        score=signal.score,
        summary=signal.summary,
        supporting_fact_ids=[
            fact_id for fact_id in (signal.supporting_fact_ids or []) if fact_id in allowed_ids
        ],
    )


def _metric_label(metric: Any) -> str:
    parts=[
        str(getattr(metric,"benchmark","") or "").strip(),
        str(getattr(metric,"metric_type","") or "").strip(),
    ]
    return " ".join(part for part in parts if part)


def build_topic_editorial_view(
    view: Any, topic: Any, facts: list[Any], signals: list[Any], metrics: list[Any],
) -> EditorialView:
    allowed_ids=set(topic.fact_ids)
    topic_signal_ids=set(topic.signal_ids)
    selected_signals=[
        signal for signal in signals
        if signal.signal_id in topic_signal_ids
        and _signal_fact_ids(signal)
        and _signal_fact_ids(signal).issubset(allowed_ids)
    ]
    selected_signals.sort(key=lambda signal:(-int(signal.score),str(signal.signal_id)))
    top=selected_signals[0] if selected_signals else None
    secondary=selected_signals[1:]
    counter=[]
    if top:
        counter=[
            signal for signal in secondary
            if getattr(signal.direction,"value",signal.direction) in {"bullish","bearish"}
            and getattr(top.direction,"value",top.direction) in {"bullish","bearish"}
            and signal.direction != top.direction
        ]
    invalidation_conditions=list(dict.fromkeys(
        str(signal.summary).strip() for signal in counter if str(signal.summary).strip()
    ))
    validation_metrics=[]
    for metric in metrics:
        source_ids=set(getattr(metric,"source_fact_ids",[]) or [])
        raw_status=getattr(metric,"status",None)
        if raw_status is None:
            raw_status=getattr(metric,"metric_status","")
        status=str(getattr(raw_status,"value",raw_status) or "")
        label=_metric_label(metric)
        if source_ids and source_ids.issubset(allowed_ids) and status in {"","computed"} and label:
            validation_metrics.append(label)
    validation_metrics=list(dict.fromkeys(validation_metrics))[:5]
    uncertainties=list(dict.fromkeys(
        str(getattr(fact,"uncertainty","") or "").strip()
        for fact in facts
        if getattr(fact,"fact_id",None) in allowed_ids and str(getattr(fact,"uncertainty","") or "").strip()
    ))
    if top and not counter:
        uncertainties.append("No topic-local counter-signal is available.")
    topic_mode = getattr(topic, "article_mode", ArticleMode.MARKET_VIEW)
    if not isinstance(topic_mode, ArticleMode):
        topic_mode = ArticleMode(str(topic_mode))
    if (
        top is None
        and topic_mode in {ArticleMode.MARKET_VIEW, ArticleMode.MARKET_ANALYSIS}
    ):
        topic_mode = ArticleMode.EVENT_BRIEF
    is_factual = topic_mode in {
        ArticleMode.FACTUAL_BRIEF, ArticleMode.EVENT_BRIEF, ArticleMode.FAITHFUL_TRANSLATION,
    }
    return EditorialView(
        view_id=f"{view.view_id}:{topic.slug}",
        market_date=view.market_date,
        main_thesis=str(getattr(top,"summary",topic.title_hint)).strip(),
        top_signal=_topic_signal_ref(top,allowed_ids) if top else None,
        secondary_signals=[_topic_signal_ref(signal,allowed_ids) for signal in secondary],
        counter_signals=[_topic_signal_ref(signal,allowed_ids) for signal in counter],
        view_change_type=view.view_change_type,
        comparison_with_previous_day="主题独立成稿，不继承其他主题的日间比较。",
        time_horizon=view.time_horizon,
        supporting_fact_ids=list(topic.fact_ids),
        invalidation_conditions=invalidation_conditions,
        validation_metrics=validation_metrics,
        uncertainties=uncertainties,
        publishable=bool((view.publishable and top) or is_factual),
        evidence_ready=bool(topic.fact_ids),
        editorially_publishable=bool((view.publishable and top) or is_factual),
        directional_signal_available=bool(top),
        article_mode=topic_mode,
        publication_angle=topic.title_hint,
        evidence_strength=min(1.0, len(topic.fact_ids) / 10),
        source_diversity=len({
            str(getattr(fact, "source_id", "")) for fact in facts
            if getattr(fact, "fact_id", None) in allowed_ids and getattr(fact, "source_id", None)
        }),
        translation_candidates=list(
            getattr(getattr(topic, "evidence_bundle", None), "excerpt_fact_ids", []) or []
        ),
        reader_value=int(
            getattr(getattr(topic, "evidence_bundle", None), "reader_value_score", 0) or 0
        ),
        audit_issues=[],
    )


def build_writer_payload(
    view: Any, facts: list[Any], signals: list[Any], metrics: list[Any],
    source_mapping: dict[str, str], *, topic: Any | None = None,
    topic_view: EditorialView | None = None,
) -> dict[str, Any]:
    if topic is None:
        signal_refs=[ref for ref in [view.top_signal,*view.counter_signals] if ref]
        referenced_signal_ids={ref.signal_id for ref in signal_refs}
        allowed_ids=set()
        if view.top_signal:
            allowed_ids.update(representative_fact_ids(view.top_signal,facts,6))
        for ref in view.counter_signals:
            allowed_ids.update(representative_fact_ids(ref,facts,3))
    else:
        topic_view=topic_view or build_topic_editorial_view(view,topic,facts,signals,metrics)
        view=topic_view
        allowed_ids=set(topic.fact_ids)
        referenced_signal_ids={
            ref.signal_id
            for ref in [view.top_signal,*view.secondary_signals,*view.counter_signals]
            if ref
        }
    selected_facts = [fact for fact in facts if fact.fact_id in allowed_ids]
    if topic is not None:
        fact_priority = {
            "geopolitical_event": 0, "sanction": 0, "refinery_outage": 1, "supply": 2,
            "demand": 2, "inventory": 3, "trade_flow": 3, "tender": 4,
            "price_change": 5, "price": 6, "source_commentary": 7,
        }
        selected_facts = sorted(
            selected_facts,
            key=lambda fact: (
                fact_priority.get(
                    getattr(getattr(fact, "fact_type", "source_commentary"), "value", str(getattr(fact, "fact_type", "source_commentary"))),
                    8,
                ),
                -float(getattr(fact, "confidence", 0)),
                str(getattr(fact, "fact_id", "")),
            ),
        )[:MAX_TOPIC_WRITER_FACTS]
    selected_signals = [signal for signal in signals if signal.signal_id in referenced_signal_ids]
    if topic is not None:
        signal_order={signal_id:index for index,signal_id in enumerate(topic.signal_ids)}
        selected_signals.sort(key=lambda signal:signal_order.get(signal.signal_id,len(signal_order)))
    selected_metrics=[]
    for metric in metrics:
        source_ids=set(getattr(metric,"source_fact_ids",[]) or [])
        if source_ids and source_ids.issubset(allowed_ids):
            selected_metrics.append(metric)
        if len(selected_metrics) >= 10:
            break
    preferred_excerpt_ids = list(
        getattr(getattr(topic, "evidence_bundle", None), "excerpt_fact_ids", []) or []
    ) if topic is not None else []
    source_excerpts = select_source_excerpts(
        selected_facts, source_mapping, limit=min(6, len(selected_facts)),
        preferred_fact_ids=preferred_excerpt_ids,
    )
    contextual_excerpts = select_contextual_source_excerpts(
        selected_facts, source_mapping, limit=min(6, len(selected_facts)),
    )
    if len(contextual_excerpts) >= 3:
        source_excerpts = contextual_excerpts
    editorial_view = view.model_dump(mode="json")
    selected_source_ids={str(getattr(fact,"source_id","")) for fact in selected_facts}
    scoped_mapping={key:value for key,value in source_mapping.items() if key in selected_source_ids}
    serialized_signals=[]
    for signal in selected_signals:
        serialized=signal.model_dump(mode="json") if hasattr(signal,"model_dump") else dict(vars(signal))
        if topic is not None:
            for field_name in ("supporting_fact_ids","counter_fact_ids"):
                serialized[field_name]=[
                    fact_id for fact_id in serialized.get(field_name,[]) if fact_id in allowed_ids
                ]
        serialized_signals.append(serialized)
    serialized_facts=[]
    for fact in selected_facts:
        serialized=fact.model_dump(mode="json") if hasattr(fact, "model_dump") else dict(vars(fact))
        serialized["source_title"]=source_mapping.get(
            str(getattr(fact, "source_id", "")), "Market publication",
        )
        serialized_facts.append(serialized)
    payload = {
        "editorial_view": editorial_view,
        "verified_facts": serialized_facts,
        "verified_signals": serialized_signals,
        "metrics": [metric.model_dump(mode="json") if hasattr(metric, "model_dump") else vars(metric) for metric in selected_metrics],
        "source_mapping": scoped_mapping if topic is not None else source_mapping,
        "source_excerpts": source_excerpts,
        "source_dossiers": [],
    }
    if topic is not None:
        payload["article_topic"] = topic.model_dump(mode="json") if hasattr(topic,"model_dump") else vars(topic)
        payload["article_mode"] = getattr(
            getattr(topic, "article_mode", "market_view"), "value",
            getattr(topic, "article_mode", "market_view"),
        )
        article_section_ids = list(dict.fromkeys(
            str(getattr(fact, "article_section_id", "") or "")
            for fact in selected_facts
            if str(getattr(fact, "article_section_id", "") or "")
        ))
        article_contexts = [
            str(item.get("original_excerpt") or "").strip()
            for item in source_excerpts if str(item.get("original_excerpt") or "").strip()
        ]
        payload["primary_event"] = {
            "headline_subject": str(getattr(topic, "title_hint", "") or ""),
            "fact_ids": [str(getattr(fact, "fact_id", "")) for fact in selected_facts],
            "article_section_ids": article_section_ids,
            "context_excerpt": "\n".join(article_contexts)[:3000],
        }
        payload["evidence_policy"] = {
            "single_event_required": True,
            "cross_event_linking_allowed": False,
            "allowed_inferences": [],
            "omit_unrelated_allowed_facts": True,
        }
    return payload


def reader_safe_writer_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Remove internal workflow fields before sending evidence to the article writer."""
    facts = []
    for fact in payload.get("verified_facts", []):
        facts.append({
            "fact_type": fact.get("fact_type"),
            "statement": fact.get("statement"),
            "evidence_text": fact.get("evidence_text"),
            "market_date": fact.get("market_date"),
            "commodity": fact.get("commodity"),
            "region": fact.get("region"),
            "source_title": fact.get("source_title"),
        })
    view = payload.get("editorial_view", {})
    topic = payload.get("article_topic", {})
    article_mode = str(payload.get("article_mode") or view.get("article_mode") or "market_view")
    original_excerpt_limit = 2400 if article_mode == ArticleMode.FAITHFUL_TRANSLATION.value else 900
    return {
        "article_mode": article_mode,
        "publication_voice": {
            "body": "Chinese energy newsroom report",
            "lead": "news peg and 5W1H first",
            "organization": "news value, confirmed facts, context, attributed views, market relevance",
            "translated_excerpts": "rendered separately after the newsroom body",
            "forbidden": "line-by-line translation or translation-guide narration",
        },
        "article_topic": {
            "title_hint": topic.get("title_hint"),
            "rationale": topic.get("rationale"),
        },
        "primary_event": {
            "headline_subject": (payload.get("primary_event") or {}).get("headline_subject"),
            "article_section_count": len(
                (payload.get("primary_event") or {}).get("article_section_ids", [])
            ),
            "context_excerpt": (payload.get("primary_event") or {}).get("context_excerpt", ""),
        },
        "evidence_policy": payload.get("evidence_policy", {
            "single_event_required": True,
            "cross_event_linking_allowed": False,
            "allowed_inferences": [],
            "omit_unrelated_allowed_facts": True,
        }),
        "editorial_view": {
            "time_horizon": view.get("time_horizon"),
            "uncertainties": view.get("uncertainties", []),
            "publication_angle": view.get("publication_angle"),
        },
        "verified_facts": facts,
        "source_excerpts": [
            {
                "excerpt_id": item.get("excerpt_id"),
                "source_title": _limited_text(item.get("source_title"), 240),
                "paragraph_role": item.get("paragraph_role"),
                "original_excerpt": _limited_text(item.get("original_excerpt"), original_excerpt_limit),
                "previous_context": _limited_text(item.get("previous_context"), 400),
                "next_context": _limited_text(item.get("next_context"), 400),
                "preserved_devices": list(item.get("preserved_devices", []))[:8],
                "translation_requirement": _limited_text(item.get("translation_requirement"), 300),
            }
            for item in payload.get("source_excerpts", [])[:8]
        ],
        "source_dossiers": [
            {
                "source_title": _limited_text(item.get("source_title"), 240),
                "source_genre": item.get("source_genre"),
                "central_question": _limited_text(item.get("central_question"), 600),
                "main_thesis": _limited_text(item.get("main_thesis"), 1200),
                "tone": _limited_text(item.get("tone"), 240),
                "argument_pattern": _compact_writer_value(item.get("argument_pattern", []), 8),
                "rhetorical_devices": _compact_writer_value(item.get("rhetorical_devices", []), 8),
                "uncertainty_language": _compact_writer_value(item.get("uncertainty_language", []), 8),
                "source_argument_map": _compact_writer_value(item.get("source_argument_map", []), 8),
                "translation_notes": _compact_writer_value(item.get("translation_notes", []), 8),
                "section_structure": _compact_writer_value(item.get("section_structure", []), 10),
                "key_events": _compact_writer_value(item.get("key_events", []), 8),
                "source_conclusions": _compact_writer_value(item.get("source_conclusions", []), 6),
                "qualifications": _compact_writer_value(item.get("qualifications", []), 8),
            }
            for item in payload.get("source_dossiers", [])[:3]
        ],
        "story_brief": payload.get("story_brief", {}),
        "claim_ledger": [
            {
                "claim_type": item.get("claim_type"),
                "claim_text": item.get("claim_text"),
                "source_attribution": item.get("source_attribution"),
                "publishable": item.get("publishable"),
            }
            for item in payload.get("claim_ledger", [])
        ],
        "external_confirmations": [
            {
                "source_title": item.get("source_title"),
                "source_publisher": item.get("source_publisher"),
                "source_tier": item.get("source_tier"),
                "claim_text": item.get("claim_text"),
                "evidence_text": item.get("evidence_text"),
                "event_date": item.get("event_date"),
            }
            for item in payload.get("external_confirmations", [])
        ],
    }


def _limited_text(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _compact_writer_value(value: Any, max_items: int, *, depth: int = 0) -> Any:
    if depth >= 2:
        return _limited_text(value, 500)
    if isinstance(value, list):
        return [
            _compact_writer_value(item, max_items, depth=depth + 1)
            for item in value[:max_items]
        ]
    if isinstance(value, dict):
        return {
            str(key): _compact_writer_value(item, max_items, depth=depth + 1)
            for key, item in list(value.items())[:12]
        }
    if isinstance(value, str):
        return _limited_text(value, 500)
    return value


def call_dify_writer(base_url: str, api_key: str, market_date: date, payload: dict[str, Any]) -> dict[str, Any]:
    article_mode = str(
        payload.get("article_mode") or payload.get("editorial_view", {}).get("article_mode")
        or ArticleMode.EVENT_BRIEF.value
    )
    article_mode = {
        "market_view": ArticleMode.MARKET_ANALYSIS.value,
        "factual_brief": ArticleMode.EVENT_BRIEF.value,
    }.get(article_mode, article_mode)
    safe_payload = reader_safe_writer_payload(payload)
    evidence_payload = json.dumps(safe_payload, ensure_ascii=False, default=str)
    if len(evidence_payload) > MAX_WRITER_EVIDENCE_PAYLOAD_CHARACTERS:
        raise ValueError(
            "Dify writer evidence payload exceeds local budget: "
            f"{len(evidence_payload)}>{MAX_WRITER_EVIDENCE_PAYLOAD_CHARACTERS} characters"
        )
    response = httpx.post(
        f"{base_url.rstrip('/')}/v1/workflows/run",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "inputs": {
                "article_mode": article_mode,
                "date": market_date.isoformat(),
                "evidence_payload": evidence_payload,
                "article_contract": WRITER_TASK,
            },
            "response_mode": "blocking", "user": "market-article-worker",
        }, timeout=300,
    )
    if getattr(response, "is_error", False):
        raise RuntimeError(
            f"Dify writer HTTP {response.status_code}: {response.text[:500]} "
            f"(evidence_payload_characters={len(evidence_payload)})"
        )
    response.raise_for_status()
    outputs = response.json().get("data", {}).get("outputs", {})
    for value in outputs.values():
        if isinstance(value, dict) and "report_markdown" in value:
            return value
        if isinstance(value, str):
            cleaned = THINK_PATTERN.sub("", value).strip().strip("`")
            try:
                decoded = json.loads(cleaned.removeprefix("json").strip())
            except json.JSONDecodeError:
                continue
            if isinstance(decoded, dict) and "report_markdown" in decoded:
                return decoded
    if outputs.get("report_markdown"):
        return outputs
    raise ValueError(
        "Dify writer output missing report_markdown: "
        + json.dumps(outputs,ensure_ascii=False,default=str)[:2400]
    )


def audit_article(
    markdown: str, view: Any, allowed_facts: list[Any], source_excerpts: list[dict[str, str]] | None = None,
) -> list[str]:
    issues: list[str] = []
    if THINK_PATTERN.search(markdown):
        issues.append("article contains think tags")
    if any(term.casefold() in markdown.casefold() for term in FORBIDDEN_STYLE):
        issues.append("article contains AI-related wording")
    if FILENAME_PATTERN.search(markdown):
        issues.append("article leaks attachment filenames")
    if TRACE_ID_PATTERN.search(markdown):
        issues.append("article leaks internal trace IDs")
    leaked_terms = sorted(set(INTERNAL_READER_TERM_PATTERN.findall(markdown)))
    if leaked_terms:
        issues.append(f"article leaks internal processing terms or metric codes: {leaked_terms}")
    if any(term in markdown for term in SEMANTIC_CONTRADICTIONS):
        issues.append("article incorrectly classifies gasoline as a distillate")
    leaked_phrases = [phrase for phrase in MECHANICAL_READER_PHRASES if phrase.casefold() in markdown.casefold()]
    if leaked_phrases:
        issues.append(f"article contains mechanical workflow wording: {leaked_phrases}")
    translation_headings = [
        heading
        for heading in TRANSLATION_SECTION_NAMES
        if re.search(rf"(?m)^#{{2,6}}\s+{re.escape(heading)}\s*$", markdown)
    ]
    if len(translation_headings) > 1:
        issues.append(
            f"article contains duplicate translation sections: {translation_headings}"
        )
    reader_title = next(
        (line[2:].strip() for line in markdown.splitlines() if line.startswith("# ")),
        "",
    )
    title_without_date = re.sub(r"[｜|·\-]?\s*20\d{2}-\d{2}-\d{2}\s*$", "", reader_title).strip()
    if (
        title_without_date
        and re.search(r"[·｜|]", title_without_date)
        and len(re.findall(r"[\u3400-\u9fff]", title_without_date)) < 4
    ):
        issues.append("article title must be a natural Chinese reader-facing title")
    title_focus = {
        group
        for group, markers in COMMODITY_FOCUS_PATTERNS.items()
        if any(marker.casefold() in reader_title.casefold() for marker in markers)
    }
    broad_market_title = any(
        marker.casefold() in reader_title.casefold()
        for marker in BROAD_MARKET_TITLE_MARKERS
    )
    if len(title_focus) == 1 and not broad_market_title:
        focused_group = next(iter(title_focus))
        fact_groups: list[str] = []
        for fact in allowed_facts:
            fact_text = " ".join([
                str(getattr(fact, "commodity", "") or ""),
                str(getattr(fact, "statement", "") or ""),
            ]).casefold()
            matched_groups = [
                group
                for group, markers in COMMODITY_FOCUS_PATTERNS.items()
                if any(marker.casefold() in fact_text for marker in markers)
            ]
            if len(matched_groups) == 1:
                fact_groups.append(matched_groups[0])
        focused_count = fact_groups.count(focused_group)
        unrelated_count = len(fact_groups) - focused_count
        if unrelated_count >= 2 and unrelated_count >= focused_count:
            issues.append(
                f"article title focuses on {focused_group} but evidence bundle is dominated "
                f"by unrelated commodities ({focused_count}/{len(fact_groups)})"
            )
    excerpts = source_excerpts or []
    normalized_excerpts = [
        (
            re.sub(r"\s+", " ", str(item.get("original_excerpt", ""))).strip(),
            str(item.get("source_title", "")).strip(),
        )
        for item in excerpts
    ]
    main_body = re.split(
        r"(?m)^#{2,6}\s+(?:原文摘选|忠实摘译|原文摘译|原文延读)\s*$",
        markdown,
        maxsplit=1,
    )[0]
    normalized_main_body = re.sub(r"\s+", " ", main_body).strip()
    repeated_translation = next((
        translated
        for item in excerpts
        if len((translated := re.sub(
            r"\s+", " ", str(item.get("translated_excerpt", ""))
        ).strip())) >= 30
        and translated in normalized_main_body
    ), "")
    if repeated_translation:
        issues.append("article newsroom body repeats a complete translated excerpt")
    for match in re.finditer(r"“([^”\n]{12,})”", markdown):
        quoted = re.sub(r"\s+", " ", match.group(1)).strip(" ….")
        if not re.search(r"[A-Za-z]", quoted):
            continue
        matching_titles = [
            source_title for excerpt, source_title in normalized_excerpts
            if quoted and quoted in excerpt
        ]
        if not matching_titles:
            issues.append("article quotes material outside supplied source excerpts")
            break
        line_start = markdown.rfind("\n", 0, match.start()) + 1
        line_end = markdown.find("\n", match.end())
        line_end = len(markdown) if line_end < 0 else line_end
        quote_line = markdown[line_start:line_end]
        if not any(source_title_matches_line(title, quote_line) for title in matching_titles):
            issues.append("article quote source title does not match supplied excerpt")
            break
    article_mode = getattr(getattr(view, "article_mode", None), "value", getattr(view, "article_mode", ""))
    article_mode = {
        ArticleMode.MARKET_VIEW.value: ArticleMode.MARKET_ANALYSIS.value,
        ArticleMode.FACTUAL_BRIEF.value: ArticleMode.EVENT_BRIEF.value,
    }.get(article_mode, article_mode)
    if not re.search(r"(?m)^#{2,6}\s+(?:参考资料|资料)\s*$", markdown):
        issues.append("article is missing its source-title reference section")
    market_date = getattr(view, "market_date", None)
    market_date_text = market_date.isoformat() if hasattr(market_date, "isoformat") else str(market_date or "")
    allowed_text = "\n".join(
        f"{fact.statement}\n{fact.evidence_text}\n{fact.market_date}" for fact in allowed_facts
    ) + "\n" + market_date_text
    allowed_text += "\n" + "\n".join(
        f"{item.get('original_excerpt', '')}\n{item.get('translated_excerpt', '')}"
        for item in excerpts
    )
    if "refining country" in allowed_text.casefold() and "炼油国" in markdown:
        issues.append("article mistranslates refining country as 炼油国; use 精炼国")
    evidence_segments = [
        text for fact in allowed_facts
        for text in (str(fact.statement), str(fact.evidence_text))
    ] + [
        text for item in excerpts
        for text in (str(item.get("original_excerpt", "")), str(item.get("translated_excerpt", "")))
    ]
    issues.extend(quantitative_qualifier_issues(markdown, evidence_segments))
    allowed_numbers = numeric_values(allowed_text)
    allowed_numbers.update({
        str(view.market_date.year), str(view.market_date.month), str(view.market_date.day)
    })
    allowed_casefold = allowed_text.casefold()
    allowed_numbers.update(number for name, number in MONTH_NUMBERS.items() if name in allowed_casefold)
    without_trace_ids = TRACE_ID_PATTERN.sub("", markdown)
    without_excerpt_labels = re.sub(r"原文\s*\d+", "原文", without_trace_ids)
    without_list_numbers = re.sub(r"(?m)^\s*\d+[.)、]\s*", "", without_excerpt_labels)
    title_line = next((line for line in markdown.splitlines() if line.startswith("# ")), "")
    unsupported_durations = sorted({
        duration for duration in CHINESE_DURATION_PATTERN.findall(title_line)
        if duration not in allowed_text
    })
    if unsupported_durations:
        issues.append(f"article title contains unsupported duration: {unsupported_durations}")
    unsupported = sorted(numeric_values(without_list_numbers) - allowed_numbers)
    if unsupported:
        issues.append(f"article contains unsupported numbers: {unsupported}")
    return issues


def sanitize_article_markdown(
    markdown: str, view: Any, allowed_facts: list[Any], source_excerpts: list[dict[str, str]] | None = None,
) -> tuple[str, list[str]]:
    """Drop whole reader-facing lines that cannot be proven from this article's evidence set."""
    market_date = getattr(view, "market_date", None)
    market_date_text = market_date.isoformat() if hasattr(market_date, "isoformat") else str(market_date or "")
    allowed_text = "\n".join(
        f"{getattr(fact, 'statement', '')}\n{getattr(fact, 'evidence_text', '')}\n{getattr(fact, 'market_date', '')}"
        for fact in allowed_facts
    ) + "\n" + market_date_text
    allowed_text += "\n" + "\n".join(
        f"{item.get('original_excerpt', '')}\n{item.get('translated_excerpt', '')}"
        for item in (source_excerpts or [])
    )

    allowed_numbers = numeric_values(allowed_text)
    if market_date:
        allowed_numbers.update({str(market_date.year), str(market_date.month), str(market_date.day)})
    allowed_casefold = allowed_text.casefold()
    allowed_numbers.update(number for name, number in MONTH_NUMBERS.items() if name in allowed_casefold)
    excerpt_pairs = [
        (re.sub(r"\s+", " ", str(item.get("original_excerpt", ""))).strip(), str(item.get("source_title", "")).strip())
        for item in (source_excerpts or [])
    ]
    evidence_segments = [
        text for fact in allowed_facts
        for text in (str(getattr(fact, "statement", "")), str(getattr(fact, "evidence_text", "")))
    ] + [
        text for item in (source_excerpts or [])
        for text in (str(item.get("original_excerpt", "")), str(item.get("translated_excerpt", "")))
    ]
    normalize_refining_country = "refining country" in allowed_text.casefold()
    kept: list[str] = []
    removed: list[str] = []
    for line in markdown.splitlines():
        original_line = line
        if normalize_refining_country and "炼油国" in line:
            line = line.replace("炼油国", "精炼国")
        if quantitative_qualifier_issues(line, evidence_segments):
            removed.append(original_line.strip())
            continue
        if TRACE_ID_PATTERN.search(line):
            removed.append(original_line.strip())
            continue
        if any(phrase.casefold() in line.casefold() for phrase in MECHANICAL_READER_PHRASES):
            removed.append(line.strip())
            continue
        if any(phrase in line for phrase in VAGUE_FILLER_PHRASES):
            sentence_parts = re.split(r"(?<=[。！？；.!?])", line)
            retained_parts = [
                part for part in sentence_parts
                if not any(phrase in part for phrase in VAGUE_FILLER_PHRASES)
            ]
            removed.extend(
                part.strip() for part in sentence_parts
                if part not in retained_parts and part.strip()
            )
            line = "".join(retained_parts).strip()
            if not line:
                continue
        if line.lstrip().startswith("#"):
            kept.append(line)
            continue
        unsupported = sorted(
            numeric_values(TRACE_ID_PATTERN.sub("", line)) - allowed_numbers
        )
        invalid_quote = False
        for match in re.finditer(r"“([^”\n]{12,})”", line):
            quoted = re.sub(r"\s+", " ", match.group(1)).strip(" ….")
            if not re.search(r"[A-Za-z]", quoted):
                continue
            matching_titles = [title for excerpt, title in excerpt_pairs if quoted in excerpt]
            if not matching_titles or not any(
                source_title_matches_line(title, line) for title in matching_titles
            ):
                invalid_quote = True
                break
        if unsupported or invalid_quote:
            removed.append(line.strip())
            continue
        kept.append(line)
    _recognized_section_headings: set[str] = set()
    _recognized_section_headings.update(ARTICLE_SECTION_HEADINGS)
    _recognized_section_headings.update(FACTUAL_BRIEF_HEADINGS)
    _recognized_section_headings.update(FAITHFUL_TRANSLATION_HEADINGS)
    _recognized_section_headings.update(EVENT_BRIEF_HEADINGS)
    _recognized_section_headings.update(MARKET_ANALYSIS_HEADINGS)
    _recognized_section_headings.update(ARTICLE_SECTION_ALIASES.keys())
    compacted: list[str] = []
    for index, line in enumerate(kept):
        if line.startswith("## "):
            heading_text = line.removeprefix("## ").strip()
            following = next((item for item in kept[index + 1:] if item.strip()), "")
            if (not following or following.startswith("## ")) and heading_text not in _recognized_section_headings:
                removed.append(line.strip())
                continue
        compacted.append(line)
    cleaned = ROLE_MARKER_PATTERN.sub("", "\n".join(compacted))
    return cleaned.strip() + "\n", removed



def delete_review_blocked_sentences(
    markdown: str, review: dict[str, Any],
) -> tuple[str, list[str]]:
    """Delete the single final-Markdown sentence best identified by each blocker."""

    def compact(value: str) -> str:
        return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "", value).casefold()

    def bigrams(value: str) -> set[str]:
        normalized = compact(value)
        return {normalized[index:index + 2] for index in range(max(0, len(normalized) - 1))}

    lines = markdown.splitlines()
    sentence_parts = [re.split(r"(?<=[。！？；.!?])", line) for line in lines]
    removed_positions: set[tuple[int, int]] = set()
    removed: list[str] = []
    deletion_terms = (
        "fabricated", "untraceable", "unsupported_conclusion",
        "material_mistranslation", "mistranslation",
        "topic_mixing", "unrelated_event", "cross_topic",
        "虚构", "无证据", "未经证实", "误译", "不可追溯",
        "与证据冲突", "与事实冲突", "来源错配", "主体错误", "跨主题",
    )

    for raw_issue in review.get("blocking_issues", []) or []:
        if isinstance(raw_issue, dict):
            issue_text = json.dumps(raw_issue, ensure_ascii=False)
            issue_detail = str(raw_issue.get("detail") or raw_issue.get("message") or issue_text)
        else:
            issue_text = issue_detail = str(raw_issue)
        if not any(term in issue_text.casefold() for term in deletion_terms):
            continue
        fragments = [
            match.group(1).strip()
            for match in re.finditer(r'[“”‘’"]([^“”‘’"]{4,})[“”‘’"]', issue_detail)
        ]
        issue_bigrams = bigrams(issue_detail)
        candidates: list[tuple[int, int, int, int]] = []
        for line_index, parts in enumerate(sentence_parts):
            for part_index, part in enumerate(parts):
                if not part.strip() or (line_index, part_index) in removed_positions:
                    continue
                normalized_part = compact(part)
                matching_length = max(
                    (len(compact(fragment)) for fragment in fragments if compact(fragment) in normalized_part),
                    default=0,
                )
                if not matching_length:
                    continue
                candidates.append((
                    len(bigrams(part) & issue_bigrams), matching_length, line_index, part_index,
                ))
        if not candidates:
            continue
        _, _, line_index, part_index = max(candidates)
        removed_positions.add((line_index, part_index))
        removed.append(sentence_parts[line_index][part_index].strip())

    if not removed_positions:
        return markdown, []
    kept_lines = [
        "".join(
            part for part_index, part in enumerate(parts)
            if (line_index, part_index) not in removed_positions
        )
        for line_index, parts in enumerate(sentence_parts)
    ]
    return "\n".join(kept_lines).strip() + "\n", removed


def reader_character_count(markdown: str) -> int:
    visible = re.sub(r"(?m)^#{1,6}\s+", "", markdown)
    visible = re.sub(r"[*_`>|\-]", "", visible)
    return len(re.findall(r"[\u3400-\u9fffA-Za-z0-9]", visible))


def article_disclosure_warnings(view: Any, source_excerpts: list[dict[str, str]] | None = None) -> list[str]:
    """Return non-blocking research limitations for operator and reviewer visibility."""
    warnings: list[str] = []
    if source_excerpts:
        warnings.append("source attribution is required for material claims")
    top_signal = getattr(view, "top_signal", None)
    if top_signal and not getattr(view, "counter_signals", []):
        warnings.append("no independent topic-local counter signal; disclose the evidence gap")
    if top_signal and not getattr(view, "invalidation_conditions", []):
        warnings.append("no topic-local invalidation condition; disclose the evidence gap")
    if len(getattr(view, "validation_metrics", [])) < 3:
        warnings.append("fewer than three topic-local validation metrics; disclose the evidence gap")
    return warnings

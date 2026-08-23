"""Deterministic editorial candidates and evidence bundles for Digit articles."""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from datetime import date
from typing import Any

from .contracts import ArticleMode, EditorialCandidate, EvidenceBundle


CORE_TYPES = {
    "geopolitical_event", "sanction", "policy", "refinery_outage", "production",
}
SUPPLY_TRADE_TYPES = {
    "supply", "demand", "inventory", "refinery_run", "shipment", "arrival",
    "trade_flow", "tender", "freight", "arbitrage",
}
PRICE_TYPES = {"price", "price_change", "spread", "premium_discount"}
COMMENTARY_TYPES = {"market_sentiment", "source_commentary"}
MAJOR_EVENT_TYPES = {"geopolitical_event", "sanction", "policy", "refinery_outage"}
ENTITY_STOPWORDS = {
    "According", "After", "Before", "During", "Evidence", "Publisher", "Verified",
    "Friday", "Monday", "Saturday",
    "Sunday", "Thursday", "Tuesday", "Wednesday", "March", "April", "June",
    "July", "August", "September", "October", "November", "December",
}
CONTEXT_STOPWORDS = {
    "about", "after", "again", "against", "also", "because", "before", "being",
    "between", "business", "company", "country", "could", "during", "energy", "from",
    "have", "into", "market", "more", "oil", "other", "prices", "production",
    "reported", "said", "some", "supply", "than", "that", "their", "there",
    "these", "they", "this", "through", "under", "were", "which", "while", "with",
}


def _value(item: Any, name: str, default: Any = None) -> Any:
    if isinstance(item, dict):
        return item.get(name, default)
    return getattr(item, name, default)


def _enum_value(value: Any) -> str:
    return str(getattr(value, "value", value) or "").strip()


def _normalized(value: Any, fallback: str) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip()).casefold()
    return text or fallback


def _canonical_commodity(fact: Any) -> str:
    commodity = _normalized(_value(fact, "commodity"), "")
    text = " ".join(str(_value(fact, name, "") or "") for name in (
        "commodity", "statement", "evidence_text",
    )).casefold()
    if "fuel oil" in text:
        return "fuel oil"
    if commodity in {"oil", "crude", "crude oil"} or "crude oil" in text:
        return "oil"
    if commodity:
        return commodity
    if "oil" in text or "petroleum" in text:
        return "oil"
    return "energy market"


def _canonical_region(fact: Any) -> str:
    explicit = _value(fact, "region") or _value(fact, "country")
    if explicit:
        return _normalized(explicit, "global")
    text = " ".join(str(_value(fact, name, "") or "") for name in (
        "statement", "evidence_text",
    )).casefold()
    aliases = (
        ("china", ("china", "beijing")),
        ("middle east", ("middle east", "hormuz", "red sea", "saudi", "iran")),
        ("europe", ("europe", "france", "mediterranean")),
        ("asia", ("asia", "singapore")),
    )
    for canonical, markers in aliases:
        if any(marker in text for marker in markers):
            return canonical
    return "global"


def _fact_rank(fact: Any) -> tuple[int, float, str]:
    fact_type = _enum_value(_value(fact, "fact_type"))
    if fact_type in CORE_TYPES:
        priority = 0
    elif fact_type in SUPPLY_TRADE_TYPES:
        priority = 1
    elif fact_type in PRICE_TYPES:
        priority = 2
    else:
        priority = 3
    return priority, -float(_value(fact, "confidence", 0) or 0), str(_value(fact, "fact_id", ""))


def _entity_tokens(facts: list[Any]) -> set[str]:
    tokens: set[str] = set()
    for fact in facts:
        text = " ".join(str(_value(fact, name, "") or "") for name in ("statement", "evidence_text"))
        tokens.update(
            token.casefold()
            for token in re.findall(r"\b[A-Z][A-Za-z]{3,}\b", text)
            if token not in ENTITY_STOPWORDS
        )
    return tokens


def _significant_terms(value: Any) -> set[str]:
    return {
        term for term in re.findall(r"[a-z][a-z0-9-]{3,}", str(value or "").casefold())
        if term not in CONTEXT_STOPWORDS
    }


def _expand_major_event_context(grouped_facts: list[Any], all_facts: list[Any]) -> list[Any]:
    if not any(_enum_value(_value(fact, "fact_type")) in MAJOR_EVENT_TYPES for fact in grouped_facts):
        return grouped_facts
    source_ids = {str(_value(fact, "source_id") or "") for fact in grouped_facts}
    entity_tokens = _entity_tokens(grouped_facts)
    if not source_ids or not entity_tokens:
        return grouped_facts
    existing = {str(_value(fact, "fact_id") or "") for fact in grouped_facts}
    related = [
        fact for fact in all_facts
        if str(_value(fact, "fact_id") or "") not in existing
        and str(_value(fact, "source_id") or "") in source_ids
        and bool(_entity_tokens([fact]) & entity_tokens)
    ]
    expanded = [*grouped_facts, *sorted(related, key=_fact_rank)]
    context_terms = _significant_terms(" ".join(
        str(_value(fact, "article_section_text", "") or "") for fact in expanded
    ))
    expanded_ids = {str(_value(fact, "fact_id") or "") for fact in expanded}
    linked_event_terms: set[str] = set()
    if entity_tokens & {"iran", "iranian", "qatar", "qatari"}:
        linked_event_terms.update({"hormuz", "strait"})
    contextual = [
        fact for fact in all_facts
        if str(_value(fact, "fact_id") or "") not in expanded_ids
        and str(_value(fact, "source_id") or "") in source_ids
        and _enum_value(_value(fact, "fact_type")) in (CORE_TYPES | SUPPLY_TRADE_TYPES)
        and (
            bool(_entity_tokens([fact]) & entity_tokens)
            or bool(_significant_terms(_value(fact, "statement", "")) & linked_event_terms)
        )
        and len(_significant_terms(
            f"{_value(fact, 'statement', '')} {_value(fact, 'evidence_text', '')}"
        ) & context_terms) >= 2
    ]
    return [*expanded, *sorted(contextual, key=_fact_rank)]


def _take(facts: list[Any], types: set[str], limit: int) -> list[str]:
    return [
        str(_value(fact, "fact_id"))
        for fact in sorted(facts, key=_fact_rank)
        if _enum_value(_value(fact, "fact_type")) in types and _value(fact, "fact_id")
    ][:limit]


def _title(group_key: tuple[str, str], facts: list[Any]) -> str:
    commodity, region = group_key
    major = next(
        (fact for fact in sorted(facts, key=_fact_rank) if _enum_value(_value(fact, "fact_type")) in MAJOR_EVENT_TYPES),
        None,
    )
    if major:
        statement = re.sub(r"\s+", " ", str(_value(major, "statement", "")).strip())
        if statement:
            return statement[:72].rstrip(" ,.;:，。；：")
    return " · ".join(part.title() for part in (commodity, region) if part)


def _score(facts: list[Any], source_count: int, excerpt_count: int) -> int:
    types = {_enum_value(_value(fact, "fact_type")) for fact in facts}
    score = min(len(facts), 6) * 6 + min(source_count, 3) * 10 + min(excerpt_count, 4) * 4
    if types & MAJOR_EVENT_TYPES:
        score += 20
    if types & SUPPLY_TRADE_TYPES:
        score += 8
    if types & PRICE_TYPES:
        score += 4
    return min(score, 100)


def _article_scope(fact: Any) -> str:
    source_id = str(_value(fact, "source_id", "") or "").strip()
    section_title = _normalized(_value(fact, "article_section_title"), "")
    if section_title and _enum_value(_value(fact, "fact_type")) not in MAJOR_EVENT_TYPES:
        return source_id or "legacy-unscoped"
    if section_title:
        return f"{source_id}:{section_title}"
    section_id = str(_value(fact, "article_section_id", "") or "").strip()
    if section_id:
        return f"{source_id}:{section_id}"
    return "legacy-unscoped"


def build_editorial_candidates(
    market_date: date, facts: list[Any], *, directional_signal_available: bool,
) -> list[tuple[EditorialCandidate, EvidenceBundle]]:
    grouped: dict[tuple[str, str, str], list[Any]] = defaultdict(list)
    for fact in facts:
        if not _value(fact, "fact_id") or not str(_value(fact, "evidence_text", "")).strip():
            continue
        grouped[(
            _canonical_commodity(fact),
            _canonical_region(fact),
            _article_scope(fact),
        )].append(fact)

    candidates: list[tuple[EditorialCandidate, EvidenceBundle]] = []
    for key, grouped_facts in grouped.items():
        grouped_facts = _expand_major_event_context(grouped_facts, facts)
        market_key = key[:2]
        ranked = sorted(grouped_facts, key=_fact_rank)
        source_ids = sorted({str(_value(fact, "source_id")) for fact in ranked if _value(fact, "source_id")})
        excerpt_facts = [fact for fact in ranked if len(str(_value(fact, "evidence_text", "")).split()) >= 12]
        excerpt_word_count = sum(
            len(str(_value(fact, "evidence_text", "")).split()) for fact in excerpt_facts
        )
        major = any(_enum_value(_value(fact, "fact_type")) in MAJOR_EVENT_TYPES for fact in ranked)
        multi_source = len(source_ids) >= 2 and len(ranked) >= 4 and len(excerpt_facts) >= 3
        authority_longform = (
            len(source_ids) == 1 and len(ranked) >= 5 and len(excerpt_facts) >= 4
            and excerpt_word_count >= 180
        )
        single_source_brief = (
            len(source_ids) == 1 and len(ranked) >= 4 and len(excerpt_facts) >= 3
        )
        major_event = (
            major
            and bool(source_ids)
            and len(excerpt_facts) >= 1
            and len(ranked) >= 2
        )
        if not (multi_source or authority_longform or single_source_brief or major_event):
            continue

        if directional_signal_available:
            mode = ArticleMode.MARKET_ANALYSIS
        elif authority_longform:
            mode = ArticleMode.FAITHFUL_TRANSLATION
        else:
            mode = ArticleMode.EVENT_BRIEF
        core = _take(ranked, CORE_TYPES, 5)
        supply_trade = _take(ranked, SUPPLY_TRADE_TYPES, 4)
        prices = _take(ranked, PRICE_TYPES, 3)
        commentary = _take(ranked, COMMENTARY_TYPES, 3)
        selected_ids = list(dict.fromkeys([*core, *supply_trade, *prices, *commentary]))
        if len(selected_ids) < min(len(ranked), 15):
            selected_ids.extend(
                str(_value(fact, "fact_id")) for fact in ranked
                if str(_value(fact, "fact_id")) not in selected_ids
            )
        selected_ids = selected_ids[:15]
        excerpt_ids = [
            str(_value(fact, "fact_id")) for fact in excerpt_facts
            if str(_value(fact, "fact_id")) in selected_ids
        ][:6]
        digest = hashlib.sha1(
            f"{market_date.isoformat()}|{'|'.join(key)}".encode("utf-8")
        ).hexdigest()[:12]
        candidate_id = f"CANDIDATE-{market_date.isoformat()}-{digest}"
        reasons = []
        if multi_source:
            reasons.append("multiple_sources_with_related_facts")
        if authority_longform:
            reasons.append("single_authority_longform")
        elif single_source_brief:
            reasons.append("single_source_factual_brief")
        if major_event:
            reasons.append("major_market_event")
        score = _score(ranked, len(source_ids), len(excerpt_facts))
        bundle = EvidenceBundle(
            candidate_id=candidate_id,
            market_date=market_date,
            article_mode=mode,
            core_fact_ids=[fact_id for fact_id in core if fact_id in selected_ids],
            supply_trade_fact_ids=[fact_id for fact_id in supply_trade if fact_id in selected_ids],
            price_fact_ids=[fact_id for fact_id in prices if fact_id in selected_ids],
            commentary_fact_ids=[fact_id for fact_id in commentary if fact_id in selected_ids],
            source_ids=source_ids,
            excerpt_fact_ids=excerpt_ids,
            reader_value_score=score,
        )
        candidate = EditorialCandidate(
            candidate_id=candidate_id,
            market_date=market_date,
            article_mode=mode,
            headline_subject=_title(market_key, ranked),
            fact_ids=selected_ids,
            source_ids=source_ids,
            excerpt_ids=excerpt_ids,
            newsworthiness_score=score,
            selection_reasons=reasons,
        )
        candidates.append((candidate, bundle))

    return sorted(
        candidates,
        key=lambda item: (-item[0].newsworthiness_score, -len(item[0].source_ids), item[0].candidate_id),
    )[:3]

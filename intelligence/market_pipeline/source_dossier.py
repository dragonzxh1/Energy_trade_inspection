"""Deterministic document quick-read dossiers for Digital editorial planning."""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from datetime import date
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .contracts import ParagraphExcerpt, ParagraphRole, SourceDossier, SourceGenre


def fact_excerpt_id(source_id: str, evidence_text: str) -> str:
    normalized_evidence = re.sub(r"\s+", " ", evidence_text).strip()
    digest = hashlib.sha1(
        f"{source_id}|{normalized_evidence}".encode("utf-8")
    ).hexdigest()[:16]
    return f"EXCERPT-{digest}"


HIGH_VALUE_TYPES = {
    "price_assessment", "price_table", "market_summary", "supply_disruption",
    "supply_demand_commentary", "refinery_inventory", "refinery_outage",
    "trade_flow", "sanctions_policy", "tender", "freight",
}
QUALIFICATION_PATTERN = re.compile(
    r"\b(?:may|might|could|unlikely|subject to|if|unless|uncertain|expected|"
    r"estimated|preliminary|temporary|according to)\b", re.IGNORECASE,
)
EVENT_PATTERN = re.compile(
    r"\b(?:outage|shutdown|restart|sanction|ban|export|import|shipment|cargo|"
    r"inventory|production|supply|demand|refinery|tender|policy)\b", re.IGNORECASE,
)
QUESTION_PATTERN = re.compile(r"\?|\b(?:why|how|whether|what|when)\b", re.IGNORECASE)
COUNTERPOINT_PATTERN = re.compile(
    r"\b(?:but|however|although|while|yet|on the other hand|despite)\b", re.IGNORECASE,
)
CONCLUSION_PATTERN = re.compile(
    r"\b(?:therefore|thus|in conclusion|ultimately|as a result)\b", re.IGNORECASE,
)
RHETORICAL_PATTERNS = {
    "question": QUESTION_PATTERN,
    "contrast": COUNTERPOINT_PATTERN,
    "quotation": re.compile(r'["\u201c\u201d\u2018\u2019]'),
    "numeric_evidence": re.compile(r"\b\d+(?:[.,]\d+)?%?\b"),
    "uncertainty": QUALIFICATION_PATTERN,
}


def _clean(value: Any) -> str:
    text = str(value or "")
    text = re.sub(r"[\ue000-\uf8ff]", " ", text)
    text = re.sub(r"\bPlease\s*turn\s*to\s*page\s*[A-Z]?\d+\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<=[A-Za-z])-\s+(?=[a-z])", "", text)
    return re.sub(r"\s+", " ", text).strip()


def _paragraphs(text: str) -> list[str]:
    source = str(text or "").replace("\r\n", "\n")
    blocks = [_clean(block) for block in re.split(r"\n\s*\n+", source) if _clean(block)]
    if len(blocks) > 1:
        return blocks
    sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z\u201c\u2018])", _clean(source))
    grouped: list[str] = []
    current: list[str] = []
    for sentence in sentences:
        current.append(sentence)
        if len(" ".join(current)) >= 350 or len(current) >= 4:
            grouped.append(" ".join(current))
            current = []
    if current:
        grouped.append(" ".join(current))
    return grouped


def _paragraph_role(index: int, total: int, text: str) -> ParagraphRole:
    if index == 0:
        return ParagraphRole.OPENING
    if index == total - 1:
        return ParagraphRole.CONCLUSION
    if COUNTERPOINT_PATTERN.search(text):
        return ParagraphRole.COUNTERPOINT
    if re.search(r"\b\d+(?:[.,]\d+)?%?\b", text):
        return ParagraphRole.EVIDENCE
    if CONCLUSION_PATTERN.search(text):
        return ParagraphRole.CONCLUSION
    return ParagraphRole.CLAIM


def _source_genre(document: dict[str, Any]) -> SourceGenre:
    text = " ".join(_clean(document.get(key)) for key in (
        "document_type", "report_family", "report_title",
    )).casefold()
    if any(marker in text for marker in ("column", "opinion", "commentary")):
        return SourceGenre.COLUMN
    if any(marker in text for marker in ("investigation", "special report")):
        return SourceGenre.INVESTIGATION
    if any(marker in text for marker in ("analysis", "outlook", "research")):
        return SourceGenre.ANALYSIS
    if any(marker in text for marker in (
        "news", "newspaper", "the guardian", "wall street journal", "reuters",
        "financial times", "new york times", "washington post",
    )):
        return SourceGenre.NEWS
    return SourceGenre.MARKET_REPORT


def _source_title(document: dict[str, Any]) -> str:
    report_title = _clean(document.get("report_title"))
    report_family = _clean(document.get("report_family"))
    publisher = _clean(document.get("publisher"))
    known_publication = next((
        value for value in (report_family, publisher)
        if value and any(marker in value.casefold() for marker in (
            "wall street journal", "washington post", "financial times", "reuters",
            "new york times", "the guardian", "platts", "argus",
        ))
    ), "")
    if known_publication:
        return known_publication
    return report_title or report_family or publisher or "Market publication"


def _excerpt_candidates(source_id: str, eligible: list[dict[str, Any]]) -> list[ParagraphExcerpt]:
    candidates: list[ParagraphExcerpt] = []
    prioritized_sections = sorted(
        eligible,
        key=lambda item: (
            -int(item.get("verified_fact_count") or 0),
            int(item.get("section_index") or 0),
        ),
    )
    for section in prioritized_sections:
        section_id = str(section.get("section_id") or "")
        paragraphs = [
            paragraph for paragraph in _paragraphs(str(section.get("section_text") or ""))
            if 120 <= len(paragraph) <= 1800 and len(paragraph.split()) >= 20
        ][:12]
        for index, paragraph in enumerate(paragraphs):
            digest = hashlib.sha1(
                f"{source_id}|{section_id}|{paragraph}".encode("utf-8")
            ).hexdigest()[:16]
            candidates.append(ParagraphExcerpt(
                excerpt_id=f"EXCERPT-{digest}", source_id=source_id, section_id=section_id,
                paragraph_role=_paragraph_role(index, len(paragraphs), paragraph),
                original_text=paragraph,
                previous_context=paragraphs[index - 1][-500:] if index else "",
                next_context=paragraphs[index + 1][:500] if index + 1 < len(paragraphs) else "",
                preserved_devices=[
                    name for name, pattern in RHETORICAL_PATTERNS.items() if pattern.search(paragraph)
                ],
            ))
    return candidates[:96]


def build_source_dossier(document: dict[str, Any], sections: list[dict[str, Any]]) -> SourceDossier:
    ordered = sorted(sections, key=lambda item: int(item.get("section_index", 0)))
    eligible = [
        section for section in ordered
        if (
            str(section.get("triage_category") or section.get("section_type") or "") in HIGH_VALUE_TYPES
            or bool(section.get("dify_eligible"))
        )
        and _clean(section.get("section_text"))
    ]
    headings = list(dict.fromkeys(
        _clean(section.get("section_title"))
        for section in ordered if _clean(section.get("section_title"))
    ))[:30]
    quick_read_sections: list[dict[str, Any]] = []
    seen_sections: set[str] = set()
    for section in [*ordered[:2], *eligible[:8], *ordered[-2:]]:
        section_id = str(section.get("section_id") or "")
        if section_id and section_id not in seen_sections:
            quick_read_sections.append(section)
            seen_sections.add(section_id)
    quick_read_inputs = [
        f"{_clean(section.get('section_title'))}: {_clean(section.get('section_text'))[:900]}"
        for section in quick_read_sections
    ]
    event_sections = [
        section for section in eligible
        if EVENT_PATTERN.search(
            f"{_clean(section.get('section_title'))} {_clean(section.get('section_text'))}"
        )
    ]
    qualifications = [
        _clean(match.group(0))
        for section in eligible
        for match in QUALIFICATION_PATTERN.finditer(_clean(section.get("section_text")))
    ]
    conclusions = [
        _clean(section.get("section_text"))[:600]
        for section in (eligible[-2:] if eligible else ordered[-2:])
        if _clean(section.get("section_text"))
    ]
    source_id = str(document["source_id"])
    market_date = document["market_date"]
    if isinstance(market_date, str):
        market_date = date.fromisoformat(market_date)
    source_title = _source_title(document)
    central_question = headings[0] if headings else source_title
    excerpts = _excerpt_candidates(source_id, eligible)
    rhetorical_devices = list(dict.fromkeys(
        device for excerpt in excerpts for device in excerpt.preserved_devices
    ))
    source_conclusions = conclusions
    main_thesis = source_conclusions[-1] if source_conclusions else (
        _clean(event_sections[0].get("section_text"))[:600] if event_sections else central_question
    )
    dossier_digest = hashlib.sha1(
        f"{source_id}|{market_date.isoformat()}|source-dossier.v2".encode("utf-8")
    ).hexdigest()[:16]
    return SourceDossier(
        dossier_id=f"DOSSIER-{dossier_digest}", source_id=source_id,
        source_document_id=str(document["id"]), market_date=market_date,
        source_title=source_title or "Market publication",
        source_genre=_source_genre(document),
        central_question=central_question or "Daily energy market developments",
        main_thesis=main_thesis,
        tone="skeptical" if COUNTERPOINT_PATTERN.search(" ".join(quick_read_inputs)) else "analytical",
        argument_pattern=list(dict.fromkeys(
            excerpt.paragraph_role.value for excerpt in excerpts
        )),
        rhetorical_devices=rhetorical_devices,
        paragraph_functions=[excerpt.paragraph_role.value for excerpt in excerpts],
        uncertainty_language=list(dict.fromkeys(qualifications))[:20],
        source_argument_map=[{
            "order": index,
            "paragraph_role": excerpt.paragraph_role.value,
            "excerpt_id": excerpt.excerpt_id,
            "section_id": excerpt.section_id,
        } for index, excerpt in enumerate(excerpts)],
        translation_notes=[
            f"Preserve {device}." for device in rhetorical_devices
        ],
        paragraph_excerpt_candidates=excerpts,
        section_structure=headings,
        key_events=[_clean(section.get("section_text"))[:500] for section in event_sections[:8]],
        high_value_section_ids=[str(section["section_id"]) for section in eligible[:20]],
        translation_candidate_section_ids=[
            str(section["section_id"]) for section in eligible
            if len(_clean(section.get("section_text")).split()) >= 40
        ][:8],
        source_conclusions=source_conclusions,
        qualifications=list(dict.fromkeys(qualifications))[:20],
        quick_read_inputs=quick_read_inputs,
    )


def load_and_persist_source_dossiers(
    connection: Connection[Any], market_date: date, source_channel: str,
) -> list[SourceDossier]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """SELECT DISTINCT document.*
               FROM source_documents document
               JOIN telegram_attachments attachment ON attachment.id=document.attachment_id
               JOIN telegram_message_attachments linked ON linked.attachment_id=attachment.id
               JOIN telegram_messages message ON message.id=linked.message_id
               WHERE document.market_date=%s AND document.source_verified=true
                 AND document.processing_status='parsed' AND document.needs_review=false
                 AND message.source_channel=%s AND COALESCE(document.is_current,true)=true
               ORDER BY document.source_id""",
            (market_date, source_channel),
        )
        documents = list(cursor.fetchall())
        if not documents:
            return []
        document_ids = [document["id"] for document in documents]
        cursor.execute(
            """SELECT * FROM document_sections
               WHERE source_document_id=ANY(%s)
               ORDER BY source_document_id,section_index""",
            (document_ids,),
        )
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for section in cursor.fetchall():
            grouped[str(section["source_document_id"])].append(dict(section))
        cursor.execute(
            """SELECT document_section_id, count(*) AS verified_fact_count
               FROM market_facts
               WHERE source_document_id=ANY(%s) AND verification_status='verified'
                 AND is_current=true
               GROUP BY document_section_id""",
            (document_ids,),
        )
        verified_fact_counts = {
            str(row["document_section_id"]): int(row["verified_fact_count"])
            for row in cursor.fetchall()
        }
        for sections in grouped.values():
            for section in sections:
                section["verified_fact_count"] = verified_fact_counts.get(
                    str(section.get("id") or ""), 0,
                )
    dossiers = [
        build_source_dossier(dict(document), grouped[str(document["id"])])
        for document in documents
    ]
    with connection.transaction(), connection.cursor() as cursor:
        for dossier in dossiers:
            cursor.execute(
                """INSERT INTO source_dossiers (
                     dossier_id,schema_version,source_document_id,source_id,market_date,dossier_json
                   ) VALUES (%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source_document_id,schema_version) DO UPDATE SET
                     dossier_id=EXCLUDED.dossier_id,schema_version=EXCLUDED.schema_version,
                     source_id=EXCLUDED.source_id,market_date=EXCLUDED.market_date,
                     dossier_json=EXCLUDED.dossier_json,updated_at=now()""",
                (dossier.dossier_id, dossier.schema_version, dossier.source_document_id,
                 dossier.source_id, dossier.market_date, Jsonb(dossier.model_dump(mode="json"))),
            )
    return dossiers


def load_source_dossiers(connection: Connection[Any], market_date: date) -> list[SourceDossier]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """SELECT DISTINCT ON (source_document_id) dossier_json
               FROM source_dossiers WHERE market_date=%s
               ORDER BY source_document_id,
                 CASE schema_version WHEN 'source-dossier.v2' THEN 0 ELSE 1 END,
                 updated_at DESC""",
            (market_date,),
        )
        return [SourceDossier.model_validate(row["dossier_json"]) for row in cursor.fetchall()]


def dossiers_for_topic(dossiers: list[SourceDossier], source_ids: set[str]) -> list[dict[str, Any]]:
    return [
        dossier.model_dump(mode="json") for dossier in dossiers
        if dossier.source_id in source_ids
    ]


READER_EXCERPT_PRICE_PREFIX_PATTERN = re.compile(
    r"^\s*[A-Z]{3,}\d{2,}\s+[-+]?\d+(?:,\d{3})*(?:\.\d+)?"
    r"(?:\s+[-+]?\d+(?:,\d{3})*(?:\.\d+)?)?\s*"
)
READER_EXCERPT_INTERNAL_CODE_PATTERN = re.compile(
    r"<?\s*\b[A-Z]{3,}\d{2,}\b\s*>?"
)


def clean_reader_excerpt_text(value: Any) -> str:
    text = _clean(value)
    text = READER_EXCERPT_PRICE_PREFIX_PATTERN.sub("", text, count=1)
    text = READER_EXCERPT_INTERNAL_CODE_PATTERN.sub("", text)
    return re.sub(r"\s+", " ", text).strip()


def paragraph_excerpts_for_topic(
    dossiers: list[SourceDossier], source_ids: set[str], fact_ids_by_source: dict[str, list[str]],
    limit: int = 8, section_ids: set[str] | None = None,
    topic_facts: list[dict[str, Any]] | None = None,
    include_adjacent: bool = False,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    candidates = [
        (dossier, excerpt)
        for dossier in dossiers if dossier.source_id in source_ids
        for excerpt in dossier.paragraph_excerpt_candidates
        if not section_ids or excerpt.section_id in section_ids
    ]
    generic_terms = {
        "about", "after", "against", "before", "between", "company", "could", "during",
        "from", "highest", "market", "million", "production", "reported", "their", "there",
        "these", "those", "through", "under", "which", "while", "with", "would", "also",
        "been", "being", "have", "into", "over", "said", "that", "they", "this", "well",
        "were", "what", "when", "where", "will",
    }
    facts_by_source: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for fact in topic_facts or []:
        facts_by_source[str(fact.get("source_id") or "")].append(fact)

    def terms(value: Any) -> set[str]:
        return {
            token for token in re.findall(r"[a-z][a-z0-9]{3,}", _clean(value).casefold())
            if token not in generic_terms
        }

    def candidate_binding(
        dossier: SourceDossier, excerpt: ParagraphExcerpt,
    ) -> tuple[int, list[str]]:
        if "▲" in excerpt.original_text:
            return 0, []
        if not topic_facts:
            return 1, fact_ids_by_source.get(dossier.source_id, [])
        excerpt_terms = terms(excerpt.original_text)
        score = 0
        bound_ids: list[str] = []
        for fact in facts_by_source.get(dossier.source_id, []):
            fact_section_id = str(fact.get("article_section_id") or fact.get("section_id") or "")
            if fact_section_id and fact_section_id != excerpt.section_id:
                continue
            statement_terms = terms(fact.get("statement", ""))
            evidence_text = _clean(fact.get("evidence_text", ""))
            statement_overlap = excerpt_terms & statement_terms
            evidence_overlap = excerpt_terms & terms(evidence_text)
            if len(statement_overlap) < 2 and not (
                len(evidence_text) <= 1200 and len(evidence_overlap) >= 3
            ):
                continue
            score += len(statement_overlap) * 3 + min(len(evidence_overlap), 5)
            fact_id = str(fact.get("fact_id") or "")
            if fact_id:
                bound_ids.append(fact_id)
        return score, list(dict.fromkeys(bound_ids))

    ranked_candidates: list[tuple[int, SourceDossier, ParagraphExcerpt, list[str]]] = []
    for dossier, excerpt in candidates:
        relevance, bound_ids = candidate_binding(dossier, excerpt)
        if relevance <= 0:
            continue
        ranked_candidates.append((relevance, dossier, excerpt, bound_ids))
    if include_adjacent and ranked_candidates:
        source_order = {
            (dossier.source_id, excerpt.excerpt_id): order
            for dossier in dossiers if dossier.source_id in source_ids
            for order, excerpt in enumerate(dossier.paragraph_excerpt_candidates)
        }
        ordered_candidates = sorted(ranked_candidates, key=lambda item: (
            item[1].source_id,
            source_order.get((item[1].source_id, item[2].excerpt_id), 10**9),
        ))
    else:
        ordered_candidates = sorted(ranked_candidates, key=lambda item: (
            -item[0],
            {
                "opening": 0,
                "claim": 1,
                "evidence": 2,
                "counterpoint": 3,
                "conclusion": 4,
                "transition": 5,
            }.get(item[2].paragraph_role.value, 99),
            item[1].source_id, item[2].excerpt_id,
        ))
    seen_roles: set[str] = set()
    diverse: list[tuple[int, SourceDossier, ParagraphExcerpt, list[str]]] = []
    remaining: list[tuple[int, SourceDossier, ParagraphExcerpt, list[str]]] = []
    for candidate in ordered_candidates:
        role = candidate[2].paragraph_role.value
        if role not in seen_roles:
            diverse.append(candidate)
            seen_roles.add(role)
        else:
            remaining.append(candidate)
    seen_excerpt_texts: set[str] = set()
    final_candidates = ordered_candidates if include_adjacent else diverse + remaining
    for _, dossier, excerpt, bound_ids in final_candidates:
        original_excerpt = clean_reader_excerpt_text(excerpt.original_text)
        normalized_excerpt = re.sub(r"[^0-9a-z]+", "", original_excerpt.casefold())
        if not original_excerpt or normalized_excerpt in seen_excerpt_texts:
            continue
        seen_excerpt_texts.add(normalized_excerpt)
        selected.append({
            "excerpt_id": excerpt.excerpt_id,
            "source_id": dossier.source_id,
            "section_id": excerpt.section_id,
            "paragraph_role": excerpt.paragraph_role.value,
            "source_title": dossier.source_title,
            "source_fact_ids": bound_ids or fact_ids_by_source.get(dossier.source_id, []),
            "original_excerpt": original_excerpt,
            "previous_context": clean_reader_excerpt_text(excerpt.previous_context),
            "next_context": clean_reader_excerpt_text(excerpt.next_context),
            "preserved_devices": excerpt.preserved_devices,
            "translation_review_status": "pending",
            "translation_requirement": "paragraph_faithful_translation_with_style_preservation",
        })
        if len(selected) >= limit:
            break
    return selected

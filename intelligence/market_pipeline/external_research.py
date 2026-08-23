"""Firecrawl research boundary, evidence verification, and editorial planning."""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from typing import Any, Iterable
from urllib.parse import urlsplit, urlunsplit

import httpx
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .contracts import (
    ArticleMode,
    ArticleTopic,
    ClaimLedgerEntry,
    ClaimType,
    EvidenceRelationship,
    ExternalEvidenceCandidate,
    FactClass,
    FactDirection,
    FactRiskLevel,
    MarketFact,
    SourceDossier,
    SourceGenre,
    StoryBrief,
    StoryForm,
    ValidationSeverity,
    VerificationStatus,
)
from .fact_validation import FactValidationContext, classify_fact_risk, validate_fact
from .source_dossier import fact_excerpt_id


RESEARCH_POLICY_VERSION = "external-research-policy.v2"
STORY_PLANNER_VERSION = "story-brief-planner.v2"
TIER_1_DOMAINS = {
    "gov", "europa.eu", "un.org", "imo.org", "opec.org", "iea.org", "eia.gov",
    "sec.gov", "ofac.treasury.gov", "customs.gov", "aramco.com", "shell.com",
    "bp.com", "totalenergies.com", "exxonmobil.com",
}
TIER_2_DOMAINS = {
    "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "nytimes.com",
    "theguardian.com", "spglobal.com", "argusmedia.com", "apnews.com",
}
GENERIC_FILLER_PATTERNS = (
    re.compile(r"\b(?:insurance costs?|rerouting costs?|price volatility)\b", re.I),
    re.compile(r"\b(?:worth watching|remains to be seen|could have an impact)\b", re.I),
)


def _normalized(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def canonicalize_url(value: str) -> str:
    parsed = urlsplit(str(value or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("external evidence URL must use http or https")
    host = parsed.hostname.casefold().rstrip(".")
    if host in {"localhost", "localhost.localdomain"}:
        raise ValueError("external evidence URL cannot target localhost")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address and (address.is_private or address.is_loopback or address.is_link_local):
        raise ValueError("external evidence URL cannot target a private address")
    path = re.sub(r"/{2,}", "/", parsed.path or "/")
    return urlunsplit((parsed.scheme.casefold(), parsed.netloc.casefold(), path, parsed.query, ""))


def source_tier(url: str, publisher: str = "") -> int:
    host = (urlsplit(url).hostname or "").casefold()
    publisher_folded = publisher.casefold()
    if any(host == domain or host.endswith(f".{domain}") for domain in TIER_1_DOMAINS):
        return 1
    if host.endswith(".gov") or host.endswith(".gov.cn") or host.endswith(".gov.uk"):
        return 1
    if any(host == domain or host.endswith(f".{domain}") for domain in TIER_2_DOMAINS):
        return 2
    if any(marker in publisher_folded for marker in ("government", "ministry", "commission")):
        return 1
    return 3


def normalize_external_candidate(raw: dict[str, Any], market_date: date) -> ExternalEvidenceCandidate:
    url = canonicalize_url(str(raw.get("canonical_url") or raw.get("url") or ""))
    evidence_text = _normalized(raw.get("evidence_text"))
    claim_text = _normalized(raw.get("claim_text") or raw.get("claim"))
    if not evidence_text or not claim_text:
        raise ValueError("external evidence requires claim_text and evidence_text")
    retrieved_at = raw.get("retrieved_at") or datetime.now(timezone.utc)
    if isinstance(retrieved_at, str):
        retrieved_at = datetime.fromisoformat(retrieved_at.replace("Z", "+00:00"))
    published_at = raw.get("published_at")
    if isinstance(published_at, str) and published_at:
        published_at = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
    event_date = raw.get("event_date")
    if isinstance(event_date, str) and event_date:
        event_date = date.fromisoformat(event_date[:10])
    publisher = _normalized(raw.get("source_publisher") or raw.get("publisher") or urlsplit(url).hostname)
    tier = int(raw.get("source_tier") or source_tier(url, publisher))
    if tier != source_tier(url, publisher) and tier < source_tier(url, publisher):
        tier = source_tier(url, publisher)
    content_hash = str(raw.get("content_hash") or _digest(_normalized(raw.get("page_text") or evidence_text)))
    evidence_hash = _digest(evidence_text)
    evidence_id = str(raw.get("evidence_id") or f"WEBEVID-{_digest(f'{url}|{evidence_hash}')[:20]}")
    return ExternalEvidenceCandidate(
        evidence_id=evidence_id, market_date=market_date, event_date=event_date,
        published_at=published_at, retrieved_at=retrieved_at, canonical_url=url,
        content_hash=content_hash, evidence_text_hash=evidence_hash,
        source_title=_normalized(raw.get("source_title") or publisher),
        source_publisher=publisher, source_tier=tier,
        relationship=EvidenceRelationship(str(raw.get("relationship") or "contextualizes")),
        claim_text=claim_text, evidence_text=evidence_text,
        fact=raw.get("fact"),
        supporting_internal_fact_ids=list(raw.get("supporting_internal_fact_ids") or []),
        verification_status="lead_only" if tier == 3 else "candidate",
        review_reasons=["TIER_3_LEAD_ONLY"] if tier == 3 else [],
    )


class FirecrawlResearchClient:
    def __init__(self, base_url: str, timeout_seconds: int = 480) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = min(max(timeout_seconds, 30), 480)

    def run(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = httpx.post(
            f"{self.base_url}/v1/research/run", json=payload,
            timeout=self.timeout_seconds + 30,
        )
        if response.is_error:
            try:
                body = response.json()
                detail = str(body.get("error") or body.get("status") or "") if isinstance(body, dict) else ""
            except ValueError:
                detail = ""
            raise httpx.HTTPStatusError(
                f"Firecrawl research HTTP {response.status_code}{f': {detail}' if detail else ''}",
                request=response.request, response=response,
            )
        result = response.json()
        if not isinstance(result, dict) or not isinstance(result.get("evidence", []), list):
            raise ValueError("Firecrawl research response missing evidence array")
        return result


def _research_request(
    market_date: date, dossiers: list[SourceDossier], facts: Iterable[Any],
) -> dict[str, Any]:
    priority = {
        "geopolitical_event": 0, "sanction": 0, "refinery_outage": 1,
        "refinery_run": 2, "production": 2, "supply": 2, "trade_flow": 3,
        "inventory": 3, "demand": 3, "price": 4, "price_change": 4,
    }
    ordered_facts = sorted(
        list(facts),
        key=lambda fact: (
            priority.get(str(getattr(getattr(fact, "fact_type", ""), "value", getattr(fact, "fact_type", ""))), 9),
            -float(getattr(fact, "confidence", 0) or 0),
            str(getattr(fact, "fact_id", "")),
        ),
    )
    fact_claims = [{
        "fact_id": str(getattr(fact, "fact_id", "")),
        "claim": _normalized(getattr(fact, "statement", "")),
        "evidence": _normalized(getattr(fact, "evidence_text", "")),
        "source_title": _normalized(getattr(fact, "report_title", "")),
    } for fact in ordered_facts]
    entity_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for claim in fact_claims:
        entities = re.findall(r"\b[A-Z][A-Za-z]{3,}\b", claim["claim"])
        for entity in entities:
            if entity.casefold() not in {"after", "before", "during", "friday", "march"}:
                entity_groups[entity].append(claim)
    dominant = max(entity_groups.items(), key=lambda item: len(item[1]), default=("", []))
    focused_question = ""
    if dominant[1]:
        focused_question = (
            f"Verify with official company or tier-2 sources the following {dominant[0]} claims: "
            + " | ".join(item["claim"] for item in dominant[1][:4])
        )
    dossier_questions = [
        dossier.central_question for dossier in dossiers
        if dossier.central_question and not re.fullmatch(r"(?i)page\s+\d+", dossier.central_question.strip())
    ]
    max_queries = min(max(int(os.getenv("EXTERNAL_RESEARCH_MAX_QUERIES", "4")), 1), 4)
    max_pages = min(max(int(os.getenv("EXTERNAL_RESEARCH_MAX_PAGES", "8")), 1), 8)
    return {
        "market_date": market_date.isoformat(),
        "source_dossiers": [dossier.model_dump(mode="json") for dossier in dossiers],
        "claims_to_verify": fact_claims,
        "research_questions": [question for question in dict.fromkeys([
            focused_question,
            *(f"Verify this energy-market claim: {item['claim']}" for item in fact_claims[:6]),
            *dossier_questions,
        ]) if question][:8],
        "allowed_source_tiers": [1, 2],
        "max_queries": max_queries,
        "max_pages": max_pages,
        "max_workers": 1,
        "timeout_seconds": 480,
    }


def _claim_key(value: str) -> str:
    return _digest(re.sub(r"[^a-z0-9\u4e00-\u9fff]+", " ", value.casefold()).strip())


def verify_external_candidates(
    candidates: list[ExternalEvidenceCandidate], internal_fact_ids: set[str],
) -> list[ExternalEvidenceCandidate]:
    publishers_by_claim: dict[str, set[str]] = defaultdict(set)
    for candidate in candidates:
        publishers_by_claim[_claim_key(candidate.claim_text)].add(candidate.source_publisher.casefold())
    verified: list[ExternalEvidenceCandidate] = []
    for candidate in candidates:
        reasons = list(candidate.review_reasons)
        status = candidate.verification_status
        if candidate.source_tier == 3:
            status = "lead_only"
        elif candidate.event_date and candidate.event_date != candidate.market_date:
            status = "needs_review"
            reasons.append("EVENT_DATE_MISMATCH")
        else:
            has_internal_support = bool(
                set(candidate.supporting_internal_fact_ids) & internal_fact_ids
            )
            independent_sources = len(publishers_by_claim[_claim_key(candidate.claim_text)])
            if candidate.fact is None and has_internal_support:
                status = "verified"
            elif candidate.fact is None:
                status = "candidate"
                reasons.append("NO_ATOMIC_FACT")
            elif candidate.source_tier == 2 and not has_internal_support and independent_sources < 2:
                status = "needs_review"
                reasons.append("TIER_2_NEEDS_CORROBORATION")
            else:
                status = "verified"
        verified.append(candidate.model_copy(update={
            "verification_status": status,
            "review_reasons": list(dict.fromkeys(reasons)),
        }))
    return verified


def _persist_research_run(
    connection: Connection[Any], *, run_id: str, market_date: date, mode: str,
    idempotency_key: str, request: dict[str, Any], response: dict[str, Any],
    status: str, error: str | None = None,
) -> str:
    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """INSERT INTO external_research_runs (
                 run_id,market_date,idempotency_key,research_mode,request_json,response_json,
                 processing_status,query_count,page_count,token_count,cost_usd,duration_ms,
                 error_message,completed_at
               ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,now())
               ON CONFLICT (idempotency_key) DO UPDATE SET
                 response_json=EXCLUDED.response_json,processing_status=EXCLUDED.processing_status,
                 query_count=EXCLUDED.query_count,page_count=EXCLUDED.page_count,
                 token_count=EXCLUDED.token_count,cost_usd=EXCLUDED.cost_usd,
                 duration_ms=EXCLUDED.duration_ms,error_message=EXCLUDED.error_message,
                 completed_at=now(),updated_at=now()
               RETURNING id""",
            (
                run_id, market_date, idempotency_key, mode, Jsonb(request), Jsonb(response), status,
                int(response.get("query_count", 0) or 0), int(response.get("page_count", 0) or 0),
                int(response.get("token_count", 0) or 0), float(response.get("cost_usd", 0) or 0),
                int(response.get("duration_ms", 0) or 0), error,
            ),
        )
        return str(cursor.fetchone()["id"])


def _persist_candidates(
    connection: Connection[Any], run_db_id: str, candidates: list[ExternalEvidenceCandidate],
) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        for item in candidates:
            cursor.execute(
                """INSERT INTO external_evidence_candidates (
                     evidence_id,research_run_id,market_date,event_date,published_at,retrieved_at,
                     canonical_url,content_hash,evidence_text_hash,source_title,source_publisher,
                     source_tier,relationship,claim_text,evidence_text,fact_json,
                     supporting_internal_fact_ids,verification_status,review_reasons
                   ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (evidence_id) DO UPDATE SET
                     fact_json=EXCLUDED.fact_json,verification_status=EXCLUDED.verification_status,
                     review_reasons=EXCLUDED.review_reasons,updated_at=now()""",
                (
                    item.evidence_id, run_db_id, item.market_date, item.event_date,
                    item.published_at, item.retrieved_at, item.canonical_url, item.content_hash,
                    item.evidence_text_hash, item.source_title, item.source_publisher,
                    item.source_tier, item.relationship.value, item.claim_text, item.evidence_text,
                    Jsonb(item.fact.model_dump(mode="json") if item.fact else {}),
                    Jsonb(item.supporting_internal_fact_ids), item.verification_status,
                    Jsonb(item.review_reasons),
                ),
            )


def promote_verified_external_facts(
    connection: Connection[Any], candidates: list[ExternalEvidenceCandidate],
) -> list[str]:
    promoted: list[str] = []
    for candidate in candidates:
        if candidate.verification_status != "verified" or candidate.fact is None:
            continue
        source_id = f"web:{_digest(candidate.canonical_url)[:24]}"
        section_id = f"WEBSEC-{_digest(candidate.evidence_text)[:20]}"
        extracted = candidate.fact
        fact_hash = _digest("\x1f".join((
            source_id, section_id, candidate.market_date.isoformat(), extracted.fact_type.value,
            extracted.statement, candidate.evidence_text,
        )))
        fact_id = f"WEBFACT-{fact_hash[:24]}"
        provisional = MarketFact(
            fact_id=fact_id, fact_hash=fact_hash, source_id=source_id, section_id=section_id,
            market_date=candidate.market_date, published_at=candidate.published_at,
            region=extracted.region, country=extracted.country, commodity=extracted.commodity,
            benchmark=extracted.benchmark, fact_type=extracted.fact_type,
            fact_class=FactClass.SOURCE_FACT, statement=extracted.statement,
            value=extracted.value, unit=extracted.unit, change_value=extracted.change_value,
            change_unit=extracted.change_unit, direction=extracted.direction,
            time_basis=extracted.time_basis, evidence_text=candidate.evidence_text,
            attribution=extracted.attribution or candidate.source_publisher,
            uncertainty=extracted.uncertainty, confidence=extracted.confidence,
            verification_status=VerificationStatus.PENDING, risk_level=FactRiskLevel.NORMAL,
            supporting_fact_ids=candidate.supporting_internal_fact_ids,
            metadata={
                **extracted.metadata, "external_evidence_id": candidate.evidence_id,
                "source_url": candidate.canonical_url, "source_tier": candidate.source_tier,
            },
        )
        issues, risk = validate_fact(provisional, FactValidationContext(
            source_market_date=candidate.market_date,
            telegram_message_date=candidate.retrieved_at,
            parse_method="firecrawl", source_verified=candidate.source_tier <= 2,
            section_text=candidate.evidence_text, publisher=candidate.source_publisher,
        ))
        blocking = [issue for issue in issues if issue.severity == ValidationSeverity.BLOCKING]
        if blocking or risk in {FactRiskLevel.HIGH, FactRiskLevel.CRITICAL}:
            with connection.transaction(), connection.cursor() as cursor:
                cursor.execute(
                    """UPDATE external_evidence_candidates SET verification_status='needs_review',
                       review_reasons=%s,updated_at=now() WHERE evidence_id=%s""",
                    (Jsonb([issue.rule_id for issue in blocking] + [f"RISK_{risk.value.upper()}"]), candidate.evidence_id),
                )
            continue
        fact = provisional.model_copy(update={
            "verification_status": VerificationStatus.VERIFIED, "risk_level": risk,
        })
        with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                """INSERT INTO source_documents (
                     source_id,attachment_id,schema_version,parser_version,publisher,
                     publisher_confidence,report_family,report_title,document_type,published_at,
                     market_date,market_date_confidence,market_date_reason,date_candidates,language,
                     regions,commodities,content_hash,parsed_text,parse_method,parse_confidence,
                     processing_status,source_verified,needs_review,review_reasons,contract_json,
                     source_origin,source_url,retrieved_at
                   ) VALUES (%s,NULL,'source-document.v1',%s,%s,1,%s,%s,'web_article',%s,
                     %s,1,'external_evidence_event_date',%s,'en','[]','[]',%s,%s,'firecrawl',1,
                     'parsed',true,false,'[]',%s,'external_web',%s,%s)
                   ON CONFLICT (source_id) DO UPDATE SET retrieved_at=EXCLUDED.retrieved_at,
                     parsed_text=EXCLUDED.parsed_text,updated_at=now() RETURNING id""",
                (
                    source_id, RESEARCH_POLICY_VERSION, candidate.source_publisher,
                    candidate.source_publisher, candidate.source_title, candidate.published_at,
                    candidate.market_date, Jsonb([{"date": candidate.market_date.isoformat(), "source": "external"}]),
                    candidate.content_hash, candidate.evidence_text,
                    Jsonb(candidate.model_dump(mode="json")), candidate.canonical_url, candidate.retrieved_at,
                ),
            )
            source_document_id = str(cursor.fetchone()["id"])
            cursor.execute(
                """INSERT INTO document_sections (
                     section_id,source_document_id,section_index,section_title,section_type,
                     section_text,classification_confidence,fact_extraction_status,dify_eligible
                   ) VALUES (%s,%s,0,%s,'external_evidence',%s,1,'completed',false)
                   ON CONFLICT (section_id) DO UPDATE SET section_text=EXCLUDED.section_text,
                     updated_at=now() RETURNING id""",
                (section_id, source_document_id, candidate.source_title, candidate.evidence_text),
            )
            document_section_id = str(cursor.fetchone()["id"])
            cursor.execute(
                """INSERT INTO market_facts (
                     fact_id,fact_hash,schema_version,source_document_id,document_section_id,
                     source_id,section_id,market_date,published_at,region,country,commodity,benchmark,
                     fact_type,fact_class,statement,value,unit,change_value,change_unit,direction,
                     time_basis,evidence_text,attribution,uncertainty,confidence,verification_status,
                     risk_level,supporting_fact_ids,metadata
                   ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                     %s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (fact_hash) DO UPDATE SET statement=EXCLUDED.statement,
                     evidence_text=EXCLUDED.evidence_text,verification_status=EXCLUDED.verification_status,
                     metadata=EXCLUDED.metadata,is_current=true,superseded_at=NULL,updated_at=now()""",
                (
                    fact.fact_id, fact.fact_hash, fact.schema_version, source_document_id,
                    document_section_id, fact.source_id, fact.section_id, fact.market_date,
                    fact.published_at, fact.region, fact.country, fact.commodity, fact.benchmark,
                    fact.fact_type.value, fact.fact_class.value, fact.statement, fact.value, fact.unit,
                    fact.change_value, fact.change_unit, fact.direction.value, fact.time_basis,
                    fact.evidence_text, fact.attribution, fact.uncertainty, fact.confidence,
                    fact.verification_status.value, fact.risk_level.value,
                    Jsonb(fact.supporting_fact_ids), Jsonb(fact.metadata),
                ),
            )
            cursor.execute(
                """UPDATE external_evidence_candidates SET promoted_fact_id=%s,
                   verification_status='verified',updated_at=now() WHERE evidence_id=%s""",
                (fact.fact_id, candidate.evidence_id),
            )
        promoted.append(fact.fact_id)
    return promoted


def prepare_external_research(
    connection: Connection[Any], market_date: date, dossiers: list[SourceDossier], facts: list[Any],
) -> dict[str, Any]:
    mode = os.getenv("EXTERNAL_RESEARCH_MODE", "off").strip().casefold()
    if mode not in {"shadow", "review"} or not dossiers:
        return {"mode": mode, "status": "skipped", "candidates": [], "promoted_fact_ids": []}
    request = _research_request(market_date, dossiers, facts)
    request_hash = _digest(json.dumps(request, ensure_ascii=False, sort_keys=True, default=str))
    idempotency_key = f"{market_date.isoformat()}:{request_hash}:{RESEARCH_POLICY_VERSION}"
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            "SELECT response_json,processing_status FROM external_research_runs WHERE idempotency_key=%s",
            (idempotency_key,),
        )
        cached = cursor.fetchone()
    if cached and cached["processing_status"] == "completed":
        response = dict(cached["response_json"])
    else:
        base_url = os.getenv("FIRECRAWL_AGENT_BASE_URL", "").strip()
        if not base_url:
            response = {"evidence": [], "error": "FIRECRAWL_AGENT_BASE_URL missing"}
        else:
            try:
                response = FirecrawlResearchClient(base_url).run(request)
            except Exception as error:  # fail closed without blocking internal evidence
                response = {"evidence": [], "error": str(error)}
    run_id = str(response.get("run_id") or f"WEBRUN-{uuid.uuid4().hex[:20]}")
    status = "completed" if not response.get("error") else "failed"
    run_db_id = _persist_research_run(
        connection, run_id=run_id, market_date=market_date, mode=mode,
        idempotency_key=idempotency_key, request=request, response=response,
        status=status, error=str(response.get("error") or "") or None,
    )
    normalized: list[ExternalEvidenceCandidate] = []
    for raw in response.get("evidence", []):
        try:
            normalized.append(normalize_external_candidate(raw, market_date))
        except (TypeError, ValueError):
            continue
    candidates = verify_external_candidates(
        normalized, {str(getattr(fact, "fact_id", "")) for fact in facts},
    )
    _persist_candidates(connection, run_db_id, candidates)
    promoted = promote_verified_external_facts(connection, candidates) if mode == "review" else []
    return {
        "mode": mode, "status": status, "run_id": run_id,
        "candidates": candidates, "promoted_fact_ids": promoted,
    }


def build_claim_ledger(
    market_date: date, facts: list[Any], candidates: list[ExternalEvidenceCandidate],
) -> list[ClaimLedgerEntry]:
    entries: list[ClaimLedgerEntry] = []
    for fact in facts:
        text = _normalized(getattr(fact, "statement", ""))
        if not text:
            continue
        dated_digest = _claim_key(f"{market_date.isoformat()}|{text}")
        entries.append(ClaimLedgerEntry(
            claim_id=f"CLAIM-{dated_digest[:20]}", claim_type=ClaimType.CONFIRMED_FACT,
            claim_text=text, supporting_fact_ids=[str(getattr(fact, "fact_id", ""))],
            source_attribution=_normalized(getattr(fact, "attribution", "")) or None,
            market_date=market_date, publishable=True,
        ))
    grouped: dict[str, list[ExternalEvidenceCandidate]] = defaultdict(list)
    for candidate in candidates:
        grouped[_claim_key(candidate.claim_text)].append(candidate)
    for group in grouped.values():
        supports = [item.evidence_id for item in group if item.relationship != EvidenceRelationship.REFUTES]
        refutes = [item.evidence_id for item in group if item.relationship == EvidenceRelationship.REFUTES]
        verified = all(item.verification_status == "verified" for item in group if item.source_tier <= 2)
        claim_type = ClaimType.UNRESOLVED if refutes else ClaimType.EXTERNAL_CONFIRMATION
        dated_digest = _claim_key(f"{market_date.isoformat()}|{group[0].claim_text}")
        entries.append(ClaimLedgerEntry(
            claim_id=f"CLAIM-{dated_digest[:20]}", claim_type=claim_type,
            claim_text=group[0].claim_text,
            supporting_fact_ids=list(dict.fromkeys(
                fact_id for item in group for fact_id in item.supporting_internal_fact_ids
            )),
            supporting_external_evidence_ids=supports, refuting_evidence_ids=refutes,
            source_attribution=group[0].source_publisher, market_date=market_date,
            publishable=verified and not refutes,
        ))
    deduped: dict[str, ClaimLedgerEntry] = {}
    for entry in entries:
        current = deduped.get(entry.claim_id)
        if current is None:
            deduped[entry.claim_id] = entry
            continue
        unresolved = (
            current.claim_type == ClaimType.UNRESOLVED
            or entry.claim_type == ClaimType.UNRESOLVED
        )
        supporting_fact_ids = list(dict.fromkeys([
            *current.supporting_fact_ids, *entry.supporting_fact_ids,
        ]))
        deduped[entry.claim_id] = current.model_copy(update={
            "claim_type": (
                ClaimType.UNRESOLVED if unresolved
                else ClaimType.CONFIRMED_FACT if supporting_fact_ids
                else ClaimType.EXTERNAL_CONFIRMATION
            ),
            "supporting_fact_ids": supporting_fact_ids,
            "supporting_external_evidence_ids": list(dict.fromkeys([
                *current.supporting_external_evidence_ids,
                *entry.supporting_external_evidence_ids,
            ])),
            "refuting_evidence_ids": list(dict.fromkeys([
                *current.refuting_evidence_ids, *entry.refuting_evidence_ids,
            ])),
            "source_attribution": current.source_attribution or entry.source_attribution,
            "publishable": (current.publishable or entry.publishable) and not unresolved,
        })
    return list(deduped.values())


def persist_claim_ledger(connection: Connection[Any], entries: list[ClaimLedgerEntry]) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        for entry in entries:
            normalized_hash = _claim_key(entry.claim_text)
            cursor.execute(
                """INSERT INTO editorial_claim_ledger (
                     claim_id,market_date,normalized_claim_hash,claim_type,claim_text,
                     supporting_fact_ids,supporting_external_evidence_ids,refuting_evidence_ids,
                     source_attribution,publishable,claim_json
                   ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (market_date,normalized_claim_hash) DO UPDATE SET
                     claim_id=EXCLUDED.claim_id,claim_type=EXCLUDED.claim_type,
                     supporting_fact_ids=EXCLUDED.supporting_fact_ids,
                     supporting_external_evidence_ids=EXCLUDED.supporting_external_evidence_ids,
                     refuting_evidence_ids=EXCLUDED.refuting_evidence_ids,
                     publishable=EXCLUDED.publishable,claim_json=EXCLUDED.claim_json,updated_at=now()""",
                (
                    entry.claim_id, entry.market_date, normalized_hash, entry.claim_type.value,
                    entry.claim_text, Jsonb(entry.supporting_fact_ids),
                    Jsonb(entry.supporting_external_evidence_ids), Jsonb(entry.refuting_evidence_ids),
                    entry.source_attribution, entry.publishable, Jsonb(entry.model_dump(mode="json")),
                ),
            )


def _story_form(topic: ArticleTopic, dossiers: list[SourceDossier], facts: list[Any]) -> StoryForm:
    topic_facts = [fact for fact in facts if str(getattr(fact, "fact_id", "")) in set(topic.fact_ids)]
    topic_section_ids = {
        str(getattr(fact, "article_section_id", "") or "") for fact in topic_facts
        if str(getattr(fact, "article_section_id", "") or "")
    }
    aligned_excerpts = [
        excerpt for dossier in dossiers for excerpt in dossier.paragraph_excerpt_candidates
        if not topic_section_ids or excerpt.section_id in topic_section_ids
    ]
    close_reading_genres = {
        SourceGenre.ANALYSIS, SourceGenre.COLUMN, SourceGenre.INVESTIGATION,
    }
    if (
        len({str(getattr(fact, "source_id", "")) for fact in topic_facts}) == 1
        and bool(dossiers)
        and all(dossier.source_genre in close_reading_genres for dossier in dossiers)
        and (len(aligned_excerpts) >= 4 or len(topic_facts) >= 5)
    ):
        return StoryForm.SOURCE_CLOSE_READING
    if len({str(getattr(fact, "source_id", "")) for fact in topic_facts}) >= 2:
        return StoryForm.MULTI_SOURCE_SYNTHESIS
    if any(getattr(fact, "value", None) is not None for fact in topic_facts):
        return StoryForm.DATA_EXPLAINER
    return StoryForm.EVENT_TIMELINE


def build_story_brief(
    market_date: date, topic: ArticleTopic, dossiers: list[SourceDossier],
    facts: list[Any], ledger: list[ClaimLedgerEntry],
) -> tuple[StoryBrief, list[str]]:
    topic_fact_ids = set(topic.fact_ids)
    source_ids = {
        str(getattr(fact, "source_id", "")) for fact in facts
        if str(getattr(fact, "fact_id", "")) in topic_fact_ids
    }
    topic_dossiers = [dossier for dossier in dossiers if dossier.source_id in source_ids]
    claims = [entry for entry in ledger if topic_fact_ids & set(entry.supporting_fact_ids)]
    topic_section_ids = {
        str(getattr(fact, "article_section_id", "") or "") for fact in facts
        if str(getattr(fact, "fact_id", "")) in topic_fact_ids
        and str(getattr(fact, "article_section_id", "") or "")
    }
    dossier_excerpts = [
        excerpt for dossier in topic_dossiers for excerpt in dossier.paragraph_excerpt_candidates
        if not topic_section_ids or excerpt.section_id in topic_section_ids
    ][:8]
    form = _story_form(topic, topic_dossiers, facts)
    use_dossier_excerpts = (
        form == StoryForm.SOURCE_CLOSE_READING
        and len(dossier_excerpts) >= 4
    )
    excerpts = dossier_excerpts if use_dossier_excerpts else []
    fact_excerpt_ids = [
        fact_excerpt_id(
            str(getattr(fact, "source_id", "")),
            str(getattr(fact, "evidence_text", "")),
        )
        for fact in facts
        if str(getattr(fact, "fact_id", "")) in topic_fact_ids
        and str(getattr(fact, "evidence_text", "")).strip()
    ]
    takeaway = next((entry.claim_text for entry in claims if entry.publishable), topic.title_hint)
    source_thesis = takeaway
    brief_digest = _digest("|".join((market_date.isoformat(), topic.topic_cluster_key or topic.slug, STORY_PLANNER_VERSION)))
    brief = StoryBrief(
        story_brief_id=f"BRIEF-{brief_digest[:20]}", market_date=market_date,
        reader_question=next((d.central_question for d in topic_dossiers if d.central_question), topic.title_hint),
        one_sentence_takeaway=takeaway, source_thesis=source_thesis,
        editorial_angle=topic.title_hint,
        new_information=[entry.claim_text for entry in claims if entry.publishable][:6],
        must_use_excerpt_ids=(
            [excerpt.excerpt_id for excerpt in excerpts[:8]]
            if excerpts else fact_excerpt_ids[:6]
        ),
        external_context_ids=list(dict.fromkeys(
            evidence_id for entry in claims if entry.publishable
            for evidence_id in entry.supporting_external_evidence_ids
        )),
        allowed_inference_ids=[entry.claim_id for entry in claims if entry.claim_type == ClaimType.EDITORIAL_INFERENCE],
        prohibited_claims=[entry.claim_text for entry in claims if entry.claim_type == ClaimType.UNRESOLVED],
        story_form=form,
        opening_strategy="Open with the source's strongest tension, question, or concrete fact.",
        ending_strategy="End with the source qualification or a specific unresolved evidence gap.",
        merged_candidate_ids=topic.merged_candidate_ids or ([topic.candidate_id] if topic.candidate_id else []),
    )
    issues = []
    known_excerpt_ids = (
        {item.excerpt_id for item in excerpts}
        if excerpts else set(fact_excerpt_ids)
    )
    if not (set(brief.must_use_excerpt_ids) <= known_excerpt_ids):
        issues.append("STORY_BRIEF_UNKNOWN_EXCERPT")
    if not takeaway:
        issues.append("STORY_BRIEF_MISSING_TAKEAWAY")
    return brief, issues


def persist_story_brief(
    connection: Connection[Any], topic: ArticleTopic, brief: StoryBrief, issues: list[str],
) -> None:
    cluster = topic.topic_cluster_key or topic.slug
    idempotency_key = f"{brief.market_date.isoformat()}:{cluster}:{STORY_PLANNER_VERSION}"
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """INSERT INTO story_briefs (
                 story_brief_id,market_date,topic_cluster_key,planner_version,idempotency_key,
                 brief_json,validation_status,validation_issues
               ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (market_date,topic_cluster_key,planner_version) DO UPDATE SET
                 brief_json=EXCLUDED.brief_json,validation_status=EXCLUDED.validation_status,
                 validation_issues=EXCLUDED.validation_issues,updated_at=now()""",
            (
                brief.story_brief_id, brief.market_date, cluster, STORY_PLANNER_VERSION,
                idempotency_key, Jsonb(brief.model_dump(mode="json")),
                "reject" if issues else "pass", Jsonb(issues),
            ),
        )

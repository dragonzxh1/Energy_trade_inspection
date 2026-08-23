"""Independent Dify publication review with one revision and fail-closed semantics."""

from __future__ import annotations

import json
import os
import re
from typing import Any

import httpx


THINK_PATTERN = re.compile(r"<think>.*?</think>", re.IGNORECASE | re.DOTALL)
REVIEW_EVIDENCE_LIMIT = 98000
QUOTED_TEXT_PATTERN = re.compile(r'[“"]([^”"]+)[”"]')
MISTRANSLATION_PATTERN = re.compile(r"误译|翻译|译文|mistranslat", re.IGNORECASE)

ARTICLE_REVIEW_CONTRACTS: dict[str, dict[str, Any]] = {
    "faithful_translation": {
        "purpose": "Preserve the source argument and qualification without forcing a market call.",
        "semantic_requirements": [
            "answer the reader question", "preserve the source thesis and argument order",
            "use the selected translated excerpts", "retain qualifications and uncertainty",
            "attribute the source and include reference titles",
        ],
        "minimum_translated_excerpts": 4,
        "directional_conclusion_required": False,
    },
    "event_brief": {
        "purpose": "Report a dated market event with explicit actor, action and affected market.",
        "semantic_requirements": [
            "identify the dated actor, action and affected market", "separate confirmed details from source views",
            "state concrete information gaps", "attribute the source and include reference titles",
        ],
        "minimum_translated_excerpts": 1,
        "directional_conclusion_required": False,
    },
    "market_analysis": {
        "purpose": "Explain one evidence-bound transmission chain from facts to market pricing.",
        "semantic_requirements": [
            "answer the reader question", "bind every material statement to supplied evidence",
            "explain at least one evidence-bound transmission chain", "state concrete uncertainty",
            "attribute the source and include reference titles",
        ],
        "minimum_translated_excerpts": 0,
        "directional_conclusion_required": False,
    },
}


def article_review_contract(article_mode: str) -> dict[str, Any]:
    legacy_mapping = {"factual_brief": "event_brief", "market_view": "market_analysis"}
    canonical_mode = legacy_mapping.get(article_mode, article_mode)
    return {"article_mode": canonical_mode, **ARTICLE_REVIEW_CONTRACTS.get(canonical_mode, {})}


def compact_review_evidence(payload: dict[str, Any]) -> dict[str, Any]:
    view=payload.get("editorial_view") or {}
    compact_view={
        key:view.get(key)
        for key in ("market_date", "article_mode", "publication_angle", "uncertainties")
        if key in view
    }
    fact_fields=(
        "fact_id","source_id","source_title","market_date","commodity","benchmark","fact_type",
        "statement","value","unit","change_value","change_unit","direction",
        "time_basis","evidence_text","attribution","uncertainty","confidence",
    )
    facts=[]
    referenced_sources=set()
    for item in payload.get("verified_facts",[]):
        value=item if isinstance(item,dict) else vars(item)
        compact={key:value.get(key) for key in fact_fields if value.get(key) is not None}
        facts.append(compact)
        if compact.get("source_id"):
            referenced_sources.add(compact["source_id"])
    mapping=payload.get("source_mapping") or {}
    compact={
        "editorial_view":compact_view,
        "primary_event":payload.get("primary_event", {}),
        "evidence_policy":payload.get("evidence_policy", {}),
        "verified_facts":facts,
        "source_excerpts":payload.get("source_excerpts",[]),
        "story_brief":payload.get("story_brief",{}),
        "claim_ledger":payload.get("claim_ledger",[]),
        "external_confirmations":payload.get("external_confirmations",[]),
        "source_mapping":{key:mapping[key] for key in referenced_sources if key in mapping},
        "publication_policy": {
            "blocking": [
                "wrong_date", "fabricated_or_untraceable_fact", "wrong_number_or_unit",
                "material_mistranslation", "source_mismatch", "unsupported_conclusion",
                "internal_information_leak", "unsafe_html", "template_residue",
                "unrelated_event_or_topic_mixed_into_article",
            ],
            "advisory_only": [
                "missing_verbatim_excerpt", "missing_counter_signal",
                "missing_invalidation_condition", "fewer_than_three_validation_metrics",
                "missing_directional_prediction", "single_attributed_authoritative_source",
            ],
            "editorial_requirement": (
                "Attribute material claims to supplied source titles. Do not require directional "
                "predictions, counter-signals, invalidation conditions, or three metrics for a factual brief. "
                "Every paragraph must belong to primary_event. Facts from another article, actor, page, "
                "or event are blocking even when those facts are individually verified. The main body must "
                "read as an independently edited Chinese energy news report: lead with the news event, order "
                "facts by news value, attribute source views, and keep complete faithful translations in the "
                "separate excerpt section rather than narrating the body as a translation guide."
            ),
            "article_contract": article_review_contract(str(compact_view.get("article_mode") or "")),
            "decision_rule": (
                "Advisory-only items must not lower the score or change a pass to a reject. "
                "A material-mistranslation blocker must quote the disputed Chinese wording "
                "from report_markdown exactly."
            ),
        },
    }
    encoded=json.dumps(compact,ensure_ascii=False,default=str)
    if len(encoded) >= REVIEW_EVIDENCE_LIMIT:
        raise ValueError(
            f"review evidence remains too large after safe compaction: {len(encoded)} characters"
        )
    return compact


def _decode_outputs(response: dict[str, Any]) -> dict[str, Any]:
    data = response.get("data", {})
    outputs = data.get("outputs", response) if isinstance(data, dict) else response
    if isinstance(outputs, dict) and ("decision" in outputs or "revised_markdown" in outputs):
        normalized = dict(outputs)
        dimension_scores_json = normalized.pop("dimension_scores_json", None)
        if dimension_scores_json and "dimension_scores" not in normalized:
            try:
                normalized["dimension_scores"] = json.loads(str(dimension_scores_json))
            except json.JSONDecodeError:
                normalized["dimension_scores"] = {}
        return normalized
    for value in outputs.values() if isinstance(outputs, dict) else []:
        if isinstance(value, dict):
            return value
        if isinstance(value, str):
            cleaned = THINK_PATTERN.sub("", value).strip().strip("`").removeprefix("json").strip()
            try:
                decoded = json.loads(cleaned)
            except json.JSONDecodeError:
                continue
            if isinstance(decoded, dict):
                return decoded
    diagnostics: list[str] = []
    if isinstance(outputs, dict):
        for key, value in list(outputs.items())[:12]:
            if isinstance(value, str):
                preview = re.sub(r"\s+", " ", THINK_PATTERN.sub("", value)).strip()[:240]
                diagnostics.append(f"{key}=str:{preview!r}")
            else:
                diagnostics.append(f"{key}={type(value).__name__}")
    else:
        diagnostics.append(f"outputs={type(outputs).__name__}")
    if isinstance(data, dict):
        status = str(data.get("status") or "").strip()
        error = re.sub(r"\s+", " ", str(data.get("error") or "")).strip()[:500]
        if status:
            diagnostics.append(f"workflow_status={status!r}")
        if error:
            diagnostics.append(f"workflow_error={error!r}")
    detail = "; ".join(diagnostics) or "no outputs"
    raise ValueError(f"review workflow output is not a JSON object ({detail})")


def call_review(
    base_url: str, api_key: str, *, mode: str, market_date: str, markdown: str,
    evidence_payload: dict[str, Any], previous_review: dict[str, Any] | None = None,
) -> dict[str, Any]:
    compact_evidence=compact_review_evidence(evidence_payload)
    article_mode = str(
        (compact_evidence.get("editorial_view") or {}).get("article_mode")
        or (compact_evidence.get("publication_policy") or {}).get("article_contract", {}).get("article_mode")
        or "event_brief"
    )
    article_mode = {
        "market_view": "market_analysis",
        "factual_brief": "event_brief",
    }.get(article_mode, article_mode)
    request_payload = {"inputs": {
            "mode": mode, "article_mode": article_mode,
            "date": market_date, "report_markdown": markdown,
            "extractions": json.dumps(compact_evidence, ensure_ascii=False, default=str),
            "previous_review": json.dumps(previous_review or {}, ensure_ascii=False),
        }, "response_mode": "blocking", "user": "market-publication-review"}

    def execute(workflow_key: str) -> dict[str, Any]:
        response = httpx.post(
            f"{base_url.rstrip('/')}/v1/workflows/run",
            headers={"Authorization": f"Bearer {workflow_key}"},
            json=request_payload,
            timeout=300,
        )
        if response.is_error:
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as error:
                raise httpx.HTTPStatusError(
                    f"Dify review workflow returned HTTP {response.status_code}: {response.text[:1200]}",
                    request=error.request,response=error.response,
                ) from error
        result = _decode_outputs(response.json())
        if mode == "review":
            if str(result.get("decision") or "") not in {"pass", "reject"}:
                raise ValueError("review workflow returned an invalid decision")
            try:
                score = float(result.get("score"))
            except (TypeError, ValueError) as error:
                raise ValueError("review workflow returned an invalid score") from error
            if not 0 <= score <= 100:
                raise ValueError("review workflow returned a score outside 0-100")
            if not isinstance(result.get("blocking_issues", []), list):
                raise ValueError("review workflow returned invalid blocking_issues")
        elif mode == "revise" and not str(result.get("revised_markdown") or "").strip():
            raise ValueError("review workflow returned empty revised_markdown")
        return result

    try:
        return execute(api_key)
    except ValueError:
        repair_key = os.getenv("DIFY_WORKFLOW_API_KEY_REVIEW_REPAIR", "").strip()
        if not repair_key or repair_key == api_key:
            raise
        return execute(repair_key)


def review_passes(review: dict[str, Any]) -> bool:
    return (
        str(review.get("decision", "")).lower() == "pass"
        and float(review.get("score", 0)) >= 85
        and not review.get("blocking_issues")
    )


def validate_review_against_final_markdown(
    review: dict[str, Any], markdown: str,
) -> dict[str, Any]:
    """Reject only translation blockers that point to wording in the final article."""
    normalized = dict(review)
    source_text = re.sub(r"\s+", " ", markdown).casefold()
    valid_blockers: list[str] = []
    unsupported: list[str] = []
    markdown_lines = [line.strip() for line in markdown.splitlines() if line.strip()]

    def has_adjacent_original(translation: str) -> bool:
        for index, line in enumerate(markdown_lines):
            if translation not in line:
                continue
            preceding = " ".join(markdown_lines[max(0, index - 3):index])
            if len(re.findall(r"[A-Za-z]", preceding)) >= 12:
                return True
        return False

    for raw_issue in review.get("blocking_issues", []):
        issue = str(raw_issue).strip()
        chinese_quotes = [
            quote.strip() for quote in QUOTED_TEXT_PATTERN.findall(issue)
            if len(quote.strip()) >= 4 and re.search(r"[\u4e00-\u9fff]", quote)
        ]
        is_translation_issue = bool(MISTRANSLATION_PATTERN.search(issue))
        claims_missing_original = any(
            phrase in issue
            for phrase in ("无对应的英文原文", "无对应英文原文", "没有对应的英文原文")
        )
        if (
            claims_missing_original
            and chinese_quotes
            and any(has_adjacent_original(quote) for quote in chinese_quotes)
        ):
            unsupported.append(issue)
            continue
        if is_translation_issue and chinese_quotes and not any(
            re.sub(r"\s+", " ", quote).casefold() in source_text
            for quote in chinese_quotes
        ):
            unsupported.append(issue)
            continue
        valid_blockers.append(issue)
    normalized["blocking_issues"] = valid_blockers
    if unsupported:
        normalized["unsupported_blocking_issues"] = unsupported
    if (
        unsupported
        and not valid_blockers
        and str(review.get("decision", "")).lower() == "reject"
    ):
        normalized["model_decision"] = review.get("decision")
        normalized["model_score"] = review.get("score")
        normalized["decision"] = "pass"
        normalized["score"] = max(float(review.get("score", 0)), 85.0)
        normalized["deterministic_resolution"] = (
            "All model translation blockers were absent from the final Markdown."
        )
    return normalized

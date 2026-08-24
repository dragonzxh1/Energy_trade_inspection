"""Build and audit one traceable EditorialView per market date."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from .contracts import (
    ArticleMode,
    EditorialSignalRef,
    EditorialView,
    SignalDirection,
    SignalStatus,
    ViewChangeType,
)
from .editorial_candidates import build_editorial_candidates


VIEW_NAMESPACE = uuid.UUID("2fc2ccfc-2a8f-4e23-8ee4-095f46e451ba")


def _signal_ref(signal: Any) -> EditorialSignalRef:
    return EditorialSignalRef(
        signal_id=signal.signal_id, signal_type=signal.signal_type,
        direction=signal.direction, confidence=signal.confidence, score=signal.score,
        summary=signal.summary, supporting_fact_ids=list(signal.supporting_fact_ids),
    )


def _change_type(top: Any | None, previous_top: Any | None) -> ViewChangeType:
    if top is None:
        return ViewChangeType.LOW_SIGNAL
    if previous_top is None:
        return ViewChangeType.NEW_THEME
    if top.signal_type != previous_top.signal_type:
        return ViewChangeType.DRIVER_SHIFT
    if top.direction != previous_top.direction:
        return ViewChangeType.REVERSAL
    if top.score >= previous_top.score + 8:
        return ViewChangeType.STRENGTHENING
    if top.score <= previous_top.score - 8:
        return ViewChangeType.WEAKENING
    return ViewChangeType.CONTINUATION


def build_editorial_view(
    market_date: date, signals: list[Any], *, previous_signals: list[Any],
    knowledge_card: Any | None, allowed_fact_ids: set[str], unresolved_fact_ids: set[str],
    facts: list[Any] | None = None,
) -> EditorialView:
    top_candidates = [signal for signal in signals if signal.status == SignalStatus.TOP]
    top = sorted(top_candidates, key=lambda signal: (-signal.score, signal.signal_id))[0] if top_candidates else None
    previous_top_candidates = [signal for signal in previous_signals if signal.status == SignalStatus.TOP]
    previous_top = sorted(previous_top_candidates, key=lambda signal: (-signal.score, signal.signal_id))[0] if previous_top_candidates else None
    secondaries = [signal for signal in signals if signal.status in {SignalStatus.SECONDARY, SignalStatus.WEAK}]
    counters = [
        signal for signal in secondaries
        if top and signal.direction in {SignalDirection.BULLISH, SignalDirection.BEARISH}
        and top.direction in {SignalDirection.BULLISH, SignalDirection.BEARISH}
        and signal.direction != top.direction
    ]
    if not counters:
        counters = [signal for signal in secondaries if signal.signal_id != getattr(top, "signal_id", None)][:1]
    change_type = _change_type(top, previous_top)
    supporting_fact_ids = list(dict.fromkeys(top.supporting_fact_ids if top else []))
    invalidation = list(getattr(knowledge_card, "invalidation_conditions", []))[:3]
    validation_metrics = list(getattr(knowledge_card, "validation_metrics", []))[:5]
    if top:
        main_thesis = top.summary
        comparison = (
            f"Today's leading signal is {change_type.value} versus the previous publishable day; "
            f"score {top.score} with {len(top.support_dimensions)} independent support dimensions."
        )
    else:
        main_thesis = "已核验信息不足以支持单一、可发布的市场主线。"
        comparison = "No top signal is available; preserve the verified record without publishing a market call."
    uncertainties = []
    if not counters:
        uncertainties.append("No independently verified counter-signal is available.")
    if top and not invalidation:
        uncertainties.append("No topic-specific invalidation condition is available.")
    if top and len(validation_metrics) < 3:
        uncertainties.append("Fewer than three topic-specific validation metrics are available.")
    if any(fact_id in unresolved_fact_ids for fact_id in supporting_fact_ids):
        uncertainties.append("One or more supporting facts have unresolved conflicts.")
    directional_signal_available = top is not None
    candidates = build_editorial_candidates(
        market_date, facts or [], directional_signal_available=directional_signal_available,
    )
    evidence_ready = bool(candidates)
    editorially_publishable = bool(top or candidates)
    article_mode = (
        ArticleMode.MARKET_ANALYSIS if top else
        candidates[0][0].article_mode if candidates else
        ArticleMode.ARCHIVE_ONLY
    )
    candidate_fact_ids = list(dict.fromkeys(
        fact_id for candidate, _ in candidates for fact_id in candidate.fact_ids
    ))
    candidate_sources = {
        source_id for candidate, _ in candidates for source_id in candidate.source_ids
    }
    candidate_excerpts = list(dict.fromkeys(
        excerpt_id for candidate, _ in candidates for excerpt_id in candidate.excerpt_ids
    ))
    if not supporting_fact_ids:
        supporting_fact_ids = candidate_fact_ids
    if not top and candidates:
        main_thesis = candidates[0][0].headline_subject
        comparison = "当日材料具备报道价值，但不足以形成方向性市场判断。"
    view = EditorialView(
        view_id=f"VIEW-{uuid.uuid5(VIEW_NAMESPACE, market_date.isoformat())}", market_date=market_date,
        main_thesis=main_thesis, top_signal=_signal_ref(top) if top else None,
        secondary_signals=[_signal_ref(signal) for signal in secondaries[:3]],
        counter_signals=[_signal_ref(signal) for signal in counters[:2]],
        view_change_type=change_type, comparison_with_previous_day=comparison,
        supporting_fact_ids=supporting_fact_ids, invalidation_conditions=invalidation,
        validation_metrics=validation_metrics, uncertainties=uncertainties,
        publishable=editorially_publishable,
        evidence_ready=evidence_ready,
        editorially_publishable=editorially_publishable,
        directional_signal_available=directional_signal_available,
        article_mode=article_mode,
        publication_angle=candidates[0][0].headline_subject if candidates else main_thesis,
        evidence_strength=min(1.0, len(candidate_fact_ids) / 10) if candidates else (1.0 if top else 0.0),
        source_diversity=len(candidate_sources),
        translation_candidates=candidate_excerpts,
        reader_value=candidates[0][0].newsworthiness_score if candidates else (80 if top else 0),
    )
    issues = audit_editorial_view(view, allowed_fact_ids, unresolved_fact_ids)
    view.audit_issues = issues
    view.editorially_publishable = view.editorially_publishable and not issues
    view.publishable = view.editorially_publishable
    if not view.editorially_publishable:
        view.article_mode = ArticleMode.ARCHIVE_ONLY
    return view


def audit_editorial_view(
    view: EditorialView, allowed_fact_ids: set[str], unresolved_fact_ids: set[str]
) -> list[str]:
    issues: list[str] = []
    if not view.main_thesis.strip():
        issues.append("main_thesis is empty")
    if view.top_signal:
        if view.top_signal.score < 70:
            issues.append("top signal score is below 70")
        if not view.supporting_fact_ids:
            issues.append("main thesis has no supporting facts")
    elif view.view_change_type != ViewChangeType.LOW_SIGNAL:
        issues.append("missing top signal without low_signal state")
    unknown = set(view.supporting_fact_ids) - allowed_fact_ids
    if unknown:
        issues.append(f"view references unverified facts: {sorted(unknown)}")
    unresolved = set(view.supporting_fact_ids) & unresolved_fact_ids
    if unresolved:
        issues.append(f"view references unresolved facts: {sorted(unresolved)}")
    return issues

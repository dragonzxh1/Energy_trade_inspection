"""EditorialView to local archive, reviewed article, and existing WeChat state machine."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable
from urllib.parse import urlparse

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from intelligence.content_streams import (
    ArticleLocator,
    atomic_write_json,
    atomic_write_text as write_text_atomically,
    build_artifact_identity,
    resolve_article_paths,
)
from intelligence.wechat_publish import (
    DEFAULT_CONFIG_PATH,
    load_rollout_state,
    markdown_to_report_html,
    read_publish_config,
    record_auto_success,
    reset_rollout_state,
)
from intelligence.telegram_notify import NotificationEvent, emit_event

from .article import (
    article_disclosure_warnings,
    audit_article,
    build_topic_editorial_view,
    build_writer_payload,
    call_dify_writer,
    delete_review_blocked_sentences,
    sanitize_article_markdown,
    reader_character_count,
)
from .article_review import call_review, review_passes, validate_review_against_final_markdown
from .article_topics import normalize_digit_article_markdown, plan_article_topics_with_diagnostics
from .contracts import (
    ArticleMode,
    ArticleTopic,
    ClaimLedgerEntry,
    FactDirection,
    FactType,
    StoryBrief,
    StoryForm,
    SignalDirection,
    SignalStatus,
)
from .editorial import build_editorial_view
from .external_research import (
    build_claim_ledger,
    build_story_brief,
    persist_claim_ledger,
    persist_story_brief,
    prepare_external_research,
)
from .faithful_translation import append_faithful_translations, translate_excerpts
from .knowledge import retrieve_knowledge_card
from .source_dossier import (
    dossiers_for_topic,
    load_and_persist_source_dossiers,
    load_source_dossiers,
    paragraph_excerpts_for_topic,
)
from .editorial_style import audit_editorial_style, load_recent_digit_markdowns


ARTICLE_NAMESPACE = uuid.UUID("3ee33245-970b-4df4-ad3f-f24665570c52")
GENERIC_SOURCE_TITLE=re.compile(r"(?i)^(?:volume\s+\d+\s*/\s*issue|page\s+\d+|https?://|www\.)")
SOURCE_TITLE_FRAGMENT=re.compile(r"^[a-z]")
DIGIT_SOURCE_CHANNEL = "telegram:platts-digits"
DIGIT_ALLOWED_FACTS_CTE = """
allowed_facts AS (
  SELECT DISTINCT fact.fact_id
  FROM market_facts fact
  JOIN source_documents document ON document.id = fact.source_document_id
  WHERE (
      document.source_origin = 'external_web'
      OR EXISTS (
        SELECT 1
        FROM telegram_message_attachments linked
        JOIN telegram_messages message ON message.id = linked.message_id
        WHERE linked.attachment_id = document.attachment_id
          AND message.source_channel = %s
      )
    )
    AND fact.is_current = true
    AND fact.verification_status = 'verified'
    AND fact.publication_blocked = false
)
"""
DIGIT_ALLOWED_METRICS_CTE = """
allowed_metrics AS (
  SELECT metric.metric_id
  FROM market_metrics metric
  WHERE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(metric.source_fact_ids) AS source_fact(fact_id)
    LEFT JOIN allowed_facts allowed ON allowed.fact_id = source_fact.fact_id
    WHERE allowed.fact_id IS NULL
  )
)
"""


def _publication_run_id() -> str:
    run_id = os.getenv("ETI_RUN_ID", "").strip()
    if run_id:
        return run_id
    run_id = f"DIGIT-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    os.environ["ETI_RUN_ID"] = run_id
    return run_id


def _read_json_snapshot(path_value: Any) -> dict[str, Any]:
    path_text = str(path_value or "").strip()
    if not path_text:
        return {}
    try:
        payload = json.loads(Path(path_text).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def ensure_reference_section(markdown: str, source_excerpts: list[dict[str, Any]]) -> str:
    titles = list(dict.fromkeys(
        str(item.get("source_title", "")).strip() for item in source_excerpts
        if str(item.get("source_title", "")).strip()
    ))
    if not titles:
        return markdown
    without_existing = re.sub(
        r"(?ms)^(?:##\s+)?(?:参考资料|资料)[ \t]*[:：]?[ \t]*\n"
        r"(?:[ \t]*\n)*(?:[ \t]*-[ \t]*[^\n]+(?:\n|\Z))*",
        "",
        markdown,
    )
    without_existing = re.sub(
        r"(?m)^[ \t]*参考资料[ \t]*[:：][^\n]*\n?",
        "",
        without_existing,
    )
    for title in titles:
        without_existing = re.sub(
            rf"(?m)^[ \t]*{re.escape(title)}[ \t]*$",
            "",
            without_existing,
        )
    return without_existing.rstrip() + "\n\n## 参考资料\n" + "\n".join(
        f"- {title}" for title in titles
    ) + "\n"


def repair_empty_lead_section(markdown: str, article_mode: str) -> str:
    section_pairs = {
        "market_analysis": ("核心变化", "关键数据与事实"),
        "market_view": ("核心变化", "关键数据与事实"),
        "event_brief": ("发生了什么", "已确认细节"),
        "factual_brief": ("发生了什么", "原文主要讲了什么"),
        "faithful_translation": ("原文讨论的核心问题", "原文论述脉络"),
    }
    pair = section_pairs.get(article_mode)
    if not pair:
        return markdown
    target_heading, source_heading = pair
    target_pattern = re.compile(
        rf"(?ms)(^##\s+{re.escape(target_heading)}\s*$\n)(.*?)(?=^##\s+|\Z)"
    )
    target_match = target_pattern.search(markdown)
    if not target_match or target_match.group(2).strip():
        return markdown
    source_match = re.search(
        rf"(?ms)^##\s+{re.escape(source_heading)}\s*$\n(.*?)(?=^##\s+|\Z)",
        markdown,
    )
    if not source_match:
        return markdown
    source_blocks = [
        block.strip()
        for block in re.split(r"\n\s*\n", source_match.group(1))
        if block.strip()
    ]
    if not source_blocks:
        return markdown
    return (
        markdown[:target_match.start(2)]
        + source_blocks[0]
        + "\n\n"
        + markdown[target_match.end(2):]
    )


def repair_empty_source_description(
    markdown: str, article_mode: str, translations: list[dict[str, Any]],
) -> str:
    if article_mode not in {"event_brief", "factual_brief"}:
        return markdown
    target_match = re.search(
        r"(?ms)(^##\s+来源如何描述\s*$\n)(.*?)(?=^##\s+|\Z)",
        markdown,
    )
    if not target_match or target_match.group(2).strip():
        return markdown
    excerpt = next((
        item for item in translations
        if str(item.get("translated_excerpt") or "").strip()
    ), None)
    if not excerpt:
        return markdown
    source_title = str(excerpt.get("source_title") or "来源材料").strip()
    translated = str(excerpt.get("translated_excerpt") or "").strip()
    source_line = f"{source_title}写道：“{translated}”"
    return (
        markdown[:target_match.start(2)]
        + source_line
        + "\n\n"
        + markdown[target_match.end(2):]
    )


def promote_source_close_reading_topic(
    topic: ArticleTopic, brief: StoryBrief,
) -> ArticleTopic:
    if (
        topic.article_mode == ArticleMode.FAITHFUL_TRANSLATION
        and brief.story_form != StoryForm.SOURCE_CLOSE_READING
    ):
        evidence_bundle = topic.evidence_bundle
        if evidence_bundle is not None:
            evidence_bundle = evidence_bundle.model_copy(update={
                "article_mode": ArticleMode.EVENT_BRIEF,
            })
        return topic.model_copy(update={
            "article_mode": ArticleMode.EVENT_BRIEF,
            "evidence_bundle": evidence_bundle,
            "rationale": f"{topic.rationale}; newsroom_event_story",
        })
    if (
        topic.article_mode not in {ArticleMode.EVENT_BRIEF, ArticleMode.FACTUAL_BRIEF}
        or brief.story_form != StoryForm.SOURCE_CLOSE_READING
        or len(brief.must_use_excerpt_ids) < 4
    ):
        return topic
    evidence_bundle = topic.evidence_bundle
    if evidence_bundle is not None:
        evidence_bundle = evidence_bundle.model_copy(update={
            "article_mode": ArticleMode.FAITHFUL_TRANSLATION,
        })
    return topic.model_copy(update={
        "article_mode": ArticleMode.FAITHFUL_TRANSLATION,
        "evidence_bundle": evidence_bundle,
        "rationale": f"{topic.rationale}; source_close_reading_with_paragraph_evidence",
    })


def attach_approved_translations(
    excerpts: list[dict[str, Any]], translations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    approved = {
        str(item.get("excerpt_id") or ""): item
        for item in translations
        if item.get("translation_review_status") == "pass"
    }
    merged: list[dict[str, Any]] = []
    for excerpt in excerpts:
        item = dict(excerpt)
        translation = approved.get(str(item.get("excerpt_id") or ""))
        if translation:
            item.update({
                "literal_translation": translation.get("literal_translation", ""),
                "translated_excerpt": translation.get("translated_excerpt", ""),
                "publication_translation": translation.get("publication_translation", ""),
                "translation_review_status": "pass",
            })
        merged.append(item)
    return merged


def _digit_signal_query(date_predicate: str, *, limit: str = "") -> str:
    return f"""WITH {DIGIT_ALLOWED_FACTS_CTE}, {DIGIT_ALLOWED_METRICS_CTE}
        SELECT signal.*
        FROM market_signals signal
        WHERE {date_predicate}
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
              signal.supporting_fact_ids || signal.counter_fact_ids
            ) AS signal_fact(fact_id)
            LEFT JOIN allowed_facts allowed ON allowed.fact_id = signal_fact.fact_id
            WHERE allowed.fact_id IS NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(signal.metric_ids) AS signal_metric(metric_id)
            LEFT JOIN allowed_metrics allowed ON allowed.metric_id = signal_metric.metric_id
            WHERE allowed.metric_id IS NULL
          )
        {limit}"""


def source_display_title(report_title: str,publisher: str,report_family: str) -> str:
    title=(report_title or "").strip()
    publisher_name=(publisher or "").strip()
    family_name=(report_family or "").strip()
    known_publisher=publisher_name and publisher_name.casefold() != "unknown"
    known_family=family_name and family_name.casefold() not in {"unknown","market_report"}
    if (
        not title
        or GENERIC_SOURCE_TITLE.search(title)
        or SOURCE_TITLE_FRAGMENT.search(title)
        or not re.search(r"[A-Za-z0-9\u4e00-\u9fff]{3}",title)
    ):
        if known_family: return family_name
        return publisher_name or "Market publication"
    if (
        known_publisher
        and known_family
        and publisher_name.casefold() == family_name.casefold()
        and title.casefold() != publisher_name.casefold()
    ):
        return publisher_name
    return title


def _rows(connection: Connection[Any], target_date: date) -> tuple[list[Any], list[Any], list[Any], list[Any], dict[str, str], set[str]]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            _digit_signal_query("signal.market_date = %s"),
            (DIGIT_SOURCE_CHANNEL, target_date),
        )
        signal_rows = list(cursor.fetchall())
        cursor.execute(
            _digit_signal_query(
                "signal.market_date < %s",
                limit="ORDER BY signal.market_date DESC LIMIT 20",
            ),
            (DIGIT_SOURCE_CHANNEL, target_date),
        )
        previous_rows = list(cursor.fetchall())
        cursor.execute(
            """SELECT fact.*, document.report_title,document.publisher,document.report_family,
               section.section_id AS article_section_id,
               section.section_title AS article_section_title,
               section.page_start AS article_page_start,
               section.page_end AS article_page_end,
               section.section_text AS article_section_text,
               EXISTS (SELECT 1 FROM fact_conflicts conflict WHERE conflict.conflict_status='unresolved'
                 AND (conflict.left_market_fact_id=fact.id OR conflict.right_market_fact_id=fact.id)) unresolved
               FROM market_facts fact
               JOIN source_documents document ON document.id=fact.source_document_id
               JOIN document_sections section ON section.id=fact.document_section_id
               WHERE (
                 document.source_origin = 'external_web'
                 OR EXISTS (
                 SELECT 1
                 FROM telegram_message_attachments linked
                 JOIN telegram_messages message ON message.id=linked.message_id
                 WHERE linked.attachment_id=document.attachment_id AND message.source_channel=%s
                 )
               )
                 AND fact.market_date=%s AND fact.is_current=true
                 AND fact.verification_status='verified' AND fact.publication_blocked=false""",
            (DIGIT_SOURCE_CHANNEL, target_date),
        )
        fact_rows = list(cursor.fetchall())
        cursor.execute(
            f"""WITH {DIGIT_ALLOWED_FACTS_CTE}
                SELECT metric.*
                FROM market_metrics metric
                WHERE metric.market_date = %s
                  AND NOT EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements_text(metric.source_fact_ids) AS source_fact(fact_id)
                    LEFT JOIN allowed_facts allowed ON allowed.fact_id = source_fact.fact_id
                    WHERE allowed.fact_id IS NULL
                  )""",
            (DIGIT_SOURCE_CHANNEL, target_date),
        )
        metric_rows = list(cursor.fetchall())
    def signal(row):
        return SimpleNamespace(
            signal_id=row["signal_id"], signal_type=row["signal_type"], direction=SignalDirection(row["direction"]),
            confidence=float(row["confidence"]), score=row["score"], summary=row["summary"],
            supporting_fact_ids=row["supporting_fact_ids"], counter_fact_ids=row.get("counter_fact_ids",[]),
            metric_ids=row.get("metric_ids",[]), title=row.get("title",""),
            support_dimensions=row["support_dimensions"],
            status=SignalStatus(row["signal_status"]), commodity=row["commodity"], region=row["region"],
        )
    signals = [signal(row) for row in signal_rows]
    previous = [signal(row) for row in previous_rows]
    facts = []
    mapping = {}
    unresolved = set()
    for row in fact_rows:
        values = dict(row)
        values["fact_type"] = FactType(row["fact_type"])
        values["direction"] = FactDirection(row["direction"])
        facts.append(SimpleNamespace(**values))
        mapping[row["source_id"]] = source_display_title(row["report_title"],row["publisher"],row["report_family"])
        if row["unresolved"]:
            unresolved.add(row["fact_id"])
    metrics = [SimpleNamespace(**dict(row)) for row in metric_rows]
    return signals, previous, facts, metrics, mapping, unresolved


def _persist_view(connection: Connection[Any], view: Any, *, is_historical: bool) -> str:
    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """INSERT INTO editorial_views (view_id,schema_version,market_date,main_thesis,top_signal_id,
               view_change_type,comparison_with_previous_day,supporting_fact_ids,view_json,audit_issues,publishable,
               evidence_ready,editorially_publishable,directional_signal_available,article_mode,is_historical)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (market_date) DO UPDATE SET main_thesis=EXCLUDED.main_thesis,
               top_signal_id=EXCLUDED.top_signal_id,view_change_type=EXCLUDED.view_change_type,
               comparison_with_previous_day=EXCLUDED.comparison_with_previous_day,
               supporting_fact_ids=EXCLUDED.supporting_fact_ids,view_json=EXCLUDED.view_json,
               audit_issues=EXCLUDED.audit_issues,publishable=EXCLUDED.publishable,
               evidence_ready=EXCLUDED.evidence_ready,
               editorially_publishable=EXCLUDED.editorially_publishable,
               directional_signal_available=EXCLUDED.directional_signal_available,
               article_mode=EXCLUDED.article_mode,
               is_historical=editorial_views.is_historical AND EXCLUDED.is_historical,updated_at=now()
               RETURNING id""",
            (view.view_id, view.schema_version, view.market_date, view.main_thesis,
             view.top_signal.signal_id if view.top_signal else None, view.view_change_type.value,
             view.comparison_with_previous_day, Jsonb(view.supporting_fact_ids),
             Jsonb(view.model_dump(mode="json")), Jsonb(view.audit_issues), view.publishable,
             view.evidence_ready, view.editorially_publishable,
             view.directional_signal_available, view.article_mode.value, is_historical),
        )
        return str(cursor.fetchone()["id"])


def _article_upsert_parameters(view_id: str, article: dict[str, Any]) -> tuple[Any, ...]:
    return (
        article["article_id"], article["market_date"], view_id, article["title"],
        article["summary"], article["markdown_path"], article["html_path"],
        Jsonb(article["source_mapping"]), article["local_audit_passed"],
        article["llm_review_passed"], Jsonb(article["review_json"]),
        article["publication_status"], article.get("publication_reference"),
        article["is_historical"],
    )


ARTICLE_UPSERT_SQL = """INSERT INTO published_articles (
    article_id,schema_version,market_date,editorial_view_id,title,summary,markdown_path,
    html_path,source_mapping,local_audit_passed,llm_review_passed,review_json,
    publication_status,publication_reference,is_historical
  ) VALUES (%s,'published-article.v1',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
  ON CONFLICT (market_date,editorial_view_id) DO UPDATE SET
    article_id=EXCLUDED.article_id,title=EXCLUDED.title,summary=EXCLUDED.summary,
    markdown_path=EXCLUDED.markdown_path,html_path=EXCLUDED.html_path,
    source_mapping=EXCLUDED.source_mapping,local_audit_passed=EXCLUDED.local_audit_passed,
    llm_review_passed=EXCLUDED.llm_review_passed,review_json=EXCLUDED.review_json,
    publication_status=EXCLUDED.publication_status,
    publication_reference=EXCLUDED.publication_reference,
    is_historical=published_articles.is_historical AND EXCLUDED.is_historical,
    updated_at=now()"""


def _json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def _topic_publication_reference(entry: dict[str, Any]) -> str | None:
    publish_id = str(entry.get("publish_id") or "").strip()
    if publish_id:
        return publish_id
    return str(entry.get("media_id") or "").strip() or None


def _topic_publication_entry(row: Any) -> dict[str, Any]:
    values = dict(row)
    topic_json = values.get("topic_json")
    entry = dict(topic_json) if isinstance(topic_json, dict) else {}
    for key in (
        "publication_key", "market_date", "article_slug", "title", "summary",
        "markdown_path", "html_path", "quality_audit_path", "llm_review_path",
        "artifact_sha256", "local_audit_status", "llm_review_status",
        "publication_action", "publication_status", "media_id", "publish_id",
        "publication_result",
    ):
        if key in values:
            entry[key] = values[key]
    error = values.get("error")
    if error:
        entry["error"] = error
    else:
        entry.pop("error", None)
    reference = _topic_publication_reference(entry)
    if reference:
        entry["publication_reference"] = reference
    else:
        entry.pop("publication_reference", None)
    return entry


def _persist_topic_publications(
    cursor: Any, published_article_id: str, target_date: date,
    entries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    cursor.execute(
        """UPDATE digit_topic_publications SET active=false,updated_at=now()
           WHERE published_article_id=%s AND active=true""",
        (published_article_id,),
    )
    for entry in sorted(entries, key=lambda item: str(item.get("article_slug") or "")):
        article_slug = str(entry.get("article_slug") or "").strip()
        publication_action = str(entry.get("publication_action") or "").strip()
        if not article_slug or not publication_action:
            raise ValueError("topic publication requires article_slug and publication_action")
        publication_key = (
            f"digit:{target_date.isoformat()}:{article_slug}:{publication_action}"
        )
        publication_result = entry.get("publication_result")
        if not isinstance(publication_result, dict):
            publication_result = {}
        media_id = str(
            entry.get("media_id") or publication_result.get("media_id") or ""
        ).strip() or None
        publish_id = str(
            entry.get("publish_id") or publication_result.get("publish_id") or ""
        ).strip() or None
        local_audit_json = _read_json_snapshot(entry.get("quality_audit_path"))
        llm_review_json = _read_json_snapshot(entry.get("llm_review_path"))
        review_score = llm_review_json.get("score")
        if not isinstance(review_score, (int, float)):
            review_score = entry.get("review_score")
        if not isinstance(review_score, (int, float)):
            review_score = None
        cursor.execute(
            """INSERT INTO digit_publication_attempts (
                 run_id,publication_key,market_date,article_slug,title,
                 publication_action,publication_status,local_audit_status,
                 llm_review_status,review_score,artifact_sha256,local_audit_json,
                 llm_review_json,publication_result,error_message,topic_json
               ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (run_id,publication_key) DO NOTHING""",
            (
                _publication_run_id(), publication_key, target_date, article_slug,
                entry.get("title"), publication_action,
                str(entry.get("publication_status") or "generation_failed"),
                str(entry.get("local_audit_status") or "not_run"),
                str(entry.get("llm_review_status") or "not_run"), review_score,
                Jsonb(entry.get("artifact_sha256") or {}),
                Jsonb(_json_safe(local_audit_json)),
                Jsonb(_json_safe(llm_review_json)),
                Jsonb(_json_safe(publication_result)), entry.get("error"),
                Jsonb(_json_safe(entry)),
            ),
        )
        cursor.execute(
            """INSERT INTO digit_topic_publications (
                 published_article_id,publication_key,market_date,article_slug,title,summary,
                 markdown_path,html_path,quality_audit_path,llm_review_path,artifact_sha256,
                 local_audit_status,llm_review_status,publication_action,publication_status,
                 media_id,publish_id,publication_result,error_message,topic_json,active
               ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true)
               ON CONFLICT (market_date,article_slug,publication_action) DO UPDATE SET
                 published_article_id=EXCLUDED.published_article_id,
                 title=EXCLUDED.title,summary=EXCLUDED.summary,
                 markdown_path=EXCLUDED.markdown_path,html_path=EXCLUDED.html_path,
                 quality_audit_path=EXCLUDED.quality_audit_path,
                 llm_review_path=EXCLUDED.llm_review_path,
                 artifact_sha256=EXCLUDED.artifact_sha256,
                 local_audit_status=EXCLUDED.local_audit_status,
                 llm_review_status=EXCLUDED.llm_review_status,
                 publication_status=EXCLUDED.publication_status,
                 media_id=CASE
                   WHEN digit_topic_publications.artifact_sha256=EXCLUDED.artifact_sha256
                   THEN COALESCE(EXCLUDED.media_id,digit_topic_publications.media_id)
                   ELSE EXCLUDED.media_id
                 END,
                 publish_id=CASE
                   WHEN digit_topic_publications.artifact_sha256=EXCLUDED.artifact_sha256
                   THEN COALESCE(EXCLUDED.publish_id,digit_topic_publications.publish_id)
                   ELSE EXCLUDED.publish_id
                 END,
                 publication_result=CASE
                   WHEN EXCLUDED.publication_result<>'{}'::jsonb
                   THEN EXCLUDED.publication_result
                   WHEN digit_topic_publications.artifact_sha256=EXCLUDED.artifact_sha256
                   THEN digit_topic_publications.publication_result
                   ELSE '{}'::jsonb
                 END,
                 error_message=EXCLUDED.error_message,topic_json=EXCLUDED.topic_json,
                 active=true,updated_at=now()""",
            (
                published_article_id, publication_key, target_date, article_slug,
                entry.get("title"), entry.get("summary"), entry.get("markdown_path"),
                entry.get("html_path"), entry.get("quality_audit_path"),
                entry.get("llm_review_path"), Jsonb(entry.get("artifact_sha256") or {}),
                str(entry.get("local_audit_status") or "not_run"),
                str(entry.get("llm_review_status") or "not_run"), publication_action,
                str(entry.get("publication_status") or "generation_failed"), media_id,
                publish_id, Jsonb(_json_safe(publication_result)), entry.get("error"),
                Jsonb(_json_safe(entry)),
            ),
        )
    cursor.execute(
        """SELECT article_slug,publication_key,market_date,title,summary,markdown_path,
                  html_path,quality_audit_path,llm_review_path,artifact_sha256,
                  local_audit_status,llm_review_status,publication_action,
                  publication_status,media_id,publish_id,
                  publication_result,error_message AS error,topic_json
           FROM digit_topic_publications
           WHERE published_article_id=%s AND market_date=%s AND active=true
           ORDER BY article_slug""",
        (published_article_id, target_date),
    )
    return [_topic_publication_entry(row) for row in cursor.fetchall()]


def _persist_article(
    connection: Connection[Any], view_id: str, article: dict[str, Any],
    entries: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]] | None:
    if entries is None:
        with connection.transaction(), connection.cursor() as cursor:
            cursor.execute(ARTICLE_UPSERT_SQL, _article_upsert_parameters(view_id, article))
        return None

    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            f"{ARTICLE_UPSERT_SQL} RETURNING id",
            _article_upsert_parameters(view_id, article),
        )
        published_article_id = str(cursor.fetchone()["id"])
        persisted_entries = _persist_topic_publications(
            cursor, published_article_id, article["market_date"], entries,
        )
        authoritative_article = build_daily_aggregate_article(
            article["market_date"], Path(article["markdown_path"]).parent,
            persisted_entries, article["source_mapping"],
            is_historical=article["is_historical"],
        )
        article.clear()
        article.update(authoritative_article)
        cursor.execute(
            """UPDATE published_articles SET
                 title=%s,summary=%s,markdown_path=%s,html_path=%s,source_mapping=%s,
                 local_audit_passed=%s,llm_review_passed=%s,review_json=%s,
                 publication_status=%s,publication_reference=%s,
                 is_historical=is_historical AND %s,updated_at=now()
               WHERE id=%s""",
            (
                article["title"], article["summary"], article["markdown_path"],
                article["html_path"], Jsonb(article["source_mapping"]),
                article["local_audit_passed"], article["llm_review_passed"],
                Jsonb(article["review_json"]), article["publication_status"],
                article.get("publication_reference"), article["is_historical"],
                published_article_id,
            ),
        )
        return persisted_entries


def publication_result_status(result: dict[str, Any]) -> tuple[str, str | None]:
    action = str(result.get("action") or "").strip()
    if action == "draft":
        reference = str(result.get("media_id") or "").strip()
        if not reference:
            raise ValueError("WeChat draft result missing media_id")
        return "draft_created", reference
    if action == "publish":
        reference = str(result.get("publish_id") or "").strip()
        if not reference:
            raise ValueError("WeChat publish result missing publish_id")
        return "published", reference
    raise ValueError(f"unsupported WeChat publication action: {action or 'missing'}")


def _parse_publication_result(output: Any) -> dict[str, Any]:
    text = str(output or "").strip()
    object_start = text.find("{")
    if object_start < 0:
        return {}
    try:
        payload = json.loads(text[object_start:])
    except (TypeError, ValueError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _load_topic_publication_state(
    reports_root: Path,
    target_date: date,
    article_slug: str,
    requested_action: str,
) -> dict[str, Any]:
    locator = ArticleLocator("digit", target_date, article_slug)
    paths = resolve_article_paths(locator, reports_root)
    actions = (
        ("publish", "draft", "auto")
        if requested_action == "auto"
        else (requested_action,)
    )
    candidates = [
        paths.publish_state_path(candidate_action)
        for candidate_action in actions
        if paths.publish_state_path(candidate_action).is_file()
    ]
    for state_path in sorted(
        candidates,
        key=lambda candidate: candidate.stat().st_mtime_ns,
        reverse=True,
    ):
        try:
            payload = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            return payload
    return {}


def _resolved_topic_publication_action(
    requested_action: str,
    target_date: date,
    reports_root: Path,
) -> str:
    if requested_action != "auto":
        return requested_action
    rollout_state = load_rollout_state("digit", reports_dir=reports_root)
    counted_dates = rollout_state.get("counted_dates")
    if isinstance(counted_dates, list) and target_date.isoformat() in counted_dates:
        return "draft"
    return "publish" if rollout_state.get("armed_for_publish") else "draft"


def _load_database_topic_publications(
    connection: Connection[Any],
    target_date: date,
    article_slugs: list[str],
    publication_action: str,
) -> list[dict[str, Any]]:
    if not article_slugs or publication_action not in {"draft", "publish"}:
        return []
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """SELECT article_slug,publication_key,market_date,title,summary,markdown_path,
                      html_path,quality_audit_path,llm_review_path,artifact_sha256,
                      local_audit_status,llm_review_status,publication_action,
                      publication_status,media_id,publish_id,
                      publication_result,error_message AS error,topic_json
               FROM digit_topic_publications
               WHERE market_date=%s AND article_slug=ANY(%s)
                 AND publication_action=%s
               ORDER BY article_slug""",
            (target_date, article_slugs, publication_action),
        )
        return [_topic_publication_entry(row) for row in cursor.fetchall()]


def _publication_identifier(entry: dict[str, Any], field: str) -> str:
    publication_result = entry.get("publication_result")
    result_value = (
        publication_result.get(field)
        if isinstance(publication_result, dict)
        else None
    )
    values = {
        str(value).strip()
        for value in (entry.get(field), result_value)
        if str(value or "").strip()
    }
    if len(values) > 1:
        raise RuntimeError(f"database {field} conflicts with publication result")
    return next(iter(values), "")


def _has_publication_identifier(entry: dict[str, Any]) -> bool:
    publication_result = entry.get("publication_result")
    return any(
        str(value or "").strip()
        for value in (
            entry.get("media_id"),
            entry.get("publish_id"),
            publication_result.get("media_id")
            if isinstance(publication_result, dict)
            else None,
            publication_result.get("publish_id")
            if isinstance(publication_result, dict)
            else None,
        )
    )


def _current_topic_artifact_identity(
    reports_root: Path,
    target_date: date,
    article_slug: str,
) -> dict[str, Any]:
    locator = ArticleLocator("digit", target_date, article_slug)
    paths = resolve_article_paths(locator, reports_root)
    return build_artifact_identity(
        locator,
        paths.markdown.read_text(encoding="utf-8"),
        paths.wechat_html.read_text(encoding="utf-8"),
        paths.summary.read_text(encoding="utf-8"),
    )


def _validate_recovered_image_state(payload: dict[str, Any]) -> None:
    required_fields = {
        "reference_image_present",
        "reference_image_sha256",
        "article_image_url",
        "article_image_status",
    }
    missing_fields = sorted(required_fields - payload.keys())
    if missing_fields:
        raise RuntimeError(
            "database publication result missing recovery image state: "
            + ", ".join(missing_fields)
        )
    image_present = bool(payload.get("reference_image_present"))
    image_url = str(payload.get("article_image_url") or "").strip()
    image_status = str(payload.get("article_image_status") or "").strip()
    if image_present:
        parsed_url = urlparse(image_url)
        if (
            not str(payload.get("reference_image_sha256") or "").strip()
            or image_status not in {"uploaded", "uploaded_verified"}
            or parsed_url.scheme.lower() != "https"
            or not parsed_url.netloc
        ):
            raise RuntimeError("database publication result has invalid recovery image state")
    elif image_status != "not_expected" or image_url:
        raise RuntimeError("database publication result has invalid image-free recovery state")


def _build_database_recovery_checkpoint(
    recovery_entry: dict[str, Any],
    reports_root: Path,
    target_date: date,
    article_slug: str,
    publication_action: str,
) -> tuple[Path, dict[str, Any]] | None:
    locator = ArticleLocator("digit", target_date, article_slug)
    state_path = resolve_article_paths(locator, reports_root).publish_state_path(
        publication_action,
    )
    if state_path.is_file() or not _has_publication_identifier(recovery_entry):
        return None

    entry_action = str(recovery_entry.get("publication_action") or "").strip()
    publication_result = recovery_entry.get("publication_result")
    if not isinstance(publication_result, dict):
        raise RuntimeError("database publication result missing for checkpoint recovery")
    result_action = str(publication_result.get("action") or "").strip()
    if entry_action != publication_action or (
        result_action and result_action != publication_action
    ):
        raise RuntimeError("database publication action mismatch for checkpoint recovery")

    current_identity = _current_topic_artifact_identity(
        reports_root,
        target_date,
        article_slug,
    )
    expected_publication_keys = {
        current_identity["publication_key"],
        f"{current_identity['publication_key']}:{publication_action}",
    }
    if recovery_entry.get("publication_key") not in expected_publication_keys:
        raise RuntimeError("database publication artifact identity mismatch: publication key")
    recorded_hashes = recovery_entry.get("artifact_sha256")
    if not isinstance(recorded_hashes, dict) or any(
        recorded_hashes.get(field_name)
        != current_identity["artifact_sha256"][field_name]
        for field_name in current_identity["artifact_sha256"]
    ):
        raise RuntimeError("database publication artifact identity mismatch: sha256")

    media_id = _publication_identifier(recovery_entry, "media_id")
    publish_id = _publication_identifier(recovery_entry, "publish_id")
    if not media_id:
        raise RuntimeError("database checkpoint recovery requires media_id")
    if publication_action == "draft" and publish_id:
        raise RuntimeError("database draft checkpoint unexpectedly contains publish_id")
    result_date = str(publication_result.get("date") or "").strip()
    if result_date and result_date != target_date.isoformat():
        raise RuntimeError("database publication date mismatch for checkpoint recovery")
    result_stream = str(publication_result.get("stream") or "").strip()
    if result_stream and result_stream != "digit":
        raise RuntimeError("database publication stream mismatch for checkpoint recovery")

    terminal_publish = False
    publish_status_response = publication_result.get("publish_status_response")
    if publication_action == "publish" and publish_id and isinstance(
        publish_status_response,
        dict,
    ):
        try:
            terminal_publish = int(publish_status_response.get("publish_status", -1)) == 0
        except (TypeError, ValueError):
            terminal_publish = False
    if not terminal_publish:
        if not str(publication_result.get("fingerprint") or "").strip():
            raise RuntimeError("database publication result missing fingerprint for recovery")
        _validate_recovered_image_state(publication_result)
        if (
            publication_action == "draft"
            and publication_result.get("ok") is not False
            and not str(publication_result.get("error") or "").strip()
            and publication_result.get("article_image_status") == "uploaded"
        ):
            raise RuntimeError("database draft checkpoint image was not verified")

    checkpoint = dict(publication_result)
    checkpoint.update({
        "date": target_date.isoformat(),
        "stream": "digit",
        "action": publication_action,
        "media_id": media_id,
        "publish_id": publish_id,
        "artifact_identity": current_identity,
        "database_recovered": True,
    })
    return state_path, checkpoint


def _apply_recovered_checkpoint(
    entry: dict[str, Any],
    checkpoint: dict[str, Any],
) -> None:
    entry["publication_action"] = str(checkpoint["action"])
    entry["media_id"] = str(checkpoint.get("media_id") or "").strip() or None
    entry["publish_id"] = str(checkpoint.get("publish_id") or "").strip() or None
    entry["publication_result"] = checkpoint
    reference = _topic_publication_reference(entry)
    if reference:
        entry["publication_reference"] = reference


def _recover_failed_publication_result(
    error: Exception,
    reports_root: Path,
    target_date: date,
    article_slug: str,
    requested_action: str,
) -> dict[str, Any]:
    output = getattr(error, "stdout", None)
    if output is None:
        output = getattr(error, "output", None)
    result = _parse_publication_result(output)
    if result:
        return result
    return _load_topic_publication_state(
        reports_root,
        target_date,
        article_slug,
        requested_action,
    )


def _checkpoint_recovered_publication_result(
    result: dict[str, Any],
    reports_root: Path,
    target_date: date,
    article_slug: str,
    requested_action: str,
) -> dict[str, Any]:
    if not str(result.get("checkpoint_error") or "").strip():
        return result
    if not str(result.get("media_id") or "").strip() and not str(
        result.get("publish_id") or ""
    ).strip():
        return result
    checkpoint_action = str(result.get("action") or requested_action).strip()
    if checkpoint_action not in {"draft", "publish"}:
        return result
    locator = ArticleLocator("digit", target_date, article_slug)
    state_path = resolve_article_paths(locator, reports_root).publish_state_path(
        checkpoint_action,
    )
    recovered = dict(result)
    recovered["action"] = checkpoint_action
    recovered["result_path"] = str(state_path)
    atomic_write_json(state_path, recovered)
    return result


def _publication_failure_error(error: Exception, result: dict[str, Any]) -> str:
    messages = []
    result_error = str(result.get("error") or "").strip()
    if result_error:
        messages.append(result_error)
    process_error = f"{type(error).__name__}: {error}"
    if process_error not in messages:
        messages.append(process_error)
    return "; ".join(messages)


def run_topics_independently(
    topics: list[ArticleTopic], processor: Callable[[ArticleTopic, int], dict[str, Any]],
) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for ordinal, topic in enumerate(topics, start=1):
        entry = {
            **topic.model_dump(mode="json"),
            "article_slug": f"{ordinal:02d}-{topic.slug}",
            "local_audit_status": "not_run",
            "llm_review_status": "not_run",
            "publication_status": "generation_failed",
        }
        try:
            entry.update(processor(topic, ordinal))
        except Exception as error:
            entry["error"] = f"{type(error).__name__}: {error}"
        entries.append(entry)
    return entries


def publication_index_status(entries: list[dict[str,Any]]) -> str:
    failure_statuses={"generation_failed","review_rejected","publish_failed"}
    failed=sum(entry.get("publication_status") in failure_statuses for entry in entries)
    if not entries:
        return "archive_only"
    if failed == len(entries):
        return "failed"
    if failed:
        return "partial_success"
    return "complete"


def aggregate_database_status(entries: list[dict[str,Any]]) -> str:
    if not entries:
        return "archive_only"
    statuses={str(entry.get("publication_status") or "") for entry in entries}
    if "publish_failed" in statuses:
        return "publish_failed"
    if any(
        entry.get("publication_status") in {"generation_failed","review_rejected"}
        or entry.get("local_audit_status") != "pass"
        or entry.get("llm_review_status") != "pass"
        for entry in entries
    ):
        return "review_rejected"
    success_order=("shadow_saved","draft_created","published")
    if statuses.issubset(set(success_order)):
        return next(status for status in success_order if status in statuses)
    return "review_rejected"


def build_daily_aggregate_article(
    target_date: date, date_dir: Path, entries: list[dict[str,Any]],
    source_mapping: dict[str,str], *, is_historical: bool,
) -> dict[str,Any]:
    index_status=publication_index_status(entries)
    database_status=aggregate_database_status(entries)
    status_counts: dict[str,int]={}
    compact_entries=[]
    for entry in sorted(entries,key=lambda item:str(item.get("article_slug") or "")):
        status=str(entry.get("publication_status") or "")
        status_counts[status]=status_counts.get(status,0)+1
        compact_entries.append({
            key:entry[key]
            for key in (
                "article_slug","local_audit_status","llm_review_status",
                "publication_key","publication_action","publication_status",
                "publication_reference","media_id","publish_id","publication_result","error",
            )
            if key in entry
        })
    markdown_path=date_dir / "daily-index.md"
    html_path=date_dir / "daily-index_wechat.html"
    return {
        "article_id":f"ARTICLE-{uuid.uuid5(ARTICLE_NAMESPACE,target_date.isoformat())}",
        "market_date":target_date,
        "title":f"ETI Digit 日级聚合｜{target_date.isoformat()}",
        "summary":f"{len(entries)} 篇主题稿；索引状态 {index_status}；数据库聚合状态 {database_status}。",
        "markdown_path":str(markdown_path),
        "html_path":str(html_path),
        "source_mapping":dict(sorted(source_mapping.items())),
        "local_audit_passed":all(
            entry.get("local_audit_status") == "pass" for entry in entries
        ),
        "llm_review_passed":bool(entries) and all(
            entry.get("llm_review_status") == "pass" for entry in entries
        ),
        "review_json":{
            "aggregate":{
                "index_status":index_status,
                "database_status":database_status,
                "article_count":len(entries),
                "status_counts":status_counts,
            },
            "articles":compact_entries,
        },
        "publication_status":database_status,
        "publication_reference":None,
        "is_historical":is_historical,
    }


def _atomic_write_text(path: Path, content: str) -> None:
    write_text_atomically(path, content)


def extract_digit_summary(markdown: str, limit: int = 120) -> str:
    conclusion_lines: list[str] = []
    fallback_lines: list[str] = []
    title = ""
    in_conclusion = False
    for raw_line in markdown.splitlines():
        stripped = raw_line.strip()
        heading = re.match(r"^#{1,6}\s+(.+?)\s*$", stripped)
        if heading:
            heading_text = heading.group(1).strip()
            if stripped.startswith("# ") and not title:
                title = heading_text
            if in_conclusion and heading_text != "今日结论":
                break
            in_conclusion = heading_text == "今日结论"
            continue
        if not stripped:
            continue
        plain = re.sub(r"^\s*(?:>\s*|[-*+]\s+|\d+[.)、]\s+)", "", stripped)
        plain = re.sub(r"!?(?:\[([^\]]+)\])\([^)]+\)", r"\1", plain)
        plain = re.sub(r"[*_`~]", "", plain)
        plain = re.sub(r"\s+", " ", plain).strip()
        if not plain:
            continue
        fallback_lines.append(plain)
        if in_conclusion:
            conclusion_lines.append(plain)
    summary = " ".join(conclusion_lines or fallback_lines[:1]) or title
    return summary[:limit].strip()


def _relative_artifact_link(path_value: Any, date_dir: Path) -> str | None:
    if not path_value:
        return None
    return Path(os.path.relpath(Path(str(path_value)),date_dir)).as_posix()


def render_daily_aggregate_markdown(
    target_date: date, date_dir: Path, entries: list[dict[str,Any]],
) -> str:
    lines=[
        f"# ETI Digit 日级索引｜{target_date.isoformat()}","",
        f"- 聚合状态：{publication_index_status(entries)}",
        f"- 主题数量：{len(entries)}","","## 当日主题","",
    ]
    if not entries:
        lines.append("当日无可发布主题，仅保留本地观察记录。")
    for ordinal,entry in enumerate(entries,start=1):
        title=str(entry.get("title") or entry.get("title_hint") or entry.get("article_slug") or f"主题 {ordinal}")
        lines.extend([
            f"### {ordinal}. {title}","",
            f"- 状态：{entry.get('publication_status') or 'unknown'}",
            f"- 本地审计：{entry.get('local_audit_status') or 'not_run'}",
            f"- Dify 审校：{entry.get('llm_review_status') or 'not_run'}",
        ])
        links=[]
        markdown_link=_relative_artifact_link(entry.get("markdown_path"),date_dir)
        html_link=_relative_artifact_link(entry.get("html_path"),date_dir)
        if markdown_link:
            links.append(f"[Markdown]({markdown_link})")
        if html_link:
            links.append(f"[HTML]({html_link})")
        lines.append(f"- 工件：{' · '.join(links) if links else '未生成'}")
        if entry.get("error"):
            lines.append(f"- 错误：{entry['error']}")
        lines.append("")
    return "\n".join(lines).rstrip()+"\n"


def write_daily_aggregate_artifacts(
    target_date: date, date_dir: Path, entries: list[dict[str,Any]],
) -> tuple[Path,Path]:
    markdown_path=date_dir / "daily-index.md"
    html_path=date_dir / "daily-index_wechat.html"
    markdown=render_daily_aggregate_markdown(target_date,date_dir,entries)
    summary=f"{len(entries)} 篇主题稿；聚合状态 {publication_index_status(entries)}。"
    html=markdown_to_report_html(markdown,summary,target_date.isoformat())
    _atomic_write_text(markdown_path,markdown)
    _atomic_write_text(html_path,html)
    return markdown_path,html_path


def write_publication_index(
    date_dir: Path, target_date: date, entries: list[dict[str, Any]],
    *, omitted_due_to_cap: list[Any] | tuple[Any, ...] = (),
) -> Path:
    omitted_payload = [
        item.model_dump(mode="json") if isinstance(item, ArticleTopic) else dict(item)
        for item in omitted_due_to_cap
    ]
    payload = {
        "schema_version": "digit-publication-index.v1",
        "stream": "digit",
        "market_date": target_date.isoformat(),
        "status": publication_index_status(entries),
        "articles": entries,
        "omitted_due_to_cap": omitted_payload,
    }
    index_path = date_dir / "index.json"
    _atomic_write_text(
        index_path,json.dumps(payload,ensure_ascii=False,indent=2,default=str),
    )
    return index_path


def finalize_daily_aggregate(
    connection: Any, view_id: str, target_date: date, date_dir: Path,
    entries: list[dict[str,Any]], source_mapping: dict[str,str], *,
    is_historical: bool, persister: Callable[...,Any] = _persist_article,
    omitted_due_to_cap: list[Any] | tuple[Any, ...] = (),
) -> dict[str,Any]:
    write_publication_index(
        date_dir,target_date,entries,omitted_due_to_cap=omitted_due_to_cap,
    )
    write_daily_aggregate_artifacts(target_date,date_dir,entries)
    article=build_daily_aggregate_article(
        target_date,date_dir,entries,source_mapping,is_historical=is_historical,
    )
    if persister is _persist_article:
        persisted_entries = persister(connection,view_id,article,entries)
        if persisted_entries is not None:
            entries[:] = persisted_entries
            write_publication_index(
                date_dir,target_date,entries,omitted_due_to_cap=omitted_due_to_cap,
            )
            write_daily_aggregate_artifacts(target_date,date_dir,entries)
    else:
        persister(connection,view_id,article)
    return article


def write_no_topic_archive(reports_root: Path, target_date: date, observation: str) -> Path:
    date_dir = reports_root / "digit" / target_date.isoformat()
    date_dir.mkdir(parents=True, exist_ok=True)
    (date_dir / "observation.md").write_text(
        f"# ETI 市场观察｜{target_date.isoformat()}\n\n{observation.strip()}\n",
        encoding="utf-8",
    )
    write_publication_index(date_dir, target_date, [])
    return date_dir


def topic_article_locator(target_date: date, topic: ArticleTopic, ordinal: int) -> ArticleLocator:
    return ArticleLocator("digit", target_date, f"{ordinal:02d}-{topic.slug}")


def resolve_publication_execution(
    pipeline_mode: str, *, historical: bool, dry_run: bool,
) -> tuple[str, str]:
    requested_actions = {
        "off": "off",
        "shadow": "shadow",
        "review": "draft",
        "active": "auto",
    }
    if pipeline_mode not in requested_actions:
        raise ValueError(f"unsupported MARKET_PIPELINE_MODE: {pipeline_mode}")
    requested_action = requested_actions[pipeline_mode]
    if dry_run:
        return requested_action, "draft"
    if pipeline_mode in {"off", "shadow"}:
        return requested_action, requested_action
    if historical:
        return requested_action, "draft"
    return requested_action, requested_action


def _topic_publish_command(
    target_date: date, article_slug: str, *, action: str, historical: bool,
    defer_rollout: bool = False, dry_run: bool = False,
) -> list[str]:
    effective_action = "draft" if dry_run else action
    command = [
        sys.executable, "-m", "intelligence.wechat_publish", "--date", target_date.isoformat(),
        "--stream", "digit", "--article-slug", article_slug, "--action", effective_action,
    ]
    if historical:
        command.append("--historical")
    if dry_run:
        command.extend(("--dry-run", "--preflight"))
    if defer_rollout and not dry_run:
        command.append("--defer-rollout")
    return command


def preview_topics_independently(
    entries: list[dict[str, Any]], target_date: date, *, requested_action: str,
    historical: bool, runner: Callable[..., Any] = subprocess.run,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for original in entries:
        entry = dict(original)
        entry["requested_action"] = requested_action
        entry["effective_action"] = "draft"
        if entry.get("local_audit_status") != "pass" or entry.get("llm_review_status") != "pass":
            entry["dry_run_status"] = "skipped_quality_gate"
            results.append(entry)
            continue
        try:
            completed = runner(
                _topic_publish_command(
                    target_date,
                    str(entry["article_slug"]),
                    action=requested_action,
                    historical=historical,
                    dry_run=True,
                ),
                check=True, text=True, capture_output=True,
                encoding="utf-8", errors="replace",
            )
            output = completed.stdout.strip()
            preview = json.loads(output[output.find("{"):])
            if preview.get("ready") is not True or preview.get("issues"):
                raise RuntimeError(f"dry-run preflight not ready: {preview.get('issues') or 'unknown'}")
            entry["dry_run_status"] = "pass"
            entry.pop("dry_run_error", None)
        except Exception as error:
            entry["dry_run_status"] = "failed"
            entry["dry_run_error"] = f"{type(error).__name__}: {error}"
        results.append(entry)
    return results


def publish_topics_independently(
    entries: list[dict[str, Any]], target_date: date, *, action: str, historical: bool,
    reports_root: Path | None = None, rollout_threshold: int = 3,
    recovery_entries: list[dict[str, Any]] | None = None,
    runner: Callable[..., Any] = subprocess.run,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    resolved_reports_root = reports_root or (
        Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault")) / "reports"
    )
    recovery_action = _resolved_topic_publication_action(
        action,
        target_date,
        resolved_reports_root,
    )
    database_recovery_by_slug = {
        str(candidate.get("article_slug") or ""): candidate
        for candidate in recovery_entries or []
        if str(candidate.get("article_slug") or "").strip()
    }
    for original in entries:
        entry = dict(original)
        if entry.get("local_audit_status") != "pass" or entry.get("llm_review_status") != "pass":
            results.append(entry)
            continue
        entry["publication_action"] = action
        article_slug = str(entry.get("article_slug") or "")
        recovery_entry = database_recovery_by_slug.get(article_slug)
        if recovery_entry is None and (
            str(original.get("publication_action") or "").strip() == recovery_action
            and _has_publication_identifier(original)
        ):
            recovery_entry = original
        if recovery_entry is not None and _has_publication_identifier(recovery_entry):
            entry["publication_action"] = recovery_action
            try:
                checkpoint_recovery = _build_database_recovery_checkpoint(
                    recovery_entry,
                    resolved_reports_root,
                    target_date,
                    article_slug,
                    recovery_action,
                )
                if checkpoint_recovery is not None:
                    state_path, checkpoint = checkpoint_recovery
                    _apply_recovered_checkpoint(entry, checkpoint)
                    atomic_write_json(state_path, checkpoint)
            except Exception as recovery_error:
                entry["publication_status"] = "publish_failed"
                entry["error"] = (
                    "database checkpoint recovery failed: "
                    f"{type(recovery_error).__name__}: {recovery_error}"
                )
                results.append(entry)
                continue
        result: dict[str, Any] = {}
        try:
            completed = runner(
                _topic_publish_command(
                    target_date,
                    str(entry["article_slug"]),
                    action=action,
                    historical=historical,
                    defer_rollout=action == "auto",
                ),
                check=True, text=True, capture_output=True,
            )
            result = _parse_publication_result(completed.stdout)
            if not result:
                raise ValueError("WeChat publisher returned no structured result")
            status, reference = publication_result_status(result)
            entry["publication_status"] = status
            entry["publication_reference"] = reference
            entry["publication_action"] = str(result.get("action") or "")
            entry["media_id"] = str(result.get("media_id") or "").strip() or None
            entry["publish_id"] = str(result.get("publish_id") or "").strip() or None
            entry["publication_result"] = result
            entry.pop("error", None)
        except Exception as error:
            if not result and article_slug:
                result = _recover_failed_publication_result(
                    error,
                    resolved_reports_root,
                    target_date,
                    article_slug,
                    action,
                )
            if result and article_slug:
                try:
                    result = _checkpoint_recovered_publication_result(
                        result,
                        resolved_reports_root,
                        target_date,
                        article_slug,
                        action,
                    )
                except OSError as checkpoint_error:
                    result["worker_checkpoint_error"] = (
                        f"{type(checkpoint_error).__name__}: {checkpoint_error}"
                    )
            entry["publication_status"] = "publish_failed"
            entry["error"] = _publication_failure_error(error, result)
            if result:
                entry["publication_action"] = str(
                    result.get("action") or entry.get("publication_action") or ""
                ).strip()
                entry["media_id"] = str(result.get("media_id") or "").strip() or None
                entry["publish_id"] = str(result.get("publish_id") or "").strip() or None
                entry["publication_result"] = result
                reference = _topic_publication_reference(entry)
                if reference:
                    entry["publication_reference"] = reference
        results.append(entry)
    if action == "auto":
        finalize_digit_rollout(
            results,
            target_date,
            action=action,
            historical=historical,
            reports_root=resolved_reports_root,
            rollout_threshold=rollout_threshold,
        )
    return results


def finalize_digit_rollout(
    entries: list[dict[str, Any]],
    target_date: date,
    *,
    action: str,
    historical: bool,
    reports_root: Path,
    rollout_threshold: int,
) -> dict[str, Any]:
    if action != "auto" or historical or not entries:
        return load_rollout_state("digit", reports_dir=reports_root)
    successful_statuses = {"draft_created", "published"}
    actions = {
        str(entry.get("publication_action") or "")
        for entry in entries
        if entry.get("publication_status") in successful_statuses
    }
    all_completed = all(
        entry.get("local_audit_status") == "pass"
        and entry.get("llm_review_status") == "pass"
        and entry.get("publication_status") in successful_statuses
        for entry in entries
    )
    if not all_completed or len(actions) != 1 or not actions <= {"draft", "publish"}:
        statuses = ", ".join(
            f"{entry.get('article_slug')}={entry.get('publication_status')}" for entry in entries
        )
        return reset_rollout_state(
            target_date.isoformat(),
            f"digit articles incomplete: {statuses}",
            "digit",
            reports_dir=reports_root,
        )
    state = load_rollout_state("digit", reports_dir=reports_root)
    return record_auto_success(
        target_date.isoformat(),
        actions.pop(),
        state,
        rollout_threshold,
        stream="digit",
        reports_dir=reports_root,
    )


def scoped_writer_claims(
    claim_ledger: list[ClaimLedgerEntry], writer_fact_ids: set[str],
    story_brief: StoryBrief | None, *, limit: int = 24,
) -> list[ClaimLedgerEntry]:
    brief_claim_ids = set(getattr(story_brief, "allowed_inference_ids", []) or [])
    brief_external_ids = set(getattr(story_brief, "external_context_ids", []) or [])
    brief_takeaway = str(getattr(story_brief, "one_sentence_takeaway", "") or "").strip()
    relevant: list[ClaimLedgerEntry] = []
    for entry in claim_ledger:
        claim_type = str(
            getattr(getattr(entry, "claim_type", None), "value", getattr(entry, "claim_type", ""))
        )
        if not (
            writer_fact_ids.intersection(entry.supporting_fact_ids)
            or entry.claim_id in brief_claim_ids
            or brief_external_ids.intersection(entry.supporting_external_evidence_ids)
            or (brief_takeaway and entry.claim_text == brief_takeaway)
        ):
            continue
        if entry.publishable or claim_type == "unresolved":
            relevant.append(entry)
        if len(relevant) >= limit:
            break
    return relevant


def build_topic_article(
    topic: ArticleTopic, ordinal: int, *, target_date: date, view: Any,
    facts: list[Any], signals: list[Any], metrics: list[Any], mapping: dict[str,str],
    reports_root: Path, dify_base_url: str, writer_key: str, review_key: str, extract_key: str = "",
    source_dossiers: list[Any] | None = None,
    story_brief: StoryBrief | None = None,
    claim_ledger: list[ClaimLedgerEntry] | None = None,
    external_evidence: list[Any] | None = None,
    recent_article_markdowns: list[str] | None = None,
    writer: Callable[...,dict[str,Any]] = call_dify_writer,
    reviewer: Callable[...,dict[str,Any]] = call_review,
    auditor: Callable[...,list[str]] = audit_article,
    translator: Callable[...,list[dict[str,Any]]] = translate_excerpts,
) -> dict[str,Any]:
    locator=topic_article_locator(target_date,topic,ordinal)
    paths=resolve_article_paths(locator,reports_root)
    paths.markdown.parent.mkdir(parents=True,exist_ok=True)
    paths.quality_audit.parent.mkdir(parents=True,exist_ok=True)
    quality_history = paths.quality_audit.parent / "history"
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    for quality_path in (paths.quality_audit, paths.llm_review):
        if quality_path.is_file():
            quality_history.mkdir(parents=True, exist_ok=True)
            shutil.copy2(
                quality_path,
                quality_history / f"{quality_path.stem}_{timestamp}{quality_path.suffix}",
            )
    scoped_view=build_topic_editorial_view(view,topic,facts,signals,metrics)
    payload=build_writer_payload(
        view,facts,signals,metrics,mapping,topic=topic,topic_view=scoped_view,
    )
    writer_fact_ids={item["fact_id"] for item in payload["verified_facts"]}
    topic_source_ids = {
        str(item.get("source_id") or "") for item in payload["verified_facts"]
        if str(item.get("source_id") or "")
    }
    source_fact_counts: dict[str, int] = {}
    for item in payload["verified_facts"]:
        source_id = str(item.get("source_id") or "")
        if source_id:
            source_fact_counts[source_id] = source_fact_counts.get(source_id, 0) + 1
    payload["source_dossiers"] = sorted(
        dossiers_for_topic(source_dossiers or [], topic_source_ids),
        key=lambda dossier: (
            -source_fact_counts.get(str(dossier.get("source_id") or ""), 0),
            str(dossier.get("source_id") or ""),
        ),
    )[:3]
    fact_ids_by_source: dict[str, list[str]] = {}
    for item in payload["verified_facts"]:
        source_id = str(item.get("source_id") or "")
        fact_id = str(item.get("fact_id") or "")
        if source_id and fact_id:
            fact_ids_by_source.setdefault(source_id, []).append(fact_id)
    paragraph_excerpts = paragraph_excerpts_for_topic(
        source_dossiers or [], topic_source_ids, fact_ids_by_source, limit=8,
        section_ids={
            str(item.get("article_section_id") or "") for item in payload["verified_facts"]
            if str(item.get("article_section_id") or "")
        },
        topic_facts=payload["verified_facts"],
        include_adjacent=bool(
            story_brief and story_brief.story_form == StoryForm.SOURCE_CLOSE_READING
        ),
    )
    topic_mode_value = str(getattr(
        getattr(topic, "article_mode", None), "value", getattr(topic, "article_mode", "")
    ))
    if paragraph_excerpts:
        payload["source_excerpts"] = paragraph_excerpts
    if not (
        story_brief and story_brief.story_form == StoryForm.SOURCE_CLOSE_READING
    ):
        for dossier in payload["source_dossiers"]:
            dossier["central_question"] = str(getattr(topic, "title_hint", "") or "")
            dossier["main_thesis"] = str(getattr(topic, "title_hint", "") or "")
            dossier["key_events"] = []
            dossier["source_conclusions"] = []
    payload["story_brief"] = story_brief.model_dump(mode="json") if story_brief else {}
    if payload["source_excerpts"] and payload["story_brief"]:
        payload["story_brief"]["must_use_excerpt_ids"] = [
            item["excerpt_id"] for item in payload["source_excerpts"][:6]
        ]
    scoped_claims = scoped_writer_claims(
        claim_ledger or [], writer_fact_ids, story_brief,
    )
    payload["claim_ledger"] = [entry.model_dump(mode="json") for entry in scoped_claims]
    allowed_external_ids = {
        evidence_id
        for entry in scoped_claims if entry.publishable
        for evidence_id in entry.supporting_external_evidence_ids
    }
    payload["external_confirmations"] = [
        item.model_dump(mode="json") if hasattr(item, "model_dump") else dict(item)
        for item in (external_evidence or [])
        if str(getattr(item, "evidence_id", "")) in allowed_external_ids
        and str(getattr(item, "verification_status", "")) == "verified"
    ]
    writer_facts=[fact for fact in facts if fact.fact_id in writer_fact_ids]
    article_mode = str(
        payload.get("article_mode")
        or getattr(getattr(scoped_view, "article_mode", None), "value", getattr(scoped_view, "article_mode", None))
        or getattr(getattr(topic, "article_mode", None), "value", getattr(topic, "article_mode", None))
        or ArticleMode.EVENT_BRIEF.value
    )
    translation_records = (
        translator(dify_base_url, extract_key, payload["source_excerpts"])
        if extract_key else []
    )
    translations = [
        item for item in translation_records
        if item.get("translation_review_status") == "pass"
    ]
    payload["source_excerpts"] = attach_approved_translations(
        payload["source_excerpts"], translations,
    )
    if story_brief and story_brief.story_form == StoryForm.SOURCE_CLOSE_READING:
        for dossier in payload["source_dossiers"]:
            source_id = str(dossier.get("source_id") or "")
            selected_excerpts = [
                item for item in payload["source_excerpts"]
                if str(item.get("source_id") or "") == source_id
            ]
            if not selected_excerpts:
                continue
            dossier["central_question"] = story_brief.reader_question
            dossier["main_thesis"] = story_brief.source_thesis or story_brief.one_sentence_takeaway
            dossier["source_argument_map"] = [
                {
                    "order": index,
                    "paragraph_role": item.get("paragraph_role"),
                    "excerpt_id": item.get("excerpt_id"),
                    "section_id": item.get("section_id"),
                }
                for index, item in enumerate(selected_excerpts)
            ]
            dossier["key_events"] = [
                item.get("statement") for item in payload["verified_facts"]
                if str(item.get("source_id") or "") == source_id
            ][:8]
            dossier["source_conclusions"] = [
                str(selected_excerpts[-1].get("original_excerpt") or "")
            ]
    draft=writer(dify_base_url,writer_key,target_date,payload)
    article_title=str(draft.get("title") or topic.title_hint).strip()
    draft_markdown = append_faithful_translations(
        str(draft["report_markdown"]), [],
    )
    markdown=normalize_digit_article_markdown(
        draft_markdown,article_title,target_date,article_mode,
    )
    markdown = append_faithful_translations(markdown, translations)
    markdown = ensure_reference_section(markdown, payload["source_excerpts"])
    markdown, sanitized_lines = sanitize_article_markdown(markdown, scoped_view, writer_facts, payload["source_excerpts"])
    markdown = repair_empty_source_description(markdown, article_mode, translations)
    markdown = repair_empty_lead_section(markdown, article_mode)
    atomic_write_json(paths.markdown.with_name(f"{paths.markdown.stem}_faithful_translations.json"), {
        "schema_version": "faithful-translation.v1", "market_date": target_date.isoformat(),
        "translations": translation_records,
    })
    latest_style_audit = None

    def content_issues(current_markdown: str) -> list[str]:
        nonlocal latest_style_audit
        current = auditor(current_markdown,scoped_view,writer_facts,payload["source_excerpts"])
        latest_style_audit = audit_editorial_style(
            current_markdown, recent_article_markdowns or [],
        )
        current.extend(latest_style_audit.blocking_issues)
        article_mode = getattr(
            getattr(scoped_view, "article_mode", None), "value",
            getattr(scoped_view, "article_mode", None),
        )
        minimum_lengths = {
            "faithful_translation": 1800, "event_brief": 900,
            "market_analysis": 1200, "factual_brief": 700,
        }
        minimum_length = minimum_lengths.get(str(article_mode), 0)
        if str(article_mode) == "event_brief":
            source_count = len({str(getattr(fact, "source_id", "")) for fact in writer_facts})
            if len(writer_facts) < 5 or source_count <= 1:
                # Sparse, single-source event briefs should stay concise and faithful.
                # Asking the model to pad them to the normal target invites unsupported context.
                minimum_length = 700
        if minimum_length and reader_character_count(current_markdown) < minimum_length:
            current.append(f"article is shorter than {minimum_length} reader characters")
        required_translations = {"faithful_translation": 4, "event_brief": 1}.get(str(article_mode), 0)
        if len(translations) < required_translations:
            current.append(
                f"faithful translations {len(translations)}/{required_translations}"
            )
        if story_brief:
            for prohibited in story_brief.prohibited_claims:
                if prohibited and prohibited in current_markdown:
                    current.append("article contains a prohibited unresolved claim")
                    break
            body_paragraphs = [
                block.strip() for block in re.split(r"\n\s*\n", current_markdown)
                if block.strip() and not block.lstrip().startswith("#")
            ]
            if len(body_paragraphs) < 2:
                current.append("article does not provide enough semantic coverage")
        return current

    issues=content_issues(markdown)
    disclosure_warnings=article_disclosure_warnings(scoped_view,payload["source_excerpts"])
    if latest_style_audit:
        disclosure_warnings.extend(latest_style_audit.warnings)
    review={"status":"not_run","local_issues":issues,"advisories":disclosure_warnings}
    llm_passed=False
    if issues:
        local_review={
            "decision":"reject","score":0,"blocking_issues":issues,
            "revision_instructions":[
                f"修正本地审计问题：{issue}。数字必须保留证据中的原始写法；"
                "数字可保留原文写法，或使用经本地等值核对的中文化写法；不得近似换算或改变精度。"
                for issue in issues
            ],
            "summary":"local audit failed",
        }
        revision=reviewer(
            dify_base_url,review_key,mode="revise",market_date=target_date.isoformat(),
            markdown=markdown,evidence_payload=payload,previous_review=local_review,
        )
        revised_markdown = append_faithful_translations(
            str(revision.get("revised_markdown","")), [],
        )
        markdown=normalize_digit_article_markdown(
            revised_markdown,None,target_date,article_mode,
        )
        markdown = append_faithful_translations(markdown, translations)
        markdown = ensure_reference_section(markdown, payload["source_excerpts"])
        markdown, removed = sanitize_article_markdown(markdown, scoped_view, writer_facts, payload["source_excerpts"])
        markdown = repair_empty_source_description(markdown, article_mode, translations)
        markdown = repair_empty_lead_section(markdown, article_mode)
        sanitized_lines.extend(removed)
        issues=content_issues(markdown)
        review={"local_review":local_review,"revision":revision,"post_revision_local_issues":issues,
                "advisories":disclosure_warnings}
    local_passed=not issues
    if local_passed:
        first_raw=reviewer(
            dify_base_url,review_key,mode="review",market_date=target_date.isoformat(),
            markdown=markdown,evidence_payload=payload,
        )
        first=validate_review_against_final_markdown(first_raw, markdown)
        review["first_review"]=first
        if first != first_raw:
            review["first_review_model_output"]=first_raw
        if review_passes(first):
            llm_passed=True
        else:
            cleaned_markdown, review_removed = delete_review_blocked_sentences(markdown, first_raw)
            if review_removed:
                markdown = cleaned_markdown
                markdown, removed = sanitize_article_markdown(
                    markdown, scoped_view, writer_facts, payload["source_excerpts"],
                )
                markdown = repair_empty_source_description(markdown, article_mode, translations)
                markdown = repair_empty_lead_section(markdown, article_mode)
                sanitized_lines.extend([*review_removed, *removed])
                issues = content_issues(markdown)
                review["deterministic_review_cleanup"] = {
                    "removed_sentences": review_removed,
                    "post_cleanup_local_issues": issues,
                }
                if not issues:
                    second_raw = reviewer(
                        dify_base_url, review_key, mode="review",
                        market_date=target_date.isoformat(), markdown=markdown,
                        evidence_payload=payload, previous_review=first,
                    )
                    second = validate_review_against_final_markdown(second_raw, markdown)
                    review["second_review"] = second
                    if second != second_raw:
                        review["second_review_model_output"] = second_raw
                    llm_passed = review_passes(second)
                local_passed = not issues
            else:
                revision=reviewer(
                    dify_base_url,review_key,mode="revise",market_date=target_date.isoformat(),
                    markdown=markdown,evidence_payload=payload,previous_review=first,
                )
                revised_markdown = append_faithful_translations(
                    str(revision.get("revised_markdown","")), [],
                )
                markdown=normalize_digit_article_markdown(
                    revised_markdown,None,target_date,article_mode,
                )
                markdown = append_faithful_translations(markdown, translations)
                markdown = ensure_reference_section(markdown, payload["source_excerpts"])
                markdown, removed = sanitize_article_markdown(markdown, scoped_view, writer_facts, payload["source_excerpts"])
                markdown = repair_empty_source_description(markdown, article_mode, translations)
                markdown = repair_empty_lead_section(markdown, article_mode)
                sanitized_lines.extend(removed)
                issues=content_issues(markdown)
                if not issues:
                    second_raw=reviewer(
                        dify_base_url,review_key,mode="review",market_date=target_date.isoformat(),
                        markdown=markdown,evidence_payload=payload,previous_review=first,
                    )
                    second=validate_review_against_final_markdown(second_raw, markdown)
                    review.update({"revision":revision,"second_review":second})
                    if second != second_raw:
                        review["second_review_model_output"]=second_raw
                    llm_passed=review_passes(second)
                local_passed=not issues
    status="shadow_saved" if local_passed and llm_passed else "review_rejected"
    summary=extract_digit_summary(markdown)
    html=markdown_to_report_html(markdown,summary,target_date.isoformat())
    summary_text=summary.strip()+"\n"
    identity=build_artifact_identity(locator,markdown,html,summary_text)
    write_text_atomically(paths.markdown,markdown)
    write_text_atomically(paths.wechat_html,html)
    write_text_atomically(paths.summary,summary_text)
    atomic_write_json(paths.quality_audit,{
        "status":"pass" if local_passed else "reject",
        "publishable":scoped_view.publishable and local_passed and llm_passed,
        "issues":issues,
        "warnings":disclosure_warnings,
        "sanitized_lines":sanitized_lines,
        "article_mode":getattr(
            getattr(scoped_view, "article_mode", "market_view"), "value",
            getattr(scoped_view, "article_mode", "market_view"),
        ),
        "reader_characters":reader_character_count(markdown),
        "facts_count":len(writer_facts),
        "translations_count":len(translations),
        "story_brief_id":story_brief.story_brief_id if story_brief else None,
        "story_form":story_brief.story_form.value if story_brief else None,
        "external_sources_used":len(payload.get("external_confirmations", [])),
        "style_audit": {
            "maximum_paragraph_similarity": (
                latest_style_audit.maximum_paragraph_similarity if latest_style_audit else 0
            ),
            "heading_sequence_similarity": (
                latest_style_audit.heading_sequence_similarity if latest_style_audit else 0
            ),
            "warnings": latest_style_audit.warnings if latest_style_audit else [],
        },
        "editorial_view":scoped_view.model_dump(mode="json"),
        **identity,
    })
    atomic_write_json(paths.llm_review,{
        **review,
        "status":"pass" if llm_passed else "reject",
        **identity,
    })
    return {
        **identity,
        "article_slug":locator.article_slug,
        "title":markdown.splitlines()[0].lstrip("# "),
        "summary":summary,
        "markdown_path":str(paths.markdown),
        "html_path":str(paths.wechat_html),
        "quality_audit_path":str(paths.quality_audit),
        "llm_review_path":str(paths.llm_review),
        "local_audit_status":"pass" if local_passed else "reject",
        "llm_review_status":"pass" if llm_passed else "reject",
        "publication_status":status,
        "article_mode":getattr(
            getattr(scoped_view, "article_mode", "market_view"), "value",
            getattr(scoped_view, "article_mode", "market_view"),
        ),
        "reader_characters":reader_character_count(markdown),
        "facts_count":len(writer_facts),
        "translations_count":len(translations),
        "review_score":max(
            int(item.get("score", 0) or 0)
            for item in (review.get("first_review", {}), review.get("second_review", {}), {"score": 0})
            if isinstance(item, dict)
        ),
    }


def knowledge_commodity(signals: list[Any]) -> str:
    for status in (SignalStatus.TOP,SignalStatus.SECONDARY,SignalStatus.WEAK):
        signal=next((item for item in signals if item.status == status),None)
        if signal and signal.commodity:
            return signal.commodity
    return "market"


def write_daily_pipeline_status(
    date_dir: Path, target_date: date, view: Any, entries: list[dict[str, Any]],
    *, research_state: dict[str, Any] | None = None,
    story_briefs: list[StoryBrief] | None = None,
    claim_ledger: list[ClaimLedgerEntry] | None = None,
) -> None:
    research_state = research_state or {}
    story_briefs = story_briefs or []
    claim_ledger = claim_ledger or []
    generated = bool(entries)
    local_passed = generated and all(entry.get("local_audit_status") == "pass" for entry in entries)
    llm_passed = generated and all(entry.get("llm_review_status") == "pass" for entry in entries)
    successful_entries = [
        entry for entry in entries
        if entry.get("publication_status") in {"draft_created", "published", "shadow_saved"}
    ]
    draft_created = any(entry.get("publication_status") == "draft_created" for entry in entries)
    blocking_reasons: list[str] = []
    if not getattr(view, "evidence_ready", False):
        blocking_reasons.append("NO_EDITORIAL_EVIDENCE")
    if getattr(view, "article_mode", None) == ArticleMode.ARCHIVE_ONLY:
        blocking_reasons.append("ARCHIVE_ONLY")
    for entry in entries:
        if entry.get("error"):
            blocking_reasons.append(str(entry["error"]))
        elif entry.get("publication_status") in {"generation_failed", "review_rejected", "publish_failed"}:
            blocking_reasons.append(str(entry.get("publication_status")))
    atomic_write_json(date_dir / "pipeline_status.json", {
        "schema_version": "digit-publication-status.v1",
        "market_date": target_date.isoformat(),
        "documents_ready": bool(getattr(view, "supporting_fact_ids", [])),
        "evidence_ready": bool(getattr(view, "evidence_ready", False)),
        "editorially_publishable": bool(getattr(view, "editorially_publishable", False)),
        "directional_signal_available": bool(getattr(view, "directional_signal_available", False)),
        "article_mode": getattr(getattr(view, "article_mode", "archive_only"), "value", getattr(view, "article_mode", "archive_only")),
        "topic_ready": generated,
        "article_generated": generated,
        "translation_completed": generated and all(int(entry.get("translations_count", 0) or 0) > 0 for entry in entries),
        "local_audit_passed": local_passed,
        "llm_review_passed": llm_passed,
        "wechat_preflight_passed": generated and all(entry.get("publication_status") not in {"generation_failed", "review_rejected"} for entry in entries),
        "draft_created": draft_created,
        "successful_articles_count": len(successful_entries),
        "failed_articles_count": len(entries) - len(successful_entries),
        "all_articles_passed": generated and len(successful_entries) == len(entries),
        "daily_status": publication_index_status(entries),
        "source_style_profile_ready": bool(story_briefs),
        "external_research_completed": research_state.get("status") == "completed",
        "external_evidence_verified": any(
            str(getattr(item, "verification_status", "")) == "verified"
            for item in research_state.get("candidates", [])
        ),
        "claim_ledger_ready": bool(claim_ledger),
        "story_brief_ready": bool(story_briefs),
        "story_form": [brief.story_form.value for brief in story_briefs],
        "external_sources_used": sum(int(entry.get("external_sources_used", 0) or 0) for entry in entries),
        "external_conflicts_unresolved": any(
            entry.claim_type.value == "unresolved" for entry in claim_ledger
        ),
        "blocking_reasons": list(dict.fromkeys(blocking_reasons)),
    })


def main() -> None:
    parser = argparse.ArgumentParser(description="Build EditorialView and publication artifact")
    parser.add_argument("--date", required=True)
    parser.add_argument("--historical", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    _publication_run_id()
    target_date = date.fromisoformat(args.date)
    database_url = os.environ["DATABASE_URL"]
    pipeline_mode = os.getenv("MARKET_PIPELINE_MODE", "shadow")
    requested_action, effective_action = resolve_publication_execution(
        pipeline_mode, historical=args.historical, dry_run=args.dry_run,
    )
    reports_root = Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault")) / "reports"
    date_dir = reports_root / "digit" / args.date
    entries: list[dict[str, Any]] = []
    database_recovery_entries: list[dict[str, Any]] = []
    with Connection.connect(database_url) as connection:
        signals, previous, facts, metrics, mapping, unresolved = _rows(connection, target_date)
        load_and_persist_source_dossiers(connection, target_date, DIGIT_SOURCE_CHANNEL)
        source_dossiers = load_source_dossiers(connection, target_date)
        research_state = prepare_external_research(
            connection, target_date, source_dossiers, facts,
        )
        if research_state.get("promoted_fact_ids"):
            signals, previous, facts, metrics, mapping, unresolved = _rows(connection, target_date)
        editorial_external_evidence = (
            list(research_state.get("candidates", []))
            if research_state.get("mode") == "review" else []
        )
        claim_ledger = build_claim_ledger(
            target_date, facts, editorial_external_evidence,
        )
        persist_claim_ledger(connection, claim_ledger)
        commodity = knowledge_commodity(signals)
        card = retrieve_knowledge_card(commodity)
        view = build_editorial_view(
            target_date, signals, previous_signals=previous, knowledge_card=card,
            allowed_fact_ids={fact.fact_id for fact in facts}, unresolved_fact_ids=unresolved,
            facts=facts,
        )
        database_view_id = _persist_view(connection, view, is_historical=args.historical)
        topic_plan = plan_article_topics_with_diagnostics(view, facts, signals)
        topics = list(topic_plan.topics)
        omitted_due_to_cap = list(topic_plan.omitted_due_to_cap)
        story_briefs_by_slug: dict[str, StoryBrief] = {}
        valid_topics: list[ArticleTopic] = []
        for topic in topics:
            brief, brief_issues = build_story_brief(
                target_date, topic, source_dossiers, facts, claim_ledger,
            )
            topic = promote_source_close_reading_topic(topic, brief)
            persist_story_brief(connection, topic, brief, brief_issues)
            if brief_issues:
                omitted_due_to_cap.append({
                    "topic": topic.model_dump(mode="json"),
                    "reason": "STORY_BRIEF_VALIDATION_FAILED",
                    "issues": brief_issues,
                })
                continue
            story_briefs_by_slug[topic.slug] = brief
            valid_topics.append(topic)
        topics = valid_topics
        if not topics:
            write_no_topic_archive(
                reports_root, target_date,
                f"{view.main_thesis}\n\n当日不具备可发布主题；仅本地归档，不创建公众号草稿。",
            )
            finalize_daily_aggregate(
                connection,database_view_id,target_date,date_dir,[],mapping,
                is_historical=args.historical,omitted_due_to_cap=omitted_due_to_cap,
            )
            write_daily_pipeline_status(
                date_dir, target_date, view, [], research_state=research_state,
                story_briefs=list(story_briefs_by_slug.values()), claim_ledger=claim_ledger,
            )
            print(
                f"date={args.date} publishable={view.publishable} topics=0 status=archive_only "
                f"pipeline_mode={pipeline_mode} requested_action={requested_action} "
                f"effective_action={effective_action} dry_run={str(args.dry_run).lower()}",
                flush=True,
            )
            return

        writer_key = os.environ["DIFY_WORKFLOW_API_KEY_WRITER"]
        review_key = os.environ["DIFY_WORKFLOW_API_KEY_REVIEW"]
        extract_key = os.environ["DIFY_WORKFLOW_API_KEY_EXTRACT"]
        dify_base_url = os.getenv("DIFY_BASE_URL", "http://127.0.0.1")
        recent_article_markdowns = load_recent_digit_markdowns(
            reports_root, target_date, limit=10,
        )

        def process_topic(topic: ArticleTopic, ordinal: int) -> dict[str, Any]:
            return build_topic_article(
                topic,ordinal,target_date=target_date,view=view,facts=facts,signals=signals,
                metrics=metrics,mapping=mapping,reports_root=reports_root,
                dify_base_url=dify_base_url,writer_key=writer_key,review_key=review_key,extract_key=extract_key,
                source_dossiers=source_dossiers,
                story_brief=story_briefs_by_slug.get(topic.slug),
                claim_ledger=claim_ledger,
                external_evidence=editorial_external_evidence,
                recent_article_markdowns=recent_article_markdowns,
            )

        entries = run_topics_independently(topics, process_topic)
        initial_publication_action = (
            pipeline_mode if pipeline_mode in {"off", "shadow"} else "shadow"
        )
        for entry in entries:
            entry["publication_action"] = initial_publication_action
        finalize_daily_aggregate(
            connection,database_view_id,target_date,date_dir,entries,mapping,
            is_historical=args.historical,omitted_due_to_cap=omitted_due_to_cap,
        )
        if not args.dry_run and pipeline_mode in {"review", "active"}:
            recovery_action = _resolved_topic_publication_action(
                effective_action,
                target_date,
                reports_root,
            )
            database_recovery_entries = _load_database_topic_publications(
                connection,
                target_date,
                [str(entry.get("article_slug") or "") for entry in entries],
                recovery_action,
            )

    if args.dry_run:
        entries = preview_topics_independently(
            entries,
            target_date,
            requested_action=requested_action,
            historical=args.historical,
        )
        write_publication_index(
            date_dir,target_date,entries,omitted_due_to_cap=omitted_due_to_cap,
        )
        write_daily_aggregate_artifacts(target_date, date_dir, entries)
    elif pipeline_mode in {"review", "active"}:
        rollout_threshold = int(read_publish_config(DEFAULT_CONFIG_PATH).get("shadow_publish_days", 3))
        entries = publish_topics_independently(
            entries,
            target_date,
            action=effective_action,
            historical=args.historical,
            reports_root=reports_root,
            rollout_threshold=rollout_threshold,
            recovery_entries=database_recovery_entries,
        )
        with Connection.connect(database_url) as connection:
            finalize_daily_aggregate(
                connection,database_view_id,target_date,date_dir,entries,mapping,
                is_historical=args.historical,omitted_due_to_cap=omitted_due_to_cap,
            )
    failed=sum(
        entry["publication_status"] in {"generation_failed","review_rejected","publish_failed"}
        or entry.get("dry_run_status") == "failed"
        for entry in entries
    )
    write_daily_pipeline_status(
        date_dir, target_date, view, entries, research_state=research_state,
        story_briefs=list(story_briefs_by_slug.values()), claim_ledger=claim_ledger,
    )
    successful_entries = [
        entry for entry in entries
        if entry.get("publication_status") in {"draft_created", "published", "shadow_saved"}
    ]
    failed_entries = [entry for entry in entries if entry not in successful_entries]
    if entries:
        if successful_entries and failed_entries:
            severity, status_code, event_title = "warning", "DIGIT_PARTIAL_SUCCESS", "ETI Digit 部分成功"
            impact = "已通过稿件已保留；被拒主题不会进入公众号草稿。"
        elif successful_entries:
            severity, status_code, event_title = "success", "DIGIT_DRAFTS_READY", "ETI Digit 草稿完成"
            impact = f"{len(successful_entries)}篇草稿已创建并完成回读。"
        else:
            severity, status_code, event_title = "warning", "DIGIT_ALL_REJECTED", "ETI Digit 当日无合格草稿"
            impact = "当日没有创建公众号草稿。"
        emit_event(NotificationEvent(
            market_date=args.date, stream="digit", severity=severity, status_code=status_code,
            title=event_title, impact=impact, action_required=False,
            recommended_action=(
                "检查本地审校报告；只有希望发布被拒主题时才需要人工修改。"
                if severity == "warning" else
                "无需操作；如希望发布被拒主题，可查看本地审校报告。" if status_code == "DIGIT_ALL_REJECTED" else
                "请在公众号后台预览；系统无需处理。"
            ),
            next_action="下一个交易日继续自动运行。",
            article_count=len(successful_entries),
            draft_ids=[
                str(entry.get("media_id") or entry.get("publication_reference") or "")
                for entry in successful_entries
            ],
            details=[
                *[f"成功：{entry.get('title') or entry.get('article_slug')}" for entry in successful_entries],
                *[
                    f"拒绝：{entry.get('title') or entry.get('article_slug')}；"
                    f"{entry.get('error') or entry.get('publication_status')}"
                    for entry in failed_entries
                ],
            ],
            source_run_id=os.getenv("ETI_RUN_ID", ""), historical=args.historical, dry_run=args.dry_run,
        ))
    print(
        f"date={args.date} publishable={view.publishable} topics={len(entries)} failed={failed} "
        f"pipeline_mode={pipeline_mode} requested_action={requested_action} "
        f"effective_action={effective_action} dry_run={str(args.dry_run).lower()}",
        flush=True,
    )


if __name__ == "__main__":
    main()

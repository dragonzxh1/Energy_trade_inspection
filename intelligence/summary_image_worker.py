"""Publish queued Platts Summary images after title-date validation and QR replacement."""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from intelligence.daily_prices import promote_summary_image_quote, resolve_daily_price_root
from intelligence.telegram_notify import NotificationEvent, emit_event
from intelligence.wechat_publish import (
    append_publication_footer,
    batch_get_drafts,
    clean_text,
    compute_file_sha256,
    compute_text_sha256,
    create_draft,
    ensure_final_article_content,
    ensure_publish_config,
    ensure_thumb_media_id,
    get_access_token,
    get_draft,
    prepare_thumb_image,
    read_publish_config,
    submit_publish,
    upload_article_image,
)
from intelligence.summary_image_support import (
    SUMMARY_TITLE_DATE_VERSION,
    SummaryTitleDateDetection,
    detect_market_date_from_image_title,
)


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG_PATH = Path(
    os.getenv("WECHAT_MP_CONFIG", ROOT_DIR / "intelligence" / "wechat_publish.json")
)
SUMMARY_SOURCE_CHANNEL = os.getenv(
    "TELEGRAM_SUMMARY_SOURCE_CHANNEL", "telegram:quotes-summary"
)
SUMMARY_PIPELINE_VERSION = SUMMARY_TITLE_DATE_VERSION
SUMMARY_RUN_TYPE = "summary_image"

TERMINAL_PROCESSING_STATUSES = {"completed", "needs_review", "failed_terminal"}


@dataclass(frozen=True, slots=True)
class SummaryImageItem:
    attachment_id: str | None
    source_path: Path
    source_sha256: str
    message_timestamp: datetime | None = None


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalized_html(value: str) -> str:
    return re.sub(r">\s+<", "><", re.sub(r"\s+", " ", value)).strip()


class ArticleContentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text_parts: list[str] = []
        self.image_urls: list[str] = []

    def handle_starttag(
        self,
        tag: str,
        attrs: list[tuple[str, str | None]],
    ) -> None:
        if tag.casefold() != "img":
            return
        values = {key.casefold(): value or "" for key, value in attrs}
        image_url = values.get("src") or values.get("data-src")
        if image_url:
            self.image_urls.append(image_url.strip())

    def handle_data(self, data: str) -> None:
        normalized = re.sub(r"\s+", " ", data).strip()
        if normalized:
            self.text_parts.append(normalized)


def article_content_signature(value: str) -> str:
    parser = ArticleContentParser()
    parser.feed(value)
    payload = {
        "text": " ".join(parser.text_parts),
        "image_count": len(parser.image_urls),
    }
    return compute_text_sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True)
    )


def build_summary_article(
    config: dict[str, Any],
    market_date: str,
    article_image_url: str,
    thumb_media_id: str,
) -> dict[str, Any]:
    title = f"每日普氏价格｜{market_date} 图片报价"
    digest = f"每日普氏价格图片报价，市场日期 {market_date}。"
    content = (
        '<section style="margin:0 auto;max-width:720px;color:#1f2937;">'
        f'<h1 style="margin:0 0 14px;font-size:24px;line-height:1.45;">{html.escape(title)}</h1>'
        f'<p style="margin:0 0 16px;font-size:14px;line-height:1.8;color:#6b7280;">'
        f'市场日期：{html.escape(market_date)}</p>'
        f'<img src="{html.escape(article_image_url, quote=True)}" alt="每日普氏价格图片报价" '
        'style="display:block;width:100%;height:auto;margin:0;border:0;">'
        '<p style="margin:14px 0 0;font-size:13px;line-height:1.8;color:#6b7280;">'
        '具体价格及单位以图片标注为准。</p>'
        "</section>"
    )
    content = append_publication_footer(
        content,
        source_titles=["Platts Summary 报价图片"],
        stream="summary",
    )
    article = {
        "title": title,
        "author": "能见社",
        "digest": digest,
        "content": content,
        "content_source_url": clean_text(config.get("content_source_url")),
        "thumb_media_id": thumb_media_id,
        "need_open_comment": int(config.get("need_open_comment", 0)),
        "only_fans_can_comment": int(config.get("only_fans_can_comment", 0)),
        "article_image_url": article_image_url,
        "market_date": market_date,
    }
    ensure_final_article_content(content, article_image_url)
    return article


def verify_summary_draft(
    access_token: str,
    media_id: str,
    article: dict[str, Any],
) -> dict[str, Any]:
    response = get_draft(access_token, media_id)
    news_items = response.get("news_item")
    if not isinstance(news_items, list) or len(news_items) != 1:
        raise RuntimeError("WeChat draft verification failed: expected exactly one article")
    remote = news_items[0] if isinstance(news_items[0], dict) else {}
    remote_title = clean_text(remote.get("title"))
    remote_author = clean_text(remote.get("author"))
    remote_content = clean_text(remote.get("content"))
    if remote_title != article["title"]:
        raise RuntimeError("WeChat draft verification failed: title mismatch")
    if remote_author != article["author"]:
        raise RuntimeError("WeChat draft verification failed: author mismatch")
    if article["market_date"] not in remote_title or article["market_date"] not in remote_content:
        raise RuntimeError("WeChat draft verification failed: market date missing")
    remote_parser = ArticleContentParser()
    remote_parser.feed(remote_content)
    if len(remote_parser.image_urls) != 1 or not remote_parser.image_urls[0].startswith(
        "https://mmbiz.qpic.cn/"
    ):
        raise RuntimeError("WeChat draft verification failed: body image mismatch")
    try:
        ensure_final_article_content(remote_content, remote_parser.image_urls[0])
    except (RuntimeError, ValueError) as exc:
        raise RuntimeError(
            f"WeChat draft verification failed: {exc}"
        ) from None
    if article_content_signature(article["content"]) != article_content_signature(
        remote_content
    ):
        raise RuntimeError("WeChat draft verification failed: content hash mismatch")
    return {
        "verified": True,
        "title": remote_title,
        "author": remote_author,
        "content_hash": compute_text_sha256(normalized_html(remote_content)),
        "content_length": len(remote_content),
    }


def find_existing_summary_draft(
    access_token: str,
    article: dict[str, Any],
    *,
    max_pages: int = 5,
) -> str | None:
    expected_content_signature = article_content_signature(article["content"])
    for page in range(max_pages):
        response = batch_get_drafts(access_token, offset=page * 20, count=20)
        items = response.get("item")
        if not isinstance(items, list):
            raise RuntimeError("WeChat draft recovery failed: invalid batch response")
        for item in items:
            if not isinstance(item, dict):
                continue
            media_id = clean_text(item.get("media_id"))
            content = item.get("content")
            news_items = content.get("news_item") if isinstance(content, dict) else None
            if not media_id or not isinstance(news_items, list) or len(news_items) != 1:
                continue
            remote = news_items[0] if isinstance(news_items[0], dict) else {}
            if (
                clean_text(remote.get("title")) == article["title"]
                and clean_text(remote.get("author")) == article["author"]
                and article_content_signature(clean_text(remote.get("content")))
                == expected_content_signature
            ):
                return media_id
        if len(items) < 20:
            break
    return None


def load_pending_items(connection: Any, lookback_days: int, limit: int) -> list[SummaryImageItem]:
    from psycopg.rows import dict_row

    cutoff = utc_now() - timedelta(days=lookback_days)
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT attachment.id AS attachment_id,
                   attachment.attachment_path,
                   attachment.file_hash,
                   message.telegram_message_date
            FROM telegram_attachments attachment
            JOIN telegram_message_attachments link ON link.attachment_id = attachment.id
            JOIN telegram_messages message ON message.id = link.message_id
            LEFT JOIN processing_runs run
              ON run.attachment_id = attachment.id
             AND run.run_type = %s
             AND run.pipeline_version = %s
            WHERE message.source_channel = %s
              AND attachment.attachment_mime_type LIKE 'image/%%'
              AND message.telegram_message_date >= %s
              AND (
                run.id IS NULL
                OR run.processing_status IN ('pending', 'failed', 'failed_retryable')
              )
            ORDER BY message.telegram_message_date, attachment.created_at
            LIMIT %s
            """,
            (
                SUMMARY_RUN_TYPE,
                SUMMARY_PIPELINE_VERSION,
                SUMMARY_SOURCE_CHANNEL,
                cutoff,
                limit,
            ),
        )
        return [
            SummaryImageItem(
                attachment_id=str(row["attachment_id"]),
                source_path=Path(str(row["attachment_path"])),
                source_sha256=str(row["file_hash"]),
                message_timestamp=row["telegram_message_date"],
            )
            for row in cursor.fetchall()
        ]


def upsert_processing_run(
    connection: Any,
    item: SummaryImageItem,
    status: str,
    *,
    error: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    if not item.attachment_id:
        return
    from psycopg.types.json import Jsonb

    completed_at = utc_now() if status in TERMINAL_PROCESSING_STATUSES else None
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO processing_runs (
              attachment_id,run_type,pipeline_version,pipeline_mode,
              processing_status,completed_at,error_message,metadata
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (attachment_id,run_type,pipeline_version) DO UPDATE SET
              pipeline_mode=EXCLUDED.pipeline_mode,
              processing_status=EXCLUDED.processing_status,
              completed_at=EXCLUDED.completed_at,
              error_message=EXCLUDED.error_message,
              metadata=EXCLUDED.metadata,
              updated_at=now()
            """,
            (
                item.attachment_id,
                SUMMARY_RUN_TYPE,
                SUMMARY_PIPELINE_VERSION,
                (
                    "review"
                    if os.getenv("MARKET_PIPELINE_MODE", "review") == "historical"
                    else os.getenv("MARKET_PIPELINE_MODE", "review")
                ),
                status,
                completed_at,
                error,
                Jsonb(metadata or {}),
            ),
        )


def fetch_publication_state(
    connection: Any,
    *,
    market_date: str | None = None,
    source_sha256: str | None = None,
) -> dict[str, Any] | None:
    from psycopg.rows import dict_row

    if not market_date and not source_sha256:
        return None
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT *
            FROM summary_publication_states
            WHERE (%s::date IS NOT NULL AND market_date = %s::date)
               OR (%s::text IS NOT NULL AND source_sha256 = %s)
            ORDER BY CASE WHEN source_sha256 = %s THEN 0 ELSE 1 END
            LIMIT 1
            """,
            (market_date, market_date, source_sha256, source_sha256, source_sha256),
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def persist_publication_state(
    connection: Any,
    *,
    market_date: str,
    item: SummaryImageItem,
    output_sha256: str | None,
    status: str,
    media_id: str | None = None,
    content_hash: str | None = None,
    verified_at: datetime | None = None,
    last_error: str | None = None,
    state: dict[str, Any] | None = None,
) -> None:
    from psycopg.types.json import Jsonb

    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO summary_publication_states (
              market_date,image_market_date,image_date_confidence,image_quote_status,
              image_draft_media_id,bot_confirmation_status,structured_verification_status,
              comparison_eligible,reconciliation_issues,state_json,
              source_attachment_id,source_sha256,output_sha256,draft_content_hash,
              draft_verified_at,attempts,last_error,idempotency_key
            ) VALUES (
              %s,%s,1.0,%s,%s,'pending','pending',false,'[]'::jsonb,%s,
              %s,%s,%s,%s,%s,1,%s,%s
            )
            ON CONFLICT (market_date) DO UPDATE SET
              image_market_date=EXCLUDED.image_market_date,
              image_date_confidence=EXCLUDED.image_date_confidence,
              image_quote_status=CASE
                WHEN summary_publication_states.image_quote_status='draft_verified'
                 AND EXCLUDED.image_quote_status<>'draft_verified'
                THEN summary_publication_states.image_quote_status
                ELSE EXCLUDED.image_quote_status
              END,
              image_draft_media_id=COALESCE(EXCLUDED.image_draft_media_id,summary_publication_states.image_draft_media_id),
              state_json=EXCLUDED.state_json,
              source_attachment_id=COALESCE(EXCLUDED.source_attachment_id,summary_publication_states.source_attachment_id),
              source_sha256=COALESCE(EXCLUDED.source_sha256,summary_publication_states.source_sha256),
              output_sha256=COALESCE(EXCLUDED.output_sha256,summary_publication_states.output_sha256),
              draft_content_hash=COALESCE(EXCLUDED.draft_content_hash,summary_publication_states.draft_content_hash),
              draft_verified_at=COALESCE(EXCLUDED.draft_verified_at,summary_publication_states.draft_verified_at),
              attempts=summary_publication_states.attempts + 1,
              last_error=EXCLUDED.last_error,
              idempotency_key=EXCLUDED.idempotency_key,
              updated_at=now()
            """,
            (
                market_date,
                market_date,
                status,
                media_id,
                Jsonb(state or {}),
                item.attachment_id,
                item.source_sha256,
                output_sha256,
                content_hash,
                verified_at,
                last_error,
                f"summary-image:{market_date}",
            ),
        )


def notification_for_result(result: dict[str, Any]) -> None:
    status = result.get("status")
    if status not in {
        "draft_verified", "needs_review", "failed_retryable", "failed_terminal"
    }:
        return
    market_date = str(result.get("market_date") or utc_now().date().isoformat())
    if status == "draft_verified":
        emit_event(NotificationEvent(
            market_date=market_date,
            stream="summary",
            severity="success",
            status_code="SUMMARY_IMAGE_DRAFT_VERIFIED",
            title="ETI Summary 图片报价草稿已回读",
            impact=f"市场日期 {market_date} 的图片报价草稿已创建并通过微信回读。",
            action_required=False,
            next_action="无需操作；可在公众号后台预览草稿。",
            details=[
                f"标题：{result.get('title', '')}",
                f"草稿ID：{result.get('draft_media_id', '')}",
                f"原图哈希：{str(result.get('source_sha256', ''))[:12]}",
            ],
            source_run_id=str(result.get("run_id") or ""),
        ))
        return
    reasons = ", ".join(result.get("blocking_reasons") or ["unknown"])
    emit_event(NotificationEvent(
        market_date=market_date,
        stream="summary",
        severity="warning" if status == "needs_review" else "critical",
        status_code="SUMMARY_IMAGE_NEEDS_REVIEW" if status == "needs_review" else "SUMMARY_IMAGE_FAILED",
        title="ETI Summary 图片报价需要检查",
        impact=reasons,
        action_required=True,
        recommended_action="检查原始图片、标题日期或微信接口状态。",
        next_action="修复后重新运行 Summary 待办任务。",
        details=[f"原图：{result.get('source_path', '')}"],
        source_run_id=str(result.get("run_id") or ""),
    ))


def process_item(
    item: SummaryImageItem,
    *,
    connection: Any | None,
    action: str,
    dry_run: bool,
    config_path: Path,
    market_date_from: date | None = None,
) -> dict[str, Any]:
    run_id = f"SUMMARY-{uuid.uuid4().hex[:12]}"
    base_result: dict[str, Any] = {
        "run_id": run_id,
        "source_path": str(item.source_path),
        "source_sha256": item.source_sha256,
        "market_date_source": "image_title",
        "date_detection_version": SUMMARY_TITLE_DATE_VERSION,
        "draft_media_id": None,
        "draft_verified": False,
        "blocking_reasons": [],
    }
    if not item.source_path.is_file():
        result = {
            **base_result,
            "status": "failed_terminal",
            "blocking_reasons": ["IMAGE_DECODE_FAILED"],
        }
        if connection:
            upsert_processing_run(
                connection, item, "failed_terminal",
                error="IMAGE_DECODE_FAILED", metadata=result,
            )
        return result
    actual_sha256 = compute_file_sha256(item.source_path)
    if actual_sha256 != item.source_sha256:
        result = {
            **base_result,
            "status": "failed_terminal",
            "blocking_reasons": ["SOURCE_HASH_MISMATCH"],
        }
        if connection:
            upsert_processing_run(
                connection, item, "failed_terminal",
                error="SOURCE_HASH_MISMATCH", metadata=result,
            )
        return result

    detection: SummaryTitleDateDetection = detect_market_date_from_image_title(
        str(item.source_path)
    )
    base_result.update({
        "market_date": detection.market_date,
        "date_match_count": detection.matched_count,
        "recognized_titles": list(detection.recognized_titles),
    })
    if not detection.market_date:
        if (
            market_date_from
            and item.message_timestamp
            and item.message_timestamp.date() < market_date_from
        ):
            result = {
                **base_result,
                "status": "skipped_before_start_date",
            }
            if connection:
                upsert_processing_run(connection, item, "completed", metadata=result)
            return result
        reason = detection.failure_reason or "MARKET_DATE_NOT_FOUND"
        result = {
            **base_result,
            "status": "needs_review",
            "blocking_reasons": [reason],
        }
        if connection:
            upsert_processing_run(
                connection, item, "needs_review", error=reason, metadata=result,
            )
        return result

    market_date = detection.market_date
    if market_date_from and date.fromisoformat(market_date) < market_date_from:
        result = {
            **base_result,
            "market_date": market_date,
            "status": "skipped_before_start_date",
        }
        if connection:
            upsert_processing_run(connection, item, "completed", metadata=result)
        return result
    if connection:
        existing = fetch_publication_state(
            connection,
            market_date=market_date,
            source_sha256=item.source_sha256,
        )
        if existing:
            existing_hash = clean_text(existing.get("source_sha256"))
            existing_status = clean_text(existing.get("image_quote_status"))
            if existing_hash == item.source_sha256 and existing_status == "draft_verified":
                result = {
                    **base_result,
                    "status": "skipped_duplicate",
                    "draft_media_id": existing.get("image_draft_media_id"),
                }
                upsert_processing_run(connection, item, "completed", metadata=result)
                return result
            if (
                not existing_hash
                and existing_status == "draft_verified"
                and existing.get("image_draft_media_id")
            ):
                result = {
                    **base_result,
                    "status": "skipped_duplicate",
                    "draft_media_id": existing.get("image_draft_media_id"),
                }
                upsert_processing_run(connection, item, "completed", metadata=result)
                return result
            if existing_hash and existing_hash != item.source_sha256:
                result = {
                    **base_result,
                    "status": "needs_review",
                    "blocking_reasons": ["SAME_DATE_DIFFERENT_IMAGE"],
                }
                upsert_processing_run(
                    connection, item, "needs_review",
                    error="SAME_DATE_DIFFERENT_IMAGE", metadata=result,
                )
                return result
        upsert_processing_run(connection, item, "processing", metadata=base_result)

    try:
        promotion_path = promote_summary_image_quote(
            None,
            item.source_path,
            resolve_daily_price_root(),
        )
        promotion = json.loads(promotion_path.read_text(encoding="utf-8"))
        output_path = promotion_path.parent / "public_reference.png"
        output_sha256 = compute_file_sha256(output_path)
    except Exception as exc:
        reason = (
            "IMAGE_DIMENSION_MISMATCH"
            if "dimension" in str(exc).casefold() or "width" in str(exc).casefold()
            or "height" in str(exc).casefold()
            else "QR_REPLACEMENT_FAILED"
        )
        result = {
            **base_result,
            "status": "failed_terminal",
            "blocking_reasons": [reason],
            "error": str(exc),
        }
        if connection:
            upsert_processing_run(
                connection, item, "failed_terminal", error=str(exc), metadata=result,
            )
            persist_publication_state(
                connection,
                market_date=market_date,
                item=item,
                output_sha256=None,
                status="failed_terminal",
                last_error=str(exc),
                state=result,
            )
        return result

    ready_result = {
        **base_result,
        "market_date": market_date,
        "output_sha256": output_sha256,
        "promotion_path": str(promotion_path),
        "status": "ready",
    }
    if dry_run:
        if connection:
            upsert_processing_run(connection, item, "pending", metadata=ready_result)
            persist_publication_state(
                connection,
                market_date=market_date,
                item=item,
                output_sha256=output_sha256,
                status="ready",
                state=ready_result,
            )
        return ready_result

    try:
        config = read_publish_config(config_path)
        prepare_thumb_image(config, market_date)
        ensure_publish_config(config)
        access_token = get_access_token(config)
        article_image_url = upload_article_image(access_token, output_path)
        thumb_media_id = ensure_thumb_media_id(config, access_token)
        article = build_summary_article(
            config,
            market_date,
            article_image_url,
            thumb_media_id,
        )
        media_id = find_existing_summary_draft(access_token, article)
        if not media_id:
            draft = create_draft(access_token, article)
            media_id = clean_text(draft.get("media_id"))
        if not media_id:
            raise RuntimeError("WeChat create draft succeeded without media_id")
        verification = verify_summary_draft(access_token, media_id, article)
        publish_id = None
        if action == "publish":
            publish_id = clean_text(submit_publish(access_token, media_id).get("publish_id"))
        result = {
            **ready_result,
            "status": "draft_verified",
            "title": article["title"],
            "draft_media_id": media_id,
            "draft_verified": True,
            "draft_content_hash": verification["content_hash"],
            "publish_id": publish_id,
            "completed_reason": "COMPLETED_DRAFT_VERIFIED",
        }
        if connection:
            persist_publication_state(
                connection,
                market_date=market_date,
                item=item,
                output_sha256=output_sha256,
                status="draft_verified",
                media_id=media_id,
                content_hash=verification["content_hash"],
                verified_at=utc_now(),
                state=result,
            )
            upsert_processing_run(connection, item, "completed", metadata=result)
        return result
    except Exception as exc:
        message = str(exc)
        if "upload article image" in message.casefold():
            reason = "WECHAT_BODY_IMAGE_UPLOAD_FAILED"
        elif "verification" in message.casefold() or "draft/get" in message.casefold():
            reason = "WECHAT_DRAFT_READBACK_FAILED"
        else:
            reason = "WECHAT_DRAFT_CREATE_FAILED"
        result = {
            **ready_result,
            "status": "failed_retryable",
            "blocking_reasons": [reason],
            "error": message,
        }
        if connection:
            persist_publication_state(
                connection,
                market_date=market_date,
                item=item,
                output_sha256=output_sha256,
                status="failed_retryable",
                last_error=message,
                state=result,
            )
            upsert_processing_run(
                connection, item, "failed_retryable", error=message, metadata=result,
            )
        return result


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Process pending Platts Summary images into verified WeChat drafts"
    )
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--pending", action="store_true")
    source_group.add_argument("--source", type=Path)
    parser.add_argument("--lookback-days", type=int, default=14)
    parser.add_argument("--max-images", type=int, default=20)
    parser.add_argument("--action", choices=("draft", "publish"), default="draft")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--market-date-from", type=date.fromisoformat)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.lookback_days < 1 or args.lookback_days > 90:
        raise SystemExit("--lookback-days must be between 1 and 90")
    if args.max_images < 1 or args.max_images > 100:
        raise SystemExit("--max-images must be between 1 and 100")

    connection = None
    if args.pending:
        database_url = os.getenv("DATABASE_URL", "").strip()
        if not database_url:
            raise RuntimeError("DATABASE_URL is required for --pending")
        from psycopg import Connection

        connection = Connection.connect(database_url)
        items = load_pending_items(connection, args.lookback_days, args.max_images)
    else:
        source_path = Path(args.source)
        if not source_path.is_file():
            raise FileNotFoundError(source_path)
        items = [
            SummaryImageItem(
                attachment_id=None,
                source_path=source_path,
                source_sha256=compute_file_sha256(source_path),
            )
        ]

    results: list[dict[str, Any]] = []
    try:
        for item in items:
            result = process_item(
                item,
                connection=connection,
                action=args.action,
                dry_run=args.dry_run,
                config_path=args.config,
                market_date_from=args.market_date_from,
            )
            results.append(result)
            if connection:
                connection.commit()
            if not args.dry_run:
                notification_for_result(result)
    finally:
        if connection:
            connection.close()

    payload = {
        "ok": not any(
            result["status"] in {"failed_retryable", "failed_terminal"}
            for result in results
        ),
        "processed": len(results),
        "results": results,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Parse adapted Telegram attachments and persist SourceDocument contracts."""

from __future__ import annotations

import argparse
import os
from datetime import datetime, time, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from intelligence.content_streams import digital_source_channels

from .contracts import (
    MARKET_PIPELINE_SCHEMA_VERSION,
    SOURCE_DOCUMENT_SCHEMA_VERSION,
    AttachmentMessageType,
    MarketPipelineMode,
    TelegramAttachment,
    TelegramInput,
    TelegramMessage,
)
from .document_parser import parse_telegram_document


SINGAPORE = ZoneInfo("Asia/Singapore")
PARSER_QUIET_WINDOWS = ((time(9, 0), time(12, 0)), (time(14, 0), time(18, 0)))


def parser_quiet_hours(now: datetime | None = None) -> bool:
    current = now or datetime.now(SINGAPORE)
    if current.tzinfo is None:
        current = current.replace(tzinfo=SINGAPORE)
    local_time = current.astimezone(SINGAPORE).time().replace(tzinfo=None)
    return any(start <= local_time < end for start, end in PARSER_QUIET_WINDOWS)


def _telegram_input(row: dict[str, Any]) -> TelegramInput:
    message_date = row["telegram_message_date"]
    ingested_at = row["ingested_at"]
    if message_date.tzinfo is None:
        message_date = message_date.replace(tzinfo=timezone.utc)
    if ingested_at.tzinfo is None:
        ingested_at = ingested_at.replace(tzinfo=timezone.utc)
    return TelegramInput(
        schema_version=row["schema_version"] or MARKET_PIPELINE_SCHEMA_VERSION,
        pipeline_version=row["pipeline_version"],
        pipeline_mode=MarketPipelineMode(row["pipeline_mode"]),
        source_channel=row["source_channel"],
        message=TelegramMessage(
            telegram_chat_id=row["telegram_chat_id"], telegram_message_id=row["telegram_message_id"],
            telegram_message_date=message_date, sender_name=row["sender_name"],
            forwarded_from=row["forwarded_from"], message_text=row["message_text"],
            message_type=AttachmentMessageType(row["message_type"]),
            reply_to_message_id=row["reply_to_message_id"], telegram_message_url=row["telegram_message_url"],
            raw_payload_path=row["raw_payload_path"], raw_payload=row["raw_payload_json"],
            ingested_at=ingested_at,
        ),
        attachment=TelegramAttachment(
            telegram_file_id=row["telegram_file_id"], attachment_name=row["attachment_name"],
            attachment_path=row["attachment_path"], attachment_mime_type=row["attachment_mime_type"],
            attachment_hash=row["file_hash"], attachment_size_bytes=row["attachment_size_bytes"],
        ),
    )


def load_pending(
    connection: Connection[Any], limit: int, attachment_id: str | None, include_existing: bool = False,
    parser_version: str = SOURCE_DOCUMENT_SCHEMA_VERSION,
    source_channels: tuple[str, ...] | None = None,
) -> list[dict[str, Any]]:
    allowed_channels = source_channels or digital_source_channels()
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT attachment.id AS attachment_id, attachment.telegram_file_id, attachment.file_hash,
                   attachment.attachment_name, attachment.attachment_path,
                   attachment.attachment_mime_type, attachment.attachment_size_bytes,
                   message.schema_version, message.source_channel, message.telegram_chat_id,
                   message.telegram_message_id, message.telegram_message_date, message.sender_name,
                   message.forwarded_from, message.message_text, message.message_type,
                   message.reply_to_message_id, message.telegram_message_url, message.raw_payload_path,
                   message.raw_payload_json, message.ingested_at,
                   adapter.pipeline_version, adapter.pipeline_mode
            FROM telegram_attachments attachment
            JOIN LATERAL (
              SELECT linked.message_id
              FROM telegram_message_attachments linked
              JOIN telegram_messages linked_message ON linked_message.id = linked.message_id
              WHERE linked.attachment_id = attachment.id
              ORDER BY linked_message.telegram_message_date, linked_message.id
              LIMIT 1
            ) first_link ON true
            JOIN telegram_messages message ON message.id = first_link.message_id
            JOIN processing_runs adapter
              ON adapter.attachment_id = attachment.id AND adapter.run_type = 'telegram_adapter'
            LEFT JOIN source_documents document
              ON document.attachment_id = attachment.id AND document.parser_version = %s
            WHERE (%s::uuid IS NULL OR attachment.id = %s::uuid)
              AND message.source_channel = ANY(%s)
              AND (document.id IS NULL OR %s)
            ORDER BY message.telegram_message_date, attachment.id
            LIMIT %s
            """,
            (
                parser_version,
                attachment_id,
                attachment_id,
                list(allowed_channels),
                include_existing,
                limit,
            ),
        )
        return list(cursor.fetchall())


def persist_document(connection: Connection[Any], attachment_id: str, source: Any) -> str:
    contract = source.model_dump(mode="json")
    document = source.document
    content = source.content
    status = source.status
    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            "SELECT id FROM source_documents WHERE attachment_id=%s AND is_current=true",
            (attachment_id,),
        )
        current_row = cursor.fetchone()
        supersedes_document_id = str(current_row["id"]) if current_row else None
        cursor.execute(
            """
            INSERT INTO source_documents (
              source_id, attachment_id, schema_version, parser_version, publisher,
              publisher_confidence, report_family, report_title, document_type, published_at,
              market_date, market_date_confidence, market_date_reason, date_candidates, language,
              regions, commodities, content_hash, raw_text_path, parsed_text, parse_method,
              parse_confidence, processing_status, source_verified, needs_review, review_reasons,
              error_message, contract_json, supersedes_document_id, revision_status, is_current
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s, %s, %s,
              CASE WHEN %s::text IS NULL THEN 'current' ELSE 'candidate' END,
              CASE WHEN %s::text IS NULL THEN true ELSE false END
            )
            ON CONFLICT (attachment_id, parser_version) DO UPDATE SET
              publisher = EXCLUDED.publisher, publisher_confidence = EXCLUDED.publisher_confidence,
              report_family = EXCLUDED.report_family, report_title = EXCLUDED.report_title,
              market_date = EXCLUDED.market_date, market_date_confidence = EXCLUDED.market_date_confidence,
              market_date_reason = EXCLUDED.market_date_reason, date_candidates = EXCLUDED.date_candidates,
              regions = EXCLUDED.regions, commodities = EXCLUDED.commodities,
              raw_text_path = EXCLUDED.raw_text_path, parsed_text = EXCLUDED.parsed_text,
              parse_method = EXCLUDED.parse_method, parse_confidence = EXCLUDED.parse_confidence,
              processing_status = EXCLUDED.processing_status, source_verified = EXCLUDED.source_verified,
              needs_review = EXCLUDED.needs_review, review_reasons = EXCLUDED.review_reasons,
              error_message = EXCLUDED.error_message, contract_json = EXCLUDED.contract_json,
              updated_at = now()
            RETURNING id
            """,
            (
                source.source_id, attachment_id, source.schema_version, source.parser_version,
                document.publisher, document.publisher_confidence, document.report_family,
                document.report_title, document.document_type, document.published_at,
                document.market_date, document.market_date_confidence, document.market_date_reason,
                Jsonb([candidate.model_dump(mode="json") for candidate in document.date_candidates]),
                document.language, Jsonb(document.regions), Jsonb(document.commodities),
                document.content_hash, content.raw_text_path, content.parsed_text,
                content.parse_method.value, content.parse_confidence, status.processing_status.value,
                status.source_verified, status.needs_review, Jsonb(status.review_reasons),
                status.error_message, Jsonb(contract), supersedes_document_id,
                supersedes_document_id, supersedes_document_id,
            ),
        )
        source_document_id = str(cursor.fetchone()["id"])
        cursor.execute(
            """SELECT count(*) AS fact_count
               FROM document_sections section
               JOIN market_facts fact ON fact.document_section_id=section.id
               WHERE section.source_document_id=%s""",
            (source_document_id,),
        )
        if cursor.fetchone()["fact_count"]:
            raise RuntimeError(
                "Parser revision is immutable after facts exist; use a new --parser-version"
            )
        cursor.execute("DELETE FROM parsed_tables WHERE source_document_id = %s", (source_document_id,))
        cursor.execute("DELETE FROM document_sections WHERE source_document_id = %s", (source_document_id,))
        section_ids: dict[str, str] = {}
        for section in content.sections:
            cursor.execute(
                """
                INSERT INTO document_sections (
                  section_id, source_document_id, section_index, section_title, page_start, page_end,
                  region, commodity, section_type, section_text, classification_confidence
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    section.section_id, source_document_id, section.section_index, section.section_title,
                    section.page_start, section.page_end, section.region, section.commodity,
                    section.section_type, section.text, section.classification_confidence,
                ),
            )
            section_ids[section.section_id] = str(cursor.fetchone()["id"])
        for table in content.tables:
            cursor.execute(
                """
                INSERT INTO parsed_tables (
                  table_id, source_document_id, document_section_id, table_index, title, page_number,
                  columns_json, rows_json, parse_method, parse_confidence
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    table.table_id, source_document_id, section_ids.get(table.section_id or ""),
                    table.table_index, table.title, table.page_number, Jsonb(table.columns),
                    Jsonb(table.rows), table.parse_method, table.parse_confidence,
                ),
            )
        cursor.execute(
            """
            INSERT INTO processing_runs (
              attachment_id, run_type, pipeline_version, pipeline_mode, processing_status,
              completed_at, error_message, metadata
            ) VALUES (%s, 'document_parse', %s, %s, %s, now(), %s, %s)
            ON CONFLICT (attachment_id, run_type, pipeline_version) DO UPDATE SET
              processing_status = EXCLUDED.processing_status, completed_at = now(),
              error_message = EXCLUDED.error_message, metadata = EXCLUDED.metadata, updated_at = now()
            """,
            (
                attachment_id, source.parser_version, os.getenv("MARKET_PIPELINE_MODE", "shadow"),
                status.processing_status.value, status.error_message,
                Jsonb({"source_id": source.source_id, "sections": len(content.sections), "tables": len(content.tables)}),
            ),
        )
    return source_document_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse pending Telegram attachments into SourceDocuments")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--attachment-id")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--reparse", action="store_true", help="Reparse existing source documents")
    parser.add_argument("--parser-version", default=SOURCE_DOCUMENT_SCHEMA_VERSION)
    parser.add_argument(
        "--source-channel",
        action="append",
        dest="source_channels",
        help=(
            "Digital Telegram source channel allowed into SourceDocument parsing; "
            "repeat for multiple channels"
        ),
    )
    parser.add_argument("--parsed-text-dir", default=os.getenv("MARKET_PARSED_TEXT_DIR", ""))
    parser.add_argument(
        "--respect-quiet-hours", action="store_true",
        help="Exit without parsing during 09:00-12:00 and 14:00-18:00 Asia/Singapore",
    )
    args = parser.parse_args()
    if args.respect_quiet_hours and parser_quiet_hours():
        print("processed=0 skipped=parser_quiet_hours timezone=Asia/Singapore", flush=True)
        return
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    parsed_text_dir = Path(args.parsed_text_dir) if args.parsed_text_dir else None
    with Connection.connect(database_url) as connection:
        rows = load_pending(
            connection, args.limit, args.attachment_id, args.reparse,
            parser_version=args.parser_version,
            source_channels=tuple(args.source_channels) if args.source_channels else None,
        )
        for row in rows:
            source = parse_telegram_document(
                _telegram_input(row), attachment_id=str(row["attachment_id"]),
                parsed_text_dir=parsed_text_dir, parser_version=args.parser_version,
            )
            print(
                f"{row['attachment_id']} {source.status.processing_status.value} "
                f"publisher={source.document.publisher} date={source.document.market_date} "
                f"sections={len(source.content.sections)} tables={len(source.content.tables)}",
                flush=True,
            )
            if not args.dry_run:
                persist_document(connection, str(row["attachment_id"]), source)
        print(f"processed={len(rows)} dry_run={args.dry_run}", flush=True)


if __name__ == "__main__":
    main()

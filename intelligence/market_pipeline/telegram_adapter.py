"""Adapters from the legacy ingestion payload to the TelegramInput contract."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .contracts import (
    MARKET_PIPELINE_SCHEMA_VERSION,
    AttachmentMessageType,
    MarketPipelineMode,
    TelegramAttachment,
    TelegramInput,
    TelegramMessage,
)


def _required(payload: dict[str, Any], key: str) -> str:
    value = str(payload.get(key) or "").strip()
    if not value:
        raise ValueError(f"{key} is required")
    return value


def _parse_datetime(value: Any, field_name: str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        raw = str(value or "").strip()
        if not raw:
            raise ValueError(f"{field_name} is required")
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")
    return parsed


def _message_type(payload: dict[str, Any]) -> AttachmentMessageType:
    explicit = str(payload.get("message_type") or "").strip().lower()
    if explicit:
        return AttachmentMessageType(explicit)
    media_type = str(payload.get("attachment_mime_type") or payload.get("media_type") or "")
    if media_type.startswith("image/"):
        return AttachmentMessageType.IMAGE
    return AttachmentMessageType.DOCUMENT


def adapt_legacy_payload(
    payload: dict[str, Any],
    *,
    pipeline_mode: str | MarketPipelineMode = MarketPipelineMode.SHADOW,
    pipeline_version: str = MARKET_PIPELINE_SCHEMA_VERSION,
) -> TelegramInput:
    """Normalize the current collector/API payload without parsing document content."""

    raw_payload = payload.get("raw_payload") or payload.get("raw_payload_json")
    if raw_payload is not None and not isinstance(raw_payload, dict):
        raise ValueError("raw_payload must be an object")

    source_channel = _required(payload, "source_channel")
    message_id = str(
        payload.get("telegram_message_id") or payload.get("source_message_id") or ""
    ).strip()
    if not message_id:
        raise ValueError("telegram_message_id or source_message_id is required")

    message_date = _parse_datetime(
        payload.get("telegram_message_date") or payload.get("message_timestamp"),
        "telegram_message_date",
    )
    ingested_at = _parse_datetime(
        payload.get("ingested_at") or datetime.now(timezone.utc),
        "ingested_at",
    )

    attachment_hash = str(
        payload.get("attachment_hash") or payload.get("file_hash") or ""
    ).strip()

    return TelegramInput(
        pipeline_version=pipeline_version,
        pipeline_mode=MarketPipelineMode(pipeline_mode),
        source_channel=source_channel,
        message=TelegramMessage(
            telegram_chat_id=str(payload.get("telegram_chat_id") or source_channel),
            telegram_message_id=message_id,
            telegram_message_date=message_date,
            sender_name=payload.get("sender_name") or payload.get("sender_label"),
            forwarded_from=payload.get("forwarded_from"),
            message_text=payload.get("message_text") or (raw_payload or {}).get("caption"),
            message_type=_message_type(payload),
            reply_to_message_id=(
                str(payload.get("reply_to_message_id"))
                if payload.get("reply_to_message_id") is not None
                else None
            ),
            telegram_message_url=payload.get("telegram_message_url") or payload.get("source_url"),
            raw_payload_path=payload.get("raw_payload_path"),
            raw_payload=raw_payload,
            ingested_at=ingested_at,
        ),
        attachment=TelegramAttachment(
            telegram_file_id=(
                str(payload.get("telegram_file_id"))
                if payload.get("telegram_file_id") is not None
                else None
            ),
            attachment_name=str(payload.get("attachment_name") or payload.get("file_name") or ""),
            attachment_path=str(payload.get("attachment_path") or payload.get("storage_path") or ""),
            attachment_mime_type=str(
                payload.get("attachment_mime_type") or payload.get("media_type") or ""
            ),
            attachment_hash=attachment_hash,
            attachment_size_bytes=int(
                payload.get("attachment_size_bytes") or payload.get("file_size_bytes") or 0
            ),
        ),
    )


def should_trigger_legacy_dify(
    *,
    content_type: str,
    pipeline_mode: str,
    dify_enabled: bool,
) -> bool:
    del content_type, pipeline_mode, dify_enabled
    return False

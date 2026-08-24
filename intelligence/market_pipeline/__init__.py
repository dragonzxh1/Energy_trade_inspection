"""Structured ETI market pipeline contracts and adapters."""

from .contracts import (
    MARKET_PIPELINE_SCHEMA_VERSION,
    SOURCE_DOCUMENT_SCHEMA_VERSION,
    MARKET_FACT_SCHEMA_VERSION,
    AttachmentMessageType,
    MarketPipelineMode,
    TelegramAttachment,
    TelegramInput,
    TelegramMessage,
    SourceDocument,
    MarketFact,
)
from .document_parser import parse_telegram_document
from .telegram_adapter import adapt_legacy_payload, should_trigger_legacy_dify

__all__ = [
    "MARKET_PIPELINE_SCHEMA_VERSION",
    "SOURCE_DOCUMENT_SCHEMA_VERSION",
    "MARKET_FACT_SCHEMA_VERSION",
    "AttachmentMessageType",
    "MarketPipelineMode",
    "TelegramAttachment",
    "TelegramInput",
    "TelegramMessage",
    "SourceDocument",
    "MarketFact",
    "adapt_legacy_payload",
    "parse_telegram_document",
    "should_trigger_legacy_dify",
]

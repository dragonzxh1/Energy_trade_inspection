import unittest
import json
from types import SimpleNamespace
from datetime import datetime, timezone
from pathlib import Path

from pydantic import ValidationError

from intelligence.market_pipeline import (
    MARKET_PIPELINE_SCHEMA_VERSION,
    adapt_legacy_payload,
    should_trigger_legacy_dify,
)
from intelligence.market_pipeline.contracts import TelegramInput


class TelegramAdapterTests(unittest.TestCase):
    def test_professional_energy_file_filter(self):
        from intelligence.telegram_ingest import is_professional_energy_file

        self.assertTrue(is_professional_energy_file("European Marketscan_10 July.pdf"))
        self.assertTrue(is_professional_energy_file("Oilgram Price Report_10 Jul.pdf"))
        self.assertFalse(is_professional_energy_file("The Washington Post - June 21, 2026.pdf"))
        self.assertFalse(is_professional_energy_file("NYT 2106.pdf"))

    def test_download_directory_uses_original_telegram_date(self):
        from intelligence.telegram_ingest import telegram_message_storage_date

        message = SimpleNamespace(date=datetime(2026, 6, 1, 23, 30, tzinfo=timezone.utc))
        self.assertEqual(telegram_message_storage_date(message), "20260601")

    def test_history_backfill_fields_do_not_replace_live_cursor(self):
        from intelligence.telegram_ingest import CollectorConfig
        from datetime import datetime,timezone
        config=CollectorConfig(history_before=datetime(2026,7,7,tzinfo=timezone.utc),
          history_after=datetime(2026,6,20,tzinfo=timezone.utc))
        self.assertLess(config.history_after,config.history_before)

    def payload(self) -> dict:
        return {
            "source_channel": "telegram:platts-digits",
            "source_message_id": "1234",
            "sender_label": "desk",
            "media_type": "application/pdf",
            "file_name": "marketscan.pdf",
            "file_hash": "a" * 64,
            "file_size_bytes": 1024,
            "message_timestamp": "2026-07-10T01:02:03+00:00",
            "storage_path": "/vault/marketscan.pdf",
            "source_url": "telegram://message/platts/1234",
            "raw_payload_json": {"caption": "daily report"},
        }

    def test_legacy_payload_is_normalized(self) -> None:
        result = adapt_legacy_payload(self.payload())
        self.assertEqual(result.schema_version, MARKET_PIPELINE_SCHEMA_VERSION)
        self.assertEqual(result.pipeline_mode.value, "shadow")
        self.assertEqual(result.message.telegram_message_id, "1234")
        self.assertEqual(result.message.message_type.value, "document")
        self.assertEqual(result.attachment.attachment_hash, "a" * 64)

    def test_image_payload_is_classified(self) -> None:
        payload = self.payload()
        payload.update({"media_type": "image/png", "file_name": "quote.png"})
        result = adapt_legacy_payload(payload, pipeline_mode="legacy")
        self.assertEqual(result.message.message_type.value, "image")
        self.assertEqual(result.pipeline_mode.value, "legacy")

    def test_naive_message_timestamp_is_rejected(self) -> None:
        payload = self.payload()
        payload["message_timestamp"] = "2026-07-10T01:02:03"
        with self.assertRaises(ValueError):
            adapt_legacy_payload(payload)

    def test_invalid_hash_is_rejected(self) -> None:
        payload = self.payload()
        payload["file_hash"] = "bad"
        with self.assertRaises(ValidationError):
            adapt_legacy_payload(payload)

    def test_schema_is_versioned_and_strict(self) -> None:
        schema = TelegramInput.model_json_schema()
        self.assertEqual(schema["properties"]["schema_version"]["default"], MARKET_PIPELINE_SCHEMA_VERSION)
        self.assertFalse(schema["additionalProperties"])

    def test_checked_in_schema_matches_model(self) -> None:
        schema_path = Path(__file__).parent / "schemas" / "telegram_input.schema.json"
        checked_in = json.loads(schema_path.read_text(encoding="utf-8"))
        self.assertEqual(checked_in, TelegramInput.model_json_schema())

    def test_datetime_object_with_timezone_is_accepted(self) -> None:
        payload = self.payload()
        payload["message_timestamp"] = datetime(2026, 7, 10, tzinfo=timezone.utc)
        result = adapt_legacy_payload(payload)
        self.assertEqual(result.message.telegram_message_date.utcoffset().total_seconds(), 0)

    def test_collector_never_calls_dify_for_documents_or_images(self) -> None:
        for content_type in ("documents", "images"):
            for pipeline_mode in ("legacy", "shadow", "review", "active"):
                self.assertFalse(should_trigger_legacy_dify(
                    content_type=content_type,
                    pipeline_mode=pipeline_mode,
                    dify_enabled=True,
                ))


if __name__ == "__main__":
    unittest.main()

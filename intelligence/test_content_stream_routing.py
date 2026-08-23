from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from intelligence.content_streams import (
    digital_source_channels,
    summary_source_channels,
)
from intelligence.market_pipeline.document_worker import load_pending


class RecordingCursor:
    def __init__(self) -> None:
        self.query = ""
        self.parameters = ()

    def __enter__(self) -> "RecordingCursor":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def execute(self, query: str, parameters: tuple[object, ...]) -> None:
        self.query = query
        self.parameters = parameters

    def fetchall(self) -> list[object]:
        return []


class RecordingConnection:
    def __init__(self) -> None:
        self.cursor_instance = RecordingCursor()

    def cursor(self, **_: object) -> RecordingCursor:
        return self.cursor_instance


class ContentStreamRoutingTests(unittest.TestCase):
    def test_default_stream_channels_are_disjoint(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("TELEGRAM_DIGITAL_SOURCE_CHANNELS", None)
            os.environ.pop("TELEGRAM_SUMMARY_SOURCE_CHANNELS", None)
            self.assertEqual(
                digital_source_channels(),
                ("telegram:platts-digits",),
            )
            self.assertEqual(
                summary_source_channels(),
                ("telegram:quotes-summary",),
            )
            self.assertTrue(
                set(digital_source_channels()).isdisjoint(
                    summary_source_channels()
                )
            )

    def test_document_worker_only_selects_explicit_digital_channels(self) -> None:
        connection = RecordingConnection()

        rows = load_pending(
            connection,
            limit=20,
            attachment_id=None,
            source_channels=("telegram:platts-digits",),
        )

        self.assertEqual(rows, [])
        self.assertIn("message.source_channel = ANY(%s)", connection.cursor_instance.query)
        self.assertEqual(
            connection.cursor_instance.parameters[3],
            ["telegram:platts-digits"],
        )
        self.assertNotIn(
            "telegram:quotes-summary",
            connection.cursor_instance.parameters[3],
        )


if __name__ == "__main__":
    unittest.main()

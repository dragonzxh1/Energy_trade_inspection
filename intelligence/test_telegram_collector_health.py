from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from intelligence.telegram_collector_health import inspect_state


class TelegramCollectorHealthTests(unittest.TestCase):
    def test_no_new_message_is_healthy_when_poll_is_fresh(self) -> None:
        now = datetime(2026, 7, 25, 1, 0, tzinfo=timezone.utc)
        with TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps({
                "last_message_id": 174,
                "last_poll_at": (now - timedelta(minutes=2)).isoformat(),
                "consecutive_failures": 0,
            }), encoding="utf-8")
            result = inspect_state("summary", path, now=now)
        self.assertTrue(result.healthy)
        self.assertEqual(result.last_message_id, 174)

    def test_stale_poll_is_unhealthy(self) -> None:
        now = datetime(2026, 7, 25, 1, 0, tzinfo=timezone.utc)
        with TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps({
                "last_message_id": 174,
                "last_poll_at": (now - timedelta(minutes=20)).isoformat(),
            }), encoding="utf-8")
            result = inspect_state("summary", path, now=now)
        self.assertFalse(result.healthy)
        self.assertEqual(result.reason, "poll_stale")

    def test_repeated_processing_failures_are_unhealthy(self) -> None:
        now = datetime(2026, 7, 25, 1, 0, tzinfo=timezone.utc)
        with TemporaryDirectory() as directory:
            path = Path(directory) / "state.json"
            path.write_text(json.dumps({
                "last_poll_at": now.isoformat(),
                "consecutive_failures": 3,
            }), encoding="utf-8")
            result = inspect_state("digital", path, now=now)
        self.assertFalse(result.healthy)
        self.assertEqual(result.reason, "consecutive_failures")


if __name__ == "__main__":
    unittest.main()

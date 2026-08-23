from __future__ import annotations

import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from intelligence.market_pipeline.document_worker import parser_quiet_hours


class DocumentWorkerScheduleTests(unittest.TestCase):
    def test_peak_windows_are_blocked(self) -> None:
        timezone = ZoneInfo("Asia/Singapore")
        for hour, minute in ((9, 0), (11, 59), (14, 0), (17, 59)):
            with self.subTest(hour=hour, minute=minute):
                self.assertTrue(parser_quiet_hours(datetime(2026, 7, 20, hour, minute, tzinfo=timezone)))

    def test_scheduled_slots_are_allowed(self) -> None:
        timezone = ZoneInfo("Asia/Singapore")
        for hour, minute in ((8, 0), (12, 30), (18, 30)):
            with self.subTest(hour=hour, minute=minute):
                self.assertFalse(parser_quiet_hours(datetime(2026, 7, 20, hour, minute, tzinfo=timezone)))

    def test_window_end_is_allowed(self) -> None:
        timezone = ZoneInfo("Asia/Singapore")
        self.assertFalse(parser_quiet_hours(datetime(2026, 7, 20, 12, 0, tzinfo=timezone)))
        self.assertFalse(parser_quiet_hours(datetime(2026, 7, 20, 18, 0, tzinfo=timezone)))


if __name__ == "__main__":
    unittest.main()

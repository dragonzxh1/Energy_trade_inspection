from __future__ import annotations

import os
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from intelligence.telegram_notify import (
    NotificationEvent,
    emit_event,
    flush_pending,
    notification_status,
    recover_task_failure,
    send_telegram_message,
)


class TelegramNotifyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "ETI_REPORTS_ROOT": self.temporary_directory.name,
            "ETI_NOTIFY_TELEGRAM_BOT_TOKEN": "token",
            "ETI_NOTIFY_TELEGRAM_CHAT_ID": "123",
            "ETI_ALLOW_TEST_NOTIFICATIONS": "1",
        }, clear=True)
        self.environment.start()

    def tearDown(self) -> None:
        self.environment.stop()
        self.temporary_directory.cleanup()

    def event(self, severity: str = "success", status_code: str = "DIGIT_DRAFTS_READY", **values):
        return NotificationEvent(
            market_date="2026-07-19", stream="digit", severity=severity,
            status_code=status_code, title="ETI 日报状态", impact="状态已更新。",
            **values,
        )

    def test_unittest_process_never_sends_real_notification(self) -> None:
        with patch.dict(os.environ, {"ETI_ALLOW_TEST_NOTIFICATIONS": "0"}), \
                patch("intelligence.telegram_notify.urllib.request.urlopen") as urlopen:
            self.assertFalse(send_telegram_message("test fixture"))
        urlopen.assert_not_called()

    def test_returns_false_without_configuration(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(send_telegram_message("ready"))

    def test_sends_configured_message(self) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        with patch.dict(os.environ, {
            "ETI_NOTIFY_TELEGRAM_BOT_TOKEN": "token",
            "ETI_NOTIFY_TELEGRAM_CHAT_ID": "123",
            "ETI_ALLOW_TEST_NOTIFICATIONS": "1",
        }, clear=True), patch("intelligence.telegram_notify.urllib.request.urlopen", return_value=response), patch(
            "intelligence.telegram_notify.json.load", return_value={"ok": True},
        ) as json_load:
            self.assertTrue(send_telegram_message("草稿完成"))
        json_load.assert_called_once_with(response)

    def test_duplicate_success_is_sent_once(self) -> None:
        with patch("intelligence.telegram_notify._send_text", return_value=(True, {"ok": True})) as send:
            first = emit_event(self.event())
            second = emit_event(self.event())
        self.assertTrue(first["delivered"])
        self.assertTrue(second["deduplicated"])
        self.assertEqual(send.call_count, 1)

    def test_waiting_duplicate_is_throttled(self) -> None:
        event = self.event("waiting", "SUMMARY_WAITING_APAG")
        with patch("intelligence.telegram_notify._send_text", return_value=(True, {"ok": True})) as send:
            emit_event(event)
            duplicate = emit_event(self.event("waiting", "SUMMARY_WAITING_APAG"))
        self.assertTrue(duplicate["deduplicated"])
        self.assertEqual(send.call_count, 1)

    def test_success_after_warning_is_recovery(self) -> None:
        with patch("intelligence.telegram_notify._send_text", return_value=(True, {"ok": True})) as send:
            emit_event(self.event("warning", "DIGIT_PARTIAL_SUCCESS", action_required=True))
            result = emit_event(self.event())
        self.assertTrue(result["recovered"])
        self.assertIn("异常已自动恢复", send.call_args.args[0])
        self.assertEqual(notification_status()["active_alerts"], [])

    def test_historical_and_dry_run_are_logged_without_state_pollution(self) -> None:
        with patch("intelligence.telegram_notify._send_text") as send:
            historical = emit_event(self.event("critical", "DIGIT_ALL_REJECTED", historical=True))
            dry_run = emit_event(self.event("warning", "DIGIT_PARTIAL_SUCCESS", dry_run=True))
        self.assertTrue(historical["suppressed"])
        self.assertTrue(dry_run["suppressed"])
        send.assert_not_called()
        self.assertEqual(notification_status()["active_alerts"], [])
        event_file = Path(self.temporary_directory.name) / "notifications" / "events" / "2026-07-19.jsonl"
        self.assertEqual(len(event_file.read_text(encoding="utf-8").splitlines()), 2)

    def test_historical_success_notifies_recovery_for_active_alert(self) -> None:
        with patch("intelligence.telegram_notify._send_text", return_value=(True, {"ok": True})) as send:
            emit_event(self.event("critical", "DIGIT_ALL_REJECTED", action_required=True))
            recovered = emit_event(self.event(historical=True))
        self.assertTrue(recovered["delivered"])
        self.assertTrue(recovered["recovered"])
        self.assertFalse(recovered["suppressed"])
        self.assertEqual(send.call_count, 2)
        self.assertEqual(notification_status()["active_alerts"], [])

    def test_failed_delivery_is_queued_and_flushes(self) -> None:
        with patch("intelligence.telegram_notify._send_text", return_value=(False, {"error": "offline"})):
            emit_event(self.event("warning", "DIGIT_PARTIAL_SUCCESS"))
            duplicate = emit_event(self.event("warning", "DIGIT_PARTIAL_SUCCESS"))
        self.assertTrue(duplicate["deduplicated"])
        self.assertEqual(notification_status()["pending_count"], 1)
        with patch("intelligence.telegram_notify._send_text", return_value=(True, {"ok": True})):
            result = flush_pending()
        self.assertEqual(result, {"delivered": 1, "failed": 0})
        self.assertEqual(notification_status()["pending_count"], 0)

    def test_fixture_identifier_is_suppressed(self) -> None:
        with patch("intelligence.telegram_notify._send_text") as send:
            result = emit_event(self.event(draft_ids=["draft-id"]))
        self.assertTrue(result["suppressed"])
        send.assert_not_called()

    def test_stale_alert_is_automatically_closed(self) -> None:
        with patch("intelligence.telegram_notify._send_text", return_value=(True, {"ok": True})):
            emit_event(self.event("critical", "DIGIT_ALL_REJECTED", action_required=True))
        state_path = Path(self.temporary_directory.name) / "notifications" / "state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        record = next(iter(state["events"].values()))
        record["last_seen_at"] = "2026-07-01T00:00:00+00:00"
        state_path.write_text(json.dumps(state), encoding="utf-8")

        self.assertEqual(notification_status()["active_alerts"], [])
        updated = json.loads(state_path.read_text(encoding="utf-8"))
        updated_record = next(iter(updated["events"].values()))
        self.assertEqual(updated_record["resolution_reason"], "stale_alert_ttl")
        self.assertFalse(updated_record["pending"])

    def test_recent_alert_remains_active(self) -> None:
        with patch("intelligence.telegram_notify._send_text", return_value=(True, {"ok": True})):
            emit_event(self.event("warning", "DIGIT_PARTIAL_SUCCESS", action_required=True))
        self.assertEqual(len(notification_status()["active_alerts"]), 1)

    def test_task_recovery_closes_same_task_alerts_across_dates(self) -> None:
        failures = [
            NotificationEvent(
                market_date=market_date, stream="system", severity="critical",
                status_code="CRON_TASK_FAILED", title="ETI 定时任务失败",
                impact="任务 digit-publish 异常退出。", action_required=True,
                source_run_id="digit-publish",
            )
            for market_date in ("2026-07-18", "2026-07-19")
        ]
        with patch("intelligence.telegram_notify._send_text", return_value=(True, {"ok": True})) as send:
            for failure in failures:
                emit_event(failure)
            recovered = recover_task_failure("digit-publish")
        self.assertTrue(recovered["recovered"])
        self.assertEqual(notification_status()["active_alerts"], [])
        self.assertEqual(send.call_count, 3)


if __name__ == "__main__":
    unittest.main()

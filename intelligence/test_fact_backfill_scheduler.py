from __future__ import annotations

import inspect
import unittest
from datetime import date
from unittest.mock import MagicMock

from intelligence.market_pipeline.fact_backfill_scheduler import (
    _failure_reason_text,
    attempted_document_count,
    backlog_counts,
    eligible_dates,
    failure_reason_breakdown,
    pending_validation_dates,
)
from intelligence.market_pipeline.section_triage_audit import audit_rows


class FactBackfillSchedulerTests(unittest.TestCase):
    def test_eligible_dates_only_selects_dify_backlog(self) -> None:
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [(date(2026, 7, 6), 20)]
        self.assertEqual(eligible_dates(connection, date(2026, 7, 1), date(2026, 7, 18)), [(date(2026, 7, 6), 20)])
        query = cursor.execute.call_args.args[0]
        self.assertIn("section.dify_eligible=true", query)
        self.assertIn("ORDER BY document.market_date", query)

    def test_backlog_status_separates_low_value_from_llm_queue(self) -> None:
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (1, 2, 3, 4, 5, 6, 7, 8)
        status = backlog_counts(connection, date(2026, 7, 1), date(2026, 7, 18))
        self.assertEqual(status["eligible_pending_sections"], 2)
        self.assertEqual(status["skipped_low_value_sections"], 6)

    def test_failure_breakdown_distinguishes_local_validation_from_dify(self) -> None:
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [("STRICT_FACT_VALIDATION_FAILED", 3)]
        self.assertEqual(
            failure_reason_breakdown(connection, ["RUN-1"]),
            {"STRICT_FACT_VALIDATION_FAILED": 3},
        )
        query = cursor.execute.call_args.args[0]
        self.assertIn("strict validation", query)
        self.assertEqual(
            _failure_reason_text("STRICT_FACT_VALIDATION_FAILED"),
            "数字或单位未在证据原句中逐字出现",
        )

    def test_empty_run_ids_have_no_failure_query(self) -> None:
        connection = MagicMock()
        self.assertEqual(failure_reason_breakdown(connection, []), {})
        connection.cursor.assert_not_called()

    def test_attempted_documents_are_distinct_across_fair_passes(self) -> None:
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (2,)
        self.assertEqual(
            attempted_document_count(connection, ["RUN-P01", "RUN-P02"]),
            2,
        )
        self.assertIn("count(DISTINCT source_document_id)", cursor.execute.call_args.args[0])

    def test_recent_pending_fact_dates_are_validated_even_without_section_backlog(self) -> None:
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [(date(2026, 8, 3), 208)]
        result = pending_validation_dates(
            connection, date(2026, 7, 25), date(2026, 8, 10),
        )
        self.assertEqual(result, [(date(2026, 8, 3), 208)])
        query = cursor.execute.call_args.args[0]
        self.assertIn("verification_status='pending'", query)
        self.assertIn("GROUP BY market_date", query)

    def test_scheduler_never_invokes_article_or_wechat_modules(self) -> None:
        from intelligence.market_pipeline import fact_backfill_scheduler

        source = inspect.getsource(fact_backfill_scheduler)
        self.assertIn("intelligence.market_pipeline.fact_worker", source)
        self.assertIn("intelligence.market_pipeline.validation_worker", source)
        self.assertIn("while remaining_budget > 0 and eligible_remaining > 0", source)
        self.assertIn('"--run-id", child_run_id', source)
        self.assertNotIn("publication_worker", source)
        self.assertNotIn("wechat_publish", source)
        self.assertIn("--triage-only", source)

    def test_read_only_audit_separates_eligible_and_skipped_samples(self) -> None:
        payload = audit_rows([
            {"section_id": "A", "section_title": "Diesel assessment", "section_text": "ULSD was assessed at $92.45/mt. " * 3, "section_type": "market_commentary"},
            {"section_id": "B", "section_title": "Comment", "section_text": "Oil traders discussed the market.", "section_type": "market_commentary"},
        ], 50)
        self.assertEqual(payload["eligible"], 1)
        self.assertEqual(payload["skipped"], 1)


if __name__ == "__main__":
    unittest.main()

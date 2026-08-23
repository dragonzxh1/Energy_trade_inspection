from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ReleaseValidationSqlTests(unittest.TestCase):
    def read_sql(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def test_high_risk_queue_check_only_covers_blocked_review_facts(self) -> None:
        sql = self.read_sql("db/validation/049_fact_validation.sql")
        self.assertIn("verification_status = 'needs_review'", sql)
        self.assertIn("publication_blocked = true", sql)

    def test_draft_quality_is_not_treated_as_public_release(self) -> None:
        sql = self.read_sql("db/validation/052_observability_feedback_rollout.sql")
        self.assertIn("publication_status = 'published'", sql)
        self.assertNotIn("IN ('draft_created','published')", sql)

    def test_current_article_modes_are_accepted(self) -> None:
        sql = self.read_sql("db/validation/059_editorial_publishability.sql")
        for article_mode in ("faithful_translation", "event_brief", "market_analysis"):
            self.assertIn(article_mode, sql)

    def test_completed_sections_are_checked_by_event_order(self) -> None:
        sql = self.read_sql("db/validation/060_section_triage_v2.sql")
        self.assertIn("triaged_at > fact_extraction_completed_at", sql)

    def test_triage_reconciliation_is_narrowly_scoped(self) -> None:
        sql = self.read_sql("db/maintenance/060_reconcile_section_triage_v2.sql")
        self.assertIn("triage_version = 'section-triage.v2'", sql)
        self.assertIn("dify_eligible = false", sql)
        self.assertIn("fact_extraction_status IN ('pending', 'failed_retryable')", sql)


if __name__ == "__main__":
    unittest.main()

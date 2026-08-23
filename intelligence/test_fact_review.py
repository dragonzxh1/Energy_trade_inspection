from __future__ import annotations

import unittest
from datetime import date

from intelligence.market_pipeline.fact_review import approval_error
from pathlib import Path


def item(**overrides):
    value={"blocking_reasons":[{"rule_id":"risk.manual_review"}],"market_date":date(2026,7,11),
      "commodity":"crude_oil","publisher":"Platts","verification_status":"needs_review",
      "publication_blocked":True}
    value.update(overrides); return value


class FactReviewTest(unittest.TestCase):
    def test_validation_preserves_valid_manual_review_and_audit_row(self):
        source=Path("intelligence/market_pipeline/validation_repository.py").read_text(encoding="utf-8")
        self.assertIn("approval_error(target,dict(corroborating_row)) is None",source)
        self.assertIn("queue_status='pending'",source)
        self.assertIn('manual_rejected=manual_review.get("action")=="reject"',source)

    def test_high_risk_approval_requires_independent_verified_publisher(self):
        self.assertIn("required",approval_error(item(),None))
        self.assertIn("different publisher",approval_error(item(),item(
          publisher="Platts",verification_status="verified",publication_blocked=False)))
        self.assertIsNone(approval_error(item(),item(
          publisher="Argus",verification_status="verified",publication_blocked=False)))

    def test_other_validation_failures_cannot_be_manually_overridden(self):
        target=item(blocking_reasons=[{"rule_id":"unit.supported"}])
        self.assertIn("solely",approval_error(target,item(
          publisher="Argus",verification_status="verified",publication_blocked=False)))


if __name__=="__main__": unittest.main()

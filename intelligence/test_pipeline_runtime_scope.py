from __future__ import annotations

import os
import unittest
from datetime import date
from unittest.mock import patch

from intelligence.market_pipeline.runtime_scope import (
    before_pipeline_start,
    clamp_to_pipeline_start,
    pipeline_start_date,
)


class PipelineRuntimeScopeTests(unittest.TestCase):
    def test_configured_start_date_clamps_historical_ranges(self) -> None:
        with patch.dict(
            os.environ,
            {"MARKET_PIPELINE_START_DATE": "2026-07-25"},
        ):
            self.assertEqual(pipeline_start_date(), date(2026, 7, 25))
            self.assertTrue(before_pipeline_start(date(2026, 7, 24)))
            self.assertFalse(before_pipeline_start(date(2026, 7, 25)))
            self.assertEqual(
                clamp_to_pipeline_start(date(2026, 7, 1)),
                date(2026, 7, 25),
            )

    def test_missing_start_date_preserves_requested_scope(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("MARKET_PIPELINE_START_DATE", None)
            self.assertIsNone(pipeline_start_date())
            self.assertEqual(
                clamp_to_pipeline_start(date(2026, 7, 1)),
                date(2026, 7, 1),
            )


if __name__ == "__main__":
    unittest.main()

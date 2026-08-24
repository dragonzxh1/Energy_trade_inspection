from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import unittest


ROOT = Path(__file__).parents[1]
SCRIPT = ROOT / "scripts" / "reconcile-production-migrations.mjs"
NODE = shutil.which("node")


class MigrationReconciliationTests(unittest.TestCase):
    def test_known_production_drift_requires_schema_signatures(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        for filename in (
            "045_intelligence_content.sql",
            "055_historical_rollout_isolation.sql",
            "056_pipeline_readiness_states.sql",
            "057_fact_extraction_update_counts.sql",
            "063_summary_image_draft_closure.sql",
        ):
            self.assertIn(filename, source)
        self.assertIn("validateSpec", source)
        self.assertNotIn("eti_password", source)

    @unittest.skipUnless(NODE, "Node.js is required for reconciliation CLI tests")
    def test_help_does_not_connect_to_database(self) -> None:
        environment = os.environ.copy()
        environment.pop("DATABASE_URL", None)
        result = subprocess.run(
            [NODE, str(SCRIPT), "--help"],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--dry-run", result.stdout)
        self.assertIn("--apply", result.stdout)

    @unittest.skipUnless(NODE, "Node.js is required for reconciliation CLI tests")
    def test_missing_database_url_fails_closed(self) -> None:
        environment = os.environ.copy()
        environment.pop("DATABASE_URL", None)
        result = subprocess.run(
            [NODE, str(SCRIPT), "--dry-run"],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("DATABASE_URL is required", result.stderr)


if __name__ == "__main__":
    unittest.main()

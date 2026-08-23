DROP INDEX IF EXISTS idx_pipeline_daily_runs_readiness;
ALTER TABLE pipeline_daily_runs
  DROP COLUMN IF EXISTS publish_execution_allowed,
  DROP COLUMN IF EXISTS quality_gate_passed,
  DROP COLUMN IF EXISTS content_ready;

ALTER TABLE pipeline_daily_runs
  ADD COLUMN content_ready BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN quality_gate_passed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN publish_execution_allowed BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_pipeline_daily_runs_readiness
ON pipeline_daily_runs (market_date DESC, content_ready, quality_gate_passed, publish_execution_allowed);

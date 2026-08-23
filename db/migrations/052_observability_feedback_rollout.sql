CREATE TABLE pipeline_daily_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_date DATE NOT NULL,
  pipeline_version TEXT NOT NULL,
  pipeline_mode TEXT NOT NULL CHECK (pipeline_mode IN ('legacy', 'shadow', 'review', 'active')),
  run_status TEXT NOT NULL CHECK (run_status IN ('running', 'completed', 'failed', 'needs_review', 'no_signal')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  document_count INTEGER NOT NULL DEFAULT 0,
  fact_count INTEGER NOT NULL DEFAULT 0,
  verified_fact_count INTEGER NOT NULL DEFAULT 0,
  rejected_fact_count INTEGER NOT NULL DEFAULT 0,
  needs_review_count INTEGER NOT NULL DEFAULT 0,
  signal_count INTEGER NOT NULL DEFAULT 0,
  publishable BOOLEAN NOT NULL DEFAULT false,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_date, pipeline_version)
);

CREATE TABLE pipeline_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_daily_run_id UUID REFERENCES pipeline_daily_runs(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'high', 'critical')),
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  alert_status TEXT NOT NULL DEFAULT 'open' CHECK (alert_status IN ('open', 'acknowledged', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE editorial_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  published_article_id UUID NOT NULL REFERENCES published_articles(id) ON DELETE CASCADE,
  original_markdown TEXT NOT NULL,
  edited_markdown TEXT NOT NULL,
  unified_diff TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  issue_types JSONB NOT NULL,
  added_lines INTEGER NOT NULL CHECK (added_lines >= 0),
  deleted_lines INTEGER NOT NULL CHECK (deleted_lines >= 0),
  editor_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE article_quality_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  published_article_id UUID NOT NULL REFERENCES published_articles(id) ON DELETE CASCADE,
  metric_version TEXT NOT NULL,
  numeric_traceability_rate DOUBLE PRECISION NOT NULL CHECK (numeric_traceability_rate BETWEEN 0 AND 1),
  unique_main_thesis BOOLEAN NOT NULL,
  has_counter_signal BOOLEAN NOT NULL,
  has_invalidation_conditions BOOLEAN NOT NULL,
  validation_metric_count INTEGER NOT NULL CHECK (validation_metric_count >= 0),
  unsupported_number_count INTEGER NOT NULL CHECK (unsupported_number_count >= 0),
  manual_deletion_ratio DOUBLE PRECISION CHECK (manual_deletion_ratio IS NULL OR manual_deletion_ratio BETWEEN 0 AND 1),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (published_article_id, metric_version)
);

CREATE TABLE pipeline_rollout_state (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  current_mode TEXT NOT NULL CHECK (current_mode IN ('legacy', 'shadow', 'review', 'active')),
  shadow_document_count INTEGER NOT NULL DEFAULT 0,
  shadow_publishable_days INTEGER NOT NULL DEFAULT 0,
  review_approved_days INTEGER NOT NULL DEFAULT 0,
  consecutive_publish_passes INTEGER NOT NULL DEFAULT 0,
  eligible_next_mode TEXT,
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO pipeline_rollout_state (id, current_mode) VALUES (true, 'shadow') ON CONFLICT DO NOTHING;

CREATE INDEX idx_pipeline_daily_runs_status ON pipeline_daily_runs(market_date DESC, run_status);
CREATE INDEX idx_pipeline_alerts_open ON pipeline_alerts(alert_status, severity, created_at);
CREATE INDEX idx_editorial_feedback_article ON editorial_feedback(published_article_id, created_at);

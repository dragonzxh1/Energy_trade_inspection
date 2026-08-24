ALTER TABLE market_facts
  DROP CONSTRAINT market_facts_risk_level_check;
ALTER TABLE market_facts
  ADD CONSTRAINT market_facts_risk_level_check
  CHECK (risk_level IN ('normal', 'elevated', 'high', 'critical'));

ALTER TABLE market_facts
  ADD COLUMN validation_version TEXT,
  ADD COLUMN validated_at TIMESTAMPTZ,
  ADD COLUMN publication_blocked BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE fact_validation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_fact_id UUID NOT NULL REFERENCES market_facts(id) ON DELETE CASCADE,
  validation_version TEXT NOT NULL,
  issue_hash TEXT NOT NULL UNIQUE CHECK (issue_hash ~ '^[A-Fa-f0-9]{64}$'),
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'blocking')),
  message TEXT NOT NULL,
  field_name TEXT,
  expected_value TEXT,
  actual_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE fact_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conflict_key TEXT NOT NULL UNIQUE CHECK (conflict_key ~ '^[A-Fa-f0-9]{64}$'),
  conflict_type TEXT NOT NULL CHECK (conflict_type IN (
    'value_conflict', 'direction_conflict', 'date_conflict', 'unit_conflict',
    'source_attribution_conflict', 'event_severity_conflict',
    'supply_demand_interpretation_conflict'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('normal', 'elevated', 'high', 'critical')),
  left_market_fact_id UUID NOT NULL REFERENCES market_facts(id) ON DELETE RESTRICT,
  right_market_fact_id UUID NOT NULL REFERENCES market_facts(id) ON DELETE RESTRICT,
  conflict_status TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (conflict_status IN ('unresolved', 'resolved', 'accepted_difference')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution_notes TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CHECK (left_market_fact_id <> right_market_fact_id)
);

CREATE TABLE fact_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_fact_id UUID NOT NULL UNIQUE REFERENCES market_facts(id) ON DELETE CASCADE,
  queue_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (queue_status IN ('pending', 'approved', 'rejected', 'resolved')),
  priority TEXT NOT NULL CHECK (priority IN ('normal', 'elevated', 'high', 'critical')),
  blocking_reasons JSONB NOT NULL,
  assigned_to TEXT,
  reviewer_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE processing_step_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_step_id UUID NOT NULL REFERENCES processing_steps(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  processing_status TEXT NOT NULL CHECK (processing_status IN ('completed', 'failed')),
  workflow_run_id TEXT,
  input_json JSONB,
  output_json JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE (processing_step_id, attempt_number)
);

CREATE INDEX idx_fact_validations_fact ON fact_validation_results(market_fact_id, validation_version);
CREATE INDEX idx_fact_conflicts_status ON fact_conflicts(conflict_status, severity, detected_at);
CREATE INDEX idx_fact_review_queue_status ON fact_review_queue(queue_status, priority, created_at);
CREATE INDEX idx_market_facts_publishable ON market_facts(market_date DESC, verification_status)
  WHERE is_current = true AND publication_blocked = false;

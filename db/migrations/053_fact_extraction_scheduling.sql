ALTER TABLE document_sections
  ADD COLUMN fact_extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (fact_extraction_status IN (
      'pending', 'leased', 'processing', 'completed', 'failed_retryable',
      'failed_terminal', 'skipped', 'needs_review'
    )),
  ADD COLUMN fact_extraction_attempts INTEGER NOT NULL DEFAULT 0 CHECK (fact_extraction_attempts >= 0),
  ADD COLUMN fact_extraction_last_error TEXT,
  ADD COLUMN fact_extraction_reason_code TEXT,
  ADD COLUMN fact_extraction_started_at TIMESTAMPTZ,
  ADD COLUMN fact_extraction_completed_at TIMESTAMPTZ,
  ADD COLUMN lease_owner TEXT,
  ADD COLUMN lease_expires_at TIMESTAMPTZ,
  ADD COLUMN last_run_id TEXT,
  ADD COLUMN section_priority INTEGER NOT NULL DEFAULT 50 CHECK (section_priority BETWEEN 0 AND 100);

UPDATE document_sections section
SET section_priority = CASE section.section_type
  WHEN 'price_assessment' THEN 100 WHEN 'price_table' THEN 100
  WHEN 'market_summary' THEN 90 WHEN 'supply_demand_commentary' THEN 80
  WHEN 'refinery_outage' THEN 80 WHEN 'trade_flow' THEN 75
  WHEN 'tender' THEN 70 WHEN 'freight' THEN 65
  WHEN 'general_news' THEN 40 WHEN 'methodology' THEN 10
  WHEN 'disclaimer' THEN 0 WHEN 'table_of_contents' THEN 0
  WHEN 'advertisement' THEN 0 WHEN 'header_footer' THEN 0
  ELSE 50 END;

WITH latest_steps AS (
  SELECT DISTINCT ON (step.step_key) step.*
  FROM processing_steps step
  WHERE step.step_type = 'source_fact'
  ORDER BY step.step_key, step.updated_at DESC
)
UPDATE document_sections section
SET fact_extraction_status = CASE
      WHEN step.processing_status = 'completed' THEN 'completed'
      WHEN step.processing_status = 'failed' AND step.attempt_count >= 3 THEN 'failed_terminal'
      WHEN step.processing_status = 'failed' THEN 'failed_retryable'
      WHEN length(trim(section.section_text)) < 80 THEN 'skipped'
      WHEN section.section_type IN ('disclaimer','table_of_contents','advertisement','header_footer') THEN 'skipped'
      ELSE 'pending' END,
    fact_extraction_attempts = COALESCE(step.attempt_count, 0),
    fact_extraction_last_error = step.error_message,
    fact_extraction_reason_code = CASE
      WHEN step.processing_status = 'completed' AND EXISTS (
        SELECT 1 FROM market_facts fact WHERE fact.document_section_id = section.id AND fact.is_current
      ) THEN 'COMPLETED_WITH_FACTS'
      WHEN step.processing_status = 'completed' THEN 'NO_FACTS_FOUND'
      WHEN step.processing_status = 'failed' AND step.attempt_count >= 3 THEN 'FAILED_MAX_RETRIES'
      WHEN step.processing_status = 'failed' THEN 'DIFY_SCHEMA_INVALID'
      WHEN length(trim(section.section_text)) < 80 THEN 'SKIPPED_TOO_SHORT'
      WHEN section.section_type IN ('disclaimer','table_of_contents','advertisement','header_footer') THEN 'SKIPPED_SECTION_TYPE'
      ELSE NULL END,
    fact_extraction_started_at = step.started_at,
    fact_extraction_completed_at = step.completed_at
FROM latest_steps step
WHERE step.step_key = section.section_id;

UPDATE document_sections section
SET fact_extraction_status = CASE
      WHEN length(trim(section.section_text)) < 80 THEN 'skipped'
      WHEN section.section_type IN ('disclaimer','table_of_contents','advertisement','header_footer') THEN 'skipped'
      ELSE 'pending' END,
    fact_extraction_reason_code = CASE
      WHEN length(trim(section.section_text)) < 80 THEN 'SKIPPED_TOO_SHORT'
      WHEN section.section_type IN ('disclaimer','table_of_contents','advertisement','header_footer') THEN 'SKIPPED_SECTION_TYPE'
      ELSE NULL END
WHERE NOT EXISTS (
  SELECT 1 FROM processing_steps step
  WHERE step.step_type = 'source_fact' AND step.step_key = section.section_id
);

CREATE TABLE fact_extraction_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL UNIQUE,
  market_date_from DATE NOT NULL,
  market_date_to DATE NOT NULL,
  pipeline_mode TEXT NOT NULL CHECK (pipeline_mode IN ('legacy','shadow','review','active')),
  run_mode TEXT NOT NULL CHECK (run_mode IN ('daily','backfill','manual')),
  lease_owner TEXT NOT NULL,
  max_sections INTEGER NOT NULL CHECK (max_sections > 0),
  max_sections_per_document INTEGER NOT NULL CHECK (max_sections_per_document > 0),
  eligible_sections INTEGER NOT NULL DEFAULT 0,
  attempted_sections INTEGER NOT NULL DEFAULT 0,
  completed_sections INTEGER NOT NULL DEFAULT 0,
  failed_retryable_sections INTEGER NOT NULL DEFAULT 0,
  failed_terminal_sections INTEGER NOT NULL DEFAULT 0,
  skipped_sections INTEGER NOT NULL DEFAULT 0,
  pending_sections INTEGER NOT NULL DEFAULT 0,
  documents_with_eligible_sections INTEGER NOT NULL DEFAULT 0,
  documents_attempted INTEGER NOT NULL DEFAULT 0,
  documents_completed INTEGER NOT NULL DEFAULT 0,
  facts_created INTEGER NOT NULL DEFAULT 0,
  price_facts_created INTEGER NOT NULL DEFAULT 0,
  reason_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  run_status TEXT NOT NULL DEFAULT 'running'
    CHECK (run_status IN ('running','completed','completed_with_backlog','failed')),
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (market_date_to >= market_date_from)
);

CREATE TABLE fact_extraction_attempt_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL REFERENCES fact_extraction_runs(run_id) ON DELETE CASCADE,
  document_section_id UUID NOT NULL REFERENCES document_sections(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  reason_code TEXT NOT NULL,
  workflow_run_id TEXT,
  prompt_version TEXT NOT NULL,
  model_name TEXT,
  raw_response JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  UNIQUE (run_id, document_section_id, attempt_number)
);

CREATE INDEX idx_sections_fact_target ON document_sections (
  fact_extraction_status, section_priority DESC, source_document_id, section_index
);
CREATE INDEX idx_sections_fact_lease ON document_sections (lease_expires_at)
  WHERE fact_extraction_status IN ('leased','processing');
CREATE INDEX idx_fact_extraction_runs_date ON fact_extraction_runs (market_date_from DESC, market_date_to DESC);
CREATE INDEX idx_fact_attempt_logs_section ON fact_extraction_attempt_logs (document_section_id, completed_at DESC);

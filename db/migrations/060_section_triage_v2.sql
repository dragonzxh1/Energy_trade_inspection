ALTER TABLE document_sections
  ADD COLUMN IF NOT EXISTS triage_version TEXT,
  ADD COLUMN IF NOT EXISTS triage_category TEXT,
  ADD COLUMN IF NOT EXISTS triage_score INTEGER CHECK (triage_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS triage_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dify_eligible BOOLEAN,
  ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_document_sections_dify_backlog
  ON document_sections (dify_eligible, fact_extraction_status, section_priority DESC, source_document_id)
  WHERE dify_eligible = true
    AND fact_extraction_status IN ('pending', 'failed_retryable');

UPDATE document_sections
SET dify_eligible = true
WHERE fact_extraction_status IN ('failed_retryable', 'failed_terminal');

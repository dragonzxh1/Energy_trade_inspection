DROP INDEX IF EXISTS idx_document_sections_dify_backlog;

ALTER TABLE document_sections
  DROP COLUMN IF EXISTS triaged_at,
  DROP COLUMN IF EXISTS dify_eligible,
  DROP COLUMN IF EXISTS triage_reasons,
  DROP COLUMN IF EXISTS triage_score,
  DROP COLUMN IF EXISTS triage_category,
  DROP COLUMN IF EXISTS triage_version;

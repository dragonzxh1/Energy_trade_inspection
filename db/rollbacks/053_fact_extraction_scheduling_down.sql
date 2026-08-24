DROP TABLE IF EXISTS fact_extraction_attempt_logs;
DROP TABLE IF EXISTS fact_extraction_runs;
DROP INDEX IF EXISTS idx_sections_fact_lease;
DROP INDEX IF EXISTS idx_sections_fact_target;
ALTER TABLE document_sections
  DROP COLUMN IF EXISTS fact_extraction_status,
  DROP COLUMN IF EXISTS fact_extraction_attempts,
  DROP COLUMN IF EXISTS fact_extraction_last_error,
  DROP COLUMN IF EXISTS fact_extraction_reason_code,
  DROP COLUMN IF EXISTS fact_extraction_started_at,
  DROP COLUMN IF EXISTS fact_extraction_completed_at,
  DROP COLUMN IF EXISTS lease_owner,
  DROP COLUMN IF EXISTS lease_expires_at,
  DROP COLUMN IF EXISTS last_run_id,
  DROP COLUMN IF EXISTS section_priority;

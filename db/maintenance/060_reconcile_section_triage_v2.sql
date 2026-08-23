BEGIN;

UPDATE document_sections
SET fact_extraction_status = 'skipped',
    fact_extraction_reason_code = COALESCE(
      fact_extraction_reason_code,
      'SKIPPED_LOW_EDITORIAL_VALUE'
    ),
    lease_owner = NULL,
    lease_expires_at = NULL,
    updated_at = NOW()
WHERE triage_version = 'section-triage.v2'
  AND dify_eligible = false
  AND fact_extraction_status IN ('pending', 'failed_retryable');

COMMIT;

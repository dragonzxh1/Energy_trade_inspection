SELECT count(*) AS completed_sections_triaged_after_extraction
FROM document_sections
WHERE fact_extraction_status = 'completed'
  AND triage_version = 'section-triage.v2'
  AND fact_extraction_completed_at IS NOT NULL
  AND triaged_at IS NOT NULL
  AND triaged_at > fact_extraction_completed_at;

SELECT count(*) AS low_value_still_pending
FROM document_sections
WHERE dify_eligible = false
  AND fact_extraction_status IN ('pending', 'failed_retryable');

SELECT count(*) AS eligible_marked_skipped
FROM document_sections
WHERE dify_eligible = true
  AND fact_extraction_status = 'skipped'
  AND fact_extraction_reason_code IN (
    'SKIPPED_LOW_EDITORIAL_VALUE', 'SKIPPED_NO_CONCRETE_EVIDENCE', 'SKIPPED_BOILERPLATE'
  );

SELECT count(*) AS invalid_documents_dify_eligible
FROM document_sections section
JOIN source_documents document ON document.id=section.source_document_id
WHERE section.dify_eligible=true
  AND (NOT document.source_verified OR document.processing_status<>'parsed' OR document.needs_review);

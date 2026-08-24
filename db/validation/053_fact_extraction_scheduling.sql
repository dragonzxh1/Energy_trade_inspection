SELECT 'invalid_section_state', count(*) FROM document_sections
WHERE fact_extraction_status NOT IN ('pending','leased','processing','completed','failed_retryable','failed_terminal','skipped','needs_review');
SELECT 'expired_active_leases', count(*) FROM document_sections
WHERE fact_extraction_status IN ('leased','processing') AND lease_expires_at < now();
SELECT 'completed_with_active_lease', count(*) FROM document_sections
WHERE fact_extraction_status = 'completed' AND (lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL);
SELECT 'duplicate_run_ids', count(*) FROM (SELECT run_id FROM fact_extraction_runs GROUP BY run_id HAVING count(*) > 1) duplicate;
SELECT 'duplicate_attempts', count(*) FROM (
  SELECT run_id,document_section_id,attempt_number FROM fact_extraction_attempt_logs
  GROUP BY run_id,document_section_id,attempt_number HAVING count(*) > 1
) duplicate;

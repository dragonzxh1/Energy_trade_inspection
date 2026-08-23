SELECT 'duplicate_validation_issues' AS check_name, count(*) AS failures
FROM (SELECT issue_hash FROM fact_validation_results GROUP BY issue_hash HAVING count(*) > 1) duplicate
UNION ALL
SELECT 'orphan_validation_results', count(*)
FROM fact_validation_results result
LEFT JOIN market_facts fact ON fact.id = result.market_fact_id
WHERE fact.id IS NULL
UNION ALL
SELECT 'invalid_conflict_pairs', count(*)
FROM fact_conflicts conflict
LEFT JOIN market_facts left_fact ON left_fact.id = conflict.left_market_fact_id
LEFT JOIN market_facts right_fact ON right_fact.id = conflict.right_market_fact_id
WHERE left_fact.id IS NULL OR right_fact.id IS NULL OR left_fact.id = right_fact.id
UNION ALL
SELECT 'publishable_unverified_facts', count(*)
FROM market_facts
WHERE is_current = true AND publication_blocked = false AND verification_status <> 'verified'
UNION ALL
SELECT 'high_risk_not_queued', count(*)
FROM market_facts fact
LEFT JOIN fact_review_queue queue ON queue.market_fact_id = fact.id
WHERE fact.is_current = true AND fact.risk_level IN ('high', 'critical') AND queue.id IS NULL
UNION ALL
SELECT 'duplicate_attempt_numbers', count(*)
FROM (
  SELECT processing_step_id, attempt_number
  FROM processing_step_attempts
  GROUP BY processing_step_id, attempt_number HAVING count(*) > 1
) duplicate;

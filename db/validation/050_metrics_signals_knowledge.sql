SELECT 'duplicate_metric_ids' AS check_name, count(*) AS failures
FROM (SELECT metric_id FROM market_metrics GROUP BY metric_id HAVING count(*) > 1) duplicate
UNION ALL
SELECT 'duplicate_signal_ids', count(*)
FROM (SELECT signal_id FROM market_signals GROUP BY signal_id HAVING count(*) > 1) duplicate
UNION ALL
SELECT 'multiple_top_signals_per_day', count(*)
FROM (
  SELECT market_date FROM market_signals WHERE signal_status = 'top_signal'
  GROUP BY market_date HAVING count(*) > 1
) duplicate
UNION ALL
SELECT 'computed_metric_without_value', count(*)
FROM market_metrics WHERE metric_status = 'computed' AND metric_value IS NULL
UNION ALL
SELECT 'insufficient_metric_with_value', count(*)
FROM market_metrics WHERE metric_status = 'insufficient_data' AND metric_value IS NOT NULL
UNION ALL
SELECT 'signal_with_unverified_fact', count(*)
FROM market_signals signal
CROSS JOIN LATERAL jsonb_array_elements_text(signal.supporting_fact_ids) supporting(fact_id)
LEFT JOIN market_facts fact ON fact.fact_id = supporting.fact_id
WHERE fact.id IS NULL OR fact.verification_status <> 'verified' OR fact.publication_blocked = true;

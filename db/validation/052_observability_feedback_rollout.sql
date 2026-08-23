SELECT 'duplicate_daily_runs' AS check_name, count(*) AS failures
FROM (SELECT market_date,pipeline_version FROM pipeline_daily_runs GROUP BY market_date,pipeline_version HAVING count(*)>1) duplicate
UNION ALL
SELECT 'orphan_alerts', count(*) FROM pipeline_alerts alert
LEFT JOIN pipeline_daily_runs run ON run.id=alert.pipeline_daily_run_id
WHERE alert.pipeline_daily_run_id IS NOT NULL AND run.id IS NULL
UNION ALL
SELECT 'invalid_released_quality', count(*) FROM published_articles article
JOIN article_quality_metrics metric ON metric.published_article_id=article.id
WHERE article.publication_status = 'published'
  AND (metric.numeric_traceability_rate < 1 OR metric.unique_main_thesis=false
       OR metric.has_counter_signal=false OR metric.has_invalidation_conditions=false
       OR metric.validation_metric_count < 3 OR metric.unsupported_number_count > 0)
UNION ALL
SELECT 'active_without_shadow_threshold', count(*) FROM pipeline_rollout_state
WHERE current_mode='active' AND (shadow_document_count < 20 OR shadow_publishable_days < 10 OR review_approved_days < 3)
UNION ALL
SELECT 'invalid_feedback_issue_type', count(*) FROM editorial_feedback feedback
CROSS JOIN LATERAL jsonb_array_elements_text(feedback.issue_types) issue(issue_type)
WHERE issue.issue_type NOT IN ('wrong_fact','wrong_number','wrong_causality','weak_relevance','too_generic',
  'too_repetitive','missing_signal','missing_counter_signal','wrong_source','wrong_date','wrong_unit','style_issue');

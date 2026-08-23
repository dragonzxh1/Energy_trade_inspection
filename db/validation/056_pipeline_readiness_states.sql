SELECT 'quality_without_content',count(*) FROM pipeline_daily_runs
WHERE quality_gate_passed AND NOT content_ready;
SELECT 'execution_without_quality',count(*) FROM pipeline_daily_runs
WHERE publish_execution_allowed AND NOT quality_gate_passed;
SELECT 'shadow_execution_allowed',count(*) FROM pipeline_daily_runs
WHERE pipeline_mode='shadow' AND publish_execution_allowed;

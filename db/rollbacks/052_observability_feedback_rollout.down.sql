BEGIN;
DROP TABLE IF EXISTS pipeline_rollout_state;
DROP TABLE IF EXISTS article_quality_metrics;
DROP TABLE IF EXISTS editorial_feedback;
DROP TABLE IF EXISTS pipeline_alerts;
DROP TABLE IF EXISTS pipeline_daily_runs;
DELETE FROM schema_migrations WHERE filename = '052_observability_feedback_rollout.sql';
COMMIT;

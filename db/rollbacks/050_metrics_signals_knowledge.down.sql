BEGIN;
DROP TABLE IF EXISTS commodity_knowledge_versions;
DROP TABLE IF EXISTS market_signals;
DROP TABLE IF EXISTS market_metrics;
DELETE FROM schema_migrations WHERE filename = '050_metrics_signals_knowledge.sql';
COMMIT;

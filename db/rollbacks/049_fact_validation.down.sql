BEGIN;

DROP INDEX IF EXISTS idx_market_facts_publishable;
DROP TABLE IF EXISTS processing_step_attempts;
DROP TABLE IF EXISTS fact_review_queue;
DROP TABLE IF EXISTS fact_conflicts;
DROP TABLE IF EXISTS fact_validation_results;

ALTER TABLE market_facts
  DROP COLUMN IF EXISTS publication_blocked,
  DROP COLUMN IF EXISTS validated_at,
  DROP COLUMN IF EXISTS validation_version;
ALTER TABLE market_facts
  DROP CONSTRAINT IF EXISTS market_facts_risk_level_check;
ALTER TABLE market_facts
  ADD CONSTRAINT market_facts_risk_level_check
  CHECK (risk_level IN ('normal', 'medium', 'high', 'critical'));

DELETE FROM schema_migrations WHERE filename = '049_fact_validation.sql';

COMMIT;

BEGIN;

DROP TABLE IF EXISTS market_prices;
DROP TABLE IF EXISTS market_facts;
DROP TABLE IF EXISTS processing_steps;

ALTER TABLE processing_runs
  DROP CONSTRAINT IF EXISTS processing_runs_processing_status_check;
ALTER TABLE processing_runs
  ADD CONSTRAINT processing_runs_processing_status_check
  CHECK (processing_status IN ('received', 'downloaded', 'adapted', 'parsed', 'failed', 'needs_review'));

DELETE FROM schema_migrations WHERE filename = '048_market_facts.sql';

COMMIT;

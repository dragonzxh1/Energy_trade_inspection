ALTER TABLE fact_extraction_runs
  ADD COLUMN IF NOT EXISTS facts_updated INTEGER NOT NULL DEFAULT 0;

ALTER TABLE fact_extraction_runs
  DROP CONSTRAINT IF EXISTS fact_extraction_runs_facts_updated_check;

ALTER TABLE fact_extraction_runs
  ADD CONSTRAINT fact_extraction_runs_facts_updated_check CHECK (facts_updated >= 0);

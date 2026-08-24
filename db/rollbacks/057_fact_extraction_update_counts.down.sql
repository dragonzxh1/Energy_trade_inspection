ALTER TABLE fact_extraction_runs
  DROP CONSTRAINT IF EXISTS fact_extraction_runs_facts_updated_check;

ALTER TABLE fact_extraction_runs
  DROP COLUMN IF EXISTS facts_updated;

SELECT count(*) AS invalid_fact_update_counts
FROM fact_extraction_runs
WHERE facts_updated < 0;

DROP INDEX IF EXISTS idx_summary_publication_states_status;
DROP TABLE IF EXISTS summary_publication_states;
DROP INDEX IF EXISTS idx_source_dossiers_market_date;
DROP TABLE IF EXISTS source_dossiers;

ALTER TABLE pipeline_daily_runs DROP CONSTRAINT IF EXISTS pipeline_daily_runs_article_mode_check;
ALTER TABLE pipeline_daily_runs ADD CONSTRAINT pipeline_daily_runs_article_mode_check
  CHECK (article_mode IN ('market_view', 'factual_brief', 'archive_only'));
ALTER TABLE editorial_views DROP CONSTRAINT IF EXISTS editorial_views_article_mode_check;
ALTER TABLE editorial_views ADD CONSTRAINT editorial_views_article_mode_check
  CHECK (article_mode IN ('market_view', 'factual_brief', 'archive_only'));

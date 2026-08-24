SELECT attachment_id, count(*)
FROM source_documents
WHERE is_current = true
GROUP BY attachment_id
HAVING count(*) > 1;

SELECT market_date, article_mode, publishable, editorially_publishable
FROM editorial_views
WHERE publishable <> editorially_publishable
   OR (article_mode = 'market_view' AND directional_signal_available = false)
   OR (article_mode = 'archive_only' AND editorially_publishable = true);

SELECT market_date, article_mode, evidence_ready, editorially_publishable
FROM pipeline_daily_runs
WHERE article_mode NOT IN (
  'faithful_translation', 'event_brief', 'market_analysis',
  'market_view', 'factual_brief', 'archive_only'
);

SELECT count(*) AS invalid_editorial_article_modes
FROM editorial_views
WHERE article_mode NOT IN (
  'faithful_translation', 'event_brief', 'market_analysis',
  'market_view', 'factual_brief', 'archive_only'
);

SELECT count(*) AS invalid_daily_run_article_modes
FROM pipeline_daily_runs
WHERE article_mode NOT IN (
  'faithful_translation', 'event_brief', 'market_analysis',
  'market_view', 'factual_brief', 'archive_only'
);

SELECT count(*) AS dossier_document_mismatches
FROM source_dossiers dossier
JOIN source_documents document ON document.id = dossier.source_document_id
WHERE dossier.source_id <> document.source_id
   OR dossier.market_date <> document.market_date;

SELECT count(*) AS invalid_summary_image_states
FROM summary_publication_states
WHERE image_quote_status IN ('draft_created', 'draft_verified')
  AND (image_market_date IS DISTINCT FROM market_date OR image_draft_media_id IS NULL);

SELECT count(*) AS unverified_comparison_states
FROM summary_publication_states
WHERE comparison_eligible = true
  AND structured_verification_status <> 'verified';
SELECT 'historical_flag_mismatch', count(*)
FROM published_articles article
JOIN editorial_views view ON view.id = article.editorial_view_id
WHERE article.is_historical = false AND view.is_historical = true;

SELECT 'null_historical_flags',
  (SELECT count(*) FROM editorial_views WHERE is_historical IS NULL)
  + (SELECT count(*) FROM published_articles WHERE is_historical IS NULL);

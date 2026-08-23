SELECT 'multiple_views_per_day' AS check_name, count(*) AS failures
FROM (SELECT market_date FROM editorial_views GROUP BY market_date HAVING count(*) > 1) duplicate
UNION ALL
SELECT 'publishable_low_signal', count(*)
FROM editorial_views
WHERE view_change_type = 'low_signal'
  AND publishable = true
  AND article_mode = 'market_view'
UNION ALL
SELECT 'publishable_view_without_facts', count(*)
FROM editorial_views WHERE publishable = true AND jsonb_array_length(supporting_fact_ids) = 0
UNION ALL
SELECT 'released_article_failed_local_audit', count(*)
FROM published_articles
WHERE publication_status IN ('draft_created', 'published') AND local_audit_passed = false
UNION ALL
SELECT 'released_article_failed_llm_review', count(*)
FROM published_articles
WHERE publication_status IN ('draft_created', 'published') AND llm_review_passed = false
UNION ALL
SELECT 'article_from_unpublishable_view', count(*)
FROM published_articles article
JOIN editorial_views view ON view.id = article.editorial_view_id
WHERE article.publication_status IN ('draft_created', 'published') AND view.publishable = false;

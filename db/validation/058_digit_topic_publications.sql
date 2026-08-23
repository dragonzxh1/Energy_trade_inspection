SELECT 'orphan_topic_publication' AS check_name, count(*) AS failures
FROM digit_topic_publications topic
LEFT JOIN published_articles article ON article.id = topic.published_article_id
WHERE article.id IS NULL
UNION ALL
SELECT 'parent_market_date_mismatch', count(*)
FROM digit_topic_publications topic
JOIN published_articles article ON article.id = topic.published_article_id
WHERE article.market_date <> topic.market_date
UNION ALL
SELECT 'unstable_publication_key', count(*)
FROM digit_topic_publications
WHERE publication_key <> concat(
  'digit:', market_date::text, ':', article_slug, ':', publication_action
)
UNION ALL
SELECT 'missing_success_reference', count(*)
FROM digit_topic_publications
WHERE (publication_status = 'draft_created' AND nullif(btrim(media_id), '') IS NULL)
   OR (publication_status = 'published' AND nullif(btrim(publish_id), '') IS NULL)
UNION ALL
SELECT 'multiple_active_actions_per_topic', count(*)
FROM (
  SELECT published_article_id, article_slug
  FROM digit_topic_publications
  WHERE active = true
  GROUP BY published_article_id, article_slug
  HAVING count(*) > 1
) duplicate
UNION ALL
SELECT 'aggregate_reference_missing', count(*)
FROM digit_topic_publications topic
JOIN published_articles article ON article.id = topic.published_article_id
WHERE topic.active = true
  AND coalesce(
    nullif(btrim(topic.publish_id), ''),
    nullif(btrim(topic.media_id), ''),
    ''
  ) <> coalesce((
    SELECT item ->> 'publication_reference'
    FROM jsonb_array_elements(
      coalesce(article.review_json -> 'articles', '[]'::jsonb)
    ) item
    WHERE item ->> 'article_slug' = topic.article_slug
    LIMIT 1
  ), '');

WITH active_status AS (
  SELECT
    published_article_id,
    CASE
      WHEN bool_or(publication_status = 'publish_failed') THEN 'publish_failed'
      WHEN bool_or(
        publication_status IN ('generation_failed', 'review_rejected')
        OR local_audit_status <> 'pass'
        OR llm_review_status <> 'pass'
      ) THEN 'review_rejected'
      WHEN bool_or(publication_status = 'shadow_saved') THEN 'shadow_saved'
      WHEN bool_or(publication_status = 'draft_created') THEN 'draft_created'
      WHEN bool_or(publication_status = 'published') THEN 'published'
      ELSE 'review_rejected'
    END AS expected_status
  FROM digit_topic_publications
  WHERE active = true
  GROUP BY published_article_id
)
SELECT 'aggregate_status_mismatch' AS check_name, count(*) AS failures
FROM active_status expected
JOIN published_articles article ON article.id = expected.published_article_id
WHERE article.publication_status <> expected.expected_status;

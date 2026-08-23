DROP INDEX IF EXISTS idx_published_articles_review_eligible;
DROP INDEX IF EXISTS idx_editorial_views_rollout_eligible;
ALTER TABLE published_articles DROP COLUMN IF EXISTS is_historical;
ALTER TABLE editorial_views DROP COLUMN IF EXISTS is_historical;

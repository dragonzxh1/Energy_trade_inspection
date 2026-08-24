ALTER TABLE editorial_views
ADD COLUMN is_historical BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE published_articles
ADD COLUMN is_historical BOOLEAN NOT NULL DEFAULT false;

-- Existing views and articles predate explicit run provenance. Conservatively exclude
-- them from rollout counters; a subsequent non-historical run changes the flag to false.
UPDATE editorial_views SET is_historical = true;
UPDATE published_articles SET is_historical = true;

CREATE INDEX idx_editorial_views_rollout_eligible
ON editorial_views (market_date DESC)
WHERE publishable = true AND is_historical = false;

CREATE INDEX idx_published_articles_review_eligible
ON published_articles (market_date DESC)
WHERE publication_status = 'draft_created' AND is_historical = false;

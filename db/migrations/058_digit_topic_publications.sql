CREATE TABLE digit_topic_publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  published_article_id UUID NOT NULL REFERENCES published_articles(id) ON DELETE RESTRICT,
  publication_key TEXT NOT NULL UNIQUE,
  market_date DATE NOT NULL,
  article_slug TEXT NOT NULL CHECK (article_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title TEXT,
  summary TEXT,
  markdown_path TEXT,
  html_path TEXT,
  quality_audit_path TEXT,
  llm_review_path TEXT,
  artifact_sha256 JSONB NOT NULL DEFAULT '{}'::jsonb,
  local_audit_status TEXT NOT NULL,
  llm_review_status TEXT NOT NULL,
  publication_action TEXT NOT NULL CHECK (publication_action IN (
    'off', 'shadow', 'auto', 'draft', 'publish'
  )),
  publication_status TEXT NOT NULL CHECK (publication_status IN (
    'generation_failed', 'review_rejected', 'shadow_saved',
    'draft_created', 'published', 'publish_failed'
  )),
  media_id TEXT,
  publish_id TEXT,
  CHECK (
    publication_status <> 'draft_created'
    OR nullif(btrim(media_id), '') IS NOT NULL
  ),
  CHECK (
    publication_status <> 'published'
    OR nullif(btrim(publish_id), '') IS NOT NULL
  ),
  publication_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  topic_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_date, article_slug, publication_action)
);

CREATE UNIQUE INDEX uq_digit_topic_publications_active_topic
ON digit_topic_publications (published_article_id, article_slug)
WHERE active = true;

CREATE INDEX idx_digit_topic_publications_daily
ON digit_topic_publications (market_date DESC, active, publication_status);

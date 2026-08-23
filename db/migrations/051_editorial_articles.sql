CREATE TABLE editorial_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  market_date DATE NOT NULL UNIQUE,
  main_thesis TEXT NOT NULL,
  top_signal_id TEXT,
  view_change_type TEXT NOT NULL CHECK (view_change_type IN (
    'continuation', 'strengthening', 'weakening', 'reversal', 'driver_shift', 'new_theme', 'low_signal'
  )),
  comparison_with_previous_day TEXT NOT NULL,
  supporting_fact_ids JSONB NOT NULL,
  view_json JSONB NOT NULL,
  audit_issues JSONB NOT NULL,
  publishable BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE published_articles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  market_date DATE NOT NULL,
  editorial_view_id UUID NOT NULL REFERENCES editorial_views(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  markdown_path TEXT NOT NULL,
  html_path TEXT NOT NULL,
  source_mapping JSONB NOT NULL,
  local_audit_passed BOOLEAN NOT NULL,
  llm_review_passed BOOLEAN NOT NULL,
  review_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  publication_status TEXT NOT NULL CHECK (publication_status IN (
    'archive_only', 'shadow_saved', 'review_rejected', 'draft_created', 'published', 'publish_failed'
  )),
  publication_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_date, editorial_view_id)
);

CREATE INDEX idx_editorial_views_publishable ON editorial_views(market_date DESC, publishable);
CREATE INDEX idx_published_articles_status ON published_articles(market_date DESC, publication_status);

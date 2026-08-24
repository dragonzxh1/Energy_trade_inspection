ALTER TABLE editorial_views
  DROP CONSTRAINT IF EXISTS editorial_views_article_mode_check;
ALTER TABLE editorial_views
  ADD CONSTRAINT editorial_views_article_mode_check
  CHECK (article_mode IN (
    'faithful_translation', 'event_brief', 'market_analysis',
    'market_view', 'factual_brief', 'archive_only'
  ));

ALTER TABLE pipeline_daily_runs
  DROP CONSTRAINT IF EXISTS pipeline_daily_runs_article_mode_check;
ALTER TABLE pipeline_daily_runs
  ADD CONSTRAINT pipeline_daily_runs_article_mode_check
  CHECK (article_mode IN (
    'faithful_translation', 'event_brief', 'market_analysis',
    'market_view', 'factual_brief', 'archive_only'
  ));

CREATE TABLE IF NOT EXISTS source_dossiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  source_document_id UUID NOT NULL UNIQUE REFERENCES source_documents(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  market_date DATE NOT NULL,
  dossier_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_source_dossiers_market_date ON source_dossiers (market_date DESC, source_id);

CREATE TABLE IF NOT EXISTS summary_publication_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_date DATE NOT NULL UNIQUE,
  image_market_date DATE,
  image_date_confidence DOUBLE PRECISION
    CHECK (image_date_confidence IS NULL OR image_date_confidence BETWEEN 0 AND 1),
  image_quote_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (image_quote_status IN ('pending', 'ready', 'blocked', 'draft_created', 'draft_verified')),
  image_draft_media_id TEXT,
  bot_confirmation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (bot_confirmation_status IN ('pending', 'received', 'conflict')),
  structured_verification_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (structured_verification_status IN ('pending', 'verified', 'needs_review')),
  comparison_eligible BOOLEAN NOT NULL DEFAULT false,
  last_reconciliation_at TIMESTAMPTZ,
  reconciliation_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  state_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_summary_publication_states_status
  ON summary_publication_states (market_date DESC, image_quote_status, structured_verification_status);

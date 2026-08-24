CREATE TABLE IF NOT EXISTS digit_publication_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL,
  publication_key TEXT NOT NULL,
  market_date DATE NOT NULL,
  article_slug TEXT NOT NULL,
  title TEXT,
  publication_action TEXT NOT NULL,
  publication_status TEXT NOT NULL,
  local_audit_status TEXT NOT NULL,
  llm_review_status TEXT NOT NULL,
  review_score NUMERIC(6,2),
  artifact_sha256 JSONB NOT NULL DEFAULT '{}'::jsonb,
  local_audit_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  llm_review_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  publication_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  topic_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, publication_key)
);

CREATE INDEX IF NOT EXISTS idx_digit_publication_attempts_daily
  ON digit_publication_attempts (market_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_digit_publication_attempts_status
  ON digit_publication_attempts (publication_status, created_at DESC);

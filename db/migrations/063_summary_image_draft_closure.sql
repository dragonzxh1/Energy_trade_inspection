ALTER TABLE summary_publication_states
  DROP CONSTRAINT IF EXISTS summary_publication_states_image_quote_status_check;
ALTER TABLE summary_publication_states
  ADD CONSTRAINT summary_publication_states_image_quote_status_check
  CHECK (image_quote_status IN (
    'pending', 'date_pending', 'ready', 'blocked', 'needs_review',
    'failed_retryable', 'failed_terminal', 'draft_created', 'draft_verified'
  ));

ALTER TABLE summary_publication_states
  ADD COLUMN IF NOT EXISTS source_attachment_id UUID REFERENCES telegram_attachments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS output_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS draft_content_hash TEXT,
  ADD COLUMN IF NOT EXISTS draft_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE summary_publication_states
  DROP CONSTRAINT IF EXISTS summary_publication_states_source_sha256_check;
ALTER TABLE summary_publication_states
  ADD CONSTRAINT summary_publication_states_source_sha256_check
  CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[A-Fa-f0-9]{64}$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_summary_publication_source_sha256
  ON summary_publication_states (source_sha256)
  WHERE source_sha256 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_summary_publication_idempotency_key
  ON summary_publication_states (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE processing_runs
  DROP CONSTRAINT IF EXISTS processing_runs_processing_status_check;
ALTER TABLE processing_runs
  ADD CONSTRAINT processing_runs_processing_status_check
  CHECK (processing_status IN (
    'received', 'downloaded', 'adapted', 'parsed', 'pending', 'processing', 'completed',
    'failed', 'failed_retryable', 'failed_terminal', 'needs_review'
  ));

CREATE INDEX IF NOT EXISTS idx_summary_image_processing_runs
  ON processing_runs (run_type, processing_status, updated_at DESC)
  WHERE run_type = 'summary_image';

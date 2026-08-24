DROP INDEX IF EXISTS idx_summary_image_processing_runs;

ALTER TABLE processing_runs
  DROP CONSTRAINT IF EXISTS processing_runs_processing_status_check;
ALTER TABLE processing_runs
  ADD CONSTRAINT processing_runs_processing_status_check
  CHECK (processing_status IN (
    'received', 'downloaded', 'adapted', 'parsed', 'completed', 'failed', 'needs_review'
  ));

DROP INDEX IF EXISTS uq_summary_publication_idempotency_key;
DROP INDEX IF EXISTS uq_summary_publication_source_sha256;

ALTER TABLE summary_publication_states
  DROP CONSTRAINT IF EXISTS summary_publication_states_source_sha256_check;

ALTER TABLE summary_publication_states
  DROP COLUMN IF EXISTS idempotency_key,
  DROP COLUMN IF EXISTS last_error,
  DROP COLUMN IF EXISTS attempts,
  DROP COLUMN IF EXISTS draft_verified_at,
  DROP COLUMN IF EXISTS draft_content_hash,
  DROP COLUMN IF EXISTS output_sha256,
  DROP COLUMN IF EXISTS source_sha256,
  DROP COLUMN IF EXISTS source_attachment_id;

ALTER TABLE summary_publication_states
  DROP CONSTRAINT IF EXISTS summary_publication_states_image_quote_status_check;
ALTER TABLE summary_publication_states
  ADD CONSTRAINT summary_publication_states_image_quote_status_check
  CHECK (image_quote_status IN ('pending', 'ready', 'blocked', 'draft_created', 'draft_verified'));

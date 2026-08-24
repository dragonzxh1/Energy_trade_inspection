DROP INDEX IF EXISTS idx_editorial_views_article_readiness;
DROP INDEX IF EXISTS idx_source_documents_revision;
DROP INDEX IF EXISTS uq_source_documents_current_attachment;

ALTER TABLE source_documents
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS is_current,
  DROP COLUMN IF EXISTS revision_status,
  DROP COLUMN IF EXISTS supersedes_document_id;

ALTER TABLE pipeline_daily_runs
  DROP COLUMN IF EXISTS article_mode,
  DROP COLUMN IF EXISTS directional_signal_available,
  DROP COLUMN IF EXISTS editorially_publishable,
  DROP COLUMN IF EXISTS evidence_ready;

ALTER TABLE editorial_views
  DROP COLUMN IF EXISTS article_mode,
  DROP COLUMN IF EXISTS directional_signal_available,
  DROP COLUMN IF EXISTS editorially_publishable,
  DROP COLUMN IF EXISTS evidence_ready;

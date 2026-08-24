ALTER TABLE editorial_views
  ADD COLUMN evidence_ready BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN editorially_publishable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN directional_signal_available BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN article_mode TEXT NOT NULL DEFAULT 'archive_only'
    CHECK (article_mode IN ('market_view', 'factual_brief', 'archive_only'));

UPDATE editorial_views
SET evidence_ready = publishable,
    editorially_publishable = publishable,
    directional_signal_available = top_signal_id IS NOT NULL,
    article_mode = CASE WHEN publishable THEN 'market_view' ELSE 'archive_only' END;

CREATE INDEX idx_editorial_views_article_readiness
ON editorial_views (market_date DESC, editorially_publishable, article_mode);

ALTER TABLE pipeline_daily_runs
  ADD COLUMN evidence_ready BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN editorially_publishable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN directional_signal_available BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN article_mode TEXT NOT NULL DEFAULT 'archive_only'
    CHECK (article_mode IN ('market_view', 'factual_brief', 'archive_only'));

ALTER TABLE source_documents
  ADD COLUMN supersedes_document_id UUID REFERENCES source_documents(id) ON DELETE RESTRICT,
  ADD COLUMN revision_status TEXT NOT NULL DEFAULT 'current'
    CHECK (revision_status IN ('candidate', 'verified', 'current', 'rejected')),
  ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN verified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX uq_source_documents_current_attachment
ON source_documents (attachment_id)
WHERE is_current = true;

CREATE INDEX idx_source_documents_revision
ON source_documents (attachment_id, parser_version, revision_status, is_current);

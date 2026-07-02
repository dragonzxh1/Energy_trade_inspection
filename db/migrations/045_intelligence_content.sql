ALTER TABLE seo_content
  DROP CONSTRAINT IF EXISTS seo_content_content_type_check,
  DROP CONSTRAINT IF EXISTS seo_content_source_level_check,
  DROP CONSTRAINT IF EXISTS seo_content_source_kind_check;

ALTER TABLE seo_content
  ADD CONSTRAINT seo_content_content_type_check
    CHECK (content_type IN ('case_study', 'risk_topic', 'country_profile', 'market_brief', 'commodity_update', 'intelligence_article')),
  ADD CONSTRAINT seo_content_source_level_check
    CHECK (source_level IN ('official', 'news', 'analysis', 'telegram', 'broker', 'exchange', 'internal')),
  ADD CONSTRAINT seo_content_source_kind_check
    CHECK (source_kind IN ('official', 'OFAC SDN designation', 'DOJ press release', 'telegram_attachment', 'market_note', 'shipment_update', 'refinery_note', 'sanctions_event', 'pricing_signal', 'trade_flow'));

ALTER TABLE seo_content
  ADD COLUMN commodity TEXT,
  ADD COLUMN subcommodity TEXT,
  ADD COLUMN region TEXT,
  ADD COLUMN content_subtype TEXT,
  ADD COLUMN source_channel TEXT,
  ADD COLUMN source_message_id TEXT,
  ADD COLUMN source_file_hash TEXT,
  ADD COLUMN source_file_name TEXT,
  ADD COLUMN source_published_at TIMESTAMP,
  ADD COLUMN parser_confidence NUMERIC(5, 4),
  ADD COLUMN review_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN distribution_status TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN language_variants JSONB,
  ADD COLUMN source_document_json JSONB,
  ADD COLUMN key_facts JSONB,
  ADD COLUMN why_it_matters TEXT,
  ADD COLUMN internal_only BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE seo_content
  ADD CONSTRAINT seo_content_review_status_check
    CHECK (review_status IN ('draft', 'reviewed', 'published', 'rejected')),
  ADD CONSTRAINT seo_content_distribution_status_check
    CHECK (distribution_status IN ('draft', 'queued', 'distributed', 'manual_only'));

CREATE INDEX idx_seo_content_commodity ON seo_content(commodity);
CREATE INDEX idx_seo_content_region ON seo_content(region);
CREATE INDEX idx_seo_content_subtype ON seo_content(content_subtype);
CREATE INDEX idx_seo_content_review_status ON seo_content(review_status);
CREATE INDEX idx_seo_content_distribution_status ON seo_content(distribution_status);
CREATE INDEX idx_seo_content_source_message_id ON seo_content(source_message_id);
CREATE INDEX idx_seo_content_source_file_hash ON seo_content(source_file_hash);

CREATE TABLE content_ingestion_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_channel TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  sender_label TEXT,
  media_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_hash TEXT,
  file_size_bytes BIGINT,
  message_timestamp TIMESTAMP NOT NULL,
  storage_path TEXT,
  source_url TEXT,
  processing_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (processing_status IN ('queued', 'parsed', 'drafted', 'review', 'published', 'failed')),
  parser_confidence NUMERIC(5, 4),
  commodity TEXT,
  region TEXT,
  extracted_title TEXT,
  extracted_summary TEXT,
  raw_payload_json JSONB,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (source_channel, source_message_id)
);

CREATE INDEX idx_content_ingestion_status ON content_ingestion_queue(processing_status, created_at DESC);
CREATE INDEX idx_content_ingestion_commodity ON content_ingestion_queue(commodity);
CREATE INDEX idx_content_ingestion_file_hash ON content_ingestion_queue(file_hash);

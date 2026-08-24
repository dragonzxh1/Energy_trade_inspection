ALTER TABLE processing_runs
  DROP CONSTRAINT processing_runs_processing_status_check;

ALTER TABLE processing_runs
  ADD CONSTRAINT processing_runs_processing_status_check
  CHECK (processing_status IN ('received', 'downloaded', 'adapted', 'parsed', 'failed', 'needs_review'));

CREATE TABLE source_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id TEXT NOT NULL UNIQUE,
  attachment_id UUID NOT NULL REFERENCES telegram_attachments(id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  publisher TEXT NOT NULL,
  publisher_confidence DOUBLE PRECISION NOT NULL CHECK (publisher_confidence BETWEEN 0 AND 1),
  report_family TEXT NOT NULL,
  report_title TEXT NOT NULL,
  document_type TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  market_date DATE NOT NULL,
  market_date_confidence DOUBLE PRECISION NOT NULL CHECK (market_date_confidence BETWEEN 0 AND 1),
  market_date_reason TEXT NOT NULL,
  date_candidates JSONB NOT NULL,
  language TEXT NOT NULL,
  regions JSONB NOT NULL DEFAULT '[]'::jsonb,
  commodities JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$'),
  raw_text_path TEXT,
  parsed_text TEXT NOT NULL,
  parse_method TEXT NOT NULL,
  parse_confidence DOUBLE PRECISION NOT NULL CHECK (parse_confidence BETWEEN 0 AND 1),
  processing_status TEXT NOT NULL CHECK (processing_status IN ('parsed', 'needs_review', 'failed')),
  source_verified BOOLEAN NOT NULL,
  needs_review BOOLEAN NOT NULL,
  review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  contract_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, parser_version)
);

CREATE TABLE document_sections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id TEXT NOT NULL UNIQUE,
  source_document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  section_index INTEGER NOT NULL CHECK (section_index >= 0),
  section_title TEXT NOT NULL,
  page_start INTEGER CHECK (page_start IS NULL OR page_start >= 1),
  page_end INTEGER CHECK (page_end IS NULL OR page_end >= 1),
  region TEXT,
  commodity TEXT,
  section_type TEXT NOT NULL,
  section_text TEXT NOT NULL,
  classification_confidence DOUBLE PRECISION NOT NULL CHECK (classification_confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_document_id, section_index)
);

CREATE TABLE parsed_tables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id TEXT NOT NULL UNIQUE,
  source_document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  document_section_id UUID REFERENCES document_sections(id) ON DELETE SET NULL,
  table_index INTEGER NOT NULL CHECK (table_index >= 0),
  title TEXT,
  page_number INTEGER CHECK (page_number IS NULL OR page_number >= 1),
  columns_json JSONB NOT NULL,
  rows_json JSONB NOT NULL,
  parse_method TEXT NOT NULL,
  parse_confidence DOUBLE PRECISION NOT NULL CHECK (parse_confidence BETWEEN 0 AND 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_document_id, table_index)
);

CREATE INDEX idx_source_documents_market_date ON source_documents(market_date DESC);
CREATE INDEX idx_source_documents_review ON source_documents(needs_review, market_date DESC);
CREATE INDEX idx_document_sections_source ON document_sections(source_document_id, section_index);
CREATE INDEX idx_parsed_tables_source ON parsed_tables(source_document_id, table_index);

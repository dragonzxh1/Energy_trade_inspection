CREATE TABLE section_merge_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merge_id TEXT NOT NULL UNIQUE,
  merge_version TEXT NOT NULL,
  source_document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE CASCADE,
  anchor_section_id UUID NOT NULL UNIQUE REFERENCES document_sections(id) ON DELETE CASCADE,
  member_section_ids JSONB NOT NULL,
  original_anchor_text TEXT NOT NULL,
  merged_text TEXT NOT NULL,
  merged_text_hash TEXT NOT NULL CHECK (merged_text_hash ~ '^[A-Fa-f0-9]{64}$'),
  merge_reason TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_section_merge_document ON section_merge_records(source_document_id,active);

ALTER TABLE source_dossiers
  DROP CONSTRAINT IF EXISTS source_dossiers_source_document_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_dossiers_document_schema
  ON source_dossiers (source_document_id, schema_version);

ALTER TABLE source_documents
  ALTER COLUMN attachment_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source_origin TEXT NOT NULL DEFAULT 'telegram'
    CHECK (source_origin IN ('telegram', 'external_web')),
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS retrieved_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_source_documents_external_url_version
  ON source_documents (source_url, parser_version)
  WHERE source_origin = 'external_web' AND source_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS external_research_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL DEFAULT 'external-research-run.v1',
  market_date DATE NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  research_mode TEXT NOT NULL CHECK (research_mode IN ('shadow', 'review')),
  request_json JSONB NOT NULL,
  response_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'running', 'completed', 'partial', 'failed')),
  query_count INTEGER NOT NULL DEFAULT 0 CHECK (query_count >= 0),
  page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
  token_count INTEGER NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_research_runs_date
  ON external_research_runs (market_date DESC, processing_status);

CREATE TABLE IF NOT EXISTS external_evidence_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL DEFAULT 'external-evidence.v1',
  research_run_id UUID NOT NULL REFERENCES external_research_runs(id) ON DELETE CASCADE,
  market_date DATE NOT NULL,
  event_date DATE,
  published_at TIMESTAMPTZ,
  retrieved_at TIMESTAMPTZ NOT NULL,
  canonical_url TEXT NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$'),
  evidence_text_hash TEXT NOT NULL CHECK (evidence_text_hash ~ '^[A-Fa-f0-9]{64}$'),
  source_title TEXT NOT NULL,
  source_publisher TEXT NOT NULL,
  source_tier INTEGER NOT NULL CHECK (source_tier BETWEEN 1 AND 3),
  relationship TEXT NOT NULL CHECK (relationship IN ('supports', 'refutes', 'updates', 'contextualizes')),
  claim_text TEXT NOT NULL,
  evidence_text TEXT NOT NULL,
  fact_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  supporting_internal_fact_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification_status TEXT NOT NULL DEFAULT 'candidate'
    CHECK (verification_status IN ('candidate', 'verified', 'needs_review', 'rejected', 'lead_only')),
  review_reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  promoted_fact_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (canonical_url, content_hash, evidence_text_hash)
);

CREATE INDEX IF NOT EXISTS idx_external_evidence_date_status
  ON external_evidence_candidates (market_date DESC, verification_status, source_tier);

CREATE TABLE IF NOT EXISTS editorial_claim_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL DEFAULT 'claim-ledger.v1',
  market_date DATE NOT NULL,
  normalized_claim_hash TEXT NOT NULL,
  claim_type TEXT NOT NULL CHECK (claim_type IN (
    'confirmed_fact', 'source_view', 'external_confirmation', 'editorial_inference', 'unresolved'
  )),
  claim_text TEXT NOT NULL,
  supporting_fact_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  supporting_external_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  refuting_evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_attribution TEXT,
  publishable BOOLEAN NOT NULL DEFAULT false,
  claim_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_date, normalized_claim_hash)
);

CREATE TABLE IF NOT EXISTS story_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  story_brief_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL DEFAULT 'story-brief.v1',
  market_date DATE NOT NULL,
  topic_cluster_key TEXT NOT NULL,
  planner_version TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  brief_json JSONB NOT NULL,
  validation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (validation_status IN ('pending', 'pass', 'reject')),
  validation_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_date, topic_cluster_key, planner_version)
);

CREATE INDEX IF NOT EXISTS idx_story_briefs_date
  ON story_briefs (market_date DESC, validation_status);

ALTER TABLE processing_runs
  DROP CONSTRAINT processing_runs_processing_status_check;
ALTER TABLE processing_runs
  ADD CONSTRAINT processing_runs_processing_status_check
  CHECK (processing_status IN ('received', 'downloaded', 'adapted', 'parsed', 'completed', 'failed', 'needs_review'));

CREATE TABLE processing_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_run_id UUID NOT NULL REFERENCES processing_runs(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  step_type TEXT NOT NULL,
  processing_status TEXT NOT NULL CHECK (processing_status IN ('pending', 'running', 'completed', 'failed', 'needs_review', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  workflow_name TEXT,
  workflow_run_id TEXT,
  prompt_version TEXT,
  model_name TEXT,
  input_json JSONB,
  output_json JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (processing_run_id, step_key)
);

CREATE TABLE market_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fact_id TEXT NOT NULL UNIQUE,
  fact_hash TEXT NOT NULL UNIQUE CHECK (fact_hash ~ '^[A-Fa-f0-9]{64}$'),
  schema_version TEXT NOT NULL,
  source_document_id UUID NOT NULL REFERENCES source_documents(id) ON DELETE RESTRICT,
  document_section_id UUID NOT NULL REFERENCES document_sections(id) ON DELETE RESTRICT,
  extraction_step_id UUID REFERENCES processing_steps(id) ON DELETE SET NULL,
  source_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  market_date DATE NOT NULL,
  published_at TIMESTAMPTZ,
  region TEXT,
  country TEXT,
  commodity TEXT,
  benchmark TEXT,
  fact_type TEXT NOT NULL CHECK (fact_type IN (
    'price', 'price_change', 'spread', 'premium_discount', 'inventory', 'production',
    'refinery_run', 'refinery_outage', 'shipment', 'arrival', 'tender', 'trade_flow',
    'demand', 'supply', 'weather', 'sanction', 'policy', 'geopolitical_event',
    'freight', 'arbitrage', 'market_sentiment', 'source_commentary'
  )),
  fact_class TEXT NOT NULL CHECK (fact_class IN ('source_fact', 'calculated_fact', 'supported_inference', 'editorial_view', 'hypothesis')),
  statement TEXT NOT NULL,
  value NUMERIC,
  unit TEXT,
  change_value NUMERIC,
  change_unit TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down', 'flat', 'mixed', 'unknown')),
  time_basis TEXT,
  evidence_text TEXT NOT NULL,
  page_number INTEGER CHECK (page_number IS NULL OR page_number >= 1),
  attribution TEXT,
  uncertainty TEXT,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending', 'verified', 'needs_review', 'rejected')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('normal', 'medium', 'high', 'critical')),
  supporting_fact_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_current BOOLEAN NOT NULL DEFAULT true,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (value IS NULL OR unit IS NOT NULL)
);

CREATE TABLE market_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_fact_id UUID NOT NULL UNIQUE REFERENCES market_facts(id) ON DELETE CASCADE,
  market_date DATE NOT NULL,
  commodity TEXT,
  region TEXT,
  benchmark TEXT,
  price NUMERIC,
  unit TEXT,
  change_value NUMERIC,
  change_unit TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('up', 'down', 'flat', 'mixed', 'unknown')),
  source_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (price IS NULL OR unit IS NOT NULL)
);

CREATE INDEX idx_processing_steps_status ON processing_steps(processing_status, created_at);
CREATE INDEX idx_market_facts_date_commodity ON market_facts(market_date DESC, commodity);
CREATE INDEX idx_market_facts_verification ON market_facts(verification_status, risk_level, market_date DESC);
CREATE INDEX idx_market_facts_source ON market_facts(source_document_id, document_section_id);
CREATE INDEX idx_market_prices_lookup ON market_prices(market_date DESC, commodity, region, benchmark);

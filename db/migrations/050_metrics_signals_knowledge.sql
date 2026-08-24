CREATE TABLE market_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  market_date DATE NOT NULL,
  commodity TEXT NOT NULL,
  region TEXT,
  benchmark TEXT NOT NULL,
  metric_type TEXT NOT NULL,
  metric_value DOUBLE PRECISION,
  unit TEXT,
  metric_status TEXT NOT NULL CHECK (metric_status IN ('computed', 'insufficient_data')),
  calculation_method TEXT NOT NULL,
  calculation_version TEXT NOT NULL,
  source_fact_ids JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE market_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id TEXT NOT NULL UNIQUE,
  schema_version TEXT NOT NULL,
  market_date DATE NOT NULL,
  commodity TEXT NOT NULL,
  region TEXT,
  signal_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('bullish', 'bearish', 'neutral', 'mixed')),
  supporting_fact_ids JSONB NOT NULL,
  counter_fact_ids JSONB NOT NULL,
  metric_ids JSONB NOT NULL,
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  score_breakdown JSONB NOT NULL,
  support_dimensions JSONB NOT NULL,
  signal_status TEXT NOT NULL CHECK (signal_status IN ('top_signal', 'secondary_signal', 'weak_signal', 'discard', 'low_signal')),
  scoring_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE commodity_knowledge_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  card_version TEXT NOT NULL,
  updated_on DATE NOT NULL,
  content_hash TEXT NOT NULL CHECK (content_hash ~ '^[A-Fa-f0-9]{64}$'),
  obsidian_path TEXT,
  dify_document_id TEXT,
  sync_status TEXT NOT NULL CHECK (sync_status IN ('local', 'obsidian_synced', 'dify_synced', 'failed')),
  sync_error TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (commodity_id, card_version)
);

CREATE INDEX idx_market_metrics_lookup ON market_metrics(market_date DESC, commodity, region, benchmark, metric_type);
CREATE INDEX idx_market_signals_daily ON market_signals(market_date DESC, signal_status, score DESC);
CREATE UNIQUE INDEX uq_market_signals_one_top_per_day ON market_signals(market_date) WHERE signal_status = 'top_signal';

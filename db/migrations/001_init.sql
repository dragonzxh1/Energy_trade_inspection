CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company', 'vessel', 'terminal')),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  slug TEXT UNIQUE,
  imo TEXT UNIQUE,
  registration_number TEXT,
  country TEXT NOT NULL,
  jurisdiction_flag TEXT NOT NULL,
  sanction_status TEXT NOT NULL CHECK (sanction_status IN ('not_listed', 'listed', 'unknown')),
  authenticity_score INTEGER NOT NULL CHECK (authenticity_score BETWEEN 0 AND 100),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  score_breakdown_json JSONB NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_source_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_verified TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_sanction_status ON entities(sanction_status);
CREATE INDEX IF NOT EXISTS idx_entities_updated_at ON entities(updated_at);
CREATE INDEX IF NOT EXISTS idx_entities_name_trgm ON entities USING gin(normalized_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id BIGSERIAL PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity_id ON entity_aliases(entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_alias_trgm ON entity_aliases USING gin(normalized_alias gin_trgm_ops);

CREATE TABLE IF NOT EXISTS risk_flags (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  flag_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL CHECK (status IN ('pending_review', 'approved', 'rejected')),
  description TEXT,
  submitter_user_id TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_risk_flags_entity_id ON risk_flags(entity_id);
CREATE INDEX IF NOT EXISTS idx_risk_flags_status ON risk_flags(status);

CREATE TABLE IF NOT EXISTS user_query_usage (
  user_id TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  query_count INTEGER NOT NULL DEFAULT 0,
  quota_limit INTEGER NOT NULL,
  last_query_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, period_start)
);

CREATE TABLE IF NOT EXISTS query_log (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entity_id TEXT,
  query_text TEXT,
  result_type TEXT NOT NULL CHECK (result_type IN ('full', 'limited', 'blocked')),
  queried_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_log_user_id ON query_log(user_id);
CREATE INDEX IF NOT EXISTS idx_query_log_queried_at ON query_log(queried_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

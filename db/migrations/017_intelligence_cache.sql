-- Intelligence search result cache
-- TTL 24 hours. entity_type + entity_key form the composite primary key.
-- Storing full response JSON avoids re-running Tavily + HiFleet PSC on every page visit.

CREATE TABLE IF NOT EXISTS intelligence_cache (
  entity_type  TEXT        NOT NULL,  -- 'company' | 'vessel' | 'terminal'
  entity_key   TEXT        NOT NULL,  -- slug / IMO / terminal id
  data_json    JSONB       NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS intelligence_cache_expires ON intelligence_cache (expires_at);

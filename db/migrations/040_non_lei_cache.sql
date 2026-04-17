-- Migration 040: Non-LEI entity cache
-- Caches search results from ACRA / Companies House / Zefix / OpenCorporates
-- for entities that have no corresponding GLEIF LEI.
-- TTL: 7 days.  Prevents repeated HTTP calls for the same small company or
-- offshore entity that shows up in searches but is not in lei_cache.

CREATE TABLE IF NOT EXISTS non_lei_cache (
  id              TEXT         PRIMARY KEY,   -- 'acra:{UEN}' | 'ch:{NUM}' | 'zefix:{UID}' | 'oc:{JRSD}:{NUM}'
  canonical_name  TEXT         NOT NULL,
  entity_type     TEXT         NOT NULL DEFAULT 'company',
  jurisdiction    CHAR(2),
  registry_source TEXT         NOT NULL,      -- 'acra' | 'ch' | 'zefix' | 'oc'
  data_json       JSONB        NOT NULL,       -- serialised SearchResult
  authenticity_score INTEGER,
  fetched_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ  NOT NULL        -- typically NOW() + 7 days
);

CREATE INDEX IF NOT EXISTS non_lei_name_trgm
  ON non_lei_cache USING GIN (canonical_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS non_lei_expires
  ON non_lei_cache(expires_at);

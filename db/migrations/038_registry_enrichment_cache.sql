-- Migration 038: Registry enrichment cache
-- Caches the result of resolveGleifRecord() (CH/ACRA/Zefix/OC/GLEIF-only Company objects)
-- so repeated entity lookups don't re-hit the national registry each time.
-- TTL: 7 days (registry data changes slowly; stale entries are purged by cron/cleanup).

CREATE TABLE IF NOT EXISTS registry_enrichment_cache (
  lei           CHAR(20)     PRIMARY KEY REFERENCES lei_cache(lei) ON DELETE CASCADE,
  registry_source TEXT       NOT NULL,           -- 'ch' | 'acra' | 'zefix' | 'oc' | 'gleif_only'
  data_json     JSONB        NOT NULL,            -- full serialised Company object
  fetched_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ  NOT NULL             -- typically NOW() + 7 days
);

CREATE INDEX IF NOT EXISTS registry_enrichment_expires
  ON registry_enrichment_cache(expires_at);

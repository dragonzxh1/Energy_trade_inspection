-- 030_domain_whois_cache.sql
-- Cache for RDAP/WHOIS lookups used in domain fraud risk scoring.
--
-- TTL: 48 hours. Rows where queried_at < NOW() - INTERVAL '48 hours' are
-- refreshed on next access. This avoids hammering RDAP servers and keeps
-- latency acceptable in the trade-check hot path.
--
-- Risk signals stored here:
--   registered_at   → domain age (< 90 days = high risk)
--   duration_days   → 1-year-only registration = minimum commitment
--   registrant_org  → null or individual name = no corporate registrant
--   privacy_protected → WHOIS data intentionally hidden

CREATE TABLE IF NOT EXISTS domain_whois_cache (
  domain               TEXT PRIMARY KEY,

  -- Registration timeline
  registered_at        DATE,               -- domain creation date (from RDAP)
  expires_at           DATE,               -- domain expiration date
  duration_days        INT,                -- (expires_at - registered_at) in days

  -- Registrant identity
  registrant_org       TEXT,               -- organization name; null when hidden
  registrant_name      TEXT,               -- individual/contact name; null when hidden
  registrant_country   TEXT,               -- 2-letter ISO country code

  -- Privacy flag: true when registrar privacy service masks the real owner
  privacy_protected    BOOLEAN NOT NULL DEFAULT FALSE,

  -- Cache housekeeping
  queried_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error                TEXT,               -- RDAP error message, if query failed
  raw_json             JSONB               -- full RDAP response for debugging
);

-- Index for TTL-based refresh: find stale rows efficiently
CREATE INDEX IF NOT EXISTS domain_whois_cache_queried
  ON domain_whois_cache(queried_at);

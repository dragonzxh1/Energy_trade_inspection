-- 032_domain_email_cache.sql
-- Cache for email DNS checks: MX, SPF, DMARC, DKIM selector probing.
-- TTL: 48 hours. Same pattern as domain_whois_cache (migration 030).
-- Rows where queried_at < NOW() - INTERVAL '48 hours' are refreshed on next access.

CREATE TABLE IF NOT EXISTS domain_email_cache (
  domain         TEXT PRIMARY KEY,
  has_mx         BOOLEAN,        -- true when at least one MX record is present
  has_spf        BOOLEAN,        -- true when a TXT record starting 'v=spf1' exists at root domain
  has_dmarc      BOOLEAN,        -- true when a TXT record starting 'v=DMARC1' exists at _dmarc.<domain>
  dkim_detected  BOOLEAN,        -- true when a TXT record was found for any probed selector._domainkey.<domain>
  dkim_selector  TEXT,           -- first selector that matched, if any (google|mail|s1|s2|default|mimecast|selector1|selector2)
  risk_signals   TEXT[],         -- human-readable risk signal strings (empty array when no risks found)
  queried_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error          TEXT            -- error message if lookup failed (ENOTFOUND, ESERVFAIL, etc.)
);

-- Index for TTL-based refresh: find stale rows efficiently
CREATE INDEX IF NOT EXISTS domain_email_cache_queried
  ON domain_email_cache(queried_at);

-- 029_legitimate_domains.sql
-- Curated registry of legitimate energy companies and their official domains.
-- Used for domain-spoofing detection: when a trade document contains a domain
-- that closely resembles one in this table, it signals likely impersonation.
--
-- Sources:
--   whitelist  = auto-imported from fraud_alerts WHERE list_type='whitelist'
--                (Rotterdam Port Whitelist — verified terminal operators)
--   manual     = curated list of major global energy traders and oil majors
--   wikidata   = future: auto-synced from Wikidata SPARQL

CREATE TABLE IF NOT EXISTS legitimate_domains (
  domain           TEXT PRIMARY KEY,       -- e.g. 'vitol.com' (lowercase, no www)
  company_name     TEXT NOT NULL,          -- e.g. 'Vitol Group'
  normalized_name  TEXT NOT NULL,          -- for fuzzy name matching
  country_code     CHAR(2),               -- ISO 3166-1 alpha-2, nullable
  source           TEXT NOT NULL           -- 'whitelist' | 'manual' | 'wikidata'
                   CHECK (source IN ('whitelist', 'manual', 'wikidata')),
  source_url       TEXT,                   -- reference page where domain was confirmed
  synced_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- GIN index for full-text search on company name
CREATE INDEX IF NOT EXISTS legitimate_domains_company_fts
  ON legitimate_domains
  USING gin(to_tsvector('simple', company_name));

-- Trigram index for fuzzy domain matching
CREATE INDEX IF NOT EXISTS legitimate_domains_domain_trgm
  ON legitimate_domains
  USING gin(domain gin_trgm_ops);

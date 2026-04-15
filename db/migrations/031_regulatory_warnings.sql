-- 031_regulatory_warnings.sql
-- Stores government regulatory warning list entries.
-- Separate from sanctions_entries (sanctions = trade restrictions)
-- and fraud_alerts (fraud = industry-reported scams).
-- Regulatory warnings = official investor/consumer protection alerts from financial regulators.
--
-- Sources (source keys):
--   fca    = FCA (UK) — Financial Conduct Authority
--   finma  = FINMA (Switzerland) — Swiss Financial Market Supervisory Authority
--   sfc    = SFC (Hong Kong) — Securities and Futures Commission
--   mas    = MAS (Singapore) — Monetary Authority of Singapore
--   dfsa   = DFSA (Dubai DIFC) — Dubai Financial Services Authority
--   sca    = SCA (UAE federal) — Securities and Commodities Authority
--   cma    = CMA Oman — Capital Market Authority

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS regulatory_warnings (
  id              TEXT PRIMARY KEY,          -- "{source}:{slug}"
  source          TEXT NOT NULL,             -- machine-readable key: 'fca', 'mas', etc.
  source_name     TEXT NOT NULL,             -- human-readable: 'FCA (UK)', 'MAS (Singapore)'
  jurisdiction    TEXT NOT NULL,             -- ISO region: 'UK', 'CH', 'HK', 'SG', 'AE-DU', 'AE', 'OM'
  entity_name     TEXT NOT NULL,             -- original name as listed by the regulator
  normalized_name TEXT NOT NULL,             -- normalizeEntityName(entity_name, true)
  list_url        TEXT NOT NULL,             -- canonical URL of the warning list page
  warning_type    TEXT,                      -- optional: 'unauthorized_firm', 'clone_firm', etc.
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_regwarn_normalized ON regulatory_warnings
  USING GIN (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_regwarn_source ON regulatory_warnings (source);

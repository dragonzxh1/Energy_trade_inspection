-- 028_fraud_alerts.sql
-- Stores fraud/scam company listings scraped from industry blacklists.
-- Separate from sanctions_entries because fraud != sanctions:
--   - Sanctions: government-imposed trade restrictions
--   - Fraud alerts: industry-reported scam/impersonation warnings
--
-- Sources:
--   storagespoofing  = Rotterdam Port Blacklist/Whitelist (storagespoofing.nl)
--   fuelscamalert    = Fuel Scam Alert (fuelscamalert.com)
--   ametheus         = Ametheus Blacklist (ametheus.com)
--   glo-innovations  = Global Innovations Blacklist (glo-innovations.com)
--   capitalgaslogistics = Capital Gas Logistics Fraud Alert (capitalgaslogistics.us)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS fraud_alerts (
  id              TEXT PRIMARY KEY,          -- "{source}:{slug}"
  source          TEXT NOT NULL,             -- machine-readable source key
  source_name     TEXT NOT NULL,             -- human-readable: "Rotterdam Port Blacklist"
  source_url      TEXT NOT NULL,             -- page URL where this entry was found
  company_name    TEXT NOT NULL,             -- original name as listed
  normalized_name TEXT NOT NULL,             -- normalizeEntityName(company_name, true)
  list_type       TEXT NOT NULL DEFAULT 'blacklist',  -- 'blacklist' | 'whitelist'
  fraud_type      TEXT,                      -- 'storage-spoofing' | 'fuel-scam' | 'impersonation'
  description     TEXT,                      -- additional context if available
  scam_url        TEXT,                      -- the fake website URL (if listed)
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_normalized ON fraud_alerts
  USING GIN (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fraud_source ON fraud_alerts (source);
CREATE INDEX IF NOT EXISTS idx_fraud_list_type ON fraud_alerts (list_type);

-- Sync log: tracks last scrape per source
CREATE TABLE IF NOT EXISTS fraud_sync_log (
  id            SERIAL PRIMARY KEY,
  source        TEXT NOT NULL,
  status        TEXT NOT NULL,    -- 'success' | 'error'
  record_count  INT,
  error_message TEXT,
  duration_ms   INT,
  synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

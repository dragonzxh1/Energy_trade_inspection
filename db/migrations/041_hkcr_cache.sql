-- Migration 041: Hong Kong Companies Registry local cache
-- Purpose: Store HK company data from weekly CSV batch downloads
-- Strategy: CSV batch download + local cache import (gleif-golden-copy.ts pattern)
-- Source: data.gov.hk CKAN API (hk-cr-crdata-list-newly-registered-companies-2526)

CREATE TABLE IF NOT EXISTS hkcr_cache (
  id SERIAL PRIMARY KEY,
  company_number TEXT NOT NULL UNIQUE,           -- 7-digit registration number (unique key)
  company_name TEXT NOT NULL,                    -- Company English name
  company_name_chinese TEXT,                     -- Company Chinese name (optional)
  company_type TEXT,                             -- e.g. 'Private Company Limited by Shares'
  company_status TEXT,                           -- 'Live' | 'Deregistered' | 'Dissolved'
  date_of_incorporation DATE,                    -- Incorporation date
  nature_of_business TEXT,                       -- Business nature (optional)
  fetched_at TIMESTAMPTZ DEFAULT NOW(),          -- Data fetch timestamp
  last_synced_at TIMESTAMPTZ DEFAULT NOW()       -- Last sync timestamp
);

-- Trigram index: supports English name fuzzy search (GIN index for pg_trgm)
CREATE INDEX IF NOT EXISTS idx_hkcr_cache_name_trgm
  ON hkcr_cache USING GIN (company_name gin_trgm_ops);

-- Trigram index: supports Chinese name fuzzy search
CREATE INDEX IF NOT EXISTS idx_hkcr_cache_name_chinese_trgm
  ON hkcr_cache USING GIN (company_name_chinese gin_trgm_ops);

-- B-tree index: supports registration number exact lookup
CREATE INDEX IF NOT EXISTS idx_hkcr_cache_number
  ON hkcr_cache (company_number);

-- Status index: supports filtering by company status
CREATE INDEX IF NOT EXISTS idx_hkcr_cache_status
  ON hkcr_cache (company_status);
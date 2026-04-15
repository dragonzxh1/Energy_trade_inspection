-- ── Migration 011: Ports, PSC inspections, ICIJ offshore leaks ───────────────

-- ── 1. Ports (World Port Index / UN LOCODE) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ports (
  locode            TEXT PRIMARY KEY,        -- UN/LOCODE e.g. 'SGSIN'
  name              TEXT NOT NULL,
  country           TEXT NOT NULL,           -- ISO 2-letter country code
  region            TEXT,                    -- state / province
  lat               NUMERIC(8, 5),
  lng               NUMERIC(8, 5),
  port_type         TEXT,                    -- 'seaport','river','lake','canal'
  size              TEXT,                    -- 'small','medium','large','very large'
  max_vessel        TEXT,                    -- max vessel class accepted
  tide_range        NUMERIC(5, 2),           -- metres
  shelter           TEXT,                    -- 'excellent','good','fair','poor'
  fuel_oil          BOOLEAN DEFAULT FALSE,
  diesel            BOOLEAN DEFAULT FALSE,
  fresh_water       BOOLEAN DEFAULT FALSE,
  provisions        BOOLEAN DEFAULT FALSE,
  crane             BOOLEAN DEFAULT FALSE,
  drydock           TEXT,                    -- 'none','small','medium','large'
  railway           BOOLEAN DEFAULT FALSE,
  wpi_id            TEXT,                    -- WPI publication index number
  is_energy_hub     BOOLEAN DEFAULT FALSE,   -- curated: major energy trading hubs
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ports_country ON ports (country);
CREATE INDEX IF NOT EXISTS idx_ports_energy  ON ports (is_energy_hub) WHERE is_energy_hub = TRUE;

-- ── 2. PSC Inspections (Port State Control) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS psc_inspections (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  imo              TEXT NOT NULL,            -- vessel IMO (loose coupling, no FK)
  vessel_name      TEXT,
  inspection_date  DATE NOT NULL,
  port_locode      TEXT,                     -- nullable: may not know LOCODE
  port_name        TEXT,
  authority        TEXT NOT NULL,            -- 'Paris MOU','Tokyo MOU','USCG', etc.
  result           TEXT NOT NULL,            -- 'no_deficiency','deficiency','detained'
  deficiency_count INT  DEFAULT 0,
  detention_days   INT,
  deficiencies     JSONB,                    -- array of deficiency category strings
  source_url       TEXT,
  synced_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psc_imo    ON psc_inspections (imo);
CREATE INDEX IF NOT EXISTS idx_psc_date   ON psc_inspections (inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_psc_result ON psc_inspections (result);

-- ── 3. ICIJ Offshore Leaks ────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- may already exist from migration 010

CREATE TABLE IF NOT EXISTS icij_entities (
  node_id             TEXT PRIMARY KEY,     -- ICIJ internal node_id
  name                TEXT NOT NULL,
  dataset             TEXT NOT NULL,        -- 'panama_papers','pandora_papers', etc.
  entity_type         TEXT,                 -- 'Company','Officer','Intermediary','Address'
  countries           TEXT,                 -- comma-separated ISO codes
  jurisdiction        TEXT,
  status              TEXT,                 -- 'active','inactive', etc.
  incorporation_date  TEXT,
  inactivation_date   TEXT,
  struck_off_date     TEXT,
  address             TEXT,
  source_url          TEXT,
  linked_entity_id    TEXT,                 -- matched entities.id in our DB (nullable)
  match_confidence    NUMERIC(4, 2),        -- 0.00–1.00
  synced_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_icij_name_trgm ON icij_entities
  USING GIN (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_icij_dataset   ON icij_entities (dataset);
CREATE INDEX IF NOT EXISTS idx_icij_linked    ON icij_entities (linked_entity_id)
  WHERE linked_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_icij_countries ON icij_entities (countries);

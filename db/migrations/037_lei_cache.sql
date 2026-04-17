-- Migration 037: GLEIF LEI local cache
-- Stores Golden Copy Level 1 (entity), Level 2 RR (ownership chain),
-- and REPEX (reporting exceptions) data for cache-first LEI lookups.

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- may already exist from migration 010/011

CREATE TABLE IF NOT EXISTS lei_cache (
  lei                              CHAR(20)     PRIMARY KEY,
  legal_name                       TEXT         NOT NULL,
  jurisdiction                     CHAR(2),
  country                          CHAR(2),
  registration_authority_id        TEXT,
  registration_authority_entity_id TEXT,
  initial_registration_date        DATE,
  entity_status                    TEXT,
  entity_category                  TEXT,
  direct_parent_lei                CHAR(20),
  ultimate_parent_lei              CHAR(20),
  reporting_exception_type         TEXT,
  reporting_exception_reason       TEXT,
  last_synced_at                   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at                       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Trigram index for fuzzy name search (matches icij_entities pattern)
CREATE INDEX IF NOT EXISTS lei_cache_legal_name_trgm
  ON lei_cache USING GIN (legal_name gin_trgm_ops);

-- B-tree index for registry number lookup (used by resolveGleifRecord routing)
CREATE INDEX IF NOT EXISTS lei_cache_registration_authority_entity_id
  ON lei_cache (registration_authority_entity_id);

-- B-tree index for jurisdiction filter
CREATE INDEX IF NOT EXISTS lei_cache_jurisdiction
  ON lei_cache (jurisdiction);

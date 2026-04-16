-- Migration 036: ICIJ↔Sanctions linkage
-- Adds is_sanctioned and sanctions_match columns to icij_entities,
-- then runs a full re-match against sanctions_entries (word_similarity > 0.72).

ALTER TABLE icij_entities
  ADD COLUMN IF NOT EXISTS is_sanctioned  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sanctions_match TEXT;

-- Sparse index: only index flagged rows (matches idx_icij_linked pattern)
CREATE INDEX IF NOT EXISTS idx_icij_sanctioned
  ON icij_entities (is_sanctioned)
  WHERE is_sanctioned = TRUE;

-- NOTE: Initial population of is_sanctioned is handled by the ICIJ sync script
-- (scripts/sync-icij-offshore.mjs → matchSanctions()) per D-01/D-02.
-- The UPDATE runs there to avoid a long-running transaction at startup.

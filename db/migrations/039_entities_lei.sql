-- Migration 039: Link sanctions entities to GLEIF LEI
-- Adds a nullable lei column to the entities table so that sanctions records can be
-- associated with their GLEIF Golden Copy entry.  This enables:
--   - Ultimate-parent chain traversal without a live GLEIF API call
--   - Detecting when a trade counterparty's ultimate parent is on a sanctions list
-- The column is populated asynchronously by the linkSanctionsToGleif() background job.

ALTER TABLE entities ADD COLUMN IF NOT EXISTS lei CHAR(20) REFERENCES lei_cache(lei);

CREATE INDEX IF NOT EXISTS idx_entities_lei
  ON entities(lei)
  WHERE lei IS NOT NULL;

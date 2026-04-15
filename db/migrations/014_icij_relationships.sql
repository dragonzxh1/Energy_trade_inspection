-- ── Migration 014: ICIJ relationships table ──────────────────────────────────
--
-- Stores edges from relationships.csv:
--   Officer   → DIRECTOR_OF / SHAREHOLDER_OF / OFFICER_OF → Entity
--   Intermediary → INTERMEDIARY_OF → Entity
--   Any node  → REGISTERED_ADDRESS → Address
--
-- This enables beneficial ownership chain queries:
--   "Is any director of [company] linked to a sanctioned offshore entity?"

CREATE TABLE IF NOT EXISTS icij_relationships (
  id            BIGSERIAL PRIMARY KEY,
  rel_type      TEXT NOT NULL,          -- officer_of, intermediary_of, registered_address, same_name_as, etc.
  link          TEXT,                   -- specific role: 'director of', 'shareholder of', 'beneficial owner', etc.
  from_node_id  TEXT NOT NULL,          -- node_id from icij_entities
  to_node_id    TEXT NOT NULL,          -- node_id from icij_entities
  dataset       TEXT,                   -- panama_papers, pandora_papers, etc.
  start_date    TEXT,
  end_date      TEXT,
  synced_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_icij_rel_from   ON icij_relationships (from_node_id);
CREATE INDEX IF NOT EXISTS idx_icij_rel_to     ON icij_relationships (to_node_id);
CREATE INDEX IF NOT EXISTS idx_icij_rel_type   ON icij_relationships (rel_type);
CREATE INDEX IF NOT EXISTS idx_icij_rel_linked ON icij_relationships (from_node_id, to_node_id);

-- Composite: find all entities a given officer is connected to
CREATE INDEX IF NOT EXISTS idx_icij_officer_entities
  ON icij_relationships (from_node_id, rel_type)
  WHERE rel_type = 'officer_of';

CREATE INDEX IF NOT EXISTS idx_icij_rel_link ON icij_relationships (link) WHERE link IS NOT NULL;

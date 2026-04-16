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

-- Full re-match: single-pass LEFT JOIN LATERAL (D-02: full re-match every sync)
-- Threshold: word_similarity > 0.72 (D-03, matches sanctions.ts)
-- This may take several minutes on large icij_entities tables.
UPDATE icij_entities ie
SET
  is_sanctioned  = (m.matched_name IS NOT NULL),
  sanctions_match = m.matched_name
FROM (
  SELECT
    ie2.node_id,
    (
      SELECT se.name
      FROM sanctions_entries se
      WHERE se.sanctions IS NOT NULL
        AND word_similarity(lower(ie2.name), se.search_text) > 0.72
      ORDER BY word_similarity(lower(ie2.name), se.search_text) DESC
      LIMIT 1
    ) AS matched_name
  FROM icij_entities ie2
) m
WHERE ie.node_id = m.node_id;

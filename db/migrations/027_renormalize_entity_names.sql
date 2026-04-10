-- 027_renormalize_entity_names.sql
-- Recomputes normalized_name for all entities using the canonical suffix-stripping rules.
-- Must stay in sync with LEGAL_SUFFIXES / GENERIC_WORDS in src/lib/server/normalize.ts.
--
-- PRODUCTION NOTE: This migration runs a mass UPDATE on the entities table.
-- Apply manually before deploying to avoid a write-lock during server startup:
--   psql $DATABASE_URL -f db/migrations/027_renormalize_entity_names.sql
-- The migration runner will then skip it (already in schema_migrations).
--
-- Regex note: \m = start-of-word, \M = end-of-word (PostgreSQL POSIX anchors).
-- These differ from JS \b at digit/letter boundaries — acceptable for entity names.
-- SQL cannot replicate JS normalize('NFD') diacritic stripping without the unaccent
-- extension. Known gap: diacritical names (e.g. "Société") normalize differently
-- via SQL vs TypeScript. Add unaccent in a follow-up migration if needed.

-- Step 1: Back up current values so we can roll back if needed.
-- DROP + CREATE (not IF NOT EXISTS) so re-runs always have fresh backup data.
DROP TABLE IF EXISTS _normalized_name_backup;
CREATE TABLE _normalized_name_backup AS SELECT id, normalized_name FROM entities;

DROP TABLE IF EXISTS _normalized_alias_backup;
CREATE TABLE _normalized_alias_backup AS SELECT id, normalized_alias FROM entity_aliases;

-- Step 2: Recompute entities.normalized_name (legal suffixes + generic industry words stripped)
-- Suffix list must match LEGAL_SUFFIXES in src/lib/server/normalize.ts.
UPDATE entities SET normalized_name = trim(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(name),
          -- Legal suffixes (sync with LEGAL_SUFFIXES in normalize.ts)
          '\m(sa|sarl|sas|srl|spa|sl|sc|se|sk|ltd|limited|inc|incorporated|corp|corporation|co|company|bv|nv|gmbh|ag|kg|ug|kgaa|pte|fze|fzco|fzc|llc|llp|lp|lllp|plc|as|asa|ab|oy|oyj|aps|sdn|bhd|pvt|jsc|ojsc|ooo|zao|pjsc|kft|nyrt|bt|ev|ek|hb|kb|nb|mb)\M\.?',
          ' ', 'gi'
        ),
        -- Generic industry words (sync with GENERIC_WORDS in normalize.ts)
        '\m(energy|trading|marine|maritime|shipping|petroleum|oil|gas|lng|lpg|commodities|cargo|logistics|services|solutions|resources|group|holdings|holding|international|management|investment|investments|capital|finance|financial|partners|partnership|ventures|venture|enterprise|enterprises)\M',
        ' ', 'gi'
      ),
      '[^a-z0-9\s]', ' ', 'gi'
    ),
    '\s+', ' ', 'g'
  )
);

-- Step 3: Recompute entity_aliases.normalized_alias (legal suffixes only, NOT generic words)
-- Aliases are often trade names / former names where generic words are distinctive.
UPDATE entity_aliases SET normalized_alias = trim(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(alias),
        '\m(sa|sarl|sas|srl|spa|sl|sc|se|sk|ltd|limited|inc|incorporated|corp|corporation|co|company|bv|nv|gmbh|ag|kg|ug|kgaa|pte|fze|fzco|fzc|llc|llp|lp|lllp|plc|as|asa|ab|oy|oyj|aps|sdn|bhd|pvt|jsc|ojsc|ooo|zao|pjsc|kft|nyrt|bt|ev|ek|hb|kb|nb|mb)\M\.?',
        ' ', 'gi'
      ),
      '[^a-z0-9\s]', ' ', 'gi'
    ),
    '\s+', ' ', 'g'
  )
);

-- Rollback instructions (run manually if needed):
-- UPDATE entities e SET normalized_name = b.normalized_name
--   FROM _normalized_name_backup b WHERE b.id = e.id;
-- UPDATE entity_aliases a SET normalized_alias = b.normalized_alias
--   FROM _normalized_alias_backup b WHERE b.id = a.id;
-- DROP TABLE IF EXISTS _normalized_name_backup;
-- DROP TABLE IF EXISTS _normalized_alias_backup;

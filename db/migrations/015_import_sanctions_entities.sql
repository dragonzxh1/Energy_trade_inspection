-- ── Migration 015: Bulk import OpenSanctions entities into entities table ────────
--
-- Sources:
--   Company (111,492), LegalEntity (70,787), Organization (18,303) → entity_type = 'company'
--   Vessel   (8,923)                                               → entity_type = 'vessel'
--
-- Slug strategy: 'os-' + name_slug + '-' + last 8 chars of id (guaranteed unique)
-- IMO strategy:  first occurrence per IMO number wins
-- All imported entities are sanction_status='listed', risk_level='critical'
--
-- Safe to run multiple times (ON CONFLICT (id) DO NOTHING).

INSERT INTO entities (
  id,
  entity_type,
  name,
  normalized_name,
  slug,
  imo,
  country,
  jurisdiction_flag,
  sanction_status,
  authenticity_score,
  risk_level,
  score_breakdown_json,
  metadata_json,
  data_source_json,
  last_verified
)
SELECT
  'os-' || s.id                                              AS id,
  CASE
    WHEN s.schema = 'Vessel' THEN 'vessel'
    ELSE 'company'
  END                                                        AS entity_type,
  s.name,
  lower(trim(s.name))                                        AS normalized_name,

  -- Unique slug: 'os-' + slugified name (max 40 chars) + '-' + first 10 chars of md5(id)
  'os-' ||
    left(regexp_replace(lower(trim(s.name)), '[^a-z0-9]+', '-', 'g'), 40) ||
    '-' || left(md5(s.id), 10)                               AS slug,

  -- IMO: only first occurrence per IMO number (dedup via ROW_NUMBER)
  CASE
    WHEN s.schema = 'Vessel'
      AND s.identifiers ~ 'IMO[0-9]+'
      AND ROW_NUMBER() OVER (
            PARTITION BY regexp_replace(s.identifiers, '.*IMO([0-9]+).*', '\1')
            ORDER BY s.id
          ) = 1
    THEN regexp_replace(s.identifiers, '.*IMO([0-9]+).*', '\1')
    ELSE NULL
  END                                                        AS imo,

  -- Country: first value from semicolon-separated list
  COALESCE(NULLIF(split_part(s.countries, ';', 1), ''), 'xx') AS country,
  COALESCE(NULLIF(split_part(s.countries, ';', 1), ''), 'xx') AS jurisdiction_flag,

  'listed'                                                   AS sanction_status,
  65                                                         AS authenticity_score,
  'critical'                                                 AS risk_level,

  jsonb_build_object(
    'sanctions',       100,
    'financial_crime',  80,
    'regulatory',       75
  )                                                          AS score_breakdown_json,

  jsonb_build_object(
    'dataset',      s.dataset,
    'schema',       s.schema,
    'identifiers',  s.identifiers,
    'sanctions',    s.sanctions
  )                                                          AS metadata_json,

  jsonb_build_array(
    jsonb_build_object(
      'source',  'opensanctions',
      'dataset', s.dataset
    )
  )                                                          AS data_source_json,

  COALESCE(s.last_change, NOW())                             AS last_verified

FROM sanctions_entries s
WHERE
  s.schema IN ('Company', 'LegalEntity', 'Organization', 'Vessel')
  AND s.name IS NOT NULL
  AND trim(s.name) != ''

ON CONFLICT (id) DO NOTHING;

-- Update stats
SELECT
  entity_type,
  COUNT(*) AS imported
FROM entities
WHERE id LIKE 'os-%'
GROUP BY entity_type
ORDER BY COUNT(*) DESC;

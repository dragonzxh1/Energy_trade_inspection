-- ── Migration 019: PSC data normalization + demo vessel seed data ─────────────

-- ── 1. Normalize result values ─────────────────────────────────────────────────
-- The sync-equasis script originally wrote 'clear' for no-deficiency results.
-- The app schema uses 'no_deficiency'. Normalise all historic records.

UPDATE psc_inspections
SET result = 'no_deficiency'
WHERE result = 'clear';

-- ── 2. Add CHECK constraint to prevent future mismatches ───────────────────────

ALTER TABLE psc_inspections
  DROP CONSTRAINT IF EXISTS psc_result_check;

ALTER TABLE psc_inspections
  ADD CONSTRAINT psc_result_check
    CHECK (result IN ('no_deficiency', 'deficiency', 'detained'));

-- ── 3. Seed PSC inspection data for demo vessels ───────────────────────────────

-- MT Nordic Star (IMO 9587234) — oil tanker, Flag: Marshall Islands
INSERT INTO psc_inspections
  (imo, vessel_name, inspection_date, port_locode, port_name, authority, result,
   deficiency_count, detention_days, deficiencies, source_url)
VALUES
  -- 2024
  ('9587234', 'MT Nordic Star', '2024-08-14', 'SGSIN', 'Singapore', 'Paris MOU',
   'no_deficiency', 0, NULL, '[]',
   'https://www.parismou.org/inspections-results/white-grey-black-lists'),

  ('9587234', 'MT Nordic Star', '2024-03-22', 'NLRTM', 'Rotterdam', 'Paris MOU',
   'deficiency', 2, NULL,
   '["Fire-fighting appliances and equipment", "ISM — Safety management"]',
   'https://www.parismou.org/inspections-results/white-grey-black-lists'),

  -- 2023
  ('9587234', 'MT Nordic Star', '2023-11-05', 'AEJEA', 'Fujairah', 'India MOU',
   'detained', 1, 1,
   '["Emergency fire pump", "Means of escape", "CO2 system"]',
   'https://www.parismou.org/inspections-results/white-grey-black-lists'),

  ('9587234', 'MT Nordic Star', '2023-06-18', 'SGSIN', 'Singapore', 'Tokyo MOU',
   'deficiency', 1, NULL,
   '["Working and living conditions"]',
   'https://www.tokyo-mou.org/inspections/'),

  -- 2022
  ('9587234', 'MT Nordic Star', '2022-09-30', 'DEHAM', 'Hamburg', 'Paris MOU',
   'no_deficiency', 0, NULL, '[]',
   'https://www.parismou.org/inspections-results/white-grey-black-lists'),

  ('9587234', 'MT Nordic Star', '2022-04-11', 'BEANR', 'Antwerp', 'Paris MOU',
   'deficiency', 1, NULL,
   '["Hull and associated equipment"]',
   'https://www.parismou.org/inspections-results/white-grey-black-lists'),

  -- 2021
  ('9587234', 'MT Nordic Star', '2021-12-03', 'NLRTM', 'Rotterdam', 'Paris MOU',
   'no_deficiency', 0, NULL, '[]',
   'https://www.parismou.org/inspections-results/white-grey-black-lists'),

  ('9587234', 'MT Nordic Star', '2021-07-19', 'SGSIN', 'Singapore', 'Tokyo MOU',
   'no_deficiency', 0, NULL, '[]',
   'https://www.tokyo-mou.org/inspections/'),

  -- 2020
  ('9587234', 'MT Nordic Star', '2020-10-27', 'GBSOU', 'Southampton', 'Paris MOU',
   'deficiency', 3, NULL,
   '["Propulsion and auxiliary machinery", "Mooring equipment", "Life saving appliances"]',
   'https://www.parismou.org/inspections-results/white-grey-black-lists')
ON CONFLICT DO NOTHING;


-- MT Petrovest Pioneer (IMO 9412847) — bulk carrier
INSERT INTO psc_inspections
  (imo, vessel_name, inspection_date, port_locode, port_name, authority, result,
   deficiency_count, detention_days, deficiencies, source_url)
VALUES
  ('9412847', 'MT Petrovest Pioneer', '2024-06-10', 'CNSHA', 'Shanghai', 'Tokyo MOU',
   'deficiency', 3, NULL,
   '["Cargo and cargo equipment", "ISM — Safety management", "Fire-fighting appliances and equipment"]',
   'https://www.tokyo-mou.org/inspections/'),

  ('9412847', 'MT Petrovest Pioneer', '2024-01-25', 'JPYOK', 'Yokohama', 'Tokyo MOU',
   'no_deficiency', 0, NULL, '[]',
   'https://www.tokyo-mou.org/inspections/'),

  ('9412847', 'MT Petrovest Pioneer', '2023-09-14', 'CNSHA', 'Shanghai', 'Tokyo MOU',
   'detained', 2, 2,
   '["SOLAS — Load Line", "Cargo and cargo equipment", "Structural condition"]',
   'https://www.tokyo-mou.org/inspections/'),

  ('9412847', 'MT Petrovest Pioneer', '2023-03-08', 'KRPUS', 'Busan', 'Tokyo MOU',
   'deficiency', 1, NULL,
   '["Navigational equipment"]',
   'https://www.tokyo-mou.org/inspections/'),

  ('9412847', 'MT Petrovest Pioneer', '2022-11-20', 'SGSIN', 'Singapore', 'Tokyo MOU',
   'no_deficiency', 0, NULL, '[]',
   'https://www.tokyo-mou.org/inspections/')
ON CONFLICT DO NOTHING;


-- MV Arabian Falcon (IMO 9234561) — LPG carrier
INSERT INTO psc_inspections
  (imo, vessel_name, inspection_date, port_locode, port_name, authority, result,
   deficiency_count, detention_days, deficiencies, source_url)
VALUES
  ('9234561', 'MV Arabian Falcon', '2024-09-03', 'AEJEA', 'Fujairah', 'India MOU',
   'no_deficiency', 0, NULL, '[]',
   'https://www.parismou.org/inspections-results/white-grey-black-lists'),

  ('9234561', 'MV Arabian Falcon', '2024-02-15', 'IQUBN', 'Umm Qasr', 'India MOU',
   'deficiency', 2, NULL,
   '["Fire-fighting appliances and equipment", "Life saving appliances"]',
   'https://www.parismou.org/inspections-results/white-grey-black-lists'),

  ('9234561', 'MV Arabian Falcon', '2023-07-28', 'SGSIN', 'Singapore', 'Tokyo MOU',
   'no_deficiency', 0, NULL, '[]',
   'https://www.tokyo-mou.org/inspections/')
ON CONFLICT DO NOTHING;

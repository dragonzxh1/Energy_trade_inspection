-- Realistic energy trade entities for demo and showcase
-- 12 companies + 8 vessels with varied sanction statuses, risk levels, and risk flags

-- ── Companies ─────────────────────────────────────────────────────────────────

-- 1. Petrovest Energy Ltd (Singapore) — not_listed, medium
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-002', 'company', 'Petrovest Energy Ltd.', 'petrovest energy',
  'petrovest-energy-ltd', '201923456B', 'Singapore', '🇸🇬',
  'not_listed', 63, 'medium',
  '{
    "entityExistence":    {"score": 16, "maxScore": 25},
    "assetReality":       {"score": 20, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 6,  "maxScore": 10},
    "communityReputation":{"score": 6,  "maxScore": 10}
  }'::jsonb,
  '{
    "website": "petrovest-energy.com",
    "incorporationDate": "2019-07-15",
    "registeredAddress": "10 Anson Road, #28-05, International Plaza, Singapore 079903",
    "directors": [
      {"id": "dir-p1", "name": "Li Wei", "role": "Managing Director", "nationality": "Chinese", "appointedDate": "2019-07-15"},
      {"id": "dir-p2", "name": "Sarah Tan Mei Ling", "role": "Director", "nationality": "Singaporean", "appointedDate": "2019-07-15"},
      {"id": "dir-p3", "name": "Ramesh Subramaniam", "role": "Independent Director", "nationality": "Indian", "appointedDate": "2021-01-10"}
    ]
  }'::jsonb,
  '["OpenSanctions", "ACRA Singapore"]'::jsonb,
  '2026-03-15T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- 2. Arabian Gulf Trading Co LLC (UAE) — listed, critical (OFAC)
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-003', 'company', 'Arabian Gulf Trading Co LLC', 'arabian gulf trading co',
  'arabian-gulf-trading', 'AE-DXB-2018-04521', 'United Arab Emirates', '🇦🇪',
  'listed', 22, 'critical',
  '{
    "entityExistence":    {"score": 8,  "maxScore": 25},
    "assetReality":       {"score": 6,  "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 2,  "maxScore": 10},
    "communityReputation":{"score": 1,  "maxScore": 10}
  }'::jsonb,
  '{
    "website": "arabian-gulf-trading.ae",
    "incorporationDate": "2018-03-22",
    "registeredAddress": "Jumeirah Lakes Towers, Cluster T, Office 1204, Dubai, UAE",
    "directors": [
      {"id": "dir-ag1", "name": "Hamid Al-Rashidi", "role": "Managing Director", "nationality": "Emirati", "appointedDate": "2018-03-22"},
      {"id": "dir-ag2", "name": "Omar Samir Khalil", "role": "Director", "nationality": "Syrian", "appointedDate": "2018-03-22"}
    ]
  }'::jsonb,
  '["OpenSanctions", "OFAC SDN List", "UN Consolidated List"]'::jsonb,
  '2026-03-20T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- 3. Nordex Maritime Holdings Ltd (Cyprus) — not_listed, low
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-004', 'company', 'Nordex Maritime Holdings Ltd', 'nordex maritime holdings',
  'nordex-maritime-holdings', 'HE 387241', 'Cyprus', '🇨🇾',
  'not_listed', 80, 'low',
  '{
    "entityExistence":    {"score": 22, "maxScore": 25},
    "assetReality":       {"score": 26, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 8,  "maxScore": 10},
    "communityReputation":{"score": 8,  "maxScore": 10}
  }'::jsonb,
  '{
    "incorporationDate": "2011-04-08",
    "registeredAddress": "Arch. Makarios III Ave 195, Limassol, CY-3030, Cyprus",
    "directors": [
      {"id": "dir-nm1", "name": "Andreas Stavros Konstantinou", "role": "Chairman", "nationality": "Cypriot", "appointedDate": "2011-04-08"},
      {"id": "dir-nm2", "name": "Emma Nielsen", "role": "Director", "nationality": "Danish", "appointedDate": "2014-06-01"},
      {"id": "dir-nm3", "name": "Georgios Papadimitriou", "role": "Secretary", "nationality": "Cypriot", "appointedDate": "2011-04-08"}
    ]
  }'::jsonb,
  '["OpenSanctions", "EU FSF", "VesselFinder"]'::jsonb,
  '2026-03-28T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- 4. Shahriar Energy Group FZE (UAE shell, Iranian-linked) — listed, critical
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-005', 'company', 'Shahriar Energy Group FZE', 'shahriar energy group',
  'shahriar-energy-group', 'AE-JAFZA-2016-00891', 'United Arab Emirates', '🇦🇪',
  'listed', 12, 'critical',
  '{
    "entityExistence":    {"score": 4,  "maxScore": 25},
    "assetReality":       {"score": 3,  "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 2,  "maxScore": 10},
    "communityReputation":{"score": 0,  "maxScore": 10}
  }'::jsonb,
  '{
    "incorporationDate": "2016-09-14",
    "registeredAddress": "Jebel Ali Free Zone, PO Box 261872, Dubai, UAE",
    "directors": [
      {"id": "dir-se1", "name": "Javad Shahriari", "role": "General Manager", "nationality": "Iranian", "appointedDate": "2016-09-14"},
      {"id": "dir-se2", "name": "Mohammed Al-Khatib", "role": "Director", "nationality": "Syrian", "appointedDate": "2016-09-14"}
    ]
  }'::jsonb,
  '["OpenSanctions", "OFAC SDN List", "EU FSF", "UN Consolidated List"]'::jsonb,
  '2026-02-10T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- 5. Pacific Bulk Carriers Pte Ltd (Singapore) — not_listed, low
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-006', 'company', 'Pacific Bulk Carriers Pte Ltd', 'pacific bulk carriers',
  'pacific-bulk-carriers', '200819872K', 'Singapore', '🇸🇬',
  'not_listed', 85, 'low',
  '{
    "entityExistence":    {"score": 24, "maxScore": 25},
    "assetReality":       {"score": 28, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 9,  "maxScore": 10},
    "communityReputation":{"score": 9,  "maxScore": 10}
  }'::jsonb,
  '{
    "incorporationDate": "2008-05-20",
    "registeredAddress": "80 Raffles Place, #32-01, UOB Plaza 1, Singapore 048624",
    "directors": [
      {"id": "dir-pb1", "name": "James Lim Kok Chuan", "role": "Chief Executive Officer", "nationality": "Singaporean", "appointedDate": "2008-05-20"},
      {"id": "dir-pb2", "name": "Priya Krishnamurthy", "role": "Chief Financial Officer", "nationality": "Indian", "appointedDate": "2010-03-01"},
      {"id": "dir-pb3", "name": "David Wee Boon Huat", "role": "Director", "nationality": "Singaporean", "appointedDate": "2008-05-20"}
    ]
  }'::jsonb,
  '["OpenSanctions", "ACRA Singapore", "Paris MOU"]'::jsonb,
  '2026-04-01T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- 6. Crestwave Marine Ltd (Marshall Islands) — unknown, high
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-007', 'company', 'Crestwave Marine Ltd', 'crestwave marine',
  'crestwave-marine-ltd', 'MHL-2019-78237', 'Marshall Islands', '🇲🇭',
  'unknown', 40, 'high',
  '{
    "entityExistence":    {"score": 10, "maxScore": 25},
    "assetReality":       {"score": 12, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 4,  "maxScore": 10},
    "communityReputation":{"score": 3,  "maxScore": 10}
  }'::jsonb,
  '{
    "website": "crestwave-marine.com",
    "incorporationDate": "2019-02-14",
    "registeredAddress": "Trust Company Complex, Ajeltake Road, Majuro, MH 96960",
    "directors": [
      {"id": "dir-cw1", "name": "Registered Agent (Nominee)", "role": "Director", "nationality": "Unknown", "appointedDate": "2019-02-14"}
    ]
  }'::jsonb,
  '["OpenSanctions"]'::jsonb,
  '2026-01-15T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- 7. Vostok Petroleum Corp (Russia) — listed, critical (EU FSF)
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-008', 'company', 'Vostok Petroleum Corp', 'vostok petroleum corp',
  'vostok-petroleum-corp', 'RU 7712345678', 'Russia', '🇷🇺',
  'listed', 28, 'critical',
  '{
    "entityExistence":    {"score": 10, "maxScore": 25},
    "assetReality":       {"score": 8,  "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 3,  "maxScore": 10},
    "communityReputation":{"score": 2,  "maxScore": 10}
  }'::jsonb,
  '{
    "incorporationDate": "2004-11-03",
    "registeredAddress": "Leninsky Prospekt 38, Moscow, 119334, Russia",
    "directors": [
      {"id": "dir-vp1", "name": "Dmitry Alexandrovich Volkov", "role": "General Director", "nationality": "Russian", "appointedDate": "2004-11-03"},
      {"id": "dir-vp2", "name": "Igor Petrov", "role": "Deputy Director", "nationality": "Russian", "appointedDate": "2008-07-22"}
    ]
  }'::jsonb,
  '["OpenSanctions", "EU FSF", "OFAC SDN List"]'::jsonb,
  '2026-03-01T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- 8. Meridian Commodities FZE (UAE/Sharjah) — not_listed, medium
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-009', 'company', 'Meridian Commodities FZE', 'meridian commodities',
  'meridian-commodities-fze', 'AE-SHJ-2020-08877', 'United Arab Emirates', '🇦🇪',
  'not_listed', 60, 'medium',
  '{
    "entityExistence":    {"score": 15, "maxScore": 25},
    "assetReality":       {"score": 19, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 6,  "maxScore": 10},
    "communityReputation":{"score": 5,  "maxScore": 10}
  }'::jsonb,
  '{
    "incorporationDate": "2020-01-08",
    "registeredAddress": "Hamriyah Free Zone, Block A, Office 714, Sharjah, UAE",
    "directors": [
      {"id": "dir-mc1", "name": "Rashid Al-Hamdan", "role": "Managing Director", "nationality": "Emirati", "appointedDate": "2020-01-08"},
      {"id": "dir-mc2", "name": "Prashant Mehta", "role": "Operations Director", "nationality": "Indian", "appointedDate": "2020-01-08"}
    ]
  }'::jsonb,
  '["OpenSanctions", "EU FSF"]'::jsonb,
  '2026-03-10T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- 9. Torbjorn Shipping AS (Norway) — not_listed, low
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-010', 'company', 'Torbjorn Shipping AS', 'torbjorn shipping',
  'torbjorn-shipping-as', 'NO 924567890', 'Norway', '🇳🇴',
  'not_listed', 91, 'low',
  '{
    "entityExistence":    {"score": 25, "maxScore": 25},
    "assetReality":       {"score": 29, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 10, "maxScore": 10},
    "communityReputation":{"score": 9,  "maxScore": 10}
  }'::jsonb,
  '{
    "incorporationDate": "1998-03-12",
    "registeredAddress": "Bryggegata 7, 0250 Oslo, Norway",
    "directors": [
      {"id": "dir-ts1", "name": "Lars Erik Torbjorn", "role": "Chief Executive Officer", "nationality": "Norwegian", "appointedDate": "1998-03-12"},
      {"id": "dir-ts2", "name": "Ingrid Haaland", "role": "Chief Operating Officer", "nationality": "Norwegian", "appointedDate": "2003-06-01"},
      {"id": "dir-ts3", "name": "Kristoffer Moe", "role": "Independent Director", "nationality": "Norwegian", "appointedDate": "2015-01-15"}
    ]
  }'::jsonb,
  '["OpenSanctions", "EU FSF", "Paris MOU", "IMO GISIS"]'::jsonb,
  '2026-04-02T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- 10. Atlas Bunkering Corp (Liberia) — unknown, high
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-011', 'company', 'Atlas Bunkering Corp', 'atlas bunkering corp',
  'atlas-bunkering-corp', 'LR-2017-BKR-05512', 'Liberia', '🇱🇷',
  'unknown', 43, 'high',
  '{
    "entityExistence":    {"score": 11, "maxScore": 25},
    "assetReality":       {"score": 14, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 4,  "maxScore": 10},
    "communityReputation":{"score": 3,  "maxScore": 10}
  }'::jsonb,
  '{
    "incorporationDate": "2017-08-29",
    "registeredAddress": "80 Broad Street, Monrovia, Liberia",
    "directors": [
      {"id": "dir-ab1", "name": "Registered Agent (Anonymous Nominee)", "role": "Director", "nationality": "Unknown", "appointedDate": "2017-08-29"}
    ]
  }'::jsonb,
  '["OpenSanctions"]'::jsonb,
  '2025-12-01T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- 11. Solaris LNG Partners Ltd (Bermuda) — not_listed, medium
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-012', 'company', 'Solaris LNG Partners Ltd', 'solaris lng partners',
  'solaris-lng-partners', 'BM-2019-SLP-33441', 'Bermuda', '🇧🇲',
  'not_listed', 57, 'medium',
  '{
    "entityExistence":    {"score": 14, "maxScore": 25},
    "assetReality":       {"score": 18, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 6,  "maxScore": 10},
    "communityReputation":{"score": 5,  "maxScore": 10}
  }'::jsonb,
  '{
    "incorporationDate": "2019-11-05",
    "registeredAddress": "Canon''s Court, 22 Victoria Street, Hamilton HM 12, Bermuda",
    "directors": [
      {"id": "dir-sl1", "name": "Robert Chen", "role": "Managing Director", "nationality": "Bermudian", "appointedDate": "2019-11-05"},
      {"id": "dir-sl2", "name": "Sofia Papadopoulos", "role": "Director", "nationality": "Greek", "appointedDate": "2019-11-05"}
    ]
  }'::jsonb,
  '["OpenSanctions", "EU FSF"]'::jsonb,
  '2026-02-20T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- 12. Straits Trading HK Ltd (Hong Kong) — not_listed, medium
INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'co-013', 'company', 'Straits Trading HK Ltd', 'straits trading hk',
  'straits-trading-hk', 'HK 2946821', 'Hong Kong', '🇭🇰',
  'not_listed', 64, 'medium',
  '{
    "entityExistence":    {"score": 17, "maxScore": 25},
    "assetReality":       {"score": 21, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 7,  "maxScore": 10},
    "communityReputation":{"score": 6,  "maxScore": 10}
  }'::jsonb,
  '{
    "incorporationDate": "2015-08-17",
    "registeredAddress": "Suite 2204, Two Pacific Place, 88 Queensway, Hong Kong",
    "directors": [
      {"id": "dir-st1", "name": "Kevin Leung Ka-Ming", "role": "Managing Director", "nationality": "Hong Konger", "appointedDate": "2015-08-17"},
      {"id": "dir-st2", "name": "Mei Lin Zhang", "role": "Director", "nationality": "Chinese", "appointedDate": "2015-08-17"},
      {"id": "dir-st3", "name": "Raymond Kwok", "role": "Non-Executive Director", "nationality": "Hong Konger", "appointedDate": "2018-03-01"}
    ]
  }'::jsonb,
  '["OpenSanctions", "EU FSF"]'::jsonb,
  '2026-03-25T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;


-- ── Vessels ──────────────────────────────────────────────────────────────────

-- V1. MT Petrovest Pioneer (Panama) — not_listed, medium; owned by Petrovest Energy
INSERT INTO entities (
  id, entity_type, name, normalized_name, imo,
  country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'vessel-002', 'vessel', 'MT Petrovest Pioneer', 'mt petrovest pioneer', '9412847',
  'Panama', '🇵🇦',
  'not_listed', 68, 'medium',
  '{
    "entityExistence":    {"score": 19, "maxScore": 25},
    "assetReality":       {"score": 24, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 7,  "maxScore": 10},
    "communityReputation":{"score": 6,  "maxScore": 10}
  }'::jsonb,
  '{
    "flag": "Panama",
    "vesselType": "Oil Tanker",
    "grossTonnage": 78000,
    "yearBuilt": 2016,
    "mmsi": "351456789",
    "currentOperator": "Petrovest Shipping Services",
    "ownerCompanySlug": "petrovest-energy-ltd"
  }'::jsonb,
  '["IMO GISIS", "OpenSanctions", "VesselFinder"]'::jsonb,
  '2026-03-15T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- V2. MV Arabian Falcon (Marshall Islands) — listed, critical; owned by Arabian Gulf Trading
INSERT INTO entities (
  id, entity_type, name, normalized_name, imo,
  country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'vessel-003', 'vessel', 'MV Arabian Falcon', 'mv arabian falcon', '9234561',
  'Marshall Islands', '🇲🇭',
  'listed', 20, 'critical',
  '{
    "entityExistence":    {"score": 7,  "maxScore": 25},
    "assetReality":       {"score": 6,  "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 3,  "maxScore": 10},
    "communityReputation":{"score": 1,  "maxScore": 10}
  }'::jsonb,
  '{
    "flag": "Marshall Islands",
    "vesselType": "Product Tanker",
    "grossTonnage": 52000,
    "yearBuilt": 2012,
    "mmsi": "538089234",
    "currentOperator": "Arabian Gulf Trading Co LLC",
    "ownerCompanySlug": "arabian-gulf-trading"
  }'::jsonb,
  '["IMO GISIS", "OpenSanctions", "OFAC SDN List"]'::jsonb,
  '2026-03-20T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- V3. MT Nordic Star (Norway) — not_listed, low; owned by Torbjorn Shipping
INSERT INTO entities (
  id, entity_type, name, normalized_name, imo,
  country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'vessel-004', 'vessel', 'MT Nordic Star', 'mt nordic star', '9587234',
  'Norway', '🇳🇴',
  'not_listed', 89, 'low',
  '{
    "entityExistence":    {"score": 24, "maxScore": 25},
    "assetReality":       {"score": 28, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 9,  "maxScore": 10},
    "communityReputation":{"score": 9,  "maxScore": 10}
  }'::jsonb,
  '{
    "flag": "Norway",
    "vesselType": "LNG Carrier",
    "grossTonnage": 165000,
    "yearBuilt": 2019,
    "mmsi": "257843691",
    "currentOperator": "Torbjorn Shipping AS",
    "ownerCompanySlug": "torbjorn-shipping-as"
  }'::jsonb,
  '["IMO GISIS", "Paris MOU", "OpenSanctions", "VesselFinder"]'::jsonb,
  '2026-04-02T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- V4. MT Vostok Voyager (St. Kitts flag) — listed, critical; owned by Vostok Petroleum
INSERT INTO entities (
  id, entity_type, name, normalized_name, imo,
  country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'vessel-005', 'vessel', 'MT Vostok Voyager', 'mt vostok voyager', '9167823',
  'Saint Kitts and Nevis', '🇰🇳',
  'listed', 25, 'critical',
  '{
    "entityExistence":    {"score": 9,  "maxScore": 25},
    "assetReality":       {"score": 8,  "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 3,  "maxScore": 10},
    "communityReputation":{"score": 2,  "maxScore": 10}
  }'::jsonb,
  '{
    "flag": "Saint Kitts and Nevis",
    "vesselType": "Crude Oil Tanker",
    "grossTonnage": 120000,
    "yearBuilt": 2008,
    "mmsi": "341789345",
    "currentOperator": "Vostok Petroleum Corp",
    "ownerCompanySlug": "vostok-petroleum-corp"
  }'::jsonb,
  '["IMO GISIS", "OpenSanctions", "EU FSF", "OFAC SDN List"]'::jsonb,
  '2026-03-01T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- V5. MV Pacific Champion (Singapore) — not_listed, low; owned by Pacific Bulk Carriers
INSERT INTO entities (
  id, entity_type, name, normalized_name, imo,
  country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'vessel-006', 'vessel', 'MV Pacific Champion', 'mv pacific champion', '9345678',
  'Singapore', '🇸🇬',
  'not_listed', 83, 'low',
  '{
    "entityExistence":    {"score": 23, "maxScore": 25},
    "assetReality":       {"score": 27, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 9,  "maxScore": 10},
    "communityReputation":{"score": 8,  "maxScore": 10}
  }'::jsonb,
  '{
    "flag": "Singapore",
    "vesselType": "Bulk Carrier",
    "grossTonnage": 38000,
    "yearBuilt": 2017,
    "mmsi": "564271893",
    "currentOperator": "Pacific Bulk Carriers Pte Ltd",
    "ownerCompanySlug": "pacific-bulk-carriers"
  }'::jsonb,
  '["IMO GISIS", "Paris MOU", "OpenSanctions"]'::jsonb,
  '2026-04-01T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- V6. MT Crestwave Atlas (Cameroon flag) — unknown, high; owned by Crestwave Marine
INSERT INTO entities (
  id, entity_type, name, normalized_name, imo,
  country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'vessel-007', 'vessel', 'MT Crestwave Atlas', 'mt crestwave atlas', '9089213',
  'Cameroon', '🇨🇲',
  'unknown', 38, 'high',
  '{
    "entityExistence":    {"score": 10, "maxScore": 25},
    "assetReality":       {"score": 12, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 4,  "maxScore": 10},
    "communityReputation":{"score": 3,  "maxScore": 10}
  }'::jsonb,
  '{
    "flag": "Cameroon",
    "vesselType": "Oil Tanker",
    "grossTonnage": 28000,
    "yearBuilt": 2005,
    "mmsi": "613047832",
    "currentOperator": "Atlas Marine Management",
    "ownerCompanySlug": "crestwave-marine-ltd"
  }'::jsonb,
  '["IMO GISIS", "OpenSanctions"]'::jsonb,
  '2026-01-15T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- V7. MT Shahriar Star (Comoros flag) — listed, critical; owned by Shahriar Energy Group
INSERT INTO entities (
  id, entity_type, name, normalized_name, imo,
  country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'vessel-008', 'vessel', 'MT Shahriar Star', 'mt shahriar star', '9456321',
  'Comoros', '🇰🇲',
  'listed', 10, 'critical',
  '{
    "entityExistence":    {"score": 3,  "maxScore": 25},
    "assetReality":       {"score": 3,  "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 1,  "maxScore": 10},
    "communityReputation":{"score": 0,  "maxScore": 10}
  }'::jsonb,
  '{
    "flag": "Comoros",
    "vesselType": "VLCC",
    "grossTonnage": 290000,
    "yearBuilt": 2004,
    "mmsi": "620789234",
    "currentOperator": "Shahriar Energy Group FZE",
    "ownerCompanySlug": "shahriar-energy-group"
  }'::jsonb,
  '["IMO GISIS", "OpenSanctions", "OFAC SDN List", "UN Consolidated List"]'::jsonb,
  '2026-02-10T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;

-- V8. MV Straits Harmony (Bahamas) — not_listed, medium; owned by Straits Trading HK
INSERT INTO entities (
  id, entity_type, name, normalized_name, imo,
  country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json, last_verified
) VALUES (
  'vessel-009', 'vessel', 'MV Straits Harmony', 'mv straits harmony', '9523741',
  'Bahamas', '🇧🇸',
  'not_listed', 62, 'medium',
  '{
    "entityExistence":    {"score": 16, "maxScore": 25},
    "assetReality":       {"score": 20, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 7,  "maxScore": 10},
    "communityReputation":{"score": 6,  "maxScore": 10}
  }'::jsonb,
  '{
    "flag": "Bahamas",
    "vesselType": "Container Vessel",
    "grossTonnage": 42000,
    "yearBuilt": 2018,
    "mmsi": "308453671",
    "currentOperator": "Straits Trading HK Ltd",
    "ownerCompanySlug": "straits-trading-hk"
  }'::jsonb,
  '["IMO GISIS", "OpenSanctions", "VesselFinder"]'::jsonb,
  '2026-03-25T00:00:00Z'
) ON CONFLICT (id) DO NOTHING;


-- ── Risk flags (approved — visible on entity pages) ───────────────────────────

-- Arabian Gulf Trading Co — 2 critical/high flags
INSERT INTO risk_flags (id, entity_id, flag_type, severity, status, description, submitted_at, approved_at)
VALUES
  ('rf-001', 'co-003', 'AIS Signal Manipulation', 'critical', 'approved',
   'Vessel affiliated with this company detected disabling AIS transponder during cargo transfers in international waters.',
   '2026-01-12T08:30:00Z', '2026-01-15T14:00:00Z'),
  ('rf-002', 'co-003', 'Cargo Misrepresentation', 'high', 'approved',
   'Shipping documents linked to this entity show discrepancies between declared cargo type and satellite imagery analysis.',
   '2025-11-04T11:00:00Z', '2025-11-10T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Shahriar Energy Group — 2 critical flags
INSERT INTO risk_flags (id, entity_id, flag_type, severity, status, description, submitted_at, approved_at)
VALUES
  ('rf-003', 'co-005', 'OFAC-Designated Entity', 'critical', 'approved',
   'Entity designated under OFAC Iran-related sanctions program (EO 13846). Direct engagement may expose counterparties to secondary sanctions.',
   '2022-08-20T00:00:00Z', '2022-08-22T12:00:00Z'),
  ('rf-004', 'co-005', 'Sanctions Evasion Network', 'critical', 'approved',
   'Entity identified as part of a multi-jurisdiction network used to obscure Iranian crude oil exports. Front companies identified in UAE, Hong Kong, and Malaysia.',
   '2024-03-15T09:00:00Z', '2024-03-18T16:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Vostok Petroleum Corp — critical + high flags
INSERT INTO risk_flags (id, entity_id, flag_type, severity, status, description, submitted_at, approved_at)
VALUES
  ('rf-005', 'co-008', 'EU FSF Sanctions Designation', 'critical', 'approved',
   'Listed on EU Financial Sanctions File in connection with Russian energy sector sanctions (Reg. 833/2014 as amended). EU counterparties prohibited from transacting.',
   '2022-03-02T00:00:00Z', '2022-03-03T08:00:00Z'),
  ('rf-006', 'co-008', 'Beneficial Ownership Opacity', 'high', 'approved',
   'Ultimate beneficial owner not disclosed. Shell structure identified across 4 jurisdictions. Flagged by FATF for potential sanctions circumvention.',
   '2023-06-10T14:00:00Z', '2023-06-14T11:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Crestwave Marine Ltd — high flag
INSERT INTO risk_flags (id, entity_id, flag_type, severity, status, description, submitted_at, approved_at)
VALUES
  ('rf-007', 'co-007', 'AIS Dark Operations', 'high', 'approved',
   'Vessels operated by this company exhibit frequent AIS blackouts exceeding 72 hours in the Persian Gulf and Red Sea regions.',
   '2025-09-03T10:00:00Z', '2025-09-08T15:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Atlas Bunkering Corp — high flag
INSERT INTO risk_flags (id, entity_id, flag_type, severity, status, description, submitted_at, approved_at)
VALUES
  ('rf-008', 'co-011', 'Beneficial Ownership Concealment', 'high', 'approved',
   'Company registered via anonymous nominee director structure in Liberia. No verifiable beneficial ownership chain. Shell indicators consistent with high-risk bunkering operations.',
   '2025-07-22T09:30:00Z', '2025-07-28T13:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- MV Arabian Falcon (vessel) — high flag
INSERT INTO risk_flags (id, entity_id, flag_type, severity, status, description, submitted_at, approved_at)
VALUES
  ('rf-009', 'vessel-003', 'Ship-to-Ship Transfer Activity', 'high', 'approved',
   'Satellite imagery confirms multiple ship-to-ship transfers of petroleum products at sea without port state notification. Consistent with sanctions evasion methodology.',
   '2026-02-14T07:00:00Z', '2026-02-18T10:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- MT Vostok Voyager (vessel) — critical flag
INSERT INTO risk_flags (id, entity_id, flag_type, severity, status, description, submitted_at, approved_at)
VALUES
  ('rf-010', 'vessel-005', 'Flag State Switching', 'critical', 'approved',
   'Vessel has changed flag state 3 times in 18 months (Russia → Cambodia → Saint Kitts and Nevis), a pattern consistent with sanctions evasion. AIS spoofing incidents recorded.',
   '2023-11-08T12:00:00Z', '2023-11-15T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- MT Crestwave Atlas (vessel) — high flag
INSERT INTO risk_flags (id, entity_id, flag_type, severity, status, description, submitted_at, approved_at)
VALUES
  ('rf-011', 'vessel-007', 'Extended AIS Blackout', 'high', 'approved',
   'Vessel went dark on AIS for 14 days while transiting the Strait of Hormuz. Last known position before blackout: 28 nautical miles from Iranian territorial waters.',
   '2025-10-19T06:00:00Z', '2025-10-25T14:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- MT Shahriar Star (vessel) — critical + high flags
INSERT INTO risk_flags (id, entity_id, flag_type, severity, status, description, submitted_at, approved_at)
VALUES
  ('rf-012', 'vessel-008', 'Deceptive Shipping Practices', 'critical', 'approved',
   'VLCC engaged in confirmed deceptive shipping practices: falsified port calls, spoofed AIS identity, and documented cargo obscuration for Iranian crude oil exports.',
   '2024-07-01T00:00:00Z', '2024-07-05T10:00:00Z'),
  ('rf-013', 'vessel-008', 'OFAC-Listed Vessel', 'critical', 'approved',
   'Vessel identified as beneficial property of OFAC-designated entity Shahriar Energy Group FZE. All U.S.-nexus transactions involving this vessel are prohibited.',
   '2024-07-01T00:00:00Z', '2024-07-05T10:00:00Z')
ON CONFLICT (id) DO NOTHING;


-- ── Entity aliases (fuzzy search) ─────────────────────────────────────────────

INSERT INTO entity_aliases (entity_id, alias, normalized_alias) VALUES
  ('co-002', 'Petrovest Energy',         'petrovest energy'),
  ('co-002', 'Petrovest Singapore',      'petrovest singapore'),
  ('co-003', 'Arabian Gulf Trading',     'arabian gulf trading'),
  ('co-003', 'AGTC',                     'agtc'),
  ('co-004', 'Nordex Maritime',          'nordex maritime'),
  ('co-004', 'Nordex Holdings',          'nordex holdings'),
  ('co-005', 'Shahriar Energy',          'shahriar energy'),
  ('co-005', 'SEG FZE',                  'seg fze'),
  ('co-006', 'Pacific Bulk Carriers',    'pacific bulk carriers'),
  ('co-006', 'PBC Singapore',            'pbc singapore'),
  ('co-007', 'Crestwave Marine',         'crestwave marine'),
  ('co-008', 'Vostok Petroleum',         'vostok petroleum'),
  ('co-008', 'Vostok Corp',              'vostok corp'),
  ('co-009', 'Meridian Commodities',     'meridian commodities'),
  ('co-009', 'Meridian FZE',             'meridian fze'),
  ('co-010', 'Torbjorn Shipping',        'torbjorn shipping'),
  ('co-010', 'Torbjørn Shipping',        'torbjorn shipping'),
  ('co-011', 'Atlas Bunkering',          'atlas bunkering'),
  ('co-012', 'Solaris LNG',              'solaris lng'),
  ('co-013', 'Straits Trading',          'straits trading'),
  ('co-013', 'Straits HK',              'straits hk'),
  ('vessel-002', 'Petrovest Pioneer',    'petrovest pioneer'),
  ('vessel-003', 'Arabian Falcon',       'arabian falcon'),
  ('vessel-004', 'Nordic Star',          'nordic star'),
  ('vessel-005', 'Vostok Voyager',       'vostok voyager'),
  ('vessel-006', 'Pacific Champion',     'pacific champion'),
  ('vessel-007', 'Crestwave Atlas',      'crestwave atlas'),
  ('vessel-008', 'Shahriar Star',        'shahriar star'),
  ('vessel-009', 'Straits Harmony',      'straits harmony')
ON CONFLICT DO NOTHING;

-- Demo seed data for development and showcase purposes

INSERT INTO entities (
  id, entity_type, name, normalized_name, slug,
  registration_number, country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json,
  last_verified
)
VALUES (
  'demo-001',
  'company',
  'Demo Trading Co. Ltd.',
  'demo trading co',
  'demo-trading-co',
  '202012345A',
  'Singapore',
  '🇸🇬',
  'not_listed',
  55,
  'medium',
  '{
    "entityExistence":    {"score": 18, "maxScore": 25},
    "assetReality":       {"score": 22, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 7,  "maxScore": 10},
    "communityReputation":{"score": 8,  "maxScore": 10}
  }'::jsonb,
  '{
    "incorporationDate": "2020-06-01",
    "registeredAddress": "1 Raffles Place, #20-01, Singapore 048616",
    "directors": [
      {"id": "dir-001", "name": "Jane Chen", "role": "Director", "nationality": "Singaporean", "appointedDate": "2020-06-01"},
      {"id": "dir-002", "name": "Ahmad Bin Yusof", "role": "Director", "nationality": "Malaysian", "appointedDate": "2021-03-15"}
    ]
  }'::jsonb,
  '["OpenSanctions", "ACRA Singapore"]'::jsonb,
  '2026-04-01T00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO entities (
  id, entity_type, name, normalized_name, imo,
  country, jurisdiction_flag,
  sanction_status, authenticity_score, risk_level,
  score_breakdown_json, metadata_json, data_source_json,
  last_verified
)
VALUES (
  'vessel-001',
  'vessel',
  'MV Demo Tanker',
  'mv demo tanker',
  '9999999',
  'Panama',
  '🇵🇦',
  'not_listed',
  72,
  'medium',
  '{
    "entityExistence":    {"score": 22, "maxScore": 25},
    "assetReality":       {"score": 26, "maxScore": 30},
    "tradingTrackRecord": {"score": 0,  "maxScore": 25, "phase2Pending": true},
    "documentConsistency":{"score": 8,  "maxScore": 10},
    "communityReputation":{"score": 7,  "maxScore": 10}
  }'::jsonb,
  '{
    "flag": "Panama",
    "vesselType": "Oil Tanker",
    "grossTonnage": 45000,
    "yearBuilt": 2015,
    "mmsi": "352001234",
    "currentOperator": "Demo Shipping Pte Ltd",
    "ownerCompanySlug": "demo-trading-co"
  }'::jsonb,
  '["IMO GISIS", "Paris MOU", "OpenSanctions"]'::jsonb,
  '2026-04-01T00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

-- Aliases for fuzzy search
INSERT INTO entity_aliases (entity_id, alias, normalized_alias)
VALUES
  ('demo-001', 'Demo Trading', 'demo trading'),
  ('demo-001', 'DTC Singapore', 'dtc singapore'),
  ('vessel-001', 'Demo Tanker', 'demo tanker')
ON CONFLICT DO NOTHING;

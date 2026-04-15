-- Update demo company to include associated vessel in metadata
UPDATE entities
SET metadata_json = metadata_json || '{
  "vessels": [
    {"imo": "9999999", "name": "MV Demo Tanker", "flag": "Panama"}
  ]
}'::jsonb
WHERE id = 'demo-001';

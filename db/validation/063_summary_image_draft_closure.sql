SELECT count(*) AS invalid_summary_hashes
FROM summary_publication_states
WHERE source_sha256 IS NOT NULL
  AND source_sha256 !~ '^[A-Fa-f0-9]{64}$';

SELECT count(*) AS duplicate_summary_source_hashes
FROM (
  SELECT source_sha256
  FROM summary_publication_states
  WHERE source_sha256 IS NOT NULL
  GROUP BY source_sha256
  HAVING count(*) > 1
) duplicates;

SELECT count(*) AS duplicate_summary_idempotency_keys
FROM (
  SELECT idempotency_key
  FROM summary_publication_states
  WHERE idempotency_key IS NOT NULL
  GROUP BY idempotency_key
  HAVING count(*) > 1
) duplicates;

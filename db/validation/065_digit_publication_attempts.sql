SELECT COUNT(*) AS duplicate_attempts
FROM (
  SELECT run_id, publication_key
  FROM digit_publication_attempts
  GROUP BY run_id, publication_key
  HAVING COUNT(*) > 1
) duplicates;

SELECT COUNT(*) AS missing_run_identity
FROM digit_publication_attempts
WHERE nullif(btrim(run_id), '') IS NULL
   OR nullif(btrim(publication_key), '') IS NULL;

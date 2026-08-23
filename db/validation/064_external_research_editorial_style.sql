SELECT count(*) AS invalid_external_source_documents
FROM source_documents
WHERE (source_origin = 'external_web' AND (source_url IS NULL OR retrieved_at IS NULL))
   OR (source_origin = 'telegram' AND attachment_id IS NULL);

SELECT count(*) AS duplicate_source_dossier_versions
FROM (
  SELECT source_document_id, schema_version
  FROM source_dossiers
  GROUP BY source_document_id, schema_version
  HAVING count(*) > 1
) duplicates;

SELECT count(*) AS invalid_external_evidence_hashes
FROM external_evidence_candidates
WHERE content_hash !~ '^[A-Fa-f0-9]{64}$'
   OR evidence_text_hash !~ '^[A-Fa-f0-9]{64}$';

SELECT count(*) AS publishable_tier_three_evidence
FROM external_evidence_candidates
WHERE source_tier = 3 AND verification_status = 'verified';

SELECT count(*) AS unresolved_publishable_claims
FROM editorial_claim_ledger
WHERE claim_type = 'unresolved' AND publishable = true;

SELECT count(*) AS invalid_story_brief_claim_bindings
FROM story_briefs brief
WHERE brief.validation_status = 'pass'
  AND COALESCE(jsonb_array_length(brief.brief_json->'new_information'), 0) = 0;

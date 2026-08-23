DROP TABLE IF EXISTS story_briefs;
DROP TABLE IF EXISTS editorial_claim_ledger;
DROP TABLE IF EXISTS external_evidence_candidates;
DROP TABLE IF EXISTS external_research_runs;

DELETE FROM source_documents
WHERE source_origin = 'external_web';

DROP INDEX IF EXISTS uq_source_documents_external_url_version;
ALTER TABLE source_documents
  DROP COLUMN IF EXISTS retrieved_at,
  DROP COLUMN IF EXISTS source_url,
  DROP COLUMN IF EXISTS source_origin;

DROP INDEX IF EXISTS uq_source_dossiers_document_schema;
DELETE FROM source_dossiers newer
USING source_dossiers older
WHERE newer.source_document_id = older.source_document_id
  AND (
    newer.created_at < older.created_at
    OR (newer.created_at = older.created_at AND newer.id < older.id)
  );
ALTER TABLE source_dossiers
  ADD CONSTRAINT source_dossiers_source_document_id_key UNIQUE (source_document_id);

ALTER TABLE source_documents ALTER COLUMN attachment_id SET NOT NULL;

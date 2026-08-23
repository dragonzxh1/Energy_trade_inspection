BEGIN;

DROP TABLE IF EXISTS parsed_tables;
DROP TABLE IF EXISTS document_sections;
DROP TABLE IF EXISTS source_documents;

ALTER TABLE processing_runs
  DROP CONSTRAINT IF EXISTS processing_runs_processing_status_check;
ALTER TABLE processing_runs
  ADD CONSTRAINT processing_runs_processing_status_check
  CHECK (processing_status IN ('received', 'downloaded', 'adapted', 'failed', 'needs_review'));

DELETE FROM schema_migrations WHERE filename = '047_source_documents.sql';

COMMIT;

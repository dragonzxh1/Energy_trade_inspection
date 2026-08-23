SELECT 'duplicate_source_documents' AS check_name, count(*) AS failures
FROM (
  SELECT attachment_id, parser_version
  FROM source_documents
  GROUP BY attachment_id, parser_version
  HAVING count(*) > 1
) duplicates
UNION ALL
SELECT 'duplicate_section_indexes', count(*)
FROM (
  SELECT source_document_id, section_index
  FROM document_sections
  GROUP BY source_document_id, section_index
  HAVING count(*) > 1
) duplicates
UNION ALL
SELECT 'duplicate_table_indexes', count(*)
FROM (
  SELECT source_document_id, table_index
  FROM parsed_tables
  GROUP BY source_document_id, table_index
  HAVING count(*) > 1
) duplicates
UNION ALL
SELECT 'orphan_sections', count(*)
FROM document_sections section
LEFT JOIN source_documents document ON document.id = section.source_document_id
WHERE document.id IS NULL
UNION ALL
SELECT 'orphan_tables', count(*)
FROM parsed_tables parsed_table
LEFT JOIN source_documents document ON document.id = parsed_table.source_document_id
WHERE document.id IS NULL
UNION ALL
SELECT 'review_flag_mismatch', count(*)
FROM source_documents
WHERE needs_review <> (processing_status <> 'parsed');

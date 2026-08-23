UPDATE document_sections section
SET section_text=record.original_anchor_text,updated_at=now()
FROM section_merge_records record
WHERE record.anchor_section_id=section.id AND record.active;

UPDATE document_sections section
SET fact_extraction_status=CASE WHEN length(trim(section.section_text))<80 THEN 'skipped' ELSE 'pending' END,
    fact_extraction_reason_code=CASE WHEN length(trim(section.section_text))<80 THEN 'SKIPPED_TOO_SHORT' ELSE NULL END,
    updated_at=now()
WHERE section.fact_extraction_reason_code='SKIPPED_MERGED'
  AND section.fact_extraction_attempts=0;

DROP TABLE IF EXISTS section_merge_records;

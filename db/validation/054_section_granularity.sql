SELECT 'duplicate_merge_anchors',count(*) FROM (
  SELECT anchor_section_id FROM section_merge_records WHERE active GROUP BY anchor_section_id HAVING count(*)>1
) duplicate;
SELECT 'merged_hash_mismatch',count(*) FROM section_merge_records
WHERE encode(digest(merged_text,'sha256'),'hex')<>lower(merged_text_hash);
SELECT 'active_merge_text_mismatch',count(*) FROM section_merge_records record
JOIN document_sections section ON section.id=record.anchor_section_id
WHERE record.active AND section.section_text<>record.merged_text;
SELECT 'merged_member_not_skipped',count(*) FROM section_merge_records record
JOIN LATERAL jsonb_array_elements_text(record.member_section_ids) member(id) ON true
JOIN document_sections section ON section.id=member.id::uuid
WHERE record.active AND section.id<>record.anchor_section_id
  AND section.fact_extraction_reason_code<>'SKIPPED_MERGED';

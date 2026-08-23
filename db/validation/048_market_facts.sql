SELECT 'duplicate_fact_hashes' AS check_name, count(*) AS failures
FROM (
  SELECT fact_hash FROM market_facts GROUP BY fact_hash HAVING count(*) > 1
) duplicates
UNION ALL
SELECT 'orphan_fact_sources', count(*)
FROM market_facts fact
LEFT JOIN source_documents document ON document.id = fact.source_document_id
LEFT JOIN document_sections section ON section.id = fact.document_section_id
WHERE document.id IS NULL OR section.id IS NULL
UNION ALL
SELECT 'fact_section_mismatch', count(*)
FROM market_facts fact
JOIN document_sections section ON section.id = fact.document_section_id
JOIN source_documents document ON document.id = section.source_document_id
WHERE document.id <> fact.source_document_id
   OR document.source_id <> fact.source_id
   OR section.section_id <> fact.section_id
UNION ALL
SELECT 'numeric_fact_without_unit', count(*)
FROM market_facts WHERE value IS NOT NULL AND unit IS NULL
UNION ALL
SELECT 'price_without_fact', count(*)
FROM market_prices price
LEFT JOIN market_facts fact ON fact.id = price.market_fact_id
WHERE fact.id IS NULL
UNION ALL
SELECT 'duplicate_processing_steps', count(*)
FROM (
  SELECT processing_run_id, step_key
  FROM processing_steps
  GROUP BY processing_run_id, step_key
  HAVING count(*) > 1
) duplicates;

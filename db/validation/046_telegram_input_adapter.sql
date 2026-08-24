SELECT 'duplicate_messages' AS check_name, count(*) AS failures
FROM (
  SELECT source_channel, telegram_message_id
  FROM telegram_messages
  GROUP BY source_channel, telegram_message_id
  HAVING count(*) > 1
) duplicates
UNION ALL
SELECT 'duplicate_file_hashes', count(*)
FROM (
  SELECT file_hash
  FROM telegram_attachments
  GROUP BY file_hash
  HAVING count(*) > 1
) duplicates
UNION ALL
SELECT 'orphan_message_attachments', count(*)
FROM telegram_message_attachments link
LEFT JOIN telegram_messages message ON message.id = link.message_id
LEFT JOIN telegram_attachments attachment ON attachment.id = link.attachment_id
WHERE message.id IS NULL OR attachment.id IS NULL
UNION ALL
SELECT 'orphan_processing_runs', count(*)
FROM processing_runs run
LEFT JOIN telegram_attachments attachment ON attachment.id = run.attachment_id
WHERE attachment.id IS NULL;

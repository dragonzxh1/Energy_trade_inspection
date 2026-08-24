BEGIN;

DROP TABLE IF EXISTS processing_runs;
DROP TABLE IF EXISTS telegram_message_attachments;
DROP TABLE IF EXISTS telegram_attachments;
DROP TABLE IF EXISTS telegram_messages;

DELETE FROM schema_migrations
WHERE filename = '046_telegram_input_adapter.sql';

COMMIT;

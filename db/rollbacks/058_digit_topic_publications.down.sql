BEGIN;
DROP TABLE IF EXISTS digit_topic_publications;
DELETE FROM schema_migrations WHERE filename = '058_digit_topic_publications.sql';
COMMIT;

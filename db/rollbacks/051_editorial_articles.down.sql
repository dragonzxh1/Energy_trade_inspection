BEGIN;
DROP TABLE IF EXISTS published_articles;
DROP TABLE IF EXISTS editorial_views;
DELETE FROM schema_migrations WHERE filename = '051_editorial_articles.sql';
COMMIT;

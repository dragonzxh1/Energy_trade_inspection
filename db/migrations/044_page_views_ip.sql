-- 044_page_views_ip.sql
-- Store raw IP and country (geo-location) for admin visibility.

ALTER TABLE page_views ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS country TEXT;

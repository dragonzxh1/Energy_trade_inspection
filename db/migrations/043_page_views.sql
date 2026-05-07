-- 043_page_views.sql
-- Tracks page views for admin dashboard analytics.
-- SHA-256(ip) for privacy; composite index for dedup queries.

CREATE TABLE IF NOT EXISTS page_views (
  id BIGSERIAL PRIMARY KEY,
  path TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_ip_path ON page_views(ip_hash, path, created_at);

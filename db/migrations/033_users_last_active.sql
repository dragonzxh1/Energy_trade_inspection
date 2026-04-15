-- 033_users_last_active.sql
-- Adds last_active_at column to users table.
-- Updated by consumeQuota() each time a user makes a quota-consuming query.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at);

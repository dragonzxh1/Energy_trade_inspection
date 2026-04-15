-- Add email/password authentication support
-- password_hash: bcrypt hash, NULL for OAuth-only users
-- normalized_email: canonicalized email for abuse detection (Gmail dot/plus normalization)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS normalized_email TEXT;

-- Unique index on normalized_email prevents plus-addressing and dot-trick abuse
-- Partial index: only enforced when normalized_email is not null (OAuth users don't have it)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_normalized_email
  ON users (normalized_email)
  WHERE normalized_email IS NOT NULL;

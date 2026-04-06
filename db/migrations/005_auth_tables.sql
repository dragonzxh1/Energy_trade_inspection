-- NextAuth v5 (@auth/pg-adapter) required tables
-- Ref: https://authjs.dev/getting-started/adapters/pg

-- Users table (core identity)
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name           TEXT,
  email          TEXT UNIQUE,
  email_verified TIMESTAMPTZ,
  image          TEXT,
  plan           TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free','starter','professional','enterprise')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OAuth accounts linked to users
CREATE TABLE IF NOT EXISTS accounts (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,
  provider            TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token       TEXT,
  access_token        TEXT,
  expires_at          BIGINT,
  token_type          TEXT,
  scope               TEXT,
  id_token            TEXT,
  session_state       TEXT,
  UNIQUE (provider, provider_account_id)
);

-- Session tokens (database sessions strategy)
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  session_token TEXT UNIQUE NOT NULL,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires       TIMESTAMPTZ NOT NULL
);

-- Email verification tokens (magic link / email OTP)
CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT NOT NULL,
  token      TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token   ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);

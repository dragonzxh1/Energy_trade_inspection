-- NextAuth v5 (@auth/pg-adapter) required tables
-- Column names match adapter expectations exactly (camelCase quoted where needed)

-- Users table (emailVerified must be camelCase quoted)
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name            TEXT,
  email           TEXT UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  image           TEXT,
  plan            TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free','starter','professional','enterprise')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OAuth accounts (userId and providerAccountId must be camelCase quoted)
CREATE TABLE IF NOT EXISTS accounts (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId"             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                 TEXT NOT NULL,
  provider             TEXT NOT NULL,
  "providerAccountId"  TEXT NOT NULL,
  refresh_token        TEXT,
  access_token         TEXT,
  expires_at           BIGINT,
  token_type           TEXT,
  scope                TEXT,
  id_token             TEXT,
  session_state        TEXT,
  UNIQUE (provider, "providerAccountId")
);

-- Sessions (sessionToken and userId must be camelCase quoted)
CREATE TABLE IF NOT EXISTS sessions (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sessionToken" TEXT UNIQUE NOT NULL,
  "userId"       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires        TIMESTAMPTZ NOT NULL
);

-- Verification tokens (table name is singular: verification_token)
CREATE TABLE IF NOT EXISTS verification_token (
  identifier TEXT NOT NULL,
  token      TEXT NOT NULL,
  expires    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE INDEX IF NOT EXISTS idx_accounts_userId   ON accounts("userId");
CREATE INDEX IF NOT EXISTS idx_sessions_userId   ON sessions("userId");
CREATE INDEX IF NOT EXISTS idx_sessions_token    ON sessions("sessionToken");
CREATE INDEX IF NOT EXISTS idx_users_email       ON users(email);

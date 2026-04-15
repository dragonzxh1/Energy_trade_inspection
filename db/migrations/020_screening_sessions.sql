-- Screening sessions: stores document screening results for PDF download
CREATE TABLE IF NOT EXISTS screening_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_screening_user
  ON screening_sessions(user_id, created_at DESC);

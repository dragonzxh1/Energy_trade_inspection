-- Trade check sessions: persist results for PDF download and audit trail
CREATE TABLE IF NOT EXISTS trade_sessions (
  id           TEXT        PRIMARY KEY,
  user_id      TEXT        NOT NULL REFERENCES users(id),
  input_json   JSONB       NOT NULL,
  result_json  JSONB       NOT NULL,
  overall_risk TEXT        NOT NULL CHECK (overall_risk IN ('low', 'medium', 'high', 'critical')),
  flag_count   INT         NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_sessions_user
  ON trade_sessions(user_id, created_at DESC);

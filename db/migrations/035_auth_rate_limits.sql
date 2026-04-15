-- Rate limiting table for auth actions (registration, password reset)
-- Tracks attempt counts per IP per hour to prevent abuse

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  ip           TEXT         NOT NULL,
  action       TEXT         NOT NULL,   -- 'register' | 'forgot-password'
  window_start TIMESTAMPTZ  NOT NULL,   -- truncated to the hour
  count        INT          NOT NULL DEFAULT 1,
  PRIMARY KEY (ip, action, window_start)
);

-- Clean up old windows automatically (optional: cron cleanup)
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_window
  ON auth_rate_limits (window_start);

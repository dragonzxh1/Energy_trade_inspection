-- Migration 018: watchlist alerts + terminal support + live status tracking

-- 1. Expand entity_type constraint to include 'terminal'
ALTER TABLE watchlist DROP CONSTRAINT IF EXISTS watchlist_entity_type_check;
ALTER TABLE watchlist ADD CONSTRAINT watchlist_entity_type_check
  CHECK (entity_type IN ('company', 'vessel', 'terminal'));

-- 2. Track the most recently confirmed sanction status (vs. the snapshot at add-time)
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS current_sanction_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ;

-- Seed current_sanction_status from initial snapshot
UPDATE watchlist SET current_sanction_status = sanction_status
  WHERE current_sanction_status = 'unknown';

-- 3. Alert log: records every detected status change per user-entity pair
CREATE TABLE IF NOT EXISTS watchlist_alerts (
  id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id    TEXT        NOT NULL,
  entity_name  TEXT        NOT NULL,
  entity_type  TEXT        NOT NULL,
  entity_key   TEXT        NOT NULL,
  alert_type   TEXT        NOT NULL DEFAULT 'sanction_status_change',
  old_value    TEXT,
  new_value    TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_watchlist_alerts_user   ON watchlist_alerts (user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_alerts_unread ON watchlist_alerts (user_id)
  WHERE read_at IS NULL;

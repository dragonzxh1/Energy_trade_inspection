-- Watchlist: users can watch companies/vessels for sanction status changes
CREATE TABLE IF NOT EXISTS watchlist (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id      TEXT NOT NULL,
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('company', 'vessel')),
  entity_key     TEXT NOT NULL,   -- slug for company, imo for vessel
  entity_name    TEXT NOT NULL,
  sanction_status TEXT NOT NULL DEFAULT 'unknown',
  added_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_user   ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_entity ON watchlist(entity_id);

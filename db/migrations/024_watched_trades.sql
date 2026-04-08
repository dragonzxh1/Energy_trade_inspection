-- Watched trade patterns: users can monitor a seller+vessel pair for risk changes.
CREATE TABLE IF NOT EXISTS watched_trades (
  id                     TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_name            TEXT NOT NULL,
  vessel_name            TEXT NOT NULL,
  vessel_imo             TEXT,
  loading_port           TEXT,
  trade_date             TEXT,
  -- Risk snapshot at save time (and updated on each refresh)
  last_overall_risk      TEXT NOT NULL DEFAULT 'low',
  last_flag_count        INTEGER NOT NULL DEFAULT 0,
  last_seller_sanctioned BOOLEAN NOT NULL DEFAULT FALSE,
  last_vessel_sanctioned BOOLEAN NOT NULL DEFAULT FALSE,
  last_psc_detentions    INTEGER,
  last_checked_at        TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, seller_name, vessel_name)
);

CREATE INDEX IF NOT EXISTS idx_watched_trades_user ON watched_trades(user_id);

-- Alerts generated when a watched trade's risk profile changes.
CREATE TABLE IF NOT EXISTS watched_trade_alerts (
  id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  watched_trade_id TEXT NOT NULL REFERENCES watched_trades(id) ON DELETE CASCADE,
  -- alert_type: 'sanction_exposure' | 'psc_detention' | 'risk_escalation'
  alert_type       TEXT NOT NULL,
  detail           TEXT NOT NULL,
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watched_trade_alerts_user  ON watched_trade_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_watched_trade_alerts_trade ON watched_trade_alerts(watched_trade_id);

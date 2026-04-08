-- Trade events: records verified trade interactions between entities.
-- Written by POST /api/trade after a successful trade check.
-- Powers the tradingTrackRecord (Phase 2) dimension of the authenticity score.

CREATE TABLE IF NOT EXISTS trade_events (
  id                TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  entity_id         TEXT        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  counterparty_name TEXT        NOT NULL,
  counterparty_id   TEXT        REFERENCES entities(id) ON DELETE SET NULL,
  vessel_imo        TEXT,
  event_date        DATE,
  commodity         TEXT,
  port_locode       TEXT,
  source            TEXT        NOT NULL DEFAULT 'trade_check',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_events_entity ON trade_events(entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_events_vessel  ON trade_events(vessel_imo);

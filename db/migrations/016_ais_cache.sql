-- AIS position cache
-- Avoids repeated VesselAPI + aisstream WebSocket calls for the same vessel.
-- TTL is set per-row based on nav status (moving = 10min, stopped = 45min).
-- Future: append-mode can turn this into a historical position log.

CREATE TABLE IF NOT EXISTS ais_cache (
  imo         TEXT        PRIMARY KEY,
  mmsi        TEXT,
  data_json   JSONB       NOT NULL,
  provider    TEXT        NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS ais_cache_expires_at ON ais_cache (expires_at);

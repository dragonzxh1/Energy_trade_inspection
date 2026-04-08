-- Session TTL cleanup policy: sessions older than 90 days are eligible for deletion.
-- The existing composite index on (user_id, created_at DESC) is not efficient for
-- cleanup queries that filter only on created_at. Add a dedicated index.

CREATE INDEX IF NOT EXISTS idx_screening_sessions_created_at
  ON screening_sessions(created_at);

CREATE INDEX IF NOT EXISTS idx_trade_sessions_created_at
  ON trade_sessions(created_at);

-- Cleanup query (run by /api/cron/cleanup or piggybacked on writes):
--   DELETE FROM screening_sessions WHERE created_at < NOW() - INTERVAL '90 days';
--   DELETE FROM trade_sessions     WHERE created_at < NOW() - INTERVAL '90 days';

import { db } from './db'

// Max attempts per IP per window
const LIMITS: Record<string, number> = {
  register:         5,
  'forgot-password': 5,
}

/**
 * Check and increment rate limit for an IP + action.
 * Returns true if the action is allowed, false if the limit is exceeded.
 * Window is 1 hour, tracked in the auth_rate_limits table.
 */
export async function checkRateLimit(ip: string, action: string): Promise<boolean> {
  const limit = LIMITS[action] ?? 5

  const { rows } = await db.query<{ count: number }>(
    `INSERT INTO auth_rate_limits (ip, action, window_start, count)
     VALUES ($1, $2, date_trunc('hour', NOW()), 1)
     ON CONFLICT (ip, action, window_start) DO UPDATE
       SET count = auth_rate_limits.count + 1
     RETURNING count`,
    [ip, action]
  )

  return (rows[0]?.count ?? 1) <= limit
}

/** Periodic cleanup: remove entries older than 24 hours. Run from cron. */
export async function cleanupRateLimits(): Promise<void> {
  await db.query(
    `DELETE FROM auth_rate_limits WHERE window_start < NOW() - INTERVAL '24 hours'`
  )
}

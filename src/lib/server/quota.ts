/**
 * Query quota system
 * Free: 5 queries/month
 * Starter: 100 queries/month
 * Professional: unlimited
 * Enterprise: unlimited
 */

import { db } from './db'
import { getPeriodBounds } from './repository'

const PLAN_LIMITS: Record<string, number> = {
  free:         5,
  starter:      100,
  professional: Infinity,
  enterprise:   Infinity,
}

export const UNLIMITED_QUOTA = -1

export interface QuotaStatus {
  used:       number
  limit:      number
  remaining:  number
  blocked:    boolean
  resetDate:  string   // ISO date YYYY-MM-DD
}

/**
 * Get current quota usage for a user in the current billing period.
 * Returns null if userId is not provided (unauthenticated).
 */
export async function getQuotaStatus(
  userId: string,
  plan: string
): Promise<QuotaStatus> {
  const { start, end } = getPeriodBounds()
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

  if (!isFinite(limit)) {
    return { used: 0, limit: UNLIMITED_QUOTA, remaining: UNLIMITED_QUOTA, blocked: false, resetDate: end }
  }

  const { rows } = await db.query<{ query_count: number }>(
    `SELECT query_count FROM user_query_usage
     WHERE user_id = $1 AND period_start = $2`,
    [userId, start]
  )

  const used = rows[0]?.query_count ?? 0
  const remaining = Math.max(0, limit - used)

  return {
    used,
    limit,
    remaining,
    blocked:   used >= limit,
    resetDate: end,
  }
}

/**
 * Consume one query from the user's quota.
 * Returns the updated QuotaStatus.
 * Throws if the user is already at the limit.
 */
export async function consumeQuota(
  userId: string,
  plan: string,
  entityId?: string,
  queryText?: string
): Promise<QuotaStatus> {
  const { start, end } = getPeriodBounds()
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free

  // Unlimited plans — just log, don't check
  if (!isFinite(limit)) {
    await logQuery(userId, entityId, queryText, 'full')
    return { used: 0, limit: UNLIMITED_QUOTA, remaining: UNLIMITED_QUOTA, blocked: false, resetDate: end }
  }

  // Upsert usage row
  const { rows } = await db.query<{ query_count: number }>(
    `INSERT INTO user_query_usage (user_id, period_start, period_end, query_count, quota_limit)
     VALUES ($1, $2, $3, 1, $4)
     ON CONFLICT (user_id, period_start) DO UPDATE
       SET query_count = user_query_usage.query_count + 1,
           last_query_at = NOW()
     RETURNING query_count`,
    [userId, start, end, limit]
  )

  const used = rows[0]?.query_count ?? 1
  const remaining = Math.max(0, limit - used)
  const blocked = used > limit  // Over limit after increment

  await logQuery(userId, entityId, queryText, blocked ? 'blocked' : 'full')

  return { used, limit, remaining, blocked, resetDate: end }
}

async function logQuery(
  userId: string,
  entityId?: string,
  queryText?: string,
  resultType: 'full' | 'limited' | 'blocked' = 'full'
) {
  await db.query(
    `INSERT INTO query_log (id, user_id, entity_id, query_text, result_type)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4)`,
    [userId, entityId ?? null, queryText ?? null, resultType]
  ).catch(() => {}) // Non-critical — don't block the response
}

/** Quota status for unauthenticated users (treated as anonymous free) */
export function guestQuotaStatus(): QuotaStatus {
  return {
    used:      0,
    limit:     5,
    remaining: 5,
    blocked:   false,
    resetDate: getPeriodBounds().end,
  }
}

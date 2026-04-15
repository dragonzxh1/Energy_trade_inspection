/**
 * Fraud alert lookup.
 *
 * Queries fraud_alerts using pg_trgm fuzzy matching — same approach as
 * sanctions.ts but separate because fraud != sanctions:
 *
 *   Sanctions: government-imposed restrictions — affects trade legality.
 *   Fraud:     industry-reported scam/impersonation — affects counterparty trust.
 *
 * The source_name and source_url fields are always returned so the caller can
 * present verifiable references to the user (traceability requirement).
 */

import { db } from '@/lib/server/db'
import { normalizeEntityName } from '@/lib/server/normalize'

export interface FraudAlert {
  source: string
  source_name: string
  source_url: string
  company_name: string
  list_type: 'blacklist' | 'whitelist'
  fraud_type: string | null
  description: string | null
  scam_url: string | null
}

export interface FraudCheckResult {
  /** True if found on any blacklist. */
  flagged: boolean
  /** True if found on a verified whitelist (e.g., Rotterdam Port Whitelist). */
  whitelisted: boolean
  /** All matching fraud alerts (includes both blacklist and whitelist). */
  alerts: FraudAlert[]
}

const SIMILARITY_THRESHOLD = 0.45  // same threshold as entity search

export async function checkFraudAlerts(
  name: string
): Promise<FraudCheckResult> {
  const empty: FraudCheckResult = { flagged: false, whitelisted: false, alerts: [] }

  if (!name || name.trim().length < 2) return empty

  const normalized = normalizeEntityName(name, true)
  if (!normalized || normalized.length < 2) return empty

  try {
    const { rows } = await db.query<FraudAlert & { sim: number }>(
      `SELECT
         source,
         source_name,
         source_url,
         company_name,
         list_type,
         fraud_type,
         description,
         scam_url,
         GREATEST(
           similarity(normalized_name, $1),
           word_similarity($1, normalized_name)
         ) AS sim
       FROM fraud_alerts
       WHERE
         normalized_name % $1
         OR $1 %> normalized_name
       ORDER BY sim DESC
       LIMIT 10`,
      [normalized]
    )

    const hits = rows.filter((r) => r.sim >= SIMILARITY_THRESHOLD)
    if (hits.length === 0) return empty

    const alerts: FraudAlert[] = hits.map(({ sim: _sim, ...r }) => r)
    const flagged = alerts.some((a) => a.list_type === 'blacklist')
    const whitelisted = alerts.some((a) => a.list_type === 'whitelist')

    return { flagged, whitelisted, alerts }
  } catch {
    // Never block main flow on fraud lookup failure
    return empty
  }
}

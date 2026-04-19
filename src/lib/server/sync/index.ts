/**
 * Data sync orchestrator.
 * Manages all external data source sync tasks.
 */

import { syncOFAC } from './ofac'
import { syncFraudAlerts, syncFraudSource, getFraudSyncStatus } from './fraud-alerts'
import { syncLegitDomains } from './legitimate-domains'
import { syncRegulatoryWarnings } from './regulatory-warnings'
import { syncLeiDelta, syncLeiLevel2, syncLeiLevel2Full, syncLeiExceptions, syncLeiExceptionsFull } from './gleif-golden-copy'
import { syncHKCRFull } from './hkcr'
import { db } from '@/lib/server/db'

export type SyncSource =
  | 'ofac'
  | 'fraud'
  | 'legitdomains'
  | 'warninglists'
  | 'gleif'
  | 'gleif:full'
  | 'gleif:delta'
  | 'gleif:level2'
  | 'gleif:level2:full'
  | 'gleif:exceptions'
  | 'gleif:exceptions:full'
  | 'sanctions-gleif-link'
  | 'hkcr:full'
  | 'all'

export interface SyncResult {
  source: string
  success: boolean
  count?: number
  error?: string
  durationMs: number
}

export async function runSync(source: SyncSource): Promise<SyncResult[]> {
  const results: SyncResult[] = []

  if (source === 'ofac' || source === 'all') {
    const start = Date.now()
    try {
      const { count } = await syncOFAC()
      results.push({
        source: 'ofac',
        success: true,
        count,
        durationMs: Date.now() - start,
      })
    } catch (err) {
      results.push({
        source: 'ofac',
        success: false,
        error: String(err),
        durationMs: Date.now() - start,
      })
    }
  }

  if (source === 'fraud' || source === 'all') {
    const fraudResults = await syncFraudAlerts()
    for (const r of fraudResults) {
      results.push({
        source: `fraud:${r.source}`,
        success: !r.error,
        count: r.count,
        error: r.error,
        durationMs: r.durationMs,
      })
    }
  }

  if (source === 'legitdomains' || source === 'all') {
    const start = Date.now()
    try {
      const r = await syncLegitDomains()
      results.push({
        source: 'legitdomains',
        success: true,
        count: r.total,
        durationMs: Date.now() - start,
      })
    } catch (err) {
      results.push({
        source: 'legitdomains',
        success: false,
        error: String(err),
        durationMs: Date.now() - start,
      })
    }
  }

  if (source === 'warninglists' || source === 'all') {
    const warnResults = await syncRegulatoryWarnings()
    for (const r of warnResults) {
      results.push({
        source: `warn:${r.source}`,
        success: !r.error,
        count: r.count,
        error: r.error,
        durationMs: r.durationMs,
      })
    }
  }

  if (source === 'gleif:delta') {
    const start = Date.now()
    try {
      const { count } = await syncLeiDelta()
      results.push({ source: 'gleif:delta', success: true, count, durationMs: Date.now() - start })
    } catch (err) {
      results.push({ source: 'gleif:delta', success: false, error: String(err), durationMs: Date.now() - start })
    }
  }

  if (source === 'gleif:level2') {
    const start = Date.now()
    try {
      const { count } = await syncLeiLevel2()
      results.push({ source: 'gleif:level2', success: true, count, durationMs: Date.now() - start })
    } catch (err) {
      results.push({ source: 'gleif:level2', success: false, error: String(err), durationMs: Date.now() - start })
    }
  }

  if (source === 'gleif:exceptions') {
    const start = Date.now()
    try {
      const { count } = await syncLeiExceptions()
      results.push({ source: 'gleif:exceptions', success: true, count, durationMs: Date.now() - start })
    } catch (err) {
      results.push({ source: 'gleif:exceptions', success: false, error: String(err), durationMs: Date.now() - start })
    }
  }

  if (source === 'gleif:level2:full') {
    const start = Date.now()
    try {
      const { count } = await syncLeiLevel2Full()
      results.push({ source: 'gleif:level2:full', success: true, count, durationMs: Date.now() - start })
    } catch (err) {
      results.push({ source: 'gleif:level2:full', success: false, error: String(err), durationMs: Date.now() - start })
    }
  }

  if (source === 'gleif:exceptions:full') {
    const start = Date.now()
    try {
      const { count } = await syncLeiExceptionsFull()
      results.push({ source: 'gleif:exceptions:full', success: true, count, durationMs: Date.now() - start })
    } catch (err) {
      results.push({ source: 'gleif:exceptions:full', success: false, error: String(err), durationMs: Date.now() - start })
    }
  }

  if (source === 'sanctions-gleif-link') {
    const start = Date.now()
    try {
      const { linked, skipped } = await linkSanctionsToGleif()
      results.push({
        source: 'sanctions-gleif-link',
        success: true,
        count: linked,
        durationMs: Date.now() - start,
        error: skipped > 0 ? `${skipped} entities skipped (ambiguous matches)` : undefined,
      })
    } catch (err) {
      results.push({
        source: 'sanctions-gleif-link',
        success: false,
        error: String(err),
        durationMs: Date.now() - start,
      })
    }
  }

  if (source === 'hkcr:full') {
    const start = Date.now()
    try {
      const { inserted, errors } = await syncHKCRFull()
      results.push({
        source: 'hkcr:full',
        success: errors === 0,
        count: inserted,
        durationMs: Date.now() - start,
        error: errors > 0 ? `${errors} files failed` : undefined,
      })
    } catch (err) {
      results.push({
        source: 'hkcr:full',
        success: false,
        error: String(err),
        durationMs: Date.now() - start,
      })
    }
  }

  return results
}

/**
 * Link sanctions entities in the `entities` table to their GLEIF LEI in `lei_cache`.
 *
 * For each entity where `lei IS NULL`, searches `lei_cache` by name similarity
 * (threshold 0.6) within the same jurisdiction/country.  Updates `entities.lei`
 * only when there is a single unambiguous match (multiple candidates are skipped
 * to avoid false positives).
 *
 * This enables:
 *   - Ultimate-parent chain traversal without live GLEIF API calls
 *   - Detecting when a trade counterparty's parent is on a sanctions list
 *
 * Trigger via: POST /api/admin/sync { source: 'sanctions-gleif-link' }
 */
export async function linkSanctionsToGleif(): Promise<{ linked: number; skipped: number }> {
  // Fetch all unlinked company entities (vessels don't have LEI)
  const { rows: unlinked } = await db.query<{
    id: string
    name: string
    country: string
  }>(
    `SELECT id, name, country
     FROM entities
     WHERE lei IS NULL
       AND entity_type = 'company'
     ORDER BY id`,
  )

  let linked = 0
  let skipped = 0

  for (const entity of unlinked) {
    try {
      // Use the entity name directly (no normalization — lei_cache stores legal names)
      const countryCode = entity.country.slice(0, 2).toUpperCase()

      const { rows: candidates } = await db.query<{ lei: string; similarity: number }>(
        `SELECT lei, SIMILARITY(legal_name, $1) AS similarity
         FROM lei_cache
         WHERE SIMILARITY(legal_name, $1) > 0.6
           AND entity_status = 'ACTIVE'
           AND (
             jurisdiction = $2
             OR country    = $2
           )
         ORDER BY similarity DESC
         LIMIT 2`,
        [entity.name, countryCode],
      )

      if (candidates.length === 1) {
        // Single high-confidence match — safe to link
        await db.query(`UPDATE entities SET lei = $1 WHERE id = $2`, [
          candidates[0].lei,
          entity.id,
        ])
        linked++
      } else {
        // 0 matches or ambiguous (2+ candidates) — skip to avoid false positives
        skipped++
      }
    } catch {
      skipped++
    }
  }

  return { linked, skipped }
}

/** Sync a single fraud alert source by key (e.g. 'storagespoofing'). */
export async function runFraudSourceSync(fraudSource: string): Promise<SyncResult> {
  const r = await syncFraudSource(fraudSource)
  return {
    source: `fraud:${r.source}`,
    success: !r.error,
    count: r.count,
    error: r.error,
    durationMs: r.durationMs,
  }
}

/** Query last sync status for all data sources. */
export async function getSyncStatus() {
  const { db } = await import('@/lib/server/db')

  const [{ rows: sanctionRows }, fraudRows] = await Promise.all([
    db.query(`
      SELECT DISTINCT ON (source)
        source,
        synced_at,
        status,
        record_count,
        error_message,
        duration_ms
      FROM sanctions_sync_log
      ORDER BY source, synced_at DESC
    `),
    getFraudSyncStatus(),
  ])

  // Tag fraud rows with a 'fraud:' prefix so consumers can distinguish them
  const taggedFraudRows = fraudRows.map((r: Record<string, unknown>) => ({
    ...r,
    source: `fraud:${r.source}`,
  }))

  return [...sanctionRows, ...taggedFraudRows]
}

/**
 * Data sync orchestrator.
 * Manages all external data source sync tasks.
 */

import { syncOFAC } from './ofac'
import { syncFraudAlerts, syncFraudSource, getFraudSyncStatus } from './fraud-alerts'
import { syncLegitDomains } from './legitimate-domains'
import { syncRegulatoryWarnings } from './regulatory-warnings'

export type SyncSource = 'ofac' | 'fraud' | 'legitdomains' | 'warninglists' | 'all'

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

  return results
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

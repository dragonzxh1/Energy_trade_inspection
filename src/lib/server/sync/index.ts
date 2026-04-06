/**
 * 数据同步编排器
 * 统一管理所有外部数据源的同步任务
 */

import { syncOFAC } from './ofac'

export type SyncSource = 'ofac' | 'all'

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

  return results
}

/** 查询上次各数据源的同步状态 */
export async function getSyncStatus() {
  const { db } = await import('@/lib/server/db')

  const { rows } = await db.query(`
    SELECT DISTINCT ON (source)
      source,
      synced_at,
      status,
      record_count,
      error_message,
      duration_ms
    FROM sanctions_sync_log
    ORDER BY source, synced_at DESC
  `)

  return rows
}

/**
 * Server-side cache for intelligence (Tavily + HiFleet PSC) results.
 * TTL: 24 hours. Stored in intelligence_cache table.
 */

import { db } from './db'

const TTL_HOURS = 24

export type EntityType = 'company' | 'vessel' | 'terminal'

export async function readIntelligenceCache(
  entityType: EntityType,
  entityKey: string,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await db.query<{ data_json: Record<string, unknown> }>(
      `SELECT data_json FROM intelligence_cache
       WHERE entity_type = $1 AND entity_key = $2 AND expires_at > NOW()`,
      [entityType, entityKey],
    )
    return result.rows[0]?.data_json ?? null
  } catch {
    return null
  }
}

export async function writeIntelligenceCache(
  entityType: EntityType,
  entityKey: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO intelligence_cache (entity_type, entity_key, data_json, fetched_at, expires_at)
       VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '${TTL_HOURS} hours')
       ON CONFLICT (entity_type, entity_key)
       DO UPDATE SET data_json = EXCLUDED.data_json,
                     fetched_at = NOW(),
                     expires_at = NOW() + INTERVAL '${TTL_HOURS} hours'`,
      [entityType, entityKey, JSON.stringify(data)],
    )
  } catch (err) {
    // 缂撳瓨鍐欏け璐ヤ笉闃诲涓绘祦绋嬶紝浠呮墦鏃ュ織
    console.error('[intelligence-cache] write failed:', err)
  }
}


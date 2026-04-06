/**
 * 统一制裁筛查
 *
 * 优先查询本地 sanctions_entries 表（由 sync-opensanctions.mjs 从 OpenSanctions 导入）。
 * 如果本地表为空（首次部署前），回退到 sanctions.network 外部 API。
 *
 * OpenSanctions 数据覆盖：OFAC SDN、EU FSF、UN、SECO、OFSI 等 100+ 来源。
 */

import { db } from '../db'

// ─── 本地 DB 查询 ─────────────────────────────────────────────────────────────

interface LocalHit {
  id: string
  name: string
  schema: string
  dataset: string | null
  sanctions: string | null
}

/**
 * 规范化查询词：去掉公司后缀、标点、多余空格，转小写
 */
function normalizeQuery(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[.,;'"()\-]/g, ' ')
    .replace(/\b(ltd|llc|co|corp|inc|gmbh|plc|pvt|sdn|bhd|fze|fzco|jsc|ojsc|ooo|llp|lp|as|oy|ab|nv|bv|sa|ag|kg)\b\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function checkLocalSanctions(
  name: string
): Promise<{ listed: boolean; sources: string[] }> {
  const query = normalizeQuery(name)
  if (!query || query.length < 2) return { listed: false, sources: [] }

  const { rows } = await db.query<LocalHit>(
    `SELECT id, name, schema, dataset, sanctions
     FROM sanctions_entries
     WHERE word_similarity($1, search_text) > 0.35
     ORDER BY word_similarity($1, search_text) DESC
     LIMIT 5`,
    [query]
  )

  if (rows.length === 0) return { listed: false, sources: [] }

  // 从 dataset 字段提取来源名（分号分隔）
  const sources = [
    ...new Set(
      rows.flatMap((r) => {
        if (!r.dataset) return ['OpenSanctions']
        return r.dataset
          .split(';')
          .map((d) => d.trim())
          .filter(Boolean)
          .slice(0, 3)
      })
    ),
  ]

  return { listed: true, sources }
}

// ─── 外部 API 回退 ────────────────────────────────────────────────────────────

const SANCTIONS_API = 'https://api.sanctions.network'

interface SanctionsEntry {
  id: string
  target_type: string
  source: string
  source_id: string
  names: string[]
  listed_on?: string
}

async function checkApiSanctions(
  name: string
): Promise<{ listed: boolean; sources: string[] }> {
  const url = new URL('/rpc/search_sanctions', SANCTIONS_API)
  url.searchParams.set('name', name.trim())

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'EnergyTradeInspection/1.0',
    },
    signal: AbortSignal.timeout(4000),
  })

  if (!response.ok) return { listed: false, sources: [] }

  const results: SanctionsEntry[] = await response.json()
  if (!Array.isArray(results) || results.length === 0) {
    return { listed: false, sources: [] }
  }

  const normalizedQuery = name.toLowerCase().trim()
  const hits = results.filter((entry) =>
    entry.names.some((n) => {
      const dist = normalizedQuery.length - n.toLowerCase().trim().length
      return Math.abs(dist) <= 5 && n.toLowerCase().includes(normalizedQuery.slice(0, 6))
    })
  )

  if (hits.length === 0) return { listed: false, sources: [] }

  const sources = [...new Set(hits.map((h) => h.source))]
  return { listed: true, sources }
}

// ─── 公开接口 ─────────────────────────────────────────────────────────────────

/**
 * 检查实体名称是否命中制裁名单。
 *
 * 优先使用本地 OpenSanctions 数据库（快速、离线、每日更新）。
 * 本地表为空时回退到 sanctions.network 外部 API。
 */
export async function checkSanctions(
  name: string
): Promise<{ listed: boolean; sources: string[] }> {
  if (!name || name.trim().length < 2) return { listed: false, sources: [] }

  try {
    // 检查本地表是否有数据
    const { rows: cnt } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM sanctions_entries LIMIT 1`
    )
    const hasLocalData = parseInt(cnt[0]?.n ?? '0', 10) > 0

    if (hasLocalData) {
      return await checkLocalSanctions(name)
    }

    // 本地表为空 → 回退到外部 API
    return await checkApiSanctions(name)
  } catch {
    // 任何错误都不阻断主查询流程
    return { listed: false, sources: [] }
  }
}

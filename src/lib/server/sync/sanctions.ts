/**
 * 统一制裁筛查
 *
 * 优先查询本地 sanctions_entries 表（由 sync-opensanctions.mjs 从 OpenSanctions 导入）。
 * 如果本地表为空（首次部署前），回退到 sanctions.network 外部 API。
 *
 * OpenSanctions 数据覆盖：OFAC SDN、EU FSF、UN、SECO、OFSI 等 100+ 来源。
 */

import { db } from '../db'

// ─── 本地 DB 查询 ────────────────────────────────────────────────────────────────

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
    // 阈值从 0.35 提高到 0.72，避免仅净通用词（energy/hong kong/petroleum）被匹配
    `SELECT id, name, schema, dataset, sanctions
     FROM sanctions_entries
     WHERE word_similarity($1, search_text) > 0.72
     ORDER BY word_similarity($1, search_text) DESC
     LIMIT 5`,
    [query]
  )

  if (rows.length === 0) return { listed: false, sources: [] }

  // Keep only rows with actual sanctions measures. `sanctions = null` is often a PEP hit.
  const sanctionedRows = rows.filter((r) => r.sanctions != null)
  if (sanctionedRows.length === 0) return { listed: false, sources: [] }

  // Exclude regulatory enforcement datasets such as banking orders and procurement blacklists.
  // These rows may have non-null `sanctions` fields but are not trade sanctions in our model.
  const EXCLUDED_REGULATORY_DATASETS = [
    'US OCC Enforcement Actions',
    'US CFTC Enforcement Actions',
    'US FDIC Enforcement Actions',
    'US FRB Enforcement Actions',
    'US SEC Enforcement Actions',
    'US FHFA Enforcement Actions',
    'US NCUA Enforcement Actions',
    'US BIS Alleged Antiboycott Violations',
    'US SAM Procurement Exclusions',   // 政府采购排除名单，非贸易制裁
  ]

  // Keywords that strongly suggest a trade-relevant sanctions listing.
  // A plain "OFAC" mention is too broad, so this list stays narrower.
  const TRADE_SANCTION_KEYWORDS = [
    'SDN', 'SDGT', 'SDNTK', 'Entity List', 'EL)', 'Unverified List',
    'Executive Order', 'EU FSF', 'OFSI', 'Consolidated List',
    'GLOMAG', 'RUSSIA', 'IRAN', 'DPRK', 'CUBA', 'SYRIA',
    'VENEZUELA', 'MYANMAR', 'BELARUS', 'UKRAINE', 'Terrorism',
    'debarred',
  ]

  // Authoritative dataset names. A hit here is enough even if the textual sanctions
  // field uses regulation numbers instead of readable labels.
  const TRADE_SANCTION_DATASET_KEYWORDS = [
    'OFAC Specially Designated',   // US OFAC SDN List
    'OFAC Consolidated',           // US OFAC Non-SDN Consolidated
    'EU Council Official Journal', // EU 理事会制裁令
    'EU FSF',                      // EU Financial Sanctions Files
    'UN Security Council',         // 联合国安理会制裁
    'UK FCDO Sanctions',
    'UK HMT/OFSI',
    'SECO Sanctions',              // 瑞士 SECO
    'Australian Sanctions',        // 澳大利亚
    'Canadian Consolidated Autonomous Sanctions',
    'Ukraine War and Sanctions',
    'US Trade Consolidated Screening List',
  ]

  const tradeRows = sanctionedRows.filter((r) => {
    // Exclude regulatory enforcement datasets first.
    if (r.dataset) {
      const isRegulatory = EXCLUDED_REGULATORY_DATASETS.some((ds) =>
        r.dataset!.includes(ds)
      )
      if (isRegulatory) return false
    }
    // Path 1: authoritative dataset name match.
    if (r.dataset) {
      const isAuthoritativeSource = TRADE_SANCTION_DATASET_KEYWORDS.some((kw) =>
        r.dataset!.includes(kw)
      )
      if (isAuthoritativeSource) return true
    }
    // Path 2: sanctions text contains a trade-sanctions keyword.
    return TRADE_SANCTION_KEYWORDS.some((kw) => r.sanctions?.includes(kw))
  })
  if (tradeRows.length === 0) return { listed: false, sources: [] }

  // Extract sources only from the filtered trade-relevant rows.
  const relevantRows = tradeRows

  // Split dataset names on semicolons and keep a short source list.
  const sources = [
    ...new Set(
      relevantRows.flatMap((r) => {
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

// ─── 外部 API 回退 ────────────────────────────────────────────────────────────────

const SANCTIONS_API = 'https://api.sanctions.network'

// ─── Circuit Breaker State ─────────────────────────────────────────────────────
// Wraps checkApiSanctions() — the external sanctions.network API fallback.
// Local DB path is unaffected.

let circuitOpen = false
let circuitOpenedAt = 0
let failureCount = 0

const CIRCUIT_FAILURE_THRESHOLD = 3   // consecutive failures to trip
const CIRCUIT_COOLDOWN_MS       = 60_000  // 60 s before half-open attempt

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

  if (!response.ok) throw new Error(`sanctions.network API error: ${response.status}`)

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

async function callApiSanctionsWithBreaker(
  name: string
): Promise<{ listed: boolean; sources: string[]; degraded?: true }> {
  const now = Date.now()

  // Circuit is open — check if cooldown has elapsed (half-open)
  if (circuitOpen) {
    if (now - circuitOpenedAt < CIRCUIT_COOLDOWN_MS) {
      // Still in cooldown — return degraded without calling API
      return { listed: false, sources: [], degraded: true }
    }
    // Half-open: allow one attempt
    // (circuitOpen remains true until we know the outcome)
  }

  try {
    const result = await checkApiSanctions(name)
    // Success — reset circuit
    circuitOpen = false
    failureCount = 0
    return result
  } catch {
    failureCount += 1
    if (failureCount >= CIRCUIT_FAILURE_THRESHOLD) {
      circuitOpen = true
      circuitOpenedAt = Date.now()
    } else if (circuitOpen) {
      // Half-open attempt failed — extend cooldown
      circuitOpenedAt = Date.now()
    }
    return { listed: false, sources: [], degraded: true }
  }
}

// ─── 公开接口 ────────────────────────────────────────────────────────────────────

/**
 * 检查实体名称是否命中制裁名单。
  * Prefer the local OpenSanctions mirror first.
  * Fall back to the external `sanctions.network` API when local data is empty.
  */
export async function checkSanctions(
  name: string
): Promise<{ status: 'ok' | 'degraded'; listed: boolean; sources: string[]; reason?: string }> {
  if (!name || name.trim().length < 2) return { status: 'ok', listed: false, sources: [] }

  try {
    // Check whether the local mirror has any data.
    const { rows: cnt } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM sanctions_entries LIMIT 1`
    )
    const hasLocalData = parseInt(cnt[0]?.n ?? '0', 10) > 0

    if (hasLocalData) {
      const result = await checkLocalSanctions(name)
      return { status: 'ok', ...result }
    }

    // Fall back to the external API via circuit breaker
    const apiResult = await callApiSanctionsWithBreaker(name)
    if (apiResult.degraded) {
      return {
        status: 'degraded',
        listed: false,
        sources: [],
        reason: 'opensanctions_api_unavailable',
      }
    }
    return { status: 'ok', listed: apiResult.listed, sources: apiResult.sources }
  } catch {
    // Never block the main flow on sanctions lookup failures.
    return { status: 'degraded', listed: false, sources: [], reason: 'opensanctions_api_unavailable' }
  }
}

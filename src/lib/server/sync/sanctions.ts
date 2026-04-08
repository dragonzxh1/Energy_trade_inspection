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
    // 阈值从 0.35 提高到 0.72，避免仅凭通用词（energy/hong kong/petroleum）误匹配
    `SELECT id, name, schema, dataset, sanctions
     FROM sanctions_entries
     WHERE word_similarity($1, search_text) > 0.72
     ORDER BY word_similarity($1, search_text) DESC
     LIMIT 5`,
    [query]
  )

  if (rows.length === 0) return { listed: false, sources: [] }

  // 只计入实际有制裁措施的条目（sanctions 字段非 null）
  // sanctions 为 null 的条目是 PEP（政治公众人物），不等于受制裁
  const sanctionedRows = rows.filter((r) => r.sanctions != null)
  if (sanctionedRows.length === 0) return { listed: false, sources: [] }

  // 排除纯监管执法数据集（银行监管令、政府采购黑名单等）——不属于贸易制裁
  // 这些数据集的条目即使 sanctions 字段非空，也不是贸易制裁意义上的"制裁"
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

  // 贸易相关制裁关键词：用于检查 sanctions 文本字段
  // 注意：仅用"OFAC"不够精确（OCC 执法令中可能出现"OFAC Compliance Issue"）
  const TRADE_SANCTION_KEYWORDS = [
    'SDN', 'SDGT', 'SDNTK', 'Entity List', 'EL)', 'Unverified List',
    'Executive Order', 'EU FSF', 'OFSI', 'Consolidated List',
    'GLOMAG', 'RUSSIA', 'IRAN', 'DPRK', 'CUBA', 'SYRIA',
    'VENEZUELA', 'MYANMAR', 'BELARUS', 'UKRAINE', 'Terrorism',
    'debarred',
  ]

  // 权威贸易制裁数据集名称关键词（用于 dataset 字段）
  // 若 dataset 字段包含这些来源，即使 sanctions 文本用 EU 法规编号格式（如 126/2018），
  // 也直接确认为贸易制裁——覆盖 Rosneft 等跨国列名实体
  const TRADE_SANCTION_DATASET_KEYWORDS = [
    'OFAC Specially Designated',   // US OFAC SDN List
    'OFAC Consolidated',           // US OFAC Non-SDN Consolidated
    'EU Council Official Journal', // EU 理事会制裁令
    'EU FSF',                      // EU Financial Sanctions Files
    'UN Security Council',         // 联合国安理会制裁
    'UK FCDO Sanctions',           // 英国外交部制裁
    'UK HMT/OFSI',                 // 英国财政部 OFSI
    'SECO Sanctions',              // 瑞士 SECO
    'Australian Sanctions',        // 澳大利亚
    'Canadian Consolidated Autonomous Sanctions', // 加拿大
    'Ukraine War and Sanctions',   // 乌克兰制裁登记
    'US Trade Consolidated Screening List',       // BIS/DDTC/OFAC 合并
  ]

  const tradeRows = sanctionedRows.filter((r) => {
    // 先排除纯监管执法数据集
    if (r.dataset) {
      const isRegulatory = EXCLUDED_REGULATORY_DATASETS.some((ds) =>
        r.dataset!.includes(ds)
      )
      if (isRegulatory) return false
    }
    // 方式一：dataset 字段包含权威制裁来源名称 → 直接确认
    if (r.dataset) {
      const isAuthoritativeSource = TRADE_SANCTION_DATASET_KEYWORDS.some((kw) =>
        r.dataset!.includes(kw)
      )
      if (isAuthoritativeSource) return true
    }
    // 方式二：sanctions 文本包含贸易制裁关键词
    return TRADE_SANCTION_KEYWORDS.some((kw) => r.sanctions?.includes(kw))
  })
  if (tradeRows.length === 0) return { listed: false, sources: [] }

  // 用 tradeRows 替代 sanctionedRows 提取来源
  const relevantRows = tradeRows

  // 从 dataset 字段提取来源名（分号分隔）
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

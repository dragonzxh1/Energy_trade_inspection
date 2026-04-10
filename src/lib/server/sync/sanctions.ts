/**
 * 缁熶竴鍒惰绛涙煡
 *
 * 浼樺厛鏌ヨ鏈湴 sanctions_entries 琛紙鐢?sync-opensanctions.mjs 浠?OpenSanctions 瀵煎叆锛夈€? * 濡傛灉鏈湴琛ㄤ负绌猴紙棣栨閮ㄧ讲鍓嶏級锛屽洖閫€鍒?sanctions.network 澶栭儴 API銆? *
 * OpenSanctions 鏁版嵁瑕嗙洊锛歄FAC SDN銆丒U FSF銆乁N銆丼ECO銆丱FSI 绛?100+ 鏉ユ簮銆? */

import { db } from '../db'

// 鈹€鈹€鈹€ 鏈湴 DB 鏌ヨ 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

interface LocalHit {
  id: string
  name: string
  schema: string
  dataset: string | null
  sanctions: string | null
}

/**
 * 瑙勮寖鍖栨煡璇㈣瘝锛氬幓鎺夊叕鍙稿悗缂€銆佹爣鐐广€佸浣欑┖鏍硷紝杞皬鍐? */
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
    // 闃堝€间粠 0.35 鎻愰珮鍒?0.72锛岄伩鍏嶄粎鍑€氱敤璇嶏紙energy/hong kong/petroleum锛夎鍖归厤
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
    'US SAM Procurement Exclusions',   // 鏀垮簻閲囪喘鎺掗櫎鍚嶅崟锛岄潪璐告槗鍒惰
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
    'EU Council Official Journal', // EU 鐞嗕簨浼氬埗瑁佷护
    'EU FSF',                      // EU Financial Sanctions Files
    'UN Security Council',         // 鑱斿悎鍥藉畨鐞嗕細鍒惰
    'UK FCDO Sanctions',
    'UK HMT/OFSI',
    'SECO Sanctions',              // 鐟炲＋ SECO
    'Australian Sanctions',        // 婢冲ぇ鍒╀簹
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

// 鈹€鈹€鈹€ 澶栭儴 API 鍥為€€ 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€鈹€ 鍏紑鎺ュ彛 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * 妫€鏌ュ疄浣撳悕绉版槸鍚﹀懡涓埗瑁佸悕鍗曘€? *
  * Prefer the local OpenSanctions mirror first.
  * Fall back to the external `sanctions.network` API when local data is empty.
  */
export async function checkSanctions(
  name: string
): Promise<{ listed: boolean; sources: string[] }> {
  if (!name || name.trim().length < 2) return { listed: false, sources: [] }

  try {
    // Check whether the local mirror has any data.
    const { rows: cnt } = await db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM sanctions_entries LIMIT 1`
    )
    const hasLocalData = parseInt(cnt[0]?.n ?? '0', 10) > 0

    if (hasLocalData) {
      return await checkLocalSanctions(name)
    }

    // Fall back to the external API if local data is empty.
    return await checkApiSanctions(name)
  } catch {
    // Never block the main flow on sanctions lookup failures.
    return { listed: false, sources: [] }
  }
}


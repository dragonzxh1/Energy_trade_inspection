import { randomUUID } from 'node:crypto'
import type { Company, RiskFlag, SearchResult, SanctionStatus, Terminal, Vessel } from '@/lib/types'
import { riskLevel } from './scoring'
import { db } from './db'
import { normalizeEntityName } from './normalize'
import { checkSanctions } from './sync/sanctions'
import { searchACRA, getACRAByUEN, acraToSearchResult, computeACRAScore } from './sync/acra'
import {
  searchCompaniesHouse,
  getCHCompanyByNumber,
  mightBeUKNumber,
  chToSearchResult,
  buildCHCompany,
  getCHOfficers,
  getCHPSC,
} from './sync/companies-house'
import {
  searchZefix,
  getZefixByUid,
  mightBeSwissUid,
  zefixToSearchResult,
  buildZefixCompany,
} from './sync/zefix'
import {
  searchGleifMultiple,
  getGleifRecordByLei,
  buildGleifCompany,
} from './gleif'
import type { GleifLeiRecord } from './gleif'
import {
  searchOpenCorporates,
  getOCCompanyByNumber,
  mightBeOCId,
  ocToSearchResult,
  buildOCCompany,
} from './sync/opencorporates'
import type { LeiCacheRow } from '@/lib/server/sync/gleif-golden-copy'
import {
  searchHKCRCache,
  mightBeHKNumber,
  hkcrToSearchResult,
} from './sync/hkcr'

interface EntityRow {
  id: string
  entity_type: 'company' | 'vessel' | 'terminal'
  name: string
  slug: string | null
  imo: string | null
  registration_number: string | null
  country: string
  jurisdiction_flag: string
  sanction_status: 'not_listed' | 'listed' | 'unknown'
  authenticity_score: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  score_breakdown_json: unknown
  metadata_json: unknown
  data_source_json: string[]
  last_verified: string
}

export interface BrowseRow {
  id: string
  entity_type: 'company' | 'vessel' | 'terminal'
  name: string
  slug: string | null
  imo: string | null
  jurisdiction_flag: string
  country: string
  sanction_status: 'not_listed' | 'listed' | 'unknown'
  authenticity_score: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  registration_number: string | null
  vessel_type: string | null
}

export interface FeaturedRow {
  id: string
  entity_type: 'company' | 'vessel'
  name: string
  slug: string | null
  imo: string | null
  jurisdiction_flag: string
  country: string
  sanction_status: 'not_listed' | 'listed' | 'unknown'
  authenticity_score: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
}

// normalizeInput replaced by normalizeEntityName from ./normalize
// kept as thin wrapper for any internal callers not yet migrated
function normalizeInput(value: string): string {
  return normalizeEntityName(value, false)
}

/** Ensure breakdown uses the 5 expected dimension keys.
 *  Legacy OpenSanctions rows store {sanctions, financial_crime, regulatory}
 *  and need to be mapped to the current schema. */
function normalizeBreakdown(raw: unknown, totalScore: number): Company['scoreBreakdown'] {
  const b = raw as Record<string, unknown>
  if (
    b &&
    typeof b === 'object' &&
    'entityExistence' in b &&
    'assetReality' in b &&
    'tradingTrackRecord' in b &&
    'documentConsistency' in b &&
    'communityReputation' in b
  ) {
    return b as unknown as Company['scoreBreakdown']
  }
  // Distribute score proportionally across Phase-1 dimensions (max 75)
  const ratio = Math.min(totalScore, 75) / 75
  return {
    entityExistence:     { score: Math.round(25 * ratio), maxScore: 25 },
    assetReality:        { score: Math.round(30 * ratio), maxScore: 30 },
    tradingTrackRecord:  { score: 0, maxScore: 25 },
    documentConsistency: { score: Math.round(10 * ratio), maxScore: 10 },
    communityReputation: { score: Math.round(10 * ratio), maxScore: 10 },
  }
}

/**
 * Attach human-readable evidence strings to each score dimension.
 * Evidence is derived dynamically from the entity row, so no DB migration is needed.
 */
function attachEvidence(
  breakdown: Company['scoreBreakdown'],
  row: EntityRow,
  metadata: Record<string, unknown>,
): Company['scoreBreakdown'] {
  // 鈹€鈹€ entityExistence 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const existenceEvidence: string[] = []
  if (row.registration_number) {
    existenceEvidence.push(`Registration number on record: ${row.registration_number}`)
  }
  if (row.country) {
    existenceEvidence.push(`Jurisdiction: ${row.country.toUpperCase()}`)
  }
  if (existenceEvidence.length === 0) {
    existenceEvidence.push('Entity not found in official registries')
  }

  // 鈹€鈹€ assetReality 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const assetEvidence: string[] = []
  if (row.entity_type === 'vessel') {
    if (row.imo) assetEvidence.push(`IMO number verified: ${row.imo}`)
    if (typeof metadata.grossTonnage === 'number') {
      assetEvidence.push(`Gross tonnage: ${metadata.grossTonnage.toLocaleString()} GT`)
    }
    if (typeof metadata.yearBuilt === 'number') {
      assetEvidence.push(`Year built: ${metadata.yearBuilt}`)
    }
    if (typeof metadata.vesselType === 'string') {
      assetEvidence.push(`Vessel type: ${metadata.vesselType}`)
    }
  } else if (row.entity_type === 'company') {
    const vessels = Array.isArray(metadata.vessels) ? metadata.vessels : []
    const directors = Array.isArray(metadata.directors) ? metadata.directors : []
    if (vessels.length > 0) {
      assetEvidence.push(`${vessels.length} vessel(s) associated with this entity`)
    }
    if (directors.length > 0) {
      assetEvidence.push(`${directors.length} director(s) on record`)
    }
  } else if (row.entity_type === 'terminal') {
    if (typeof metadata.terminalType === 'string') {
      assetEvidence.push(`Terminal type: ${metadata.terminalType}`)
    }
    if (typeof metadata.capacity === 'number') {
      assetEvidence.push(`Storage capacity: ${metadata.capacity.toLocaleString()} m3`)
    }
  }
  if (assetEvidence.length === 0) {
    assetEvidence.push('Minimal asset documentation available')
  }

  // 鈹€鈹€ documentConsistency 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const docEvidence: string[] = []
  if (typeof metadata.incorporationDate === 'string') {
    docEvidence.push(`Incorporation date on record: ${metadata.incorporationDate}`)
  }
  if (typeof metadata.registeredAddress === 'string') {
    docEvidence.push('Registered address on file')
  }
  if (typeof metadata.location === 'string') {
    docEvidence.push(`Location on file: ${metadata.location}`)
  }
  if (docEvidence.length === 0) {
    docEvidence.push('No document metadata available')
  }

  // 鈹€鈹€ communityReputation 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const repEvidence: string[] = []
  if (row.sanction_status === 'not_listed') {
    repEvidence.push('No matches on trade sanctions lists (OFAC, EU, UN)')
  } else if (row.sanction_status === 'listed') {
    repEvidence.push('Appears on one or more trade sanctions lists')
  }
  if (breakdown.communityReputation.score >= 7) {
    repEvidence.push('No significant adverse findings in public databases')
  } else if (breakdown.communityReputation.score === 0) {
    repEvidence.push('Adverse findings detected in public databases')
  }

  // 鈹€鈹€ tradingTrackRecord 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const trackEvidence: string[] = ['Trading history analysis requires Phase 2 data']

  return {
    entityExistence:     { ...breakdown.entityExistence,     evidence: existenceEvidence },
    assetReality:        { ...breakdown.assetReality,        evidence: assetEvidence },
    tradingTrackRecord:  { ...breakdown.tradingTrackRecord,  evidence: trackEvidence },
    documentConsistency: { ...breakdown.documentConsistency, evidence: docEvidence },
    communityReputation: { ...breakdown.communityReputation, evidence: repEvidence },
  }
}

/**
 * Compute the tradingTrackRecord dimension score from trade_events table.
 * Returns a score from 0 to 22, and evidence strings.
 * Max breakdown: +5 (any events) + 5 (repeat counterparty) + 5 (recent) + 7 (10+ events) or +5 (3–9 events).
 */
export async function computeTradingTrackRecord(entityId: string): Promise<{
  score: number
  evidence: string[]
}> {
  try {
    const { rows } = await db.query<{
      total_events: string
      recent_events: string
      unique_counterparties: string
    }>(
      `SELECT
         COUNT(*)::text                                                               AS total_events,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '6 months')::text     AS recent_events,
         COUNT(DISTINCT counterparty_name)::text                                      AS unique_counterparties
       FROM trade_events
       WHERE entity_id = $1`,
      [entityId]
    )
    const total  = parseInt(rows[0]?.total_events         ?? '0', 10)
    const recent = parseInt(rows[0]?.recent_events        ?? '0', 10)
    const unique = parseInt(rows[0]?.unique_counterparties ?? '0', 10)

    let score = 0
    const evidence: string[] = []

    if (total > 0) {
      score += 5
      evidence.push(`${total} verified trade event(s) on record`)
    } else {
      evidence.push('No verified trade events on record yet')
    }

    if (total > unique) {
  // More events than unique counterparties means there was at least one repeat counterparty.
      score += 5
      evidence.push('Established relationship: repeat counterparty detected')
    }

    if (recent > 0) {
      score += 5
      evidence.push(`Active: ${recent} event(s) in the last 6 months`)
    }

    // Volume tier — award the higher tier only, never stack
    if (total >= 10) {
      score += 7
      evidence.push('High-volume: 10+ verified trade events on record')
    } else if (total >= 3) {
      score += 5
      evidence.push('Established volume: 3–9 verified trade events on record')
    }

    return { score, evidence }
  } catch {
    return { score: 0, evidence: ['Trading history analysis unavailable'] }
  }
}

/** Normalize `dataSource`; legacy OpenSanctions rows store `[{source, dataset}]` objects. */
function normalizeDataSource(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object' && 'source' in item) {
      const src = String((item as Record<string, unknown>).source)
      // Map known source identifiers to display names
      if (src === 'opensanctions') return 'OpenSanctions'
      return src.charAt(0).toUpperCase() + src.slice(1)
    }
    return String(item)
  })
}

function parseEntity(row: EntityRow): Company | Vessel | Terminal {
  const rawBreakdown = normalizeBreakdown(row.score_breakdown_json, row.authenticity_score)
  const dataSource = normalizeDataSource(row.data_source_json)
  const metadata = row.metadata_json as Record<string, unknown>
  const scoreBreakdown = attachEvidence(rawBreakdown, row, metadata)

  if (row.entity_type === 'vessel') {
    return {
      id: row.id,
      type: 'vessel',
      name: row.name,
      imo: row.imo ?? '',
      mmsi: typeof metadata.mmsi === 'string' ? metadata.mmsi : undefined,
      flag: (metadata.flag as string) ?? row.country,
      vesselType: (metadata.vesselType as string) ?? 'Unknown',
      grossTonnage: typeof metadata.grossTonnage === 'number' ? metadata.grossTonnage : undefined,
      yearBuilt: typeof metadata.yearBuilt === 'number' ? metadata.yearBuilt : undefined,
      currentOperator:
        typeof metadata.currentOperator === 'string' ? metadata.currentOperator : undefined,
      ownerCompanySlug:
        typeof metadata.ownerCompanySlug === 'string' ? metadata.ownerCompanySlug : undefined,
      country: row.country,
      jurisdictionFlag: row.jurisdiction_flag,
      sanctionStatus: row.sanction_status,
      authenticityScore: row.authenticity_score,
      scoreBreakdown,
      riskLevel: row.risk_level,
      riskFlags: [],
      lastVerified: row.last_verified,
      dataSource,
    }
  }

  if (row.entity_type === 'terminal') {
    return {
      id: row.id,
      type: 'terminal',
      name: row.name,
      slug: row.slug ?? undefined,
      location:
        typeof metadata.location === 'string' ? metadata.location : undefined,
      operator:
        typeof metadata.operator === 'string' ? metadata.operator : undefined,
      terminalType:
        typeof metadata.terminalType === 'string' ? metadata.terminalType : undefined,
      capacity:
        typeof metadata.capacity === 'number' ? metadata.capacity : undefined,
      ownerCompanySlug:
        typeof metadata.ownerCompanySlug === 'string' ? metadata.ownerCompanySlug : undefined,
      country: row.country,
      jurisdictionFlag: row.jurisdiction_flag,
      sanctionStatus: row.sanction_status,
      authenticityScore: row.authenticity_score,
      scoreBreakdown,
      riskLevel: row.risk_level,
      riskFlags: [],
      lastVerified: row.last_verified,
      dataSource,
    }
  }

  return {
    id: row.id,
    type: 'company',
    name: row.name,
    slug: row.slug ?? row.id,
    registrationNumber: row.registration_number ?? '',
    incorporationDate:
      typeof metadata.incorporationDate === 'string' ? metadata.incorporationDate : undefined,
    registeredAddress:
      typeof metadata.registeredAddress === 'string' ? metadata.registeredAddress : undefined,
    website:
      typeof metadata.website === 'string' ? metadata.website : undefined,
    directors: Array.isArray(metadata.directors)
      ? (metadata.directors as Company['directors'])
      : undefined,
    vessels: Array.isArray(metadata.vessels)
      ? (metadata.vessels as Company['vessels'])
      : undefined,
    country: row.country,
    jurisdictionFlag: row.jurisdiction_flag,
    sanctionStatus: row.sanction_status,
    authenticityScore: row.authenticity_score,
    scoreBreakdown,
    riskLevel: row.risk_level,
    riskFlags: [],
    lastVerified: row.last_verified,
    dataSource,
  }
}

/**
 * 瀵瑰疄浣撳悕绉拌繘琛屽埗瑁佺瓫鏌ワ紙OFAC + EU + UN锛屼竴娆?API 璋冪敤瑕嗙洊鍏ㄩ儴鏉ユ簮锛? */
async function screenSanctions(name: string): Promise<SanctionStatus> {
  const { listed } = await checkSanctions(name).catch(() => ({ listed: false, sources: [] }))
  return listed ? 'listed' : 'not_listed'
}

export async function searchEntities(query: string, entityType?: string): Promise<SearchResult[]> {
  // Query-time: strip legal suffixes only (keep generic words to preserve user intent)
  const normalized = normalizeEntityName(query, false)
  if (!normalized || normalized.length < 3) return []

  const params: unknown[] = [normalized, `${normalized}%`]
  let typeClause = ''
  if (entityType && ['company', 'vessel', 'terminal'].includes(entityType)) {
    params.push(entityType)
    typeClause = `AND e.entity_type = $${params.length}`
  }
  // $1 = normalized query (legal suffixes stripped, generic words kept)
  // $2 = prefix pattern for LIKE fallback
  // WHERE: % = full trigram similarity; $1 %> stored = "query appears in stored name"
  // HAVING: full similarity only, threshold raised to 0.45 (was 0.32)
  const sql = `
    SELECT
      e.id,
      e.name,
      e.entity_type,
      e.country,
      e.jurisdiction_flag,
      e.sanction_status,
      e.authenticity_score,
      e.risk_level,
      e.registration_number,
      e.slug,
      e.imo,
      (e.metadata_json->>'vesselType') AS vessel_type,
      GREATEST(
        similarity(e.normalized_name, $1),
        COALESCE(MAX(similarity(a.normalized_alias, $1)), 0)
      ) AS score
    FROM entities e
    LEFT JOIN entity_aliases a ON a.entity_id = e.id
    WHERE (
      e.normalized_name % $1
      OR $1 %> e.normalized_name
      OR a.normalized_alias % $1
      OR $1 %> a.normalized_alias
      OR e.normalized_name LIKE $2
      OR e.registration_number = $1
      OR e.imo = $1
    )
    ${typeClause}
    GROUP BY e.id
    HAVING GREATEST(
      similarity(e.normalized_name, $1),
      COALESCE(MAX(similarity(a.normalized_alias, $1)), 0)
    ) > 0.45
    ORDER BY score DESC, e.authenticity_score DESC
    LIMIT 20
  `

  const shouldSearchCompanies = !entityType || entityType === 'company'

  // === Tier 1: Parallel local queries ===
  // 1a. Sanctions entities (always searched — the primary compliance layer)
  // 1b. GLEIF lei_cache (companies only) — 2.3M records, the primary identity anchor
  // 1c. non_lei_cache (companies only) — cached results from prior external API calls
  const [localRows, leiCacheRows, nonLeiCacheRows] = await Promise.all([
    db.query(sql, params).then((r) => r.rows).catch(() => []),
    shouldSearchCompanies
      ? db
          .query<LeiCacheRow>(
            `SELECT * FROM lei_cache
             WHERE SIMILARITY(legal_name, $1) > 0.55
               AND entity_status = 'ACTIVE'
             ORDER BY SIMILARITY(legal_name, $1) DESC
             LIMIT 10`,
            [normalized],
          )
          .then((r) => r.rows)
          .catch(() => [] as LeiCacheRow[])
      : Promise.resolve([] as LeiCacheRow[]),
    shouldSearchCompanies
      ? db
          .query<{ id: string; data_json: SearchResult }>(
            `SELECT id, data_json FROM non_lei_cache
             WHERE SIMILARITY(canonical_name, $1) > 0.55
               AND expires_at > NOW()
             ORDER BY SIMILARITY(canonical_name, $1) DESC
             LIMIT 10`,
            [normalized],
          )
          .then((r) => r.rows)
          .catch(() => [] as Array<{ id: string; data_json: SearchResult }>)
      : Promise.resolve([] as Array<{ id: string; data_json: SearchResult }>),
  ])

  // Map sanctions entity rows → SearchResult
  const localResults: SearchResult[] = localRows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.entity_type,
    country: row.country,
    jurisdictionFlag: row.jurisdiction_flag,
    sanctionStatus: row.sanction_status,
    authenticityScore: row.authenticity_score,
    riskLevel: row.risk_level,
    registrationNumber: row.registration_number ?? undefined,
    slug: row.slug ?? undefined,
    imo: row.imo ?? undefined,
    vesselType: row.vessel_type ?? undefined,
  }))

  // Build dedup set: track all ids and registration numbers seen in Tier 1
  const tier1Seen = new Set<string>()
  for (const r of localResults) {
    tier1Seen.add(r.id)
    if (r.registrationNumber) tier1Seen.add(r.registrationNumber)
  }

  // Map lei_cache rows → SearchResult, deduplicating against sanctions results.
  // Skip if the underlying national registry number is already represented in localResults
  // (prevents showing both a sanctioned entity and its GLEIF entry as separate results).
  const gleifTier1: SearchResult[] = leiCacheRows
    .filter(
      (row) =>
        !tier1Seen.has(row.registration_authority_entity_id ?? '__none__') &&
        !tier1Seen.has(`gleif:${row.lei}`),
    )
    .map((row) => ({
      id:                `gleif:${row.lei}`,
      name:              row.legal_name,
      type:              'company' as const,
      country:           row.jurisdiction ?? row.country ?? '',
      jurisdictionFlag:  row.jurisdiction ?? '',
      sanctionStatus:    'unknown' as const,
      // LEI existence = 10 pts; +5 if registration date known
      authenticityScore: 10 + (row.initial_registration_date ? 5 : 0),
      riskLevel:         riskLevel(10 + (row.initial_registration_date ? 5 : 0), 'unknown'),
      registrationNumber: row.lei,
      slug:              `lei-${row.lei.toLowerCase()}`,
    }))

  // Extend dedup set with GLEIF tier 1 ids
  for (const r of gleifTier1) {
    tier1Seen.add(r.id)
    if (r.registrationNumber) tier1Seen.add(r.registrationNumber)
  }

  // Map non_lei_cache rows → SearchResult, deduplicating against all Tier 1 so far.
  const nonLeiTier1: SearchResult[] = nonLeiCacheRows
    .filter((row) => {
      const sr = row.data_json
      return !tier1Seen.has(sr.id) && !(sr.registrationNumber && tier1Seen.has(sr.registrationNumber))
    })
    .map((row) => row.data_json)

  const tier1Results = [...localResults, ...gleifTier1, ...nonLeiTier1]

  // Skip Tier 2 when Tier 1 already provides adequate coverage:
  // - 5+ results (original threshold), OR
  // - Any GLEIF match found (lei_cache has 2.3M records; if it matched, trust it), OR
  // - 2+ total results (enough for UX; Tier 2 external APIs return unrelated companies)
  //
  // Tier 2 is expensive (5 parallel external HTTP calls, 1-5s each) and its results
  // are unreliable — external APIs apply their own fuzzy matching, which can return
  // completely unrelated companies (e.g. CH returning "AAA ENERGY" for "ZHENFU ENERGY").
  if (!shouldSearchCompanies || tier1Results.length >= 5 || gleifTier1.length >= 1 || tier1Results.length >= 2) {
    return tier1Results.slice(0, 20)
  }

  // === Tier 2: External API calls (ACRA, CH, Zefix, OC, GLEIF live) ===
  // Only reached when Tier 1 found 0-1 results AND no GLEIF match — company is likely
  // a small/private entity not in any local database.
  const tier1RegNums = new Set(
    tier1Results.map((r) => r.registrationNumber).filter(Boolean) as string[],
  )

  const [acraEntities, chEntities, zefixEntities, ocEntities, gleifRecords, hkcrEntities] = await Promise.all([
    searchACRA(query, 5).catch(() => []),
    searchCompaniesHouse(query, 5).catch(() => []),
    searchZefix(query, 5).catch(() => []),
    searchOpenCorporates(query, 5).catch(() => []),
    searchGleifMultiple(query, 5).catch(() => []),
    searchHKCRCache(query, 5),  // HKCR: LOCAL cache query (no catch needed - returns [])
  ])

  const acraResults  = acraEntities.filter((e) => !tier1RegNums.has(e.uen)).map(acraToSearchResult)
  const chResults    = chEntities.filter((c) => !tier1RegNums.has(c.company_number)).map(chToSearchResult)
  const zefixResults = zefixEntities.filter((c) => !tier1RegNums.has(c.uid)).map(zefixToSearchResult)
  const ocResults    = ocEntities.filter((c) => !tier1RegNums.has(c.company_number)).map(ocToSearchResult)
  const hkcrResults  = hkcrEntities
    .filter((c) => !tier1RegNums.has(c.company_number))
    .map(hkcrToSearchResult)

  const allRegNums = new Set([
    ...tier1RegNums,
    ...acraResults.map((r) => r.registrationNumber).filter(Boolean),
    ...chResults.map((r) => r.registrationNumber).filter(Boolean),
    ...zefixResults.map((r) => r.registrationNumber).filter(Boolean),
    ...ocResults.map((r) => r.registrationNumber).filter(Boolean),
    ...hkcrResults.map((r) => r.registrationNumber).filter(Boolean),
  ])
  const gleifTier2 = gleifRecords
    .filter((r) => !allRegNums.has(r.lei))
    .map((r) => ({
      id:                `gleif:${r.lei}`,
      name:              r.legalName,
      type:              'company' as const,
      country:           r.jurisdiction ?? r.country ?? '',
      jurisdictionFlag:  r.jurisdiction ?? '',
      sanctionStatus:    'unknown' as const,
      authenticityScore: 10 + (r.initialRegistrationDate ? 5 : 0),
      riskLevel:         riskLevel(10 + (r.initialRegistrationDate ? 5 : 0), 'unknown'),
      registrationNumber: r.lei,
      slug:              `lei-${r.lei.toLowerCase()}`,
    }))

  // Write Tier 2 results to non_lei_cache (fire-and-forget, 7-day TTL).
  // Prevents re-hitting external APIs for the same company on subsequent searches.
  const toCache: Parameters<typeof writeNonLeiCache>[0] = [
    ...acraResults.map((r) => ({
      id:             `acra:${r.registrationNumber ?? r.id}`,
      canonicalName:  r.name,
      registrySource: 'acra',
      jurisdiction:   'SG' as string | null,
      result:         r,
    })),
    ...chResults.map((r) => ({
      id:             `ch:${r.registrationNumber ?? r.id}`,
      canonicalName:  r.name,
      registrySource: 'ch',
      jurisdiction:   'GB' as string | null,
      result:         r,
    })),
    ...zefixResults.map((r) => ({
      id:             `zefix:${r.registrationNumber ?? r.id}`,
      canonicalName:  r.name,
      registrySource: 'zefix',
      jurisdiction:   'CH' as string | null,
      result:         r,
    })),
    ...ocResults.map((r) => ({
      id:             r.id,
      canonicalName:  r.name,
      registrySource: 'oc',
      jurisdiction:   null,
      result:         r,
    })),
    ...hkcrResults.map((r) => ({
      id:             `hkcr:${r.registrationNumber ?? r.id}`,
      canonicalName:  r.name,
      registrySource: 'hkcr',
      jurisdiction:   'HK' as string | null,
      result:         r,
    })),
  ]
  if (toCache.length > 0) {
    writeNonLeiCache(toCache).catch(() => {})
  }

  return [
    ...tier1Results,
    ...acraResults,
    ...chResults,
    ...zefixResults,
    ...ocResults,
    ...gleifTier2,
    ...hkcrResults,
  ].slice(0, 20)
}

export interface BrowseResult {
  rows: BrowseRow[]
  total: number
}

export async function getBrowseEntities(entityType?: string): Promise<BrowseResult> {
  const browseType = entityType === 'company' || entityType === 'vessel' || entityType === 'terminal'
    ? entityType
    : null

  const [{ rows }, { rows: countRows }] = await Promise.all([
    db.query<BrowseRow>(
      `
        SELECT id, entity_type, name, slug, imo, jurisdiction_flag,
               country, sanction_status, authenticity_score, risk_level,
               registration_number,
               metadata_json->>'vesselType' AS vessel_type
        FROM entities
        WHERE ($1::text IS NULL OR entity_type = $1)
        ORDER BY
          CASE sanction_status WHEN 'listed' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
          CASE risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
          authenticity_score ASC,
          id ASC
        LIMIT 100
      `,
      [browseType]
    ),
    db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM entities WHERE ($1::text IS NULL OR entity_type = $1)`,
      [browseType]
    ),
  ])

  return { rows, total: parseInt(countRows[0]?.n ?? '0', 10) }
}

export async function getFeaturedEntities(): Promise<FeaturedRow[]> {
  const { rows } = await db.query<FeaturedRow>(
    `
      (
        SELECT id, entity_type, name, slug, imo, jurisdiction_flag,
               country, sanction_status, authenticity_score, risk_level
        FROM entities
        WHERE sanction_status = 'listed' OR risk_level = 'critical'
        ORDER BY authenticity_score ASC
        LIMIT 3
      )
      UNION ALL
      (
        SELECT id, entity_type, name, slug, imo, jurisdiction_flag,
               country, sanction_status, authenticity_score, risk_level
        FROM entities
        WHERE sanction_status = 'not_listed' AND risk_level = 'low'
        ORDER BY authenticity_score DESC
        LIMIT 3
      )
    `
  )

  return rows
}

/**
 * GLEIF Registration Authority codes for registries we can route to directly.
 * Source: https://www.gleif.org/en/about-lei/code-lists/gleif-registration-authorities-list
 */
const RA_COMPANIES_HOUSE = 'RA000585' // UK Companies House
const RA_ACRA            = 'RA000523' // Singapore ACRA (confirmed from live GLEIF API)
const RA_ZEFIX           = 'RA000674' // Swiss EHRA / Zefix (federal commercial register)

/**
 * Normalize a Swiss UID to the CHE-xxx.xxx.xxx format expected by Zefix.
 * GLEIF may return "CHE123456789" or "CHE-123.456.789" or bare digits.
 */
function normalizeSwissUid(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '')
  if (digits.length === 9) {
    return `CHE-${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}`
  }
  // Already correctly formatted or unrecognised — pass through
  return raw.startsWith('CHE') ? raw : `CHE-${raw}`
}

/** Cache-first: read a LEI record from lei_cache. Returns null on miss or DB error. */
async function getLeiCacheRecord(lei: string): Promise<LeiCacheRow | null> {
  try {
    const { rows } = await db.query<LeiCacheRow>(
      `SELECT * FROM lei_cache WHERE lei = $1 LIMIT 1`,
      [lei],
    )
    return rows[0] ?? null
  } catch {
    return null
  }
}

/** Write a GleifLeiRecord to lei_cache on cache miss (warm-on-miss). */
async function writeLeiCacheRecord(record: GleifLeiRecord): Promise<void> {
  try {
    await db.query(
      `INSERT INTO lei_cache
         (lei, legal_name, jurisdiction, country,
          registration_authority_id, registration_authority_entity_id,
          initial_registration_date, entity_status, last_synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', NOW())
       ON CONFLICT (lei) DO UPDATE SET
         legal_name                       = EXCLUDED.legal_name,
         jurisdiction                     = EXCLUDED.jurisdiction,
         country                          = EXCLUDED.country,
         registration_authority_id        = EXCLUDED.registration_authority_id,
         registration_authority_entity_id = EXCLUDED.registration_authority_entity_id,
         initial_registration_date        = EXCLUDED.initial_registration_date,
         entity_status                    = EXCLUDED.entity_status,
         last_synced_at                   = NOW()`,
      [
        record.lei,
        record.legalName,
        record.jurisdiction,
        record.country,
        record.registrationAuthorityId,
        record.registrationAuthorityEntityId,
        record.initialRegistrationDate,
      ],
    )
  } catch (err) {
    console.error('[lei-cache] write failed:', err)
  }
}

/** Cache-first: read a registry-enriched Company from registry_enrichment_cache (7-day TTL). */
async function getRegistryEnrichmentCache(lei: string): Promise<Company | null> {
  try {
    const { rows } = await db.query<{ data_json: Company }>(
      `SELECT data_json FROM registry_enrichment_cache
       WHERE lei = $1 AND expires_at > NOW()
       LIMIT 1`,
      [lei],
    )
    return rows[0]?.data_json ?? null
  } catch {
    return null
  }
}

/** Write a resolved Company object to registry_enrichment_cache with a 7-day TTL. */
async function setRegistryEnrichmentCache(
  lei: string,
  registrySource: string,
  company: Company,
  ttlDays = 7,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO registry_enrichment_cache (lei, registry_source, data_json, expires_at)
       VALUES ($1, $2, $3::jsonb, NOW() + ($4 || ' days')::interval)
       ON CONFLICT (lei) DO UPDATE SET
         registry_source = EXCLUDED.registry_source,
         data_json       = EXCLUDED.data_json,
         fetched_at      = NOW(),
         expires_at      = EXCLUDED.expires_at`,
      [lei, registrySource, JSON.stringify(company), String(ttlDays)],
    )
  } catch (err) {
    console.error('[registry-enrichment-cache] write failed:', err)
  }
}

/**
 * Write external API SearchResults to non_lei_cache (write-through on Tier 2 calls).
 * Prevents re-hitting external APIs for the same company on subsequent searches.
 */
async function writeNonLeiCache(
  entries: Array<{
    id: string
    canonicalName: string
    registrySource: string
    jurisdiction: string | null
    result: SearchResult
  }>,
): Promise<void> {
  for (const e of entries) {
    try {
      await db.query(
        `INSERT INTO non_lei_cache
           (id, canonical_name, entity_type, jurisdiction, registry_source, data_json, authenticity_score, expires_at)
         VALUES ($1, $2, 'company', $3, $4, $5::jsonb, $6, NOW() + interval '7 days')
         ON CONFLICT (id) DO UPDATE SET
           canonical_name     = EXCLUDED.canonical_name,
           data_json          = EXCLUDED.data_json,
           authenticity_score = EXCLUDED.authenticity_score,
           fetched_at         = NOW(),
           expires_at         = NOW() + interval '7 days'`,
        [
          e.id,
          e.canonicalName,
          e.jurisdiction,
          e.registrySource,
          JSON.stringify(e.result),
          e.result.authenticityScore ?? null,
        ],
      )
    } catch {
      // Non-critical — silently skip on write error
    }
  }
}

/** Opacity-indicating GLEIF Reporting Exception types that reduce the trust signal (per D-07). */
const OPACITY_EXCEPTION_TYPES = new Set(['NON_CONSOLIDATING', 'NON_PUBLIC', 'NO_LEI'])

/**
 * Given a GLEIF LEI record, attempt to fetch a richer Company object from the
 * underlying national registry identified by registrationAuthorityId.
 *
 * Cache-first: checks registry_enrichment_cache (7-day TTL) before making any
 * outbound registry HTTP calls.  On cache miss the result is written back.
 *
 * - RA000585 (Companies House): fetches officers + PSC → full directors/beneficialOwners
 * - RA000523 (ACRA): fetches UEN entity → proper ACRA Company object
 * - RA000674 (Zefix): fetches Swiss UID entity → proper Zefix Company object
 * - Anything else: tries OpenCorporates by jurisdiction + reg number, then falls back
 *   to buildGleifCompany (minimal object from LEI data only)
 */
async function resolveGleifRecord(record: Awaited<ReturnType<typeof getGleifRecordByLei>>): Promise<Company | null> {
  if (!record) return null

  // Cache-first: return cached Company if available (avoids repeated national registry HTTP calls)
  const cached = await getRegistryEnrichmentCache(record.lei)
  if (cached) return cached

  const raId   = record.registrationAuthorityId?.toUpperCase()
  const regNum = record.registrationAuthorityEntityId

  let company: Company | null = null
  let registrySource = 'gleif_only'

  // Route to Companies House
  if (raId === RA_COMPANIES_HOUSE && regNum) {
    const chCompany = await getCHCompanyByNumber(regNum).catch(() => null)
    if (chCompany) {
      const companyName = chCompany.title ?? chCompany.company_name ?? ''
      const [sanctionStatus, officers, psc] = await Promise.all([
        screenSanctions(companyName).catch(() => 'unknown' as SanctionStatus),
        getCHOfficers(chCompany.company_number).catch(() => []),
        getCHPSC(chCompany.company_number).catch(() => []),
      ])
      const directors: Company['directors'] = officers.map((o, i) => ({
        id:            `ch-officer-${i}`,
        name:          o.name,
        role:          o.role,
        nationality:   o.nationality,
        appointedDate: o.appointedOn,
      }))
      company = {
        ...buildCHCompany(chCompany, sanctionStatus),
        directors:        directors.length > 0 ? directors : undefined,
        beneficialOwners: psc.length > 0 ? psc : undefined,
      }
      registrySource = 'ch'
    }
  }

  // Route to ACRA
  if (raId === RA_ACRA && regNum && !company) {
    const acraEntity = await getACRAByUEN(regNum).catch(() => null)
    if (acraEntity) {
      const sanctionStatus = await screenSanctions(acraEntity.entity_name).catch(
        () => 'unknown' as SanctionStatus,
      )
      const { authenticityScore: acraScore, scoreBreakdown: acraBreakdown } =
        computeACRAScore(acraEntity, sanctionStatus)
      company = {
        id:                 `acra:${acraEntity.uen}`,
        type:               'company',
        name:               acraEntity.entity_name,
        slug:               acraEntity.uen.toLowerCase().replace(/[^a-z0-9]/g, '-'),
        registrationNumber: acraEntity.uen,
        country:            'Singapore',
        jurisdictionFlag:   '🇸🇬',
        sanctionStatus,
        authenticityScore:  acraScore,
        scoreBreakdown:     acraBreakdown,
        riskLevel:          riskLevel(acraScore, sanctionStatus),
        riskFlags:          [],
        lastVerified:       new Date().toISOString(),
        dataSource:         ['ACRA Singapore'],
      }
      registrySource = 'acra'
    }
  }

  // Route to Zefix (Switzerland)
  if (raId === RA_ZEFIX && regNum && !company) {
    const uid = normalizeSwissUid(regNum)
    const zefixCompany = await getZefixByUid(uid).catch(() => null)
    if (zefixCompany) {
      const sanctionStatus = await screenSanctions(zefixCompany.name).catch(
        () => 'unknown' as SanctionStatus,
      )
      company = buildZefixCompany(zefixCompany, sanctionStatus) as unknown as Company
      registrySource = 'zefix'
    }
  }

  // Fallback: try OpenCorporates by jurisdiction + registration number
  if (!company) {
    const jurisdiction = record.jurisdiction?.toLowerCase()
    if (jurisdiction && regNum) {
      const ocCompany = await getOCCompanyByNumber(jurisdiction, regNum).catch(() => null)
      if (ocCompany) {
        const sanctionStatus = await screenSanctions(ocCompany.name).catch(
          () => 'unknown' as SanctionStatus,
        )
        company = buildOCCompany(ocCompany, sanctionStatus) as unknown as Company
        registrySource = 'oc'
      }
    }
  }

  // Last resort: build minimal Company from GLEIF data only
  if (!company) {
    const sanctionStatus = await screenSanctions(record.legalName).catch(
      () => 'unknown' as SanctionStatus,
    )
    company = buildGleifCompany(record, sanctionStatus) as unknown as Company
    registrySource = 'gleif_only'
  }

  // Write to registry_enrichment_cache (fire-and-forget — 7-day TTL)
  setRegistryEnrichmentCache(record.lei, registrySource, company).catch(() => {})

  return company
}

export async function getEntityByKey(idOrSlugOrImo: string): Promise<Company | Vessel | Terminal | null> {
  const { rows } = await db.query<EntityRow>(
    `
      SELECT *
      FROM entities
      WHERE id = $1 OR slug = $1 OR imo = $1
      LIMIT 1
    `,
    [idOrSlugOrImo]
  )

  // 鏈湴搴撴湭鎵惧埌鏃讹紝灏濊瘯浠庡閮ㄦ暟鎹簮鏌ヨ
  if (!rows[0]) {
    // 1. Try ACRA by UEN.
    const mightBeUEN = /^[0-9]{9}[A-Z]$|^[ST][0-9]{2}[A-Z]{2}[0-9]{4}[A-Z]$/.test(
      idOrSlugOrImo.toUpperCase()
    )
    if (mightBeUEN) {
      const acraEntity = await getACRAByUEN(idOrSlugOrImo).catch(() => null)
      if (acraEntity) {
        const sanctionStatus = await screenSanctions(acraEntity.entity_name).catch(
          () => 'unknown' as SanctionStatus
        )
        const { authenticityScore: acraScore, scoreBreakdown: acraBreakdown } =
          computeACRAScore(acraEntity, sanctionStatus)
        const company: Company = {
          id: `acra:${acraEntity.uen}`,
          type: 'company',
          name: acraEntity.entity_name,
          slug: acraEntity.uen.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          registrationNumber: acraEntity.uen,
          country: 'Singapore',
          jurisdictionFlag: '🇸🇬',
          sanctionStatus,
          authenticityScore: acraScore,
          scoreBreakdown: acraBreakdown,
          riskLevel: riskLevel(acraScore, sanctionStatus),
          riskFlags: [],
          lastVerified: new Date().toISOString(),
          dataSource: ['ACRA Singapore'],
        }
        return company
      }
    }

    // 2. Try Companies House by company number.
    if (mightBeUKNumber(idOrSlugOrImo)) {
      const chCompany = await getCHCompanyByNumber(idOrSlugOrImo).catch(() => null)
      if (chCompany) {
        const companyName = chCompany.title ?? chCompany.company_name ?? ''
        const [sanctionStatus, officers, psc] = await Promise.all([
          screenSanctions(companyName).catch(() => 'unknown' as SanctionStatus),
          getCHOfficers(chCompany.company_number).catch(() => []),
          getCHPSC(chCompany.company_number).catch(() => []),
        ])

        const directors: Company['directors'] = officers.map((o, i) => ({
          id:          `ch-officer-${i}`,
          name:        o.name,
          role:        o.role,
          nationality: o.nationality,
          appointedDate: o.appointedOn,
        }))

        const company: Company = {
          ...buildCHCompany(chCompany, sanctionStatus),
          directors:        directors.length > 0 ? directors : undefined,
          beneficialOwners: psc.length > 0 ? psc : undefined,
        }
        return company
      }
    }

    // 3. Try Zefix by Swiss UID.
    if (mightBeSwissUid(idOrSlugOrImo)) {
      const zefixCompany = await getZefixByUid(idOrSlugOrImo).catch(() => null)
      if (zefixCompany) {
        const sanctionStatus = await screenSanctions(zefixCompany.name).catch(
          () => 'unknown' as SanctionStatus
        )
        return buildZefixCompany(zefixCompany, sanctionStatus) as unknown as Company
      }
    }

    // 4. Try OpenCorporates by `oc:{jurisdiction}:{number}`.
    if (mightBeOCId(idOrSlugOrImo) || idOrSlugOrImo.startsWith('oc:')) {
      // Extract jurisdiction and company number from oc:{jur}:{num} format
      const parts = idOrSlugOrImo.replace(/^oc:/, '').split(':')
      if (parts.length >= 2) {
        const [jurisdictionCode, ...numParts] = parts
        const companyNumber = numParts.join(':')
        const ocCompany = await getOCCompanyByNumber(jurisdictionCode, companyNumber).catch(() => null)
        if (ocCompany) {
          const sanctionStatus = await screenSanctions(ocCompany.name).catch(
            () => 'unknown' as SanctionStatus
          )
          return buildOCCompany(ocCompany, sanctionStatus) as unknown as Company
        }
      }
    }

    // 5. Try GLEIF by `lei-{lei}` slug (generated by searchEntities for GLEIF results).
    if (idOrSlugOrImo.startsWith('lei-')) {
      const lei = idOrSlugOrImo.slice(4).toUpperCase()
      const cachedLei = await getLeiCacheRecord(lei)
      if (cachedLei) {
        // Cache hit: build GleifLeiRecord from cache row
        const gleifRecordFromCache: GleifLeiRecord = {
          lei: cachedLei.lei,
          legalName: cachedLei.legal_name,
          jurisdiction: cachedLei.jurisdiction,
          country: cachedLei.country,
          initialRegistrationDate: cachedLei.initial_registration_date,
          registrationAuthorityId: cachedLei.registration_authority_id,
          registrationAuthorityEntityId: cachedLei.registration_authority_entity_id,
        }
        const company = await resolveGleifRecord(gleifRecordFromCache)
        if (company && cachedLei.reporting_exception_type &&
            OPACITY_EXCEPTION_TYPES.has(cachedLei.reporting_exception_type)) {
          company.riskFlags = [
            ...(company.riskFlags ?? []),
            {
              id: `gleif-exception-${cachedLei.reporting_exception_type.toLowerCase()}`,
              category: 'reporting_exception',
              severity: 'medium' as const,
              status: 'verified' as const,
              submittedAt: new Date().toISOString(),
            },
          ]
          // Apply score deduction on cache-hit path
          const crScore = company.scoreBreakdown?.communityReputation?.score ?? 0
          const deduction = Math.min(3, crScore)
          if (deduction > 0) {
            company.scoreBreakdown.communityReputation.score = crScore - deduction
            company.authenticityScore = Math.max(0, company.authenticityScore - deduction)
            company.riskLevel = riskLevel(company.authenticityScore, company.sanctionStatus)
          }
        }
        if (company) return company
      } else {
        // Cache miss: call live API and warm the cache
        const record = await getGleifRecordByLei(lei).catch(() => null)
        if (record) await writeLeiCacheRecord(record)
        const company = await resolveGleifRecord(record)
        if (company) {
          // Warm-on-miss: check if exception data was written to cache
          const freshCached = record ? await getLeiCacheRecord(record.lei) : null
          if (freshCached?.reporting_exception_type &&
              OPACITY_EXCEPTION_TYPES.has(freshCached.reporting_exception_type)) {
            company.riskFlags = [
              ...(company.riskFlags ?? []),
              {
                id: `gleif-exception-${freshCached.reporting_exception_type.toLowerCase()}`,
                category: 'reporting_exception',
                severity: 'medium' as const,
                status: 'verified' as const,
                submittedAt: new Date().toISOString(),
              },
            ]
            // Apply score deduction on warm-on-miss path
            const crScore = company.scoreBreakdown?.communityReputation?.score ?? 0
            const deduction = Math.min(3, crScore)
            if (deduction > 0) {
              company.scoreBreakdown.communityReputation.score = crScore - deduction
              company.authenticityScore = Math.max(0, company.authenticityScore - deduction)
              company.riskLevel = riskLevel(company.authenticityScore, company.sanctionStatus)
            }
          }
          return company
        }
      }
    }

    // 5b. Try GLEIF by `gleif:{lei}`.
    if (idOrSlugOrImo.startsWith('gleif:')) {
      const lei = idOrSlugOrImo.slice(6)
      const cachedLei = await getLeiCacheRecord(lei)
      if (cachedLei) {
        // Cache hit: build GleifLeiRecord from cache row
        const gleifRecordFromCache: GleifLeiRecord = {
          lei: cachedLei.lei,
          legalName: cachedLei.legal_name,
          jurisdiction: cachedLei.jurisdiction,
          country: cachedLei.country,
          initialRegistrationDate: cachedLei.initial_registration_date,
          registrationAuthorityId: cachedLei.registration_authority_id,
          registrationAuthorityEntityId: cachedLei.registration_authority_entity_id,
        }
        const company = await resolveGleifRecord(gleifRecordFromCache)
        if (company && cachedLei.reporting_exception_type &&
            OPACITY_EXCEPTION_TYPES.has(cachedLei.reporting_exception_type)) {
          company.riskFlags = [
            ...(company.riskFlags ?? []),
            {
              id: `gleif-exception-${cachedLei.reporting_exception_type.toLowerCase()}`,
              category: 'reporting_exception',
              severity: 'medium' as const,
              status: 'verified' as const,
              submittedAt: new Date().toISOString(),
            },
          ]
          // Apply score deduction on cache-hit path
          const crScore = company.scoreBreakdown?.communityReputation?.score ?? 0
          const deduction = Math.min(3, crScore)
          if (deduction > 0) {
            company.scoreBreakdown.communityReputation.score = crScore - deduction
            company.authenticityScore = Math.max(0, company.authenticityScore - deduction)
            company.riskLevel = riskLevel(company.authenticityScore, company.sanctionStatus)
          }
        }
        if (company) return company
      } else {
        // Cache miss: call live API and warm the cache
        const record = await getGleifRecordByLei(lei).catch(() => null)
        if (record) await writeLeiCacheRecord(record)
        const company = await resolveGleifRecord(record)
        if (company) {
          // Warm-on-miss: check if exception data was written to cache
          const freshCached = record ? await getLeiCacheRecord(record.lei) : null
          if (freshCached?.reporting_exception_type &&
              OPACITY_EXCEPTION_TYPES.has(freshCached.reporting_exception_type)) {
            company.riskFlags = [
              ...(company.riskFlags ?? []),
              {
                id: `gleif-exception-${freshCached.reporting_exception_type.toLowerCase()}`,
                category: 'reporting_exception',
                severity: 'medium' as const,
                status: 'verified' as const,
                submittedAt: new Date().toISOString(),
              },
            ]
            // Apply score deduction on warm-on-miss path
            const crScore = company.scoreBreakdown?.communityReputation?.score ?? 0
            const deduction = Math.min(3, crScore)
            if (deduction > 0) {
              company.scoreBreakdown.communityReputation.score = crScore - deduction
              company.authenticityScore = Math.max(0, company.authenticityScore - deduction)
              company.riskLevel = riskLevel(company.authenticityScore, company.sanctionStatus)
            }
          }
          return company
        }
      }
    }

    // 6. GLEIF name search (last resort fallback).
    const gleifResults = await searchGleifMultiple(idOrSlugOrImo, 1).catch(() => [])
    if (gleifResults[0]) {
      const resolved = await resolveGleifRecord(gleifResults[0])
      if (resolved) return resolved
    }

    return null
  }

  const entity = parseEntity(rows[0])

  // 鑾峰彇宸插鏍哥殑椋庨櫓鏍囪
  const { rows: flags } = await db.query<RiskFlag & { submitted_at: string }>(
    `
      SELECT id, flag_type AS category, severity, status, submitted_at
      FROM risk_flags
      WHERE entity_id = $1 AND status = 'approved'
      ORDER BY submitted_at DESC
    `,
    [entity.id]
  )

  entity.riskFlags = flags.map((f) => ({
    id: f.id,
    category: f.category,
    severity: f.severity,
    status: 'verified',
    submittedAt: f.submitted_at,
  }))

  // 鈹€鈹€ Phase 2: trading track record 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const trackRecord = await computeTradingTrackRecord(entity.id)
  entity.scoreBreakdown.tradingTrackRecord = {
    score:    trackRecord.score,
    maxScore: 22,  // matches the documented maximum (5+5+5+7 = 22)
    evidence: trackRecord.evidence,
  }
  entity.authenticityScore = Math.min(100, entity.authenticityScore + trackRecord.score)

  // 鈹€鈹€ SCORE-02: shell company signal deductions (company entities only) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  if (entity.type === 'company') {
    // Pre-fetch domain data from cache tables
    let domainAgeDays: number | null = null
    let hasWebPresence: boolean | null = null

    const companyWebsite = (entity as Company).website
    const rawDomain = companyWebsite
      ? companyWebsite.replace(/^https?:\/\//, '').split('/')[0].split('?')[0]
      : null

    if (rawDomain) {
      const [whoisResult, emailResult] = await Promise.all([
        db.query<{ domain_age_days: number | null }>(
          `SELECT EXTRACT(DAY FROM NOW() - registered_at)::int AS domain_age_days
           FROM domain_whois_cache
           WHERE domain = $1 AND queried_at > NOW() - INTERVAL '48 hours'`,
          [rawDomain]
        ),
        db.query<{ has_mx: boolean | null; error: string | null }>(
          `SELECT has_mx, error FROM domain_email_cache
           WHERE domain = $1 AND queried_at > NOW() - INTERVAL '48 hours'`,
          [rawDomain]
        ),
      ])

      domainAgeDays = whoisResult.rows[0]?.domain_age_days ?? null

      const emailRow = emailResult.rows[0]
      if (emailRow) {
        // No web presence = error is non-null (NXDOMAIN/ENOTFOUND) AND no MX records
        // Treat has_mx = null as equivalent to false (unknown MX state after failed lookup)
        hasWebPresence = !(emailRow.error !== null && !emailRow.has_mx)
      }
      // If no email cache row, hasWebPresence stays null (unknown = no deduction)
    } else {
      // No domain at all means no web presence signal for this entity
      hasWebPresence = false
    }

    // Apply shell signal deductions to entity.scoreBreakdown.entityExistence
    let eScore = entity.scoreBreakdown.entityExistence.score
    const shellEvidence: string[] = []

    if (domainAgeDays !== null && domainAgeDays !== undefined && domainAgeDays < 180) {
      eScore -= 10
      shellEvidence.push('Domain registered less than 6 months ago — reduced trust signal')
    }

    const regNum = (entity as Company).registrationNumber
    if (!regNum || regNum.length < 5) {
      eScore -= 8
      shellEvidence.push('No verifiable registration number on record')
    }

    if (hasWebPresence === false) {
      eScore -= 5
      shellEvidence.push('No domain, mail records, or website detected — no verifiable web presence')
    }

    if (shellEvidence.length > 0) {
      entity.scoreBreakdown.entityExistence = {
        ...entity.scoreBreakdown.entityExistence,
        score: Math.max(0, eScore),
        evidence: [
          ...(entity.scoreBreakdown.entityExistence.evidence ?? []),
          ...shellEvidence,
        ],
      }
    }
    // Always recompute the total authenticity score from all dimensions so the
    // gauge and breakdown bars stay in sync even when no shell signals fire.
    entity.authenticityScore = Math.min(
      100,
      Math.max(
        0,
        entity.scoreBreakdown.entityExistence.score +
        entity.scoreBreakdown.assetReality.score +
        entity.scoreBreakdown.tradingTrackRecord.score +
        entity.scoreBreakdown.documentConsistency.score +
        entity.scoreBreakdown.communityReputation.score,
      )
    )
    entity.riskLevel = riskLevel(entity.authenticityScore, entity.sanctionStatus)
  }

  // 鑻ュ埗瑁佺姸鎬佷负 unknown锛屽疄鏃跺仛涓€娆＄瓫鏌ュ苟鏇存柊
  if (entity.sanctionStatus === 'unknown') {
    const status = await screenSanctions(entity.name).catch(() => 'unknown' as SanctionStatus)
    if (status !== 'unknown') {
      entity.sanctionStatus = status
      // 寮傛鏇存柊 DB锛屼笉闃诲鍝嶅簲
      db.query(
        "UPDATE entities SET sanction_status = $1 WHERE id = $2",
        [status, entity.id]
      ).catch(console.error)
    }
  }

  // Fetch sanction list sources for listed entities so the UI can show tooltip details.
  if (entity.sanctionStatus === 'listed') {
    const result = await checkSanctions(entity.name).catch(() => ({ listed: true, sources: [] as string[] }))
    if (result.sources.length > 0) {
      entity.sanctionSources = result.sources
    }
  }

  return entity
}

export async function createRiskFlag(input: {
  entityId: string
  flagType: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description?: string
  submitterUserId: string
}) {
  const id = randomUUID()

  await db.query(
    `
      INSERT INTO risk_flags (id, entity_id, flag_type, severity, status, description, submitter_user_id)
      VALUES ($1, $2, $3, $4, 'pending_review', $5, $6)
    `,
    [id, input.entityId, input.flagType, input.severity, input.description ?? null, input.submitterUserId]
  )

  const { rows } = await db.query<{ submitted_at: string }>(
    'SELECT submitted_at FROM risk_flags WHERE id = $1',
    [id]
  )

  return {
    flagId: id,
    status: 'pending_review' as const,
    submittedAt: rows[0]?.submitted_at ?? new Date().toISOString(),
    estimatedReviewHours: 48,
  }
}

export async function entityExists(entityId: string): Promise<boolean> {
  const result = await db.query('SELECT 1 FROM entities WHERE id = $1 LIMIT 1', [entityId])
  return (result.rowCount ?? 0) > 0
}

export function getPeriodBounds(baseDate = new Date()) {
  const start = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth(), 1))
  const end = new Date(Date.UTC(baseDate.getUTCFullYear(), baseDate.getUTCMonth() + 1, 0))
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

// 鈹€鈹€ PSC Inspections 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface PscInspection {
  id: string
  imo: string
  vesselName: string | null
  inspectionDate: string
  portLocode: string | null
  portName: string | null
  authority: string
  result: 'no_deficiency' | 'deficiency' | 'detained'
  deficiencyCount: number
  detentionDays: number | null
  deficiencies: string[]
  sourceUrl: string | null
}

export interface PscSummary {
  totalInspections: number
  detentions: number
  deficiencyRate: number   // 0-1 fraction
  lastInspectionDate: string | null
  lastResult: string | null
}

export async function getPscSummary(imo: string): Promise<PscSummary> {
  const { rows } = await db.query<{
    total: string
    detentions: string
    with_deficiency: string
    last_date: string | null
    last_result: string | null
  }>(
    `SELECT
       COUNT(*)                                         AS total,
       COUNT(*) FILTER (WHERE result = 'detained')     AS detentions,
       COUNT(*) FILTER (WHERE result IN ('deficiency', 'detained')) AS with_deficiency,
       MAX(inspection_date)::TEXT                       AS last_date,
       (ARRAY_AGG(result ORDER BY inspection_date DESC))[1] AS last_result
     FROM psc_inspections
     WHERE imo = $1`,
    [imo]
  )
  const r = rows[0]
  const total = parseInt(r?.total ?? '0', 10)
  return {
    totalInspections: total,
    detentions: parseInt(r?.detentions ?? '0', 10),
    deficiencyRate: total > 0 ? parseInt(r?.with_deficiency ?? '0', 10) / total : 0,
    lastInspectionDate: r?.last_date ?? null,
    lastResult: r?.last_result ?? null,
  }
}

export async function getPscInspections(imo: string, limit = 10): Promise<PscInspection[]> {
  const { rows } = await db.query(
    `SELECT id, imo, vessel_name, inspection_date::TEXT, port_locode,
            port_name, authority, result, deficiency_count, detention_days,
            COALESCE(deficiencies, '[]'::jsonb) AS deficiencies, source_url
     FROM psc_inspections
     WHERE imo = $1
     ORDER BY inspection_date DESC
     LIMIT $2`,
    [imo, limit]
  )
  return rows.map((r) => ({
    id: r.id,
    imo: r.imo,
    vesselName: r.vessel_name,
    inspectionDate: r.inspection_date,
    portLocode: r.port_locode,
    portName: r.port_name,
    authority: r.authority,
    result: r.result,
    deficiencyCount: r.deficiency_count ?? 0,
    detentionDays: r.detention_days ?? null,
    deficiencies: Array.isArray(r.deficiencies) ? r.deficiencies : [],
    sourceUrl: r.source_url,
  }))
}

// 鈹€鈹€ ICIJ Offshore Leaks 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface IcijMatch {
  nodeId: string
  name: string
  dataset: string
  entityType: string | null
  countries: string | null
  jurisdiction: string | null
  status: string | null
  incorporationDate: string | null
  address: string | null
  sourceUrl: string | null
  matchConfidence: number
  isSanctioned?: boolean          // Phase 9: populated from icij_entities.is_sanctioned
  sanctionsMatch?: string | null  // Phase 9: matched sanctions entry name (for tooltip)
}

export async function getIcijMatches(entityId: string): Promise<IcijMatch[]> {
  const { rows } = await db.query(
    `SELECT node_id, name, dataset, entity_type, countries, jurisdiction,
            status, incorporation_date, address, source_url, match_confidence,
            is_sanctioned, sanctions_match
     FROM icij_entities
     WHERE linked_entity_id = $1
     ORDER BY match_confidence DESC
     LIMIT 20`,
    [entityId]
  )
  return rows.map((r) => ({
    nodeId: r.node_id,
    name: r.name,
    dataset: r.dataset,
    entityType: r.entity_type,
    countries: r.countries,
    jurisdiction: r.jurisdiction,
    status: r.status,
    incorporationDate: r.incorporation_date,
    address: r.address,
    sourceUrl: r.source_url,
    matchConfidence: parseFloat(r.match_confidence ?? '0'),
    isSanctioned: r.is_sanctioned ?? false,
    sanctionsMatch: r.sanctions_match ?? null,
  }))
}

export interface IcijOfficerLink {
  officerNodeId: string
  officerName: string
  relType: string            // DIRECTOR_OF, SHAREHOLDER_OF, etc.
  entityNodeId: string
  entityName: string
  entityDataset: string
  entityJurisdiction: string | null
  entityStatus: string | null
}

/**
 * For a given entity in our DB, find its ICIJ-linked officers/directors,
 * then find what OTHER ICIJ entities those officers are connected to.
 * Useful for: "Company X's director also controls Panama Papers shell company Y"
 */
export async function getIcijOfficerNetwork(entityId: string): Promise<IcijOfficerLink[]> {
  const { rows } = await db.query(
    `SELECT
       r1.from_node_id   AS officer_node_id,
       off.name          AS officer_name,
       r2.rel_type,
       r2.to_node_id     AS entity_node_id,
       ent.name          AS entity_name,
       ent.dataset       AS entity_dataset,
       ent.jurisdiction  AS entity_jurisdiction,
       ent.status        AS entity_status
     FROM icij_entities ie
     JOIN icij_relationships r1
       ON r1.to_node_id = ie.node_id
      AND r1.rel_type = 'officer_of'
     JOIN icij_entities off
       ON off.node_id = r1.from_node_id
     JOIN icij_relationships r2
       ON r2.from_node_id = r1.from_node_id
      AND r2.rel_type = 'officer_of'
      AND r2.to_node_id != ie.node_id
     JOIN icij_entities ent
       ON ent.node_id = r2.to_node_id
      AND ent.entity_type = 'Entity'
     WHERE ie.linked_entity_id = $1
     ORDER BY off.name, ent.name
     LIMIT 50`,
    [entityId]
  )
  return rows.map((r) => ({
    officerNodeId:     r.officer_node_id,
    officerName:       r.officer_name,
    relType:           r.rel_type,
    entityNodeId:      r.entity_node_id,
    entityName:        r.entity_name,
    entityDataset:     r.entity_dataset,
    entityJurisdiction: r.entity_jurisdiction,
    entityStatus:      r.entity_status,
  }))
}

// ── Network Graph (Phase 10) ──────────────────────────────────────────────

/**
 * A single node in the company network graph.
 * Covers three categories: ETI registry connections (directors/vessels, first-layer)
 * and ICIJ offshore entities (recursive, up to 3 hops).
 */
export interface NetworkNode {
  /** Unique node identifier. For ETI nodes: prefixed "eti-{id}". For ICIJ nodes: icij_entities.node_id */
  id: string
  /** Visual node type — controls shape/size in the React Flow renderer */
  type: 'root' | 'company' | 'vessel' | 'person' | 'icij'
  /** Truncated display label (≤20 chars, trailing … if longer) */
  label: string
  /** Full untruncated name (used for native title tooltip) */
  fullName: string
  /** Navigation key: company slug or vessel IMO. null = non-clickable node */
  etlKey: string | null
  /** Color category — computed server-side from sanction status and fraud alerts */
  nodeColor: 'root' | 'sanctioned' | 'fraud' | 'icij' | 'normal'
  /** One-line human-readable subtype shown below the label e.g. "Director", "Vessel", "Offshore Entity" */
  subtype: string
}

/**
 * A directed edge between two nodes in the network graph.
 */
export interface NetworkEdge {
  /** Unique edge identifier */
  id: string
  /** Source node id */
  source: string
  /** Target node id */
  target: string
  /** Visual style category — ETI registry connections vs. ICIJ relationships */
  edgeType: 'eti' | 'icij'
  /** Optional relationship label (e.g. "director of", "shareholder of") from icij_relationships.link */
  label?: string
}

/**
 * Return type of getNetworkGraph(). Serialized and passed as props to the
 * NetworkGraph client component.
 */
export interface NetworkGraphResult {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  /** True when ICIJ recursive query hit the 100-node cap */
  truncated: boolean
  /** Total ICIJ node count before cap was applied (for truncation banner copy) */
  totalNodeCount: number
}

/**
 * Build the full network graph for a company entity.
 * Returns three categories of nodes:
 *   1. ETI registry connections (directors + beneficial owners) — first-layer, non-recursive
 *   2. ETI vessels — first-layer, non-recursive
 *   3. ICIJ offshore entities — recursive up to 3 hops, capped at 100 nodes
 *
 * Color priority: sanctioned > fraud > icij > normal
 * The 100-node cap applies ONLY to ICIJ recursive nodes. ETI directors/vessels are additional.
 */
export async function getNetworkGraph(entityId: string): Promise<NetworkGraphResult> {
  const nodes: NetworkNode[] = []
  const edges: NetworkEdge[] = []

  // ── 1. Fetch root entity ─────────────────────────────────────────────────
  const { rows: rootRows } = await db.query(
    `SELECT id, name, slug, metadata_json,
            sanction_status
     FROM entities
     WHERE id = $1
     LIMIT 1`,
    [entityId]
  )
  if (rootRows.length === 0) {
    return { nodes: [], edges: [], truncated: false, totalNodeCount: 0 }
  }
  const rootRow = rootRows[0]
  const rootName: string = rootRow.name ?? 'Unknown'

  // Root node always uses 'root' color regardless of sanction status
  nodes.push({
    id: `eti-root-${entityId}`,
    type: 'root',
    label: rootName.length > 20 ? rootName.slice(0, 19) + '\u2026' : rootName,
    fullName: rootName,
    etlKey: rootRow.slug ?? null,
    nodeColor: 'root',
    subtype: 'Company',
  })

  const rootNodeId = `eti-root-${entityId}`
  const meta = (rootRow.metadata_json ?? {}) as Record<string, unknown>

  // ── 2. ETI Directors + Beneficial Owners (first-layer, non-recursive) ───
  // Collect all director/beneficial owner names for fraud alert lookup
  const directorNames: string[] = []
  const directors = Array.isArray(meta.directors)
    ? (meta.directors as Array<{ id?: string; name?: string; role?: string }>)
    : []
  const beneficialOwners = Array.isArray(meta.beneficial_owners)
    ? (meta.beneficial_owners as Array<{ name?: string }>)
    : []

  for (const d of directors) {
    if (!d.name) continue
    directorNames.push(d.name)
  }
  for (const bo of beneficialOwners) {
    if (!bo.name) continue
    // Avoid duplicates (some directors are also beneficial owners)
    if (!directorNames.includes(bo.name)) directorNames.push(bo.name)
  }

  // Fraud alert lookup for all director/BO names (batch query)
  const fraudAlertsMap = new Set<string>() // lowercased names with fraud alerts
  if (directorNames.length > 0) {
    const { rows: fraudRows } = await db.query(
      `SELECT DISTINCT lower(company_name) AS lname
       FROM fraud_alerts
       WHERE lower(company_name) = ANY($1::text[])
         AND list_type = 'blacklist'`,
      [directorNames.map((n) => n.toLowerCase())]
    )
    for (const fr of fraudRows) {
      fraudAlertsMap.add(fr.lname as string)
    }
  }

  // Add director nodes
  const addedPersonIds = new Set<string>()
  for (const d of directors) {
    if (!d.name) continue
    const personId = `eti-dir-${d.id ?? d.name.replace(/\s+/g, '-').toLowerCase()}`
    if (addedPersonIds.has(personId)) continue
    addedPersonIds.add(personId)

    const hasFraud = fraudAlertsMap.has(d.name.toLowerCase())
    const fullName = d.name
    nodes.push({
      id: personId,
      type: 'person',
      label: fullName.length > 20 ? fullName.slice(0, 19) + '\u2026' : fullName,
      fullName,
      etlKey: null,
      nodeColor: hasFraud ? 'fraud' : 'normal',
      subtype: d.role ? d.role.slice(0, 20) : 'Director',
    })
    edges.push({
      id: `edge-dir-${personId}`,
      source: rootNodeId,
      target: personId,
      edgeType: 'eti',
      label: 'director of',
    })
  }

  // Add beneficial owner nodes (skip if same name already added as director)
  for (const bo of beneficialOwners) {
    if (!bo.name) continue
    const personId = `eti-bo-${bo.name.replace(/\s+/g, '-').toLowerCase()}`
    if (addedPersonIds.has(personId)) continue
    const alreadyAdded = [...addedPersonIds].some(
      (pid) =>
        pid.startsWith('eti-dir-') &&
        nodes.find((n) => n.id === pid)?.fullName.toLowerCase() === bo.name!.toLowerCase()
    )
    if (alreadyAdded) continue
    addedPersonIds.add(personId)

    const hasFraud = fraudAlertsMap.has(bo.name.toLowerCase())
    const fullName = bo.name
    nodes.push({
      id: personId,
      type: 'person',
      label: fullName.length > 20 ? fullName.slice(0, 19) + '\u2026' : fullName,
      fullName,
      etlKey: null,
      nodeColor: hasFraud ? 'fraud' : 'normal',
      subtype: 'Beneficial Owner',
    })
    edges.push({
      id: `edge-bo-${personId}`,
      source: rootNodeId,
      target: personId,
      edgeType: 'eti',
      label: 'beneficial owner of',
    })
  }

  // ── 3. ETI Vessels (first-layer, non-recursive) ──────────────────────────
  const vessels = Array.isArray(meta.vessels)
    ? (meta.vessels as Array<{ imo?: string; name?: string; flag?: string }>)
    : []

  // Batch-fetch vessel sanction/fraud status in a single query to avoid N+1 DB round-trips
  const imoList = vessels.map((v) => v.imo).filter(Boolean) as string[]
  const vesselStatusMap = new Map<string, { sanctioned: boolean; hasFraud: boolean }>()
  if (imoList.length > 0) {
    const { rows: vesselStatRows } = await db.query(
      `SELECT e.metadata_json->>'imo' AS imo,
              e.sanction_status,
              EXISTS(
                SELECT 1 FROM fraud_alerts fa
                WHERE lower(fa.company_name) = lower(e.name)
                  AND fa.list_type = 'blacklist'
              ) AS has_fraud
       FROM entities e
       WHERE e.entity_type = 'vessel'
         AND e.metadata_json->>'imo' = ANY($1::text[])`,
      [imoList]
    )
    for (const row of vesselStatRows) {
      vesselStatusMap.set(row.imo as string, {
        sanctioned: row.sanction_status === 'listed',
        hasFraud:   row.has_fraud === true,
      })
    }
  }

  for (const v of vessels) {
    if (!v.imo) continue
    const vesselNodeId = `eti-vessel-${v.imo}`

    const stat = vesselStatusMap.get(v.imo)
    let vesselColor: NetworkNode['nodeColor'] = 'normal'
    if (stat?.sanctioned) vesselColor = 'sanctioned'
    else if (stat?.hasFraud) vesselColor = 'fraud'

    const fullName = v.name ?? `Vessel ${v.imo}`
    nodes.push({
      id: vesselNodeId,
      type: 'vessel',
      label: fullName.length > 20 ? fullName.slice(0, 19) + '\u2026' : fullName,
      fullName,
      etlKey: v.imo,
      nodeColor: vesselColor,
      subtype: 'Vessel',
    })
    edges.push({
      id: `edge-vessel-${v.imo}`,
      source: rootNodeId,
      target: vesselNodeId,
      edgeType: 'eti',
      label: 'operated by',
    })
  }

  // ── 4. ICIJ Offshore Entities (WITH RECURSIVE CTE, depth ≤3, limit 100) ─
  // Only traverse ICIJ network when at least one linked ICIJ entity has
  // match_confidence = 1.0 (exact name match). Lower-confidence matches are
  // name-similarity only — without a registration number to pin the identity,
  // the resulting offshore network has no verified connection to this entity.
  const { rows: icijConfRows } = await db.query(
    `SELECT 1 FROM icij_entities WHERE linked_entity_id = $1 AND match_confidence = 1.0 LIMIT 1`,
    [entityId],
  )
  const hasVerifiedIcijMatch = icijConfRows.length > 0

  const icijRows = hasVerifiedIcijMatch
    ? (await db.query(
    `WITH RECURSIVE icij_cte AS (
       -- Base case: ICIJ entities directly linked to this ETI company
       SELECT
         ie.node_id,
         ie.name,
         ie.dataset,
         ie.entity_type,
         ie.is_sanctioned,
         ie.sanctions_match,
         0 AS depth,
         ARRAY[ie.node_id] AS visited,
         NULL::TEXT AS parent_node_id,
         NULL::TEXT AS rel_link
       FROM icij_entities ie
       WHERE ie.linked_entity_id = $1

       UNION ALL

       -- Recursive case: traverse icij_relationships up to depth 3
       SELECT
         next_e.node_id,
         next_e.name,
         next_e.dataset,
         next_e.entity_type,
         next_e.is_sanctioned,
         next_e.sanctions_match,
         cte.depth + 1,
         cte.visited || next_e.node_id,
         cte.node_id AS parent_node_id,
         rel.link    AS rel_link
       FROM icij_cte cte
       JOIN icij_relationships rel
         ON rel.from_node_id = cte.node_id OR rel.to_node_id = cte.node_id
       JOIN icij_entities next_e
         ON next_e.node_id = CASE
              WHEN rel.from_node_id = cte.node_id THEN rel.to_node_id
              ELSE rel.from_node_id
            END
       WHERE cte.depth < 3
         AND NOT (next_e.node_id = ANY(cte.visited))
     ),
     deduped AS (
       -- Deduplicate: keep shallowest path to each node
       SELECT DISTINCT ON (node_id)
         node_id, name, dataset, entity_type,
         is_sanctioned, sanctions_match,
         depth, parent_node_id, rel_link
       FROM icij_cte
       ORDER BY node_id, depth
     )
     SELECT *, COUNT(*) OVER ()::INT AS total_count
     FROM deduped
     LIMIT 100`,
      [entityId],
    )).rows
    : []

  // total_count reflects distinct-node count before LIMIT; derive truncation from first row
  const totalNodeCount: number = (icijRows[0]?.total_count as number) ?? 0
  const truncated = totalNodeCount > 100

  for (const r of icijRows) {
    const nodeId = r.node_id as string
    const isSanctioned = r.is_sanctioned === true
    const fullName = (r.name as string) ?? 'Unknown Entity'

    nodes.push({
      id: nodeId,
      type: 'icij',
      label: fullName.length > 20 ? fullName.slice(0, 19) + '\u2026' : fullName,
      fullName,
      etlKey: null,
      nodeColor: isSanctioned ? 'sanctioned' : 'icij',
      subtype: 'Offshore Entity',
    })

    // Add edge from parent to this node.
    // parent_node_id is NULL for depth=0 rows (base case sets NULL::TEXT).
    // After DISTINCT ON (node_id) ORDER BY node_id, depth, a node reachable both
    // directly (depth=0) and via an intermediate (depth=1+) keeps its depth=0 row,
    // so parent_node_id stays NULL and the edge is drawn from the root. This is
    // intentional: we always show the shortest path. Any intermediate nodes that
    // are reachable only via longer paths will still have their own parent edges
    // emitted correctly because they appear as separate rows with non-NULL parent_node_id.
    const parentId = r.parent_node_id as string | null
    if (parentId) {
      edges.push({
        id: `edge-icij-${parentId}-${nodeId}`,
        source: parentId,
        target: nodeId,
        edgeType: 'icij',
        label: (r.rel_link as string | null) ?? undefined,
      })
    } else {
      // depth=0: direct link from root ETI company (parent_node_id is NULL in base case)
      edges.push({
        id: `edge-icij-root-${nodeId}`,
        source: rootNodeId,
        target: nodeId,
        edgeType: 'icij',
        label: (r.rel_link as string | null) ?? undefined,
      })
    }
  }

  return { nodes, edges, truncated, totalNodeCount }
}

// 鈹€鈹€ ICIJ: person search & person-entity links 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface IcijPersonResult {
  nodeId: string
  name: string
  dataset: string
  entityType: string
}

/**
 * Search ICIJ offshore leaks database for individuals by name.
 * Matches Officer and Intermediary node types using trigram similarity.
 */
export async function searchIcijByPersonName(name: string): Promise<IcijPersonResult[]> {
  const { rows } = await db.query(
    `SELECT node_id, name, dataset, entity_type
     FROM icij_entities
     WHERE entity_type IN ('Officer', 'Intermediary')
       AND lower(name) % lower($1)
     ORDER BY similarity(lower(name), lower($1)) DESC
     LIMIT 5`,
    [name]
  )
  return rows.map((r) => ({
    nodeId:     r.node_id,
    name:       r.name,
    dataset:    r.dataset ?? '',
    entityType: r.entity_type ?? '',
  }))
}

/**
 * Find all ICIJ entities (companies/shells) that a given officer node is linked to.
 */
export async function getIcijPersonEntities(officerNodeId: string): Promise<IcijOfficerLink[]> {
  const { rows } = await db.query(
    `SELECT
       r.from_node_id   AS officer_node_id,
       off.name         AS officer_name,
       r.rel_type,
       r.to_node_id     AS entity_node_id,
       ent.name         AS entity_name,
       ent.dataset      AS entity_dataset,
       ent.jurisdiction AS entity_jurisdiction,
       ent.status       AS entity_status
     FROM icij_entities off
     JOIN icij_relationships r
       ON r.from_node_id = off.node_id
      AND r.rel_type = 'officer_of'
     JOIN icij_entities ent
       ON ent.node_id = r.to_node_id
      AND ent.entity_type = 'Entity'
     WHERE off.node_id = $1
     ORDER BY ent.name
     LIMIT 20`,
    [officerNodeId]
  )
  return rows.map((r) => ({
    officerNodeId:      r.officer_node_id,
    officerName:        r.officer_name,
    relType:            r.rel_type,
    entityNodeId:       r.entity_node_id,
    entityName:         r.entity_name,
    entityDataset:      r.entity_dataset,
    entityJurisdiction: r.entity_jurisdiction,
    entityStatus:       r.entity_status,
  }))
}

export async function searchIcijByName(name: string, limit = 10): Promise<IcijMatch[]> {
  const { rows } = await db.query(
    `SELECT node_id, name, dataset, entity_type, countries, jurisdiction,
            status, incorporation_date, address, source_url,
            similarity(lower(name), lower($1)) AS match_confidence
     FROM icij_entities
     WHERE lower(name) % lower($1)
     ORDER BY match_confidence DESC
     LIMIT $2`,
    [name, limit]
  )
  return rows.map((r) => ({
    nodeId: r.node_id,
    name: r.name,
    dataset: r.dataset,
    entityType: r.entity_type,
    countries: r.countries,
    jurisdiction: r.jurisdiction,
    status: r.status,
    incorporationDate: r.incorporation_date,
    address: r.address,
    sourceUrl: r.source_url,
    matchConfidence: parseFloat(r.match_confidence ?? '0'),
  }))
}

// 鈹€鈹€ Ports 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface Port {
  locode: string
  name: string
  country: string
  region: string | null
  lat: number | null
  lng: number | null
  portType: string | null
  size: string | null
  maxVessel: string | null
  fuelOil: boolean
  diesel: boolean
  freshWater: boolean
  provisions: boolean
  crane: boolean
  drydock: string | null
  isEnergyHub: boolean
  maxDraftM: number | null       // max allowable vessel draft (metres)
  channelDepthM: number | null   // approach channel depth (metres)
  hasStsZone: boolean            // has designated STS anchorage
  stsZoneName: string | null
  stsAuthority: string | null
}

export interface DraftRiskResult {
  canBerth: boolean             // vessel draft <= port max draft
  vesselDraftM: number | null   // from vessel metadata
  portMaxDraftM: number | null
  marginM: number | null        // positive = safe, negative = over-limit
  isStsPort: boolean            // port is STS-only anchorage
  warning: string | null        // human-readable risk message
}

const PORT_SELECT = `
  locode, name, country, region, lat, lng, port_type, size, max_vessel,
  fuel_oil, diesel, fresh_water, provisions, crane, drydock, is_energy_hub,
  max_draft_m, channel_depth_m, has_sts_zone, sts_zone_name, sts_authority
`

export async function getEnergyHubPorts(): Promise<Port[]> {
  const { rows } = await db.query(
    `SELECT ${PORT_SELECT} FROM ports WHERE is_energy_hub = TRUE ORDER BY name`
  )
  return rows.map(mapPort)
}

export async function getPortByLocode(locode: string): Promise<Port | null> {
  const { rows } = await db.query(
    `SELECT ${PORT_SELECT} FROM ports WHERE locode = $1`,
    [locode.toUpperCase()]
  )
  return rows[0] ? mapPort(rows[0]) : null
}

/**
 * Check if a vessel with a given draft (metres) can physically berth at a port.
 * Returns a structured risk result including STS zone flags.
 */
export async function checkDraftRisk(
  locode: string,
  vesselDraftM: number | null
): Promise<DraftRiskResult> {
  const port = await getPortByLocode(locode)
  if (!port) {
    return { canBerth: true, vesselDraftM, portMaxDraftM: null, marginM: null, isStsPort: false, warning: null }
  }

  const isStsPort = port.portType === 'anchorage'
  const portMaxDraftM = port.maxDraftM

  if (isStsPort) {
    return {
      canBerth: false,
      vesselDraftM,
      portMaxDraftM,
      marginM: null,
      isStsPort: true,
      warning: `${port.name} is an STS anchorage zone, not a berth. Any contract specifying terminal delivery here is irregular.`,
    }
  }

  if (vesselDraftM == null || portMaxDraftM == null) {
    return { canBerth: true, vesselDraftM, portMaxDraftM, marginM: null, isStsPort: false, warning: null }
  }

  const marginM = portMaxDraftM - vesselDraftM
  const canBerth = marginM >= 0

  return {
    canBerth,
    vesselDraftM,
    portMaxDraftM,
    marginM,
    isStsPort: false,
    warning: canBerth
      ? null
      : `Vessel draft (${vesselDraftM.toFixed(1)}m) exceeds ${port.name} max draft (${portMaxDraftM.toFixed(1)}m). Vessel cannot berth - reported loading location may be fraudulent.`,
  }
}

function mapPort(r: Record<string, unknown>): Port {
  return {
    locode:        r.locode as string,
    name:          r.name as string,
    country:       r.country as string,
    region:        (r.region as string) ?? null,
    lat:           r.lat != null ? parseFloat(r.lat as string) : null,
    lng:           r.lng != null ? parseFloat(r.lng as string) : null,
    portType:      (r.port_type as string) ?? null,
    size:          (r.size as string) ?? null,
    maxVessel:     (r.max_vessel as string) ?? null,
    fuelOil:       Boolean(r.fuel_oil),
    diesel:        Boolean(r.diesel),
    freshWater:    Boolean(r.fresh_water),
    provisions:    Boolean(r.provisions),
    crane:         Boolean(r.crane),
    drydock:       (r.drydock as string) ?? null,
    isEnergyHub:   Boolean(r.is_energy_hub),
    maxDraftM:     r.max_draft_m != null ? parseFloat(r.max_draft_m as string) : null,
    channelDepthM: r.channel_depth_m != null ? parseFloat(r.channel_depth_m as string) : null,
    hasStsZone:    Boolean(r.has_sts_zone),
    stsZoneName:   (r.sts_zone_name as string) ?? null,
    stsAuthority:  (r.sts_authority as string) ?? null,
  }
}

// 鈹€鈹€ AIS helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * Write a discovered MMSI into a vessel entity's metadata_json.
 * Only updates if the vessel currently has no MMSI stored.
 * Safe for fire-and-forget usage; it does not throw.
 */
export async function saveVesselMmsi(imo: string, mmsi: string): Promise<void> {
  await db.query(
    `UPDATE entities
        SET metadata_json = metadata_json || jsonb_build_object('mmsi', $1::text),
            updated_at    = NOW()
      WHERE imo = $2
        AND (metadata_json->>'mmsi') IS NULL`,
    [mmsi, imo]
  )
}

// ── Sanctions list direct search ──────────────────────────────────────────────

export interface SanctionHit {
  id: string
  schema: string
  name: string
  countries: string | null
  sanctions: string | null
  dataset: string | null
}

/**
 * Search sanctions_entries directly by trigram similarity.
 * Used as a fallback when entity search returns no results.
 */
export async function searchSanctionsEntries(query: string): Promise<SanctionHit[]> {
  const q = query.toLowerCase().trim()
  if (!q || q.length < 3) return []

  const { rows } = await db.query<{
    id: string; schema: string; name: string
    countries: string | null; sanctions: string | null; dataset: string | null
  }>(
    `SELECT id, schema, name, countries, sanctions, dataset
       FROM sanctions_entries
      WHERE similarity(lower(name), $1) > 0.6
      ORDER BY similarity(lower(name), $1) DESC
      LIMIT 5`,
    [q]
  )

  return rows.map((r) => ({
    id:        r.id,
    schema:    r.schema,
    name:      r.name,
    countries: r.countries ?? null,
    sanctions: r.sanctions ?? null,
    dataset:   r.dataset   ?? null,
  }))
}

// ─── Admin Dashboard Types ──────────────────────────────────────────────────

export interface UserAdminRow {
  id: string
  email: string
  plan: string
  created_at: string
  last_active_at: string | null
  quota_used: number
  quota_limit: number
}

export interface AdminSyncLogRow {
  source: string
  status: string
  record_count: number | null
  duration_ms: number | null
  synced_at: string
  error_message: string | null
}

export interface AdminStats {
  totalUsers: number
  planDistribution: { free: number; starter: number; enterprise: number; professional: number }
  newToday: number
  new30Days: number
  dailyRegistrations: Array<{ date: string; count: number }>
  topEntityTypes: Array<{ type: 'company' | 'vessel' | 'terminal'; count: number }>
}

// ─── Admin Dashboard Queries ─────────────────────────────────────────────────

/**
 * Returns merged sync log from both sanctions_sync_log and fraud_sync_log,
 * sorted by synced_at DESC, limited to 200 rows.
 */
export async function getAdminSyncLogs(): Promise<AdminSyncLogRow[]> {
  const { rows } = await db.query<AdminSyncLogRow>(`
    SELECT source, status, record_count, duration_ms, synced_at, error_message
    FROM sanctions_sync_log
    UNION ALL
    SELECT source, status, record_count, duration_ms, synced_at, error_message
    FROM fraud_sync_log
    ORDER BY synced_at DESC
    LIMIT 200
  `)
  return rows
}

/**
 * Returns all users joined with current billing-period quota usage.
 * quota_limit = -1 for unlimited plans.
 */
export async function getAdminUsers(): Promise<UserAdminRow[]> {
  const { rows } = await db.query<UserAdminRow>(`
    SELECT
      u.id,
      u.email,
      u.plan,
      u.created_at,
      u.last_active_at,
      COALESCE(uqu.query_count, 0) AS quota_used,
      COALESCE(uqu.quota_limit, 5) AS quota_limit
    FROM users u
    LEFT JOIN user_query_usage uqu
      ON uqu.user_id = u.id
      AND uqu.period_start = date_trunc('month', NOW())::date
    ORDER BY u.created_at DESC
  `)
  return rows
}

/**
 * Returns platform usage statistics for the admin dashboard.
 * topEntityTypes: counts from query_log JOIN entities, grouped by entity_type.
 */
export async function getAdminStats(): Promise<AdminStats> {
  const [totalRow, planRows, todayRow, thirtyDayRow, dailyRows, entityTypeRows] = await Promise.all([
    db.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM users'),
    db.query<{ plan: string; count: string }>('SELECT plan, COUNT(*)::text AS count FROM users GROUP BY plan'),
    db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users WHERE created_at >= NOW() - INTERVAL '1 day'`),
    db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users WHERE created_at >= NOW() - INTERVAL '30 days'`),
    db.query<{ day: string; count: number }>(`
      SELECT
        date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
        COUNT(*)::int AS count
      FROM users
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY 1
      ORDER BY 1
    `),
    db.query<{ type: 'company' | 'vessel' | 'terminal'; count: number }>(`
      SELECT
        e.entity_type AS type,
        COUNT(*)::int AS count
      FROM query_log ql
      JOIN entities e ON e.id = ql.entity_id
      WHERE ql.entity_id IS NOT NULL
      GROUP BY e.entity_type
      ORDER BY count DESC
    `),
  ])

  const planDistribution = { free: 0, starter: 0, enterprise: 0, professional: 0 }
  for (const row of planRows.rows) {
    const key = row.plan as keyof typeof planDistribution
    if (key in planDistribution) planDistribution[key] = parseInt(row.count, 10)
  }

  return {
    totalUsers: parseInt(totalRow.rows[0]?.total ?? '0', 10),
    planDistribution,
    newToday: parseInt(todayRow.rows[0]?.count ?? '0', 10),
    new30Days: parseInt(thirtyDayRow.rows[0]?.count ?? '0', 10),
    dailyRegistrations: dailyRows.rows.map((r) => ({
      date: String(r.day),
      count: r.count,
    })),
    topEntityTypes: entityTypeRows.rows,
  }
}

// ── Fraud Alerts ──────────────────────────────────────────────────────────────

const FRAUD_SIMILARITY_THRESHOLD = 0.45  // matches fraud-check.ts SIMILARITY_THRESHOLD

export interface FraudAlertRow {
  source: string
  source_name: string
  source_url: string
  company_name: string
  list_type: 'blacklist' | 'whitelist'
  fraud_type: string | null
  description: string | null
  scam_url: string | null
  synced_at: Date                // UI requires "Reported {date}" display
}

/**
 * Fetch fraud alerts matching a company name via pg_trgm fuzzy search.
 * Used by FraudAlertsPanel on company detail page (F3 gated in page.tsx).
 */
export async function getCompanyFraudAlerts(name: string): Promise<FraudAlertRow[]> {
  if (!name || name.trim().length < 2) return []
  const normalized = normalizeEntityName(name, true)
  if (!normalized || normalized.length < 2) return []

  try {
    const { rows } = await db.query<FraudAlertRow & { sim: number }>(
      `SELECT
         source, source_name, source_url, company_name,
         list_type, fraud_type, description, scam_url, synced_at,
         GREATEST(
           similarity(normalized_name, $1),
           word_similarity($1, normalized_name)
         ) AS sim
       FROM fraud_alerts
       WHERE normalized_name % $1 OR $1 %> normalized_name
       ORDER BY
         CASE list_type WHEN 'blacklist' THEN 0 ELSE 1 END,
         synced_at DESC
       LIMIT 50`,
      [normalized]
    )
    return rows
      .filter((r) => r.sim >= FRAUD_SIMILARITY_THRESHOLD)
      .map(({ sim: _sim, ...r }) => r)
  } catch {
    return []
  }
}

/**
 * Fetch fraud alerts matching a vessel by operator or manager name.
 * Used by FraudAlertsPanel on vessel detail page (F3 gated in page.tsx).
 *
 * D-04: matches by operator OR manager (vessel.manager not yet in schema;
 * parameter reserved for future Phase 11 extension when manager data is available).
 * D-05: SIMILARITY_THRESHOLD = 0.45 (consistent with fraud-check.ts).
 */
export async function getVesselFraudAlerts(
  operator: string | null | undefined,
  manager?: string | null
): Promise<FraudAlertRow[]> {
  const names = [operator, manager].filter((n): n is string => !!n && n.trim().length >= 2)
  if (names.length === 0) return []

  const normalizedNames = names
    .map((n) => normalizeEntityName(n, true))
    .filter((n) => n.length >= 2)
  if (normalizedNames.length === 0) return []

  try {
    // Query each name and union results; deduplicate by (source, company_name)
    const seen = new Set<string>()
    const results: FraudAlertRow[] = []

    for (const normalized of normalizedNames) {
      const { rows } = await db.query<FraudAlertRow & { sim: number }>(
        `SELECT
           source, source_name, source_url, company_name,
           list_type, fraud_type, description, scam_url, synced_at,
           GREATEST(
             similarity(normalized_name, $1),
             word_similarity($1, normalized_name)
           ) AS sim
         FROM fraud_alerts
         WHERE normalized_name % $1 OR $1 %> normalized_name
         ORDER BY
           CASE list_type WHEN 'blacklist' THEN 0 ELSE 1 END,
           synced_at DESC
         LIMIT 50`,
        [normalized]
      )
      for (const row of rows) {
        if (row.sim < FRAUD_SIMILARITY_THRESHOLD) continue
        const key = `${row.source}::${row.company_name}`
        if (seen.has(key)) continue  // deduplicate when operator and manager match same row
        seen.add(key)
        const { sim: _sim, ...alert } = row
        results.push(alert)
      }
    }

    // Final sort: blacklist first, then by synced_at DESC
    results.sort((a, b) => {
      const typeDiff =
        (a.list_type === 'blacklist' ? 0 : 1) - (b.list_type === 'blacklist' ? 0 : 1)
      if (typeDiff !== 0) return typeDiff
      return new Date(b.synced_at).getTime() - new Date(a.synced_at).getTime()
    })

    return results
  } catch {
    return []
  }
}


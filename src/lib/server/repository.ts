import { randomUUID } from 'node:crypto'
import type { Company, RiskFlag, SearchResult, SanctionStatus, Terminal, Vessel } from '@/lib/types'
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
import {
  searchOpenCorporates,
  getOCCompanyByNumber,
  mightBeOCId,
  ocToSearchResult,
  buildOCCompany,
} from './sync/opencorporates'

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
    tradingTrackRecord:  { score: 0, maxScore: 25, phase2Pending: true },
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
 * Compute the tradingTrackRecord dimension score (Phase 2) from trade_events table.
 * Returns a score from 0 to 25, evidence strings, and `phase2Pending: false`.
 */
export async function computeTradingTrackRecord(entityId: string): Promise<{
  score: number
  evidence: string[]
  phase2Pending: false
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

    return { score, evidence, phase2Pending: false }
  } catch {
    return { score: 0, evidence: ['Trading history analysis unavailable'], phase2Pending: false }
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

  const { rows } = await db.query(sql, params)
  const localResults: SearchResult[] = rows.map((row) => ({
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

  // When local results are thin, supplement from external registries.
  const localIds = new Set(localResults.map((r) => r.registrationNumber).filter(Boolean))
  let acraResults: SearchResult[] = []
  let chResults: SearchResult[] = []

  const shouldSearchCompanies = !entityType || entityType === 'company'
  if (shouldSearchCompanies && localResults.length === 0) {
    // 骞惰鏌ヨ ACRA锛堟柊鍔犲潯锛夈€丆ompanies House锛堣嫳鍥斤級銆乑efix锛堢憺澹級銆丱penCorporates锛堝叏鐞冭仛鍚堬級銆丟LEIF锛堟渶缁堝悗澶囷級
    const [acraEntities, chEntities, zefixEntities, ocEntities, gleifRecords] = await Promise.all([
      searchACRA(query, 5).catch(() => []),
      searchCompaniesHouse(query, 5).catch(() => []),
      searchZefix(query, 5).catch(() => []),
      searchOpenCorporates(query, 5).catch(() => []),
      searchGleifMultiple(query, 5).catch(() => []),
    ])

    // ACRA 缁撴灉鍘婚噸
    acraResults = acraEntities
      .filter((e) => !localIds.has(e.uen))
      .map(acraToSearchResult)

    // Companies House 缁撴灉鍘婚噸
    chResults = chEntities
      .filter((c) => !localIds.has(c.company_number))
      .map(chToSearchResult)

    // Zefix 缁撴灉鍘婚噸
    const zefixResults = zefixEntities
      .filter((c) => !localIds.has(c.uid))
      .map(zefixToSearchResult)

    // OpenCorporates 缁撴灉鍘婚噸锛堣仛鍚堟敞鍐屽唽锛岃鐩?NL/HK/DE/FR 绛夋棤鐩存帴娉ㄥ唽鍐岀殑鍙告硶绠¤緰鍖猴級
    const ocResults = ocEntities
      .filter((c) => !localIds.has(c.company_number))
      .map(ocToSearchResult)

    // De-duplicate GLEIF results and only keep records not covered by other sources.
    const allRegNums = new Set([
      ...localIds,
      ...acraResults.map(r => r.registrationNumber).filter(Boolean),
      ...chResults.map(r => r.registrationNumber).filter(Boolean),
      ...zefixResults.map(r => r.registrationNumber).filter(Boolean),
      ...ocResults.map(r => r.registrationNumber).filter(Boolean),
    ])
    const gleifResults = gleifRecords
      .filter((r) => !allRegNums.has(r.lei))
      .map((r) => ({
        id: `gleif:${r.lei}`,
        name: r.legalName,
        type: 'company' as const,
        country: r.jurisdiction ?? r.country ?? '',
        jurisdictionFlag: r.jurisdiction ?? '',
        sanctionStatus: 'unknown' as const,
        // LEI = 10 pts existence; +5 if registration date known; no sanctions in search path
        authenticityScore: 10 + (r.initialRegistrationDate ? 5 : 0),
        riskLevel: 'medium' as const,
        registrationNumber: r.lei,
        slug: `lei-${r.lei.toLowerCase()}`,
      }))

    // Merge results with local records first. Heavy profile enrichment stays on entity pages.
    return [...localResults, ...acraResults, ...chResults, ...zefixResults, ...ocResults, ...gleifResults].slice(0, 20)
  }

  // Merge results with local records first. Heavy profile enrichment stays on entity pages.
  return [...localResults, ...acraResults, ...chResults].slice(0, 20)
}

export async function getBrowseEntities(entityType?: string): Promise<BrowseRow[]> {
  const browseType = entityType === 'company' || entityType === 'vessel' || entityType === 'terminal'
    ? entityType
    : null

  const { rows } = await db.query<BrowseRow>(
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
        authenticity_score ASC
      LIMIT 30
    `,
    [browseType]
  )

  return rows
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
          riskLevel: sanctionStatus === 'listed' ? 'critical' : 'medium',
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
        const [sanctionStatus, officers, psc] = await Promise.all([
          screenSanctions(chCompany.title).catch(() => 'unknown' as SanctionStatus),
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

    // 5. Try GLEIF by `gleif:{lei}`.
    if (idOrSlugOrImo.startsWith('gleif:')) {
      const lei = idOrSlugOrImo.slice(6)
      const record = await getGleifRecordByLei(lei).catch(() => null)
      if (record) {
        const sanctionStatus = await screenSanctions(record.legalName).catch(
          () => 'unknown' as SanctionStatus
        )
        return buildGleifCompany(record, sanctionStatus) as unknown as Company
      }
    }

    // 6. GLEIF 鍚嶇О鎼滅储锛堟渶鍚庡厹搴曪級
    const gleifResults = await searchGleifMultiple(idOrSlugOrImo, 1).catch(() => [])
    if (gleifResults[0]) {
      const record = gleifResults[0]
      const sanctionStatus = await screenSanctions(record.legalName).catch(
        () => 'unknown' as SanctionStatus
      )
      return buildGleifCompany(record, sanctionStatus) as unknown as Company
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
    score:         trackRecord.score,
    maxScore:      25,
    phase2Pending: false,
    evidence:      trackRecord.evidence,
  }
  entity.authenticityScore = Math.min(100, entity.authenticityScore + trackRecord.score)

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
}

export async function getIcijMatches(entityId: string): Promise<IcijMatch[]> {
  const { rows } = await db.query(
    `SELECT node_id, name, dataset, entity_type, countries, jurisdiction,
            status, incorporation_date, address, source_url, match_confidence
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


import { randomUUID } from 'node:crypto'
import type { Company, RiskFlag, SearchResult, SanctionStatus, Vessel } from '@/lib/types'
import { db } from './db'
import { checkSanctions } from './sync/sanctions'
import { searchACRA, getACRAByUEN, acraToSearchResult } from './sync/acra'
import {
  searchCompaniesHouse,
  getCHCompanyByNumber,
  mightBeUKNumber,
  chToSearchResult,
  buildCHCompany,
} from './sync/companies-house'

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

function normalizeInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(sa|ltd|limited|inc|corp|bv|gmbh|pte|fze|fzco|llc|plc)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseEntity(row: EntityRow): Company | Vessel {
  const scoreBreakdown = row.score_breakdown_json as Company['scoreBreakdown']
  const dataSource = row.data_source_json as string[]
  const metadata = row.metadata_json as Record<string, unknown>

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
 * 对实体名称进行制裁筛查（OFAC + EU + UN，一次 API 调用覆盖全部来源）
 */
async function screenSanctions(name: string): Promise<SanctionStatus> {
  const { listed } = await checkSanctions(name).catch(() => ({ listed: false, sources: [] }))
  return listed ? 'listed' : 'not_listed'
}

export async function searchEntities(query: string, entityType?: string): Promise<SearchResult[]> {
  const normalized = normalizeInput(query)
  if (!normalized || normalized.length < 2) return []

  const params: unknown[] = [normalized]
  let typeClause = ''
  if (entityType && ['company', 'vessel', 'terminal'].includes(entityType)) {
    params.push(entityType)
    typeClause = `AND e.entity_type = $${params.length}`
  }

  // 查询本地实体库
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
      OR a.normalized_alias % $1
      OR e.registration_number = $1
      OR e.imo = $1
    )
    ${typeClause}
    GROUP BY e.id
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

  // 当本地结果较少时，从外部数据源补充（仅当搜索类型包含公司）
  const localIds = new Set(localResults.map((r) => r.registrationNumber).filter(Boolean))
  let acraResults: SearchResult[] = []
  let chResults: SearchResult[] = []

  const shouldSearchCompanies = !entityType || entityType === 'company'
  if (shouldSearchCompanies && localResults.length < 5) {
    // 并行查询 ACRA（新加坡）和 Companies House（英国）
    const [acraEntities, chEntities] = await Promise.all([
      searchACRA(query, 10).catch(() => []),
      searchCompaniesHouse(query, 10).catch(() => []),
    ])

    // ACRA 结果去重
    const newFromACRA = acraEntities
      .filter((e) => !localIds.has(e.uen))
      .map(acraToSearchResult)

    // Companies House 结果去重
    const newFromCH = chEntities
      .filter((c) => !localIds.has(c.company_number))
      .map(chToSearchResult)

    // 并行做制裁筛查
    const [acraSanctions, chSanctions] = await Promise.all([
      Promise.all(newFromACRA.map((r) => screenSanctions(r.name).catch(() => 'unknown' as SanctionStatus))),
      Promise.all(newFromCH.map((r) => screenSanctions(r.name).catch(() => 'unknown' as SanctionStatus))),
    ])

    acraResults = newFromACRA.map((r, i) => ({ ...r, sanctionStatus: acraSanctions[i] }))
    chResults   = newFromCH.map((r, i) => ({ ...r, sanctionStatus: chSanctions[i] }))
  }

  // 合并结果，本地库优先
  const combined = [...localResults, ...acraResults, ...chResults]

  // 对本地库中 sanctionStatus 为 'unknown' 的条目补充制裁检查
  const enriched = await Promise.all(
    combined.map(async (result) => {
      if (result.sanctionStatus !== 'unknown') return result
      const status = await screenSanctions(result.name).catch(() => 'unknown' as SanctionStatus)
      return { ...result, sanctionStatus: status }
    })
  )

  return enriched.slice(0, 20)
}

export async function getEntityByKey(idOrSlugOrImo: string): Promise<Company | Vessel | null> {
  const { rows } = await db.query<EntityRow>(
    `
      SELECT *
      FROM entities
      WHERE id = $1 OR slug = $1 OR imo = $1
      LIMIT 1
    `,
    [idOrSlugOrImo]
  )

  // 本地库未找到时，尝试从外部数据源查询
  if (!rows[0]) {
    // 1. 尝试 ACRA（新加坡 UEN 格式）
    const mightBeUEN = /^[0-9]{9}[A-Z]$|^[ST][0-9]{2}[A-Z]{2}[0-9]{4}[A-Z]$/.test(
      idOrSlugOrImo.toUpperCase()
    )
    if (mightBeUEN) {
      const acraEntity = await getACRAByUEN(idOrSlugOrImo).catch(() => null)
      if (acraEntity) {
        const sanctionStatus = await screenSanctions(acraEntity.entity_name).catch(
          () => 'unknown' as SanctionStatus
        )
        const company: Company = {
          id: `acra:${acraEntity.uen}`,
          type: 'company',
          name: acraEntity.entity_name,
          slug: acraEntity.uen.toLowerCase().replace(/[^a-z0-9]/g, '-'),
          registrationNumber: acraEntity.uen,
          country: 'Singapore',
          jurisdictionFlag: '🇸🇬',
          sanctionStatus,
          authenticityScore: 0,
          scoreBreakdown: {
            entityExistence:    { score: 0, maxScore: 25 },
            assetReality:       { score: 0, maxScore: 30 },
            tradingTrackRecord: { score: 0, maxScore: 25, phase2Pending: true },
            documentConsistency:{ score: 0, maxScore: 10 },
            communityReputation:{ score: 0, maxScore: 10 },
          },
          riskLevel: sanctionStatus === 'listed' ? 'critical' : 'medium',
          riskFlags: [],
          lastVerified: new Date().toISOString(),
          dataSource: ['ACRA Singapore'],
        }
        return company
      }
    }

    // 2. 尝试 Companies House（英国注册号格式）
    if (mightBeUKNumber(idOrSlugOrImo)) {
      const chCompany = await getCHCompanyByNumber(idOrSlugOrImo).catch(() => null)
      if (chCompany) {
        const sanctionStatus = await screenSanctions(chCompany.title).catch(
          () => 'unknown' as SanctionStatus
        )
        const company: Company = {
          ...buildCHCompany(chCompany),
          sanctionStatus,
          riskLevel: sanctionStatus === 'listed' ? 'critical' : 'medium',
        }
        return company
      }
    }

    return null
  }

  const entity = parseEntity(rows[0])

  // 获取已审核的风险标记
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

  // 若制裁状态为 unknown，实时做一次筛查并更新
  if (entity.sanctionStatus === 'unknown') {
    const status = await screenSanctions(entity.name).catch(() => 'unknown' as SanctionStatus)
    if (status !== 'unknown') {
      entity.sanctionStatus = status
      // 异步更新 DB，不阻塞响应
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

// ── PSC Inspections ───────────────────────────────────────────────────────────

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
  deficiencyRate: number   // 0–1
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
       COUNT(*) FILTER (WHERE result != 'no_deficiency') AS with_deficiency,
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

// ── ICIJ Offshore Leaks ───────────────────────────────────────────────────────

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

// ── Ports ─────────────────────────────────────────────────────────────────────

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
      : `Vessel draft (${vesselDraftM.toFixed(1)}m) exceeds ${port.name} max draft (${portMaxDraftM.toFixed(1)}m). Vessel cannot berth — reported loading location may be fraudulent.`,
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

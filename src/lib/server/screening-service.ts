import { randomUUID } from 'node:crypto'
import { db } from './db'
import { parseDocument } from './document-parser'
import {
  extractEntities,
  extractTradeParams,
  EntityExtractionError,
  type ExtractedTradeParams,
  type ExtractedEntity,
} from './entity-extractor'
import {
  searchEntities,
  getEntityByKey,
  getPscSummary,
  getIcijOfficerNetwork,
  searchIcijByPersonName,
  getIcijPersonEntities,
  type IcijOfficerLink,
} from './repository'
import { checkSanctions } from './sync/sanctions'
import { checkFraudAlerts, type FraudAlert } from './fraud-check'
import {
  runTradeRules,
  overallRiskFromFlags,
  generateSummary,
  type TradeFlag,
} from './trade-rules'
import type { SanctionStatus, RiskLevel, SearchResult } from '@/lib/types'

export interface EntityScreeningResult {
  extracted: ExtractedEntity
  sanctionStatus: SanctionStatus
  dbEntity?: SearchResult
  icijConnections?: IcijOfficerLink[]
  pscDeficiencyRate?: number
  riskLevel: RiskLevel
  needsManualReview?: boolean
  /** Non-empty when the entity appears on an industry fraud blacklist. */
  fraudAlerts?: FraudAlert[]
  /** True when on a verified industry whitelist (e.g. Rotterdam Port). */
  whitelisted?: boolean
}

export interface TradeAssessmentResult {
  params: ExtractedTradeParams
  flags: TradeFlag[]
  overallRisk: RiskLevel
  summary: string
}

export interface ScreeningReport {
  id: string
  filename: string
  screenedAt: string
  overallRisk: RiskLevel
  entities: EntityScreeningResult[]
  tradeAssessment: TradeAssessmentResult | null
}

export const ALLOWED_SCREENING_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

function maskPassport(raw: string): string {
  const s = raw.trim()
  if (s.length <= 6) return '*'.repeat(s.length)
  const prefix = s.slice(0, 2)
  const suffix = s.slice(-4)
  const stars = '*'.repeat(s.length - 6)
  return `${prefix}${stars}${suffix}`
}

function entityRiskLevel(
  sanctionStatus: SanctionStatus,
  icijConnections: IcijOfficerLink[] | undefined,
  dbRiskLevel: RiskLevel | undefined,
  pscDeficiencyRate: number | undefined,
  fraudFlagged?: boolean,
): RiskLevel {
  if (sanctionStatus === 'listed') return 'critical'
  if (fraudFlagged) return 'critical'
  if (dbRiskLevel === 'critical' || dbRiskLevel === 'high') return 'high'
  if ((icijConnections?.length ?? 0) > 0) return 'medium'
  if (dbRiskLevel === 'medium' || (pscDeficiencyRate ?? 0) > 0.2) return 'medium'
  return 'low'
}

function overallRisk(entities: EntityScreeningResult[]): RiskLevel {
  if (entities.some((e) => e.sanctionStatus === 'listed')) return 'critical'
  if (entities.some((e) => e.riskLevel === 'high')) return 'high'
  if (entities.some((e) => e.riskLevel === 'medium')) return 'medium'
  return 'low'
}

const RISK_ORDER: Record<RiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

async function screenEntity(entity: ExtractedEntity): Promise<EntityScreeningResult> {
  const sanctionResult = await checkSanctions(entity.name).catch(() => ({ listed: false, sources: [] }))
  const sanctionStatus: SanctionStatus = sanctionResult.listed ? 'listed' : 'not_listed'

  let dbEntity: SearchResult | undefined
  let icijConnections: IcijOfficerLink[] | undefined
  let pscDeficiencyRate: number | undefined
  let fraudAlerts: FraudAlert[] | undefined
  let whitelisted: boolean | undefined

  if (entity.type === 'company') {
    const [results, fraudCheck] = await Promise.all([
      searchEntities(entity.name, 'company').catch(() => []),
      checkFraudAlerts(entity.name).catch(() => ({ flagged: false, whitelisted: false, alerts: [] as FraudAlert[] })),
    ])
    dbEntity = results[0]

    if (fraudCheck.flagged) {
      fraudAlerts = fraudCheck.alerts.filter((a) => a.list_type === 'blacklist')
    }
    if (fraudCheck.whitelisted) {
      whitelisted = true
    }

    if (dbEntity?.id) {
      icijConnections = await getIcijOfficerNetwork(dbEntity.id).catch(() => [])
      if (!icijConnections?.length) icijConnections = undefined
    }
  } else if (entity.type === 'person') {
    const icijPersons = await searchIcijByPersonName(entity.name).catch(() => [])
    if (icijPersons.length > 0) {
      const links = await getIcijPersonEntities(icijPersons[0].nodeId).catch(() => [])
      icijConnections = links.length > 0 ? links : undefined
    }
  } else if (entity.type === 'vessel') {
    const byImo = entity.imo ? await getEntityByKey(entity.imo).catch(() => null) : null

    if (byImo && byImo.type === 'vessel') {
      dbEntity = {
        id: byImo.id,
        name: byImo.name,
        type: byImo.type,
        country: byImo.country,
        jurisdictionFlag: byImo.jurisdictionFlag,
        sanctionStatus: byImo.sanctionStatus,
        authenticityScore: byImo.authenticityScore,
        riskLevel: byImo.riskLevel,
        imo: byImo.imo,
      }
      const psc = await getPscSummary(byImo.imo).catch(() => null)
      pscDeficiencyRate = psc?.deficiencyRate
    } else {
      const results = await searchEntities(entity.name, 'vessel').catch(() => [])
      dbEntity = results[0]
      if (dbEntity?.imo) {
        const psc = await getPscSummary(dbEntity.imo).catch(() => null)
        pscDeficiencyRate = psc?.deficiencyRate
      }
    }
  }

  return {
    extracted: entity.passport ? { ...entity, passport: maskPassport(entity.passport) } : entity,
    sanctionStatus,
    dbEntity,
    icijConnections,
    pscDeficiencyRate,
    riskLevel: entityRiskLevel(sanctionStatus, icijConnections, dbEntity?.riskLevel, pscDeficiencyRate, !!fraudAlerts?.length),
    needsManualReview: (icijConnections?.length ?? 0) > 0,
    fraudAlerts: fraudAlerts?.length ? fraudAlerts : undefined,
    whitelisted,
  }
}

export async function runDocumentScreening(userId: string, file: File): Promise<ScreeningReport> {
  const buffer = Buffer.from(await file.arrayBuffer())
  const text = await parseDocument(buffer, file.type)

  if (!text || text.trim().length < 50) {
    throw new Error('DOCUMENT_EMPTY')
  }

  let entities: Awaited<ReturnType<typeof extractEntities>>
  try {
    entities = await extractEntities(text)
  } catch (error) {
    if (error instanceof EntityExtractionError) {
      throw error
    }
    throw error
  }

  if (entities.length === 0) {
    throw new Error('NO_ENTITIES_FOUND')
  }

  const results: EntityScreeningResult[] = []
  const batchSize = 4
  for (let i = 0; i < entities.length; i += batchSize) {
    const batch = entities.slice(i, i + batchSize)
    const batchResults = await Promise.all(batch.map(screenEntity))
    results.push(...batchResults)
  }

  results.sort((a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel])

  let tradeAssessment: TradeAssessmentResult | null = null
  try {
    const params = await extractTradeParams(text)
    if (params && params.seller && params.vessel) {
      const sellerMatch = results.find(
        (r) => r.extracted.type === 'company' && r.extracted.name.toLowerCase().includes(params.seller!.toLowerCase().slice(0, 8))
      )
      const vesselMatch = results.find(
        (r) =>
          r.extracted.type === 'vessel' &&
          (r.extracted.name.toLowerCase().includes(params.vessel!.toLowerCase().slice(0, 6)) ||
            (params.imo && r.extracted.imo === params.imo))
      )

      const loadingPortCC =
        params.loadingPort && /^[A-Z]{2}[A-Z0-9]{3}$/i.test(params.loadingPort)
          ? params.loadingPort.slice(0, 2).toLowerCase()
          : null

      const flags = runTradeRules({
        sellerName: params.seller,
        sellerDbMatch: sellerMatch?.dbEntity ?? null,
        sellerSanctioned: sellerMatch?.sanctionStatus === 'listed',
        sellerSanctionSources: [],
        vesselName: params.vessel,
        vesselImo: params.imo ?? vesselMatch?.extracted.imo ?? null,
        vesselDbMatch: vesselMatch?.dbEntity ?? null,
        vesselSanctioned: vesselMatch?.sanctionStatus === 'listed',
        vesselSanctionSources: [],
        vesselAis: null,
        loadingPortLocode: params.loadingPort ?? null,
        loadingPortCountry: loadingPortCC,
        loadingPortName: params.loadingPort ?? null,
        draftRisk: null,
        tradeDate: params.tradeDate ?? null,
        commodity: params.commodity ?? null,
        skipAisRules: true,
        sellerFraudAlerts: sellerMatch?.fraudAlerts,
      })

      const risk = overallRiskFromFlags(flags)
      tradeAssessment = {
        params,
        flags,
        overallRisk: risk,
        summary: generateSummary(flags, risk, params.seller, params.vessel),
      }
    }
  } catch (error) {
    console.error('[screen] Trade assessment failed (non-fatal):', error)
  }

  const sessionId = randomUUID()
  const screenedAt = new Date().toISOString()
  const report: ScreeningReport = {
    id: sessionId,
    filename: file.name,
    screenedAt,
    overallRisk: overallRisk(results),
    entities: results,
    tradeAssessment,
  }

  await db.query(
    `INSERT INTO screening_sessions (id, user_id, filename, result_json)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, userId, file.name, JSON.stringify(report)]
  )

  db.query(`DELETE FROM screening_sessions WHERE created_at < NOW() - INTERVAL '90 days'`)
    .catch((err) => console.error('[screen] TTL cleanup error:', err))

  return report
}


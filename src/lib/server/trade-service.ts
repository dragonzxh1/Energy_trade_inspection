import { randomUUID } from 'node:crypto'
import { db } from './db'
import { checkSanctions } from './sync/sanctions'
import { checkFraudAlerts, type FraudAlert } from './fraud-check'
import {
  searchEntities,
  getEntityByKey,
  getPscSummary,
  checkDraftRisk,
  getPortByLocode,
  getIcijOfficerNetwork,
  type PscSummary,
} from './repository'
import { searchGleifByName, getGleifUltimateParentJurisdiction } from './gleif'
import {
  runTradeRules,
  overallRiskFromFlags,
  generateSummary,
  type TradeFlag,
} from './trade-rules'
import type { SearchResult, RiskLevel, SanctionStatus, Company, BeneficialOwner } from '@/lib/types'
import type { VesselAisData } from '@/lib/ais-types'
import type { DraftRiskResult } from './repository'
import { getVesselAis } from './ais'

export interface TradePartyResult {
  name: string
  sanctionStatus: SanctionStatus
  sanctionSources: string[]
  dbMatch: SearchResult | null
  icijConnections: number
  riskLevel: RiskLevel
  incorporationDate?: string | null
  ultimateParentJurisdiction?: string | null
  /** Non-empty only when the seller appears on an industry fraud blacklist. */
  fraudAlerts?: FraudAlert[]
  /** True when the seller is on a verified industry whitelist (e.g. Rotterdam Port). */
  whitelisted?: boolean
}

export interface TradeVesselResult {
  name: string
  imo: string | null
  sanctionStatus: SanctionStatus
  sanctionSources: string[]
  dbMatch: SearchResult | null
  hasRecentAis: boolean
  lastAisUpdate: string | null
  darkPeriods: number
  psc: PscSummary | null
  riskLevel: RiskLevel
}

export interface TradePortResult {
  locode: string
  name: string | null
  found: boolean
  isStsZone: boolean
  draftRisk: DraftRiskResult | null
}

export interface TradeCheckResult {
  id: string
  checkedAt: string
  input: {
    seller: string
    vessel: string
    date: string | null
    loadingPort: string | null
    commodity: string | null
  }
  seller: TradePartyResult
  vessel: TradeVesselResult
  port: TradePortResult | null
  flags: TradeFlag[]
  overallRisk: RiskLevel
  summary: string
}

export interface TradeCheckInput {
  seller: string
  vessel: string
  date: string | null
  loadingPort: string | null
  commodity: string | null
  imoField?: string
}

async function getCachedAis(imo: string): Promise<VesselAisData | null> {
  try {
    const { rows } = await db.query<{ data_json: VesselAisData }>(
      `SELECT data_json FROM ais_cache WHERE imo = $1 AND expires_at > NOW() LIMIT 1`,
      [imo]
    )
    return rows[0]?.data_json ?? null
  } catch {
    return null
  }
}

async function getAisForTrade(imo: string): Promise<VesselAisData | null> {
  const cached = await getCachedAis(imo)
  if (cached) return cached

  try {
    return await Promise.race([
      getVesselAis(imo),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000)),
    ])
  } catch {
    return null
  }
}

function deriveRegistrySource(id?: string): 'local_db' | 'acra' | 'ch' | 'zefix' | 'gleif' | 'oc' | null {
  if (!id) return null
  if (id.startsWith('acra:')) return 'acra'
  if (id.startsWith('ch:')) return 'ch'
  if (id.startsWith('zefix:')) return 'zefix'
  if (id.startsWith('gleif:')) return 'gleif'
  if (id.startsWith('oc:')) return 'oc'
  return 'local_db'
}

export function extractImo(vesselInput: string, imoField?: string): string | null {
  if (imoField && /^\d{7}$/.test(imoField.trim())) return imoField.trim()
  const match = vesselInput.match(/\b(\d{7})\b/)
  return match ? match[1] : null
}

const RISK_ORDER: Record<RiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

function worstRisk(...levels: (RiskLevel | undefined)[]): RiskLevel {
  return levels
    .filter((l): l is RiskLevel => !!l)
    .reduce((a, b) => (RISK_ORDER[a] < RISK_ORDER[b] ? a : b), 'low')
}

function entityRisk(sanctioned: boolean, dbMatch: SearchResult | null, icijCount: number): RiskLevel {
  if (sanctioned) return 'critical'
  if (icijCount > 0) return 'high'
  if (dbMatch?.riskLevel === 'critical' || dbMatch?.riskLevel === 'high') return 'high'
  if (dbMatch?.riskLevel === 'medium') return 'medium'
  if (!dbMatch) return 'high'
  return 'low'
}

function vesselRisk(
  sanctioned: boolean,
  dbMatch: SearchResult | null,
  ais: VesselAisData | null,
  psc: PscSummary | null,
): RiskLevel {
  if (sanctioned) return 'critical'
  if (psc && psc.detentions > 0) return 'high'
  if (!ais || !ais.position) return 'high'
  if (dbMatch?.riskLevel === 'critical' || dbMatch?.riskLevel === 'high') return 'high'
  return 'medium'
}

export async function runTradeCheck(userId: string, input: TradeCheckInput): Promise<TradeCheckResult> {
  const { seller, vessel, date, loadingPort, commodity, imoField } = input
  const vesselImo = extractImo(vessel, imoField)

  const [sellerSanction, sellerDbResults, vesselSanction, vesselDbMatch, portData, vesselAis, gleifRecord, sellerFraudCheck] = await Promise.all([
    checkSanctions(seller).catch(() => ({ listed: false, sources: [] as string[] })),
    searchEntities(seller, 'company').catch(() => [] as SearchResult[]),
    checkSanctions(vessel).catch(() => ({ listed: false, sources: [] as string[] })),
    vesselImo
      ? getEntityByKey(vesselImo).catch(() => null)
      : searchEntities(vessel, 'vessel').then((r) => r[0] ?? null).catch(() => null),
    loadingPort ? getPortByLocode(loadingPort).catch(() => null) : Promise.resolve(null),
    vesselImo ? getAisForTrade(vesselImo) : Promise.resolve(null),
    searchGleifByName(seller).catch(() => null),
    checkFraudAlerts(seller).catch(() => ({ flagged: false, whitelisted: false, alerts: [] as FraudAlert[] })),
  ])

  const sellerDbMatch = sellerDbResults[0] ?? null
  const vesselDbResult = vesselDbMatch as SearchResult | null
  const resolvedImo = vesselImo ?? vesselDbResult?.imo ?? null
  const vesselDraftM = vesselAis?.position?.draught ?? null

  const [sellerIcijCount, sellerDbIncDate, sellerUltimateParentJurisdiction, pscSummary, draftRisk, sellerFullEntity] = await Promise.all([
    sellerDbMatch?.id
      ? getIcijOfficerNetwork(sellerDbMatch.id).then((links) => links.length).catch(() => 0)
      : Promise.resolve(0),
    sellerDbMatch?.id
      ? db.query<{ inc_date: string | null }>(
          `SELECT metadata_json->>'incorporationDate' AS inc_date FROM entities WHERE id = $1`,
          [sellerDbMatch.id]
        ).then((r) => r.rows[0]?.inc_date ?? null).catch(() => null)
      : Promise.resolve(null),
    gleifRecord?.lei
      ? getGleifUltimateParentJurisdiction(gleifRecord.lei).catch(() => null)
      : Promise.resolve(null),
    resolvedImo ? getPscSummary(resolvedImo).catch(() => null) : Promise.resolve(null),
    loadingPort ? checkDraftRisk(loadingPort, vesselDraftM).catch(() => null) : Promise.resolve(null),
    sellerDbMatch?.registrationNumber
      ? getEntityByKey(sellerDbMatch.registrationNumber).catch(() => null)
      : Promise.resolve(null),
  ])

  const sellerIncorporationDate = sellerDbIncDate ?? gleifRecord?.initialRegistrationDate ?? null
  const sellerBeneficialOwners: BeneficialOwner[] | null = (sellerFullEntity as Company | null)?.beneficialOwners ?? null

  const sellerSanctionStatus: SanctionStatus = sellerSanction.listed ? 'listed' : 'not_listed'
  const vesselSanctionStatus: SanctionStatus = vesselSanction.listed ? 'listed' : 'not_listed'

  const flags = runTradeRules({
    sellerName: seller,
    sellerDbMatch,
    sellerSanctioned: sellerSanction.listed,
    sellerSanctionSources: sellerSanction.sources,
    sellerIncorporationDate,
    sellerUltimateParentJurisdiction,
    sellerBeneficialOwners,
    sellerRegistrySource: deriveRegistrySource(sellerDbMatch?.id),
    vesselName: vessel,
    vesselImo: resolvedImo,
    vesselDbMatch: vesselDbResult,
    vesselSanctioned: vesselSanction.listed,
    vesselSanctionSources: vesselSanction.sources,
    vesselAis,
    vesselOperatorChanges: null,
    vesselPscDetentions: pscSummary?.detentions ?? null,
    vesselPscDeficiencyRate: pscSummary?.deficiencyRate ?? null,
    loadingPortLocode: loadingPort,
    loadingPortCountry: portData?.country ?? null,
    loadingPortName: portData?.name ?? null,
    draftRisk,
    tradeDate: date,
    commodity,
    sellerFraudAlerts: sellerFraudCheck.flagged
      ? sellerFraudCheck.alerts.filter((a) => a.list_type === 'blacklist')
      : undefined,
  })

  const flagRisk = overallRiskFromFlags(flags)
  const sellerLevel = entityRisk(sellerSanction.listed, sellerDbMatch, sellerIcijCount)
  const vesselLevel = vesselRisk(vesselSanction.listed, vesselDbResult, vesselAis, pscSummary)
  const overallRisk = worstRisk(flagRisk, sellerLevel, vesselLevel)
  const summary = generateSummary(flags, overallRisk, seller, vessel)

  const id = randomUUID()
  const checkedAt = new Date().toISOString()
  const aisAge = vesselAis?.position
    ? (Date.now() - new Date(vesselAis.position.lastUpdate).getTime()) / 3_600_000
    : null

  const result: TradeCheckResult = {
    id,
    checkedAt,
    input: { seller, vessel, date, loadingPort, commodity },
    seller: {
      name: seller,
      sanctionStatus: sellerSanctionStatus,
      sanctionSources: sellerSanction.sources,
      dbMatch: sellerDbMatch,
      icijConnections: sellerIcijCount,
      riskLevel: sellerLevel,
      incorporationDate: sellerIncorporationDate,
      ultimateParentJurisdiction: sellerUltimateParentJurisdiction,
      fraudAlerts: sellerFraudCheck.flagged
        ? sellerFraudCheck.alerts.filter((a) => a.list_type === 'blacklist')
        : undefined,
      whitelisted: sellerFraudCheck.whitelisted || undefined,
    },
    vessel: {
      name: vessel,
      imo: resolvedImo,
      sanctionStatus: vesselSanctionStatus,
      sanctionSources: vesselSanction.sources,
      dbMatch: vesselDbResult,
      hasRecentAis: !!vesselAis?.position && (aisAge ?? 999) < 72,
      lastAisUpdate: vesselAis?.position?.lastUpdate ?? null,
      darkPeriods: vesselAis?.darkPeriods?.length ?? 0,
      psc: pscSummary,
      riskLevel: vesselLevel,
    },
    port: portData
      ? { locode: loadingPort!, name: portData.name, found: true, isStsZone: draftRisk?.isStsPort ?? false, draftRisk }
      : loadingPort
        ? { locode: loadingPort, name: null, found: false, isStsZone: false, draftRisk: null }
        : null,
    flags,
    overallRisk,
    summary,
  }

  await db.query(
    `INSERT INTO trade_sessions (id, user_id, input_json, result_json, overall_risk, flag_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, JSON.stringify(result.input), JSON.stringify(result), overallRisk, flags.length]
  ).catch((err) => console.error('[trade] Failed to persist session:', err))

  db.query(`DELETE FROM trade_sessions WHERE created_at < NOW() - INTERVAL '90 days'`)
    .catch((err) => console.error('[trade] TTL cleanup error:', err))

  if (sellerDbMatch?.id) {
    db.query(
      `INSERT INTO trade_events
         (entity_id, counterparty_name, counterparty_id, vessel_imo, event_date, commodity, port_locode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sellerDbMatch.id, vessel, vesselDbResult?.id ?? null, resolvedImo, date, commodity, loadingPort]
    ).catch((err) => console.error('[trade] Failed to write seller trade event:', err))
  }

  if (vesselDbResult?.id) {
    db.query(
      `INSERT INTO trade_events
         (entity_id, counterparty_name, counterparty_id, vessel_imo, event_date, commodity, port_locode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [vesselDbResult.id, seller, sellerDbMatch?.id ?? null, resolvedImo, date, commodity, loadingPort]
    ).catch((err) => console.error('[trade] Failed to write vessel trade event:', err))
  }

  return result
}


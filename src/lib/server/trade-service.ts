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
import { searchGleifByName, getGleifOwnershipChain } from './gleif'
import {
  runTradeRules,
  overallRiskFromFlags,
  generateSummary,
  deriveVerdict,
  type TradeFlag,
  type TradeVerdict,
  type TradeRuleInput,
} from './trade-rules'
import type { SearchResult, RiskLevel, SanctionStatus, Company, BeneficialOwner } from '@/lib/types'
import type { VesselAisData } from '@/lib/ais-types'
import type { DraftRiskResult } from './repository'
import { getVesselAis } from './ais'
import { checkDomain, extractDomain } from './domain-check'

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
  verdict: TradeVerdict    // Safe / Review / Block recommendation (DECISION-02)
  summary: string
  /** True when either the seller or vessel sanction check returned status: 'degraded' (circuit breaker open). (ARCH-02) */
  sanctionDegraded?: boolean
}

export interface TradeCheckInput {
  seller: string
  vessel: string
  date: string | null
  loadingPort: string | null
  commodity: string | null
  imoField?: string
  /** Optional seller domain or email address for WHOIS/spoofing fraud check (D-01, D-02). */
  sellerDomain?: string
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

/**
 * 1-hop director and beneficial owner sanction pre-check (DECISION-05).
 * Queries sanctions_entries and regulatory_warnings via pg_trgm similarity.
 * Returns RELATED_PARTY_RISK flags (0 or 1) -- never more than one per seller.
 * Null-guards for missing director data (GLEIF/OC entities lack directors).
 */
async function checkRelatedPartyRisk(
  directors: Array<{ name: string; role?: string; nationality?: string }>,
  beneficialOwners: BeneficialOwner[] | null,
): Promise<TradeFlag[]> {
  const people: Array<{ name: string; role: string }> = [
    ...directors.map(d => ({ name: d.name, role: d.role ?? 'Director' })),
    ...(beneficialOwners ?? []).map(b => ({ name: b.name, role: 'PSC / Beneficial Owner' })),
  ]
  if (people.length === 0) return []

  const HIGH_CONFIDENCE_THRESHOLD = 0.75
  const MEDIUM_CONFIDENCE_THRESHOLD = 0.60

  for (const person of people) {
    if (!person.name || person.name.length < 3) continue
    // Normalize: lowercase, strip non-alphanumeric except spaces
    const normalized = person.name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
    if (!normalized || normalized.length < 3) continue

    // Check sanctions_entries (OFAC SDN / EU FSF / UN)
    const { rows: sanctionMatches } = await db.query<{
      entity_name: string
      source: string
      sim: number
      last_updated: string | null
    }>(
      `SELECT entity_name, source, similarity(normalized_name, $1) AS sim, last_updated
       FROM sanctions_entries
       WHERE similarity(normalized_name, $1) >= $2
       ORDER BY sim DESC LIMIT 3`,
      [normalized, MEDIUM_CONFIDENCE_THRESHOLD]
    )

    // Check regulatory_warnings (FCA / MAS / DFSA / SCA / CMA Oman / FINMA / SFC)
    const { rows: warningMatches } = await db.query<{
      entity_name: string
      source_name: string
      sim: number
      synced_at: string | null
    }>(
      `SELECT entity_name, source_name, similarity(normalized_name, $1) AS sim, synced_at
       FROM regulatory_warnings
       WHERE similarity(normalized_name, $1) >= $2
       ORDER BY sim DESC LIMIT 3`,
      [normalized, MEDIUM_CONFIDENCE_THRESHOLD]
    )

    if (sanctionMatches.length === 0 && warningMatches.length === 0) continue

    // Combine and find best match
    type SanctionRow = { entity_name: string; source: string; sim: number; last_updated: string | null }
    type WarningRow = { entity_name: string; source_name: string; sim: number; synced_at: string | null }
    const allMatches: Array<{ entity_name: string; listName: string; sim: number; syncedAt: string | null }> = [
      ...sanctionMatches.map((r: SanctionRow) => ({
        entity_name: r.entity_name,
        listName: `${r.source.toUpperCase()} Sanctions`,
        sim: r.sim,
        syncedAt: r.last_updated,
      })),
      ...warningMatches.map((r: WarningRow) => ({
        entity_name: r.entity_name,
        listName: r.source_name,
        sim: r.sim,
        syncedAt: r.synced_at,
      })),
    ]
    allMatches.sort((a, b) => b.sim - a.sim)
    const best = allMatches[0]
    if (!best) continue

    const confidence = best.sim >= HIGH_CONFIDENCE_THRESHOLD ? 'high' : 'medium'

    return [{
      code: 'RELATED_PARTY_RISK',
      severity: 'high',
      target: 'seller',
      reason: `A director or beneficial owner of the counterparty company appears to match a sanctions or regulatory warning list entry. Manual verification by a compliance officer is required.`,
      evidence: [
        `${person.role} ${person.name} matches ${best.listName} entry '${best.entity_name}' (confidence: ${confidence})`,
      ],
      dataSource: best.listName,
      dataSourceSyncedAt: best.syncedAt ?? null,
    }]
  }

  return []
}

export async function runTradeCheck(userId: string, input: TradeCheckInput): Promise<TradeCheckResult> {
  const { seller, vessel, date, loadingPort, commodity, imoField } = input
  const vesselImo = extractImo(vessel, imoField)

  const [sellerSanction, sellerDbResults, vesselSanction, vesselDbMatch, portData, vesselAis, gleifRecord, sellerFraudCheck] = await Promise.all([
    checkSanctions(seller).catch(() => ({ status: 'degraded' as const, listed: false, sources: [] as string[] })),
    searchEntities(seller, 'company').catch(() => [] as SearchResult[]),
    checkSanctions(vessel).catch(() => ({ status: 'degraded' as const, listed: false, sources: [] as string[] })),
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

  const [sellerIcijCount, sellerDbIncDate, gleifOwnershipChain, pscSummary, draftRisk, sellerFullEntity] = await Promise.all([
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
      ? getGleifOwnershipChain(gleifRecord.lei).catch(() => null)
      : Promise.resolve(null),
    resolvedImo ? getPscSummary(resolvedImo).catch(() => null) : Promise.resolve(null),
    loadingPort ? checkDraftRisk(loadingPort, vesselDraftM).catch(() => null) : Promise.resolve(null),
    sellerDbMatch?.registrationNumber
      ? getEntityByKey(sellerDbMatch.registrationNumber).catch(() => null)
      : Promise.resolve(null),
  ])

  const sellerUltimateParentJurisdiction = gleifOwnershipChain?.ultimateParentJurisdiction ?? null
  const sellerIncorporationDate = sellerDbIncDate ?? gleifRecord?.initialRegistrationDate ?? null
  const sellerBeneficialOwners: BeneficialOwner[] | null = (sellerFullEntity as Company | null)?.beneficialOwners ?? null

  // GAP-1: Domain fraud check (DECISION-03, D-01 to D-05)
  // Must run AFTER second batch — needs sellerFullEntity.website for fallback (D-01)
  const rawDomain = input.sellerDomain
    ?? (sellerFullEntity as Company | null)?.website
    ?? null
  const resolvedDomain = rawDomain ? extractDomain(rawDomain) : null

  let sellerDomainCheck: TradeRuleInput['sellerDomainCheck'] = undefined
  if (resolvedDomain) {
    try {
      const check = await checkDomain(resolvedDomain)
      if (check.flagged) {
        // Map to exact TradeRuleInput.sellerDomainCheck shape — exclude check.whois (not expected by trade-rules.ts)
        sellerDomainCheck = {
          domain: check.domain,
          flagged: check.flagged,
          severity: check.severity,
          evidence: check.evidence,
          spoofingMatches: check.spoofingMatches,
        }
      }
    } catch (err) {
      // D-05: silently skip on RDAP failure — log but no UI impact
      console.warn('[trade] domain check failed, skipping:', err)
    }
  }

  const sellerSanctionStatus: SanctionStatus = sellerSanction.listed ? 'listed' : 'not_listed'
  const vesselSanctionStatus: SanctionStatus = vesselSanction.listed ? 'listed' : 'not_listed'
  const sanctionDegraded = sellerSanction.status === 'degraded' || vesselSanction.status === 'degraded'

  // 1-hop director/PSC sanction pre-check (DECISION-05)
  function isCompany(e: unknown): e is Company {
    return typeof e === 'object' && e !== null && 'directors' in e
  }
  const sellerDirectors: Array<{ name: string; role?: string }> =
    isCompany(sellerFullEntity) ? (sellerFullEntity.directors ?? []) : []
  const relatedPartyFlags = (sellerDirectors.length > 0 || (sellerBeneficialOwners?.length ?? 0) > 0)
    ? await checkRelatedPartyRisk(sellerDirectors, sellerBeneficialOwners).catch(() => [])
    : []

  const ruleFlags = runTradeRules({
    sellerName: seller,
    sellerDbMatch,
    sellerSanctioned: sellerSanction.listed,
    sellerSanctionSources: sellerSanction.sources,
    sellerIncorporationDate,
    sellerUltimateParentJurisdiction,
    sellerOwnershipChain: gleifOwnershipChain,
    sellerBeneficialOwners,
    sellerRegistrySource: deriveRegistrySource(sellerDbMatch?.id),
    sellerDomainCheck,        // GAP-1 (DECISION-03) — undefined when no domain resolved (D-04)
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
  const flags = [...relatedPartyFlags, ...ruleFlags]

  const flagRisk = overallRiskFromFlags(flags)
  const sellerLevel = entityRisk(sellerSanction.listed, sellerDbMatch, sellerIcijCount)
  const vesselLevel = vesselRisk(vesselSanction.listed, vesselDbResult, vesselAis, pscSummary)
  const overallRisk = worstRisk(flagRisk, sellerLevel, vesselLevel)
  const verdict = deriveVerdict(flags)
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
    verdict,
    summary,
    sanctionDegraded: sanctionDegraded || undefined,
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


/**
 * POST /api/trade
 *
 * Trade risk check — verify a single energy trade transaction.
 *
 * Input: seller name, vessel name/IMO, trade date, loading port (LOCODE), commodity.
 * Output: structured risk assessment with deterministic flags, scores, and evidence.
 *
 * Checks performed:
 *   - Seller: sanctions screen, registry lookup, ICIJ officer network, score
 *   - Vessel: sanctions screen, registry lookup, cached AIS position + dark periods, PSC history
 *   - Trade: geo risk, draft feasibility, STS zone detection, AIS destination mismatch
 *
 * Access: Starter+ plan users only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { auth } from '@/auth'
import { applyMigrations } from '@/lib/server/migrations'
import { db } from '@/lib/server/db'
import { checkSanctions } from '@/lib/server/sync/sanctions'
import {
  searchEntities,
  getEntityByKey,
  getPscSummary,
  checkDraftRisk,
  getPortByLocode,
  getIcijOfficerNetwork,
  type PscSummary,
} from '@/lib/server/repository'
import {
  runTradeRules,
  overallRiskFromFlags,
  generateSummary,
  type TradeFlag,
} from '@/lib/server/trade-rules'
import type { SearchResult, RiskLevel, SanctionStatus } from '@/lib/types'
import type { VesselAisData } from '@/lib/ais-types'
import type { DraftRiskResult } from '@/lib/server/repository'

// ── Output types ──────────────────────────────────────────────────────────────

export interface TradePartyResult {
  name: string
  sanctionStatus: SanctionStatus
  sanctionSources: string[]
  dbMatch: SearchResult | null
  icijConnections: number        // ICIJ officer network hits (companies only)
  riskLevel: RiskLevel
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read cached AIS data for a vessel without hitting the live API. */
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

/** Derive a vessel IMO from either a pure 7-digit string or a name like "MV STAR / 9346079". */
function extractImo(vesselInput: string, imoField?: string): string | null {
  if (imoField && /^\d{7}$/.test(imoField.trim())) return imoField.trim()
  const match = vesselInput.match(/\b(\d{7})\b/)
  return match ? match[1] : null
}

const RISK_ORDER: Record<RiskLevel, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

function worstRisk(...levels: (RiskLevel | undefined)[]): RiskLevel {
  return levels
    .filter((l): l is RiskLevel => !!l)
    .reduce((a, b) => RISK_ORDER[a] < RISK_ORDER[b] ? a : b, 'low')
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'Trade checks require a Starter or higher plan.' },
      { status: 403 }
    )
  }

  await applyMigrations()

  // ── Parse input ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const seller      = String(body.seller ?? '').trim()
  const vessel      = String(body.vessel ?? '').trim()
  const date        = body.date ? String(body.date).trim() : null
  const loadingPort = body.loadingPort ? String(body.loadingPort).trim().toUpperCase() : null
  const commodity   = body.commodity ? String(body.commodity).trim() : null
  const imoField    = body.imo ? String(body.imo).trim() : undefined

  if (!seller || seller.length < 2) {
    return NextResponse.json({ error: 'Field "seller" is required (min 2 chars).' }, { status: 400 })
  }
  if (!vessel || vessel.length < 2) {
    return NextResponse.json({ error: 'Field "vessel" is required (min 2 chars).' }, { status: 400 })
  }

  const vesselImo = extractImo(vessel, imoField)

  // ── Run all checks in parallel ─────────────────────────────────────────────
  const [
    sellerSanction,
    sellerDbResults,
    vesselSanction,
    vesselDbMatch,
    portData,
    vesselAis,
  ] = await Promise.all([
    checkSanctions(seller).catch(() => ({ listed: false, sources: [] as string[] })),
    searchEntities(seller, 'company').catch(() => [] as SearchResult[]),
    checkSanctions(vessel).catch(() => ({ listed: false, sources: [] as string[] })),
    // Vessel lookup: prefer IMO, fallback to name search
    vesselImo
      ? getEntityByKey(vesselImo).catch(() => null)
      : searchEntities(vessel, 'vessel').then(r => r[0] ?? null).catch(() => null),
    loadingPort ? getPortByLocode(loadingPort).catch(() => null) : Promise.resolve(null),
    vesselImo ? getCachedAis(vesselImo) : Promise.resolve(null),
  ])

  const sellerDbMatch  = sellerDbResults[0] ?? null
  const vesselDbResult = vesselDbMatch as SearchResult | null

  // ── ICIJ check for seller ─────────────────────────────────────────────────
  const sellerIcijCount = sellerDbMatch?.id
    ? await getIcijOfficerNetwork(sellerDbMatch.id)
        .then(links => links.length)
        .catch(() => 0)
    : 0

  // ── Seller incorporation date (for NEWLY_INCORPORATED_SELLER rule) ─────────
  const sellerIncorporationDate: string | null = sellerDbMatch?.id
    ? await db.query<{ inc_date: string | null }>(
        `SELECT metadata_json->>'incorporationDate' AS inc_date FROM entities WHERE id = $1`,
        [sellerDbMatch.id]
      ).then(r => r.rows[0]?.inc_date ?? null).catch(() => null)
    : null

  // ── PSC check for vessel ───────────────────────────────────────────────────
  const resolvedImo = vesselImo ?? vesselDbResult?.imo ?? null
  const pscSummary  = resolvedImo
    ? await getPscSummary(resolvedImo).catch(() => null)
    : null

  // ── Draft risk check ───────────────────────────────────────────────────────
  const vesselDraftM = vesselAis?.position?.draught ?? null
  const draftRisk: DraftRiskResult | null = loadingPort
    ? await checkDraftRisk(loadingPort, vesselDraftM).catch(() => null)
    : null

  // ── Derive risk levels ────────────────────────────────────────────────────
  const sellerSanctionStatus: SanctionStatus = sellerSanction.listed ? 'listed' : 'not_listed'
  const vesselSanctionStatus: SanctionStatus = vesselSanction.listed ? 'listed' : 'not_listed'

  function entityRisk(
    sanctioned: boolean,
    dbMatch: SearchResult | null,
    icijCount: number,
  ): RiskLevel {
    if (sanctioned) return 'critical'
    if (icijCount > 0) return 'high'
    if (dbMatch?.riskLevel === 'critical' || dbMatch?.riskLevel === 'high') return 'high'
    if (dbMatch?.riskLevel === 'medium') return 'medium'
    if (!dbMatch) return 'high'  // unknown entity = high by default
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
    if (!ais || !ais.position) return 'high'  // no tracking = unknown
    if (dbMatch?.riskLevel === 'critical' || dbMatch?.riskLevel === 'high') return 'high'
    return 'medium'
  }

  // ── Run deterministic rule engine ─────────────────────────────────────────
  const flags = runTradeRules({
    sellerName:               seller,
    sellerDbMatch,
    sellerSanctioned:         sellerSanction.listed,
    sellerSanctionSources:    sellerSanction.sources,
    sellerIncorporationDate,

    vesselName:               vessel,
    vesselImo:                resolvedImo,
    vesselDbMatch:            vesselDbResult,
    vesselSanctioned:         vesselSanction.listed,
    vesselSanctionSources:    vesselSanction.sources,
    vesselAis,
    vesselOperatorChanges:    null,  // populated in TASK-05 (PSC history)

    loadingPortLocode:        loadingPort,
    loadingPortCountry:       portData?.country ?? null,
    loadingPortName:          portData?.name ?? null,
    draftRisk,

    tradeDate:                date,
    commodity,
  })

  const flagRisk    = overallRiskFromFlags(flags)
  const sellerLevel = entityRisk(sellerSanction.listed, sellerDbMatch, sellerIcijCount)
  const vesselLevel = vesselRisk(vesselSanction.listed, vesselDbResult, vesselAis, pscSummary)
  const overallRisk = worstRisk(flagRisk, sellerLevel, vesselLevel)
  const summary     = generateSummary(flags, overallRisk, seller, vessel)

  // ── Assemble result ────────────────────────────────────────────────────────
  const id         = randomUUID()
  const checkedAt  = new Date().toISOString()

  const aisAge = vesselAis?.position
    ? (Date.now() - new Date(vesselAis.position.lastUpdate).getTime()) / 3_600_000
    : null

  const result: TradeCheckResult = {
    id,
    checkedAt,
    input: { seller, vessel, date, loadingPort, commodity },

    seller: {
      name:             seller,
      sanctionStatus:   sellerSanctionStatus,
      sanctionSources:  sellerSanction.sources,
      dbMatch:          sellerDbMatch,
      icijConnections:  sellerIcijCount,
      riskLevel:        sellerLevel,
    },

    vessel: {
      name:           vessel,
      imo:            resolvedImo,
      sanctionStatus: vesselSanctionStatus,
      sanctionSources: vesselSanction.sources,
      dbMatch:        vesselDbResult,
      hasRecentAis:   !!vesselAis?.position && (aisAge ?? 999) < 72,
      lastAisUpdate:  vesselAis?.position?.lastUpdate ?? null,
      darkPeriods:    vesselAis?.darkPeriods?.length ?? 0,
      psc:            pscSummary,
      riskLevel:      vesselLevel,
    },

    port: portData
      ? {
          locode:    loadingPort!,
          name:      portData.name,
          found:     true,
          isStsZone: draftRisk?.isStsPort ?? false,
          draftRisk,
        }
      : loadingPort
        ? { locode: loadingPort, name: null, found: false, isStsZone: false, draftRisk: null }
        : null,

    flags,
    overallRisk,
    summary,
  }

  // ── Persist session ────────────────────────────────────────────────────────
  await db.query(
    `INSERT INTO trade_sessions (id, user_id, input_json, result_json, overall_risk, flag_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      session.user.id,
      JSON.stringify(result.input),
      JSON.stringify(result),
      overallRisk,
      flags.length,
    ]
  ).catch((err) => console.error('[trade] Failed to persist session:', err))

  // Piggyback TTL cleanup (fire-and-forget, 90-day retention)
  db.query(`DELETE FROM trade_sessions WHERE created_at < NOW() - INTERVAL '90 days'`)
    .catch((err) => console.error('[trade] TTL cleanup error:', err))

  // ── Write trade events (powers tradingTrackRecord Phase 2 score) ───────────
  if (sellerDbMatch?.id) {
    db.query(
      `INSERT INTO trade_events
         (entity_id, counterparty_name, counterparty_id, vessel_imo, event_date, commodity, port_locode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        sellerDbMatch.id,
        vessel,
        vesselDbResult?.id ?? null,
        resolvedImo,
        date,
        commodity,
        loadingPort,
      ]
    ).catch((err) => console.error('[trade] Failed to write seller trade event:', err))
  }
  if (vesselDbResult?.id) {
    db.query(
      `INSERT INTO trade_events
         (entity_id, counterparty_name, counterparty_id, vessel_imo, event_date, commodity, port_locode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        vesselDbResult.id,
        seller,
        sellerDbMatch?.id ?? null,
        resolvedImo,
        date,
        commodity,
        loadingPort,
      ]
    ).catch((err) => console.error('[trade] Failed to write vessel trade event:', err))
  }

  return NextResponse.json(result)
}

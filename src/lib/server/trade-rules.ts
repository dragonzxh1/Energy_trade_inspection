/**
 * Deterministic trade risk rule engine.
 *
 * Six standard flags (Phase 1):
 *   NO_REGISTRY_MATCH          — seller not found in any registry
 *   SANCTION_EXPOSURE          — seller or vessel on trade sanctions list
 *   LIMITED_BUSINESS_FOOTPRINT — seller has negligible verifiable presence
 *   GEO_MISMATCH               — high-risk jurisdiction in seller / vessel / port
 *   NO_RECENT_ACTIVITY         — vessel AIS dark or stale > 72 h
 *   INCONSISTENT_TRADE_STORY   — physical impossibility or AIS contradiction
 *
 * Each flag includes: code, severity, target, reason, evidence[].
 * Rules are deterministic: same input → same flags, always.
 */

import type { RiskLevel } from '@/lib/types'
import type { SearchResult } from '@/lib/types'
import type { VesselAisData } from '@/lib/ais-types'
import type { DraftRiskResult } from '@/lib/server/repository'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FlagCode =
  | 'NO_REGISTRY_MATCH'
  | 'SANCTION_EXPOSURE'
  | 'LIMITED_BUSINESS_FOOTPRINT'
  | 'GEO_MISMATCH'
  | 'NO_RECENT_ACTIVITY'
  | 'INCONSISTENT_TRADE_STORY'

export interface TradeFlag {
  code: FlagCode
  severity: RiskLevel
  target: 'seller' | 'vessel' | 'trade'
  reason: string
  evidence: string[]
}

export interface TradeRuleInput {
  // Seller
  sellerName: string
  sellerDbMatch: SearchResult | null
  sellerSanctioned: boolean
  sellerSanctionSources: string[]

  // Vessel
  vesselName: string
  vesselImo: string | null
  vesselDbMatch: SearchResult | null
  vesselSanctioned: boolean
  vesselSanctionSources: string[]
  vesselAis: VesselAisData | null

  // Port
  loadingPortLocode: string | null
  loadingPortCountry: string | null
  loadingPortName: string | null
  draftRisk: DraftRiskResult | null

  // Trade context
  tradeDate: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const HIGH_RISK_CC = new Set([
  'ir', 'ru', 've', 'cu', 'kp', 'sy', 'sd', 'by', 'mm', 'ye',
])

function isHighRisk(cc: string | null | undefined): boolean {
  if (!cc) return false
  return HIGH_RISK_CC.has(cc.toLowerCase().slice(0, 2))
}

const RISK_ORDER: Record<RiskLevel, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

// ── Rule engine ───────────────────────────────────────────────────────────────

export function runTradeRules(input: TradeRuleInput): TradeFlag[] {
  const flags: TradeFlag[] = []

  // ── Rule 1: SANCTION_EXPOSURE ──────────────────────────────────────────────
  if (input.sellerSanctioned) {
    flags.push({
      code: 'SANCTION_EXPOSURE',
      severity: 'critical',
      target: 'seller',
      reason: `Seller "${input.sellerName}" appears on one or more trade sanctions lists.`,
      evidence: input.sellerSanctionSources.length > 0
        ? input.sellerSanctionSources
        : ['OpenSanctions'],
    })
  }

  if (input.vesselSanctioned) {
    const vesselLabel = input.vesselImo
      ? `${input.vesselName} (IMO ${input.vesselImo})`
      : input.vesselName
    flags.push({
      code: 'SANCTION_EXPOSURE',
      severity: 'critical',
      target: 'vessel',
      reason: `Vessel "${vesselLabel}" appears on one or more trade sanctions lists.`,
      evidence: input.vesselSanctionSources.length > 0
        ? input.vesselSanctionSources
        : ['OpenSanctions'],
    })
  }

  // ── Rule 2: NO_REGISTRY_MATCH ──────────────────────────────────────────────
  if (!input.sellerDbMatch) {
    flags.push({
      code: 'NO_REGISTRY_MATCH',
      severity: 'high',
      target: 'seller',
      reason: `Seller "${input.sellerName}" could not be found in any company registry (local database, Singapore ACRA, or UK Companies House).`,
      evidence: ['Local Entity Database', 'Singapore ACRA', 'UK Companies House'],
    })
  }

  // ── Rule 3: LIMITED_BUSINESS_FOOTPRINT ────────────────────────────────────
  if (
    input.sellerDbMatch &&
    input.sellerDbMatch.authenticityScore < 40 &&
    !input.sellerDbMatch.registrationNumber
  ) {
    flags.push({
      code: 'LIMITED_BUSINESS_FOOTPRINT',
      severity: 'high',
      target: 'seller',
      reason: `Seller "${input.sellerName}" has a very low authenticity score (${input.sellerDbMatch.authenticityScore}/100) with no verified registration number — consistent with shell company patterns.`,
      evidence: ['Authenticity Score Engine', 'Company Registry Check'],
    })
  }

  // ── Rule 4: GEO_MISMATCH ──────────────────────────────────────────────────
  const sellerCC = input.sellerDbMatch?.country ?? ''
  const vesselCC = input.vesselDbMatch?.country ?? input.vesselDbMatch?.jurisdictionFlag ?? ''
  const portCC   = input.loadingPortCountry ?? ''

  if (isHighRisk(sellerCC)) {
    flags.push({
      code: 'GEO_MISMATCH',
      severity: 'high',
      target: 'seller',
      reason: `Seller is registered in a high-risk sanctioned jurisdiction: ${sellerCC}.`,
      evidence: ['Company Registry', 'OFAC/UN/EU Sanctioned Country List'],
    })
  }

  if (portCC && isHighRisk(portCC)) {
    flags.push({
      code: 'GEO_MISMATCH',
      severity: 'high',
      target: 'trade',
      reason: `Loading port "${input.loadingPortName ?? input.loadingPortLocode}" is located in a high-risk sanctioned jurisdiction (${portCC.toUpperCase()}).`,
      evidence: ['Port Database', 'OFAC/UN/EU Sanctioned Country List'],
    })
  }

  if (vesselCC && isHighRisk(vesselCC)) {
    flags.push({
      code: 'GEO_MISMATCH',
      severity: 'medium',
      target: 'vessel',
      reason: `Vessel is registered under a high-risk flag state: ${vesselCC}.`,
      evidence: ['Vessel Registry', 'AIS Data'],
    })
  }

  // ── Rule 5: NO_RECENT_ACTIVITY ────────────────────────────────────────────
  if (!input.vesselAis || !input.vesselAis.position) {
    flags.push({
      code: 'NO_RECENT_ACTIVITY',
      severity: 'medium',
      target: 'vessel',
      reason: `No AIS position data available for vessel "${input.vesselName}"${input.vesselImo ? ` (IMO ${input.vesselImo})` : ''}. Vessel location cannot be confirmed.`,
      evidence: ['AIS Tracking System (VesselAPI / aisstream)'],
    })
  } else {
    const ageH = (Date.now() - new Date(input.vesselAis.position.lastUpdate).getTime()) / 3_600_000
    if (ageH > 72) {
      flags.push({
        code: 'NO_RECENT_ACTIVITY',
        severity: 'medium',
        target: 'vessel',
        reason: `Vessel "${input.vesselName}" AIS signal last received ${Math.round(ageH)} hours ago — vessel tracking is stale.`,
        evidence: [`Last AIS update: ${input.vesselAis.position.lastUpdate}`],
      })
    }
  }

  // ── Rule 6: INCONSISTENT_TRADE_STORY ──────────────────────────────────────

  // 6a: Loading point is STS anchorage, not a terminal
  if (input.draftRisk?.isStsPort) {
    flags.push({
      code: 'INCONSISTENT_TRADE_STORY',
      severity: 'high',
      target: 'trade',
      reason: input.draftRisk.warning ??
        `Loading point "${input.loadingPortName ?? input.loadingPortLocode}" is a ship-to-ship (STS) anchorage zone, not a terminal berth. A contract specifying delivery here is irregular.`,
      evidence: ['Port Database', 'STS Zone Registry'],
    })
  }

  // 6b: Vessel physically cannot berth — draft exceeds port maximum
  if (input.draftRisk && !input.draftRisk.isStsPort && input.draftRisk.canBerth === false) {
    flags.push({
      code: 'INCONSISTENT_TRADE_STORY',
      severity: 'high',
      target: 'trade',
      reason: input.draftRisk.warning ??
        `Vessel cannot physically berth at the stated loading port — draft exceeds port maximum.`,
      evidence: [
        `Vessel draft: ${input.draftRisk.vesselDraftM ?? 'unknown'}m`,
        `Port max draft: ${input.draftRisk.portMaxDraftM ?? 'unknown'}m`,
        'Port Database',
      ],
    })
  }

  // 6c: AIS destination doesn't match stated loading port
  if (
    input.vesselAis?.position?.destination &&
    input.loadingPortLocode &&
    input.loadingPortName
  ) {
    const dest     = input.vesselAis.position.destination.toLowerCase().trim()
    const portName = input.loadingPortName.toLowerCase()
    const portCode = input.loadingPortLocode.toLowerCase()

    // Only flag if destination is set, non-trivial, and clearly doesn't match
    if (
      dest.length > 2 &&
      !dest.includes(portCode) &&
      !dest.includes(portName.slice(0, 5)) &&
      !portName.includes(dest.slice(0, 5)) &&
      !portCode.slice(2).includes(dest.slice(0, 3))  // e.g. "HAK" matches "CNHAK"
    ) {
      flags.push({
        code: 'INCONSISTENT_TRADE_STORY',
        severity: 'medium',
        target: 'vessel',
        reason: `Vessel AIS destination ("${input.vesselAis.position.destination}") does not match the stated loading port ("${input.loadingPortName}").`,
        evidence: [
          `AIS destination: ${input.vesselAis.position.destination}`,
          `Stated loading port: ${input.loadingPortName} (${input.loadingPortLocode})`,
        ],
      })
    }
  }

  // 6d: AIS dark periods near the stated trade date
  if (input.vesselAis && input.vesselAis.darkPeriods.length > 0) {
    const tradeTime = input.tradeDate ? new Date(input.tradeDate).getTime() : null

    const nearDark = tradeTime
      ? input.vesselAis.darkPeriods.filter((dp) => {
          const startT = new Date(dp.start).getTime()
          const endT   = dp.end ? new Date(dp.end).getTime() : Date.now()
          return Math.abs(startT - tradeTime) < 14 * 24 * 3_600_000 ||
                 (startT <= tradeTime && endT >= tradeTime)
        })
      : input.vesselAis.darkPeriods  // no date provided → report all dark periods

    if (nearDark.length > 0) {
      const longest = nearDark.reduce((a, b) =>
        (a.durationHours ?? 0) > (b.durationHours ?? 0) ? a : b
      )
      flags.push({
        code: 'INCONSISTENT_TRADE_STORY',
        severity: nearDark.length >= 3 ? 'high' : 'medium',
        target: 'vessel',
        reason: `Vessel has ${nearDark.length} AIS dark period(s) near the stated trade date. Longest gap: ${longest.durationHours ? Math.round(longest.durationHours) + 'h' : 'ongoing'} at ${longest.location}.`,
        evidence: nearDark.slice(0, 3).map(
          (dp) => `Dark: ${dp.start} → ${dp.end ?? 'ongoing'} (${dp.location})`
        ),
      })
    }
  }

  return flags
}

// ── Aggregation helpers ───────────────────────────────────────────────────────

export function overallRiskFromFlags(flags: TradeFlag[]): RiskLevel {
  if (flags.length === 0) return 'low'
  return flags.reduce(
    (worst, f) => RISK_ORDER[f.severity] < RISK_ORDER[worst] ? f.severity : worst,
    'low' as RiskLevel,
  )
}

export function generateSummary(
  flags: TradeFlag[],
  overallRisk: RiskLevel,
  sellerName: string,
  vesselName: string,
): string {
  if (flags.length === 0) {
    return `No risk indicators found for seller "${sellerName}" and vessel "${vesselName}". All standard checks passed.`
  }

  const bySeverity = (s: RiskLevel) => flags.filter(f => f.severity === s)
  const critical = bySeverity('critical')
  const high     = bySeverity('high')
  const medium   = bySeverity('medium')

  const parts: string[] = [`Overall risk: ${overallRisk.toUpperCase()}.`]

  if (critical.length > 0) {
    parts.push(`${critical.length} critical flag(s): ${[...new Set(critical.map(f => f.code))].join(', ')}.`)
  }
  if (high.length > 0) {
    parts.push(`${high.length} high-severity flag(s): ${[...new Set(high.map(f => f.code))].join(', ')}.`)
  }
  if (medium.length > 0) {
    parts.push(`${medium.length} medium flag(s): ${[...new Set(medium.map(f => f.code))].join(', ')}.`)
  }

  // Lead with the most severe flag's reason
  parts.push(flags[0].reason)

  return parts.join(' ')
}

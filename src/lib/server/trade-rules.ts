/**
 * Deterministic trade risk rule engine.
 *
 * Nine standard flags (Phase 1 + Phase 2):
 *   NO_REGISTRY_MATCH          — seller not found in any registry
 *   SANCTION_EXPOSURE          — seller or vessel on trade sanctions list
 *   LIMITED_BUSINESS_FOOTPRINT — seller has negligible verifiable presence
 *   GEO_MISMATCH               — high-risk jurisdiction in seller / vessel / port
 *   NO_RECENT_ACTIVITY         — vessel AIS dark or stale > 72 h
 *   INCONSISTENT_TRADE_STORY   — physical impossibility or AIS contradiction
 *   NEWLY_INCORPORATED_SELLER  — seller < 24 months old trading high-value commodity
 *   VESSEL_FLAG_ROUTE_MISMATCH — vessel under known evasion flag state
 *   MULTIPLE_OPERATOR_CHANGES  — vessel changed operator/owner > 2× in 18 months
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
  | 'NEWLY_INCORPORATED_SELLER'
  | 'VESSEL_FLAG_ROUTE_MISMATCH'
  | 'MULTIPLE_OPERATOR_CHANGES'
  | 'VESSEL_COMPLIANCE_RISK'

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
  /** ISO date string from entity metadata_json.incorporationDate. Null if unknown. */
  sellerIncorporationDate?: string | null

  // Vessel
  vesselName: string
  vesselImo: string | null
  vesselDbMatch: SearchResult | null
  vesselSanctioned: boolean
  vesselSanctionSources: string[]
  vesselAis: VesselAisData | null
  /** Count of operator/registered-owner changes in the past 18 months. Null if unknown. */
  vesselOperatorChanges?: number | null
  /** PSC detention count across all recorded inspections. Null if no data. */
  vesselPscDetentions?: number | null
  /** PSC deficiency rate (0–1) across all recorded inspections. Null if no data. */
  vesselPscDeficiencyRate?: number | null

  // Port
  loadingPortLocode: string | null
  loadingPortCountry: string | null
  loadingPortName: string | null
  draftRisk: DraftRiskResult | null

  // Trade context
  tradeDate: string | null
  /** Commodity description e.g. "Fuel Oil 380 cst", "Crude Oil", "LNG". */
  commodity?: string | null

  /**
   * When true, AIS-dependent rules (NO_RECENT_ACTIVITY, AIS destination mismatch,
   * dark period detection) are skipped. Used when calling from the screen flow
   * where AIS data is not fetched to keep latency acceptable.
   */
  skipAisRules?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const HIGH_RISK_CC = new Set([
  'ir', 'ru', 've', 'cu', 'kp', 'sy', 'sd', 'by', 'mm', 'ye',
])

/** Flag states associated with sanctions-evasion routing per OFAC/IMO risk lists. */
const EVASION_FLAGS = new Set(['km', 'pw', 'tg', 'sl', 'md'])

/** High-value bulk energy commodities that amplify counterparty risk. */
const HIGH_VALUE_COMMODITY_RE = /crude|lng|bunker|fuel\s*oil|petroleum/i

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
  if (input.skipAisRules) {
    // AIS rules suppressed — caller did not fetch AIS (e.g. document screening flow)
  } else if (!input.vesselAis || !input.vesselAis.position) {
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

  // 6a: Loading point is STS anchorage, not a terminal (no AIS needed)
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
    !input.skipAisRules &&
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
  if (!input.skipAisRules && input.vesselAis && input.vesselAis.darkPeriods.length > 0) {
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

  // ── Rule 7: NEWLY_INCORPORATED_SELLER ─────────────────────────────────────
  // Young company (< 24 months) handling high-value bulk energy — elevated risk.
  if (
    input.sellerIncorporationDate &&
    input.commodity &&
    HIGH_VALUE_COMMODITY_RE.test(input.commodity)
  ) {
    const ageMonths =
      (Date.now() - new Date(input.sellerIncorporationDate).getTime()) / (30 * 24 * 3_600_000)
    if (ageMonths < 24) {
      flags.push({
        code: 'NEWLY_INCORPORATED_SELLER',
        severity: 'high',
        target: 'seller',
        reason: `Seller "${input.sellerName}" was incorporated ${Math.round(ageMonths)} months ago and is trading a high-value commodity (${input.commodity}). Very young companies handling bulk energy are a known red flag pattern.`,
        evidence: [
          `Incorporation date: ${input.sellerIncorporationDate}`,
          `Commodity: ${input.commodity}`,
          'Threshold: < 24 months old',
        ],
      })
    }
  }

  // ── Rule 8: VESSEL_FLAG_ROUTE_MISMATCH ────────────────────────────────────
  // Vessel registered under a known sanctions-evasion flag state.
  if (input.loadingPortLocode) {
    const flagCC = (
      input.vesselDbMatch?.jurisdictionFlag ??
      input.vesselDbMatch?.country ??
      ''
    ).toLowerCase().slice(0, 2)

    if (flagCC && EVASION_FLAGS.has(flagCC)) {
      const FLAG_NAMES: Record<string, string> = {
        km: 'Comoros', pw: 'Palau', tg: 'Togo', sl: 'Sierra Leone', md: 'Moldova',
      }
      flags.push({
        code: 'VESSEL_FLAG_ROUTE_MISMATCH',
        severity: 'medium',
        target: 'vessel',
        reason: `Vessel "${input.vesselName}" is registered under ${FLAG_NAMES[flagCC] ?? flagCC.toUpperCase()} — a flag state associated with sanctions-evasion routing. Use of such flags for energy cargo warrants enhanced scrutiny.`,
        evidence: [
          `Vessel flag: ${flagCC.toUpperCase()} (${FLAG_NAMES[flagCC] ?? 'unknown'})`,
          'Known evasion flag states: KM, PW, TG, SL, MD',
          'Source: OFAC/IMO flag state risk assessment',
        ],
      })
    }
  }

  // ── Rule 9: MULTIPLE_OPERATOR_CHANGES ─────────────────────────────────────
  // Rapid ownership/operator turnover — common obfuscation tactic.
  if (input.vesselOperatorChanges != null && input.vesselOperatorChanges > 2) {
    flags.push({
      code: 'MULTIPLE_OPERATOR_CHANGES',
      severity: 'medium',
      target: 'vessel',
      reason: `Vessel "${input.vesselName}" has changed operator or registered owner ${input.vesselOperatorChanges} times in the past 18 months. Rapid ownership transfers are a documented technique to obscure sanctions exposure.`,
      evidence: [
        `Operator/owner changes in past 18 months: ${input.vesselOperatorChanges}`,
        'Threshold: more than 2 changes',
        'Source: Vessel Registry / AIS History',
      ],
    })
  }

  // ── Rule 10: VESSEL_COMPLIANCE_RISK ───────────────────────────────────────
  // PSC detention or chronic deficiency — direct evidence of non-compliance.
  if (input.vesselPscDetentions != null && input.vesselPscDetentions > 0) {
    const defPct = input.vesselPscDeficiencyRate != null
      ? `${Math.round(input.vesselPscDeficiencyRate * 100)}%`
      : 'unknown'
    flags.push({
      code: 'VESSEL_COMPLIANCE_RISK',
      severity: 'high',
      target: 'vessel',
      reason: `Vessel "${input.vesselName}" has been detained ${input.vesselPscDetentions} time(s) during Port State Control inspections — indicating serious compliance or seaworthiness deficiencies.`,
      evidence: [
        `PSC detentions: ${input.vesselPscDetentions}`,
        `Deficiency rate: ${defPct}`,
        'Source: Paris MOU / Tokyo MOU / USCG PSC Records',
      ],
    })
  } else if (
    input.vesselPscDetentions === 0 &&
    input.vesselPscDeficiencyRate != null &&
    input.vesselPscDeficiencyRate > 0.30
  ) {
    flags.push({
      code: 'VESSEL_COMPLIANCE_RISK',
      severity: 'medium',
      target: 'vessel',
      reason: `Vessel "${input.vesselName}" has a PSC deficiency rate of ${Math.round(input.vesselPscDeficiencyRate * 100)}% (threshold: 30%) — indicating recurring maintenance or operational deficiencies across inspections.`,
      evidence: [
        `Deficiency rate: ${Math.round(input.vesselPscDeficiencyRate * 100)}%`,
        'Threshold: > 30%',
        'Source: PSC Inspection Records',
      ],
    })
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

// ── Pattern detection ─────────────────────────────────────────────────────────

type RiskPattern =
  | 'SANCTIONS_EVASION'   // active sanction + geo or flag evidence
  | 'SHELL_COMPANY'       // limited footprint / new company with no registry
  | 'DARK_VESSEL'         // AIS anomalies + operator churn
  | 'GEO_EXPOSURE'        // jurisdiction risk without other patterns
  | 'GENERIC'             // catch-all

function detectPattern(flags: TradeFlag[]): RiskPattern {
  const codes = new Set(flags.map(f => f.code))

  if (
    codes.has('SANCTION_EXPOSURE') &&
    (codes.has('GEO_MISMATCH') || codes.has('VESSEL_FLAG_ROUTE_MISMATCH'))
  ) return 'SANCTIONS_EVASION'

  if (
    (codes.has('LIMITED_BUSINESS_FOOTPRINT') || codes.has('NEWLY_INCORPORATED_SELLER')) &&
    (codes.has('NO_REGISTRY_MATCH') || codes.has('SANCTION_EXPOSURE'))
  ) return 'SHELL_COMPANY'

  if (codes.has('SANCTION_EXPOSURE')) return 'SANCTIONS_EVASION'

  if (
    codes.has('NO_RECENT_ACTIVITY') &&
    (codes.has('MULTIPLE_OPERATOR_CHANGES') || codes.has('INCONSISTENT_TRADE_STORY'))
  ) return 'DARK_VESSEL'

  if (codes.has('LIMITED_BUSINESS_FOOTPRINT') || codes.has('NEWLY_INCORPORATED_SELLER')) {
    return 'SHELL_COMPANY'
  }

  if (codes.has('GEO_MISMATCH') || codes.has('VESSEL_FLAG_ROUTE_MISMATCH')) {
    return 'GEO_EXPOSURE'
  }

  return 'GENERIC'
}

const PATTERN_LEADS: Record<RiskPattern, string> = {
  SANCTIONS_EVASION: 'Multiple signals suggest potential sanctions evasion.',
  SHELL_COMPANY:     'This seller shows characteristics consistent with a shell company or front entity.',
  DARK_VESSEL:       'This vessel shows AIS tracking anomalies consistent with dark-voyage activity.',
  GEO_EXPOSURE:      'Geographic risk indicators require enhanced due diligence.',
  GENERIC:           'Risk indicators detected across trade parameters.',
}

const RECOMMENDATION: Record<RiskLevel, string> = {
  critical: 'Do not proceed. Escalate to compliance immediately.',
  high:     'Place on hold. Enhanced due diligence required before proceeding.',
  medium:   'Request additional documentation and counterparty confirmation before proceeding.',
  low:      'Standard monitoring applies. No immediate action required.',
}

export function generateSummary(
  flags: TradeFlag[],
  overallRisk: RiskLevel,
  sellerName: string,
  vesselName: string,
): string {
  if (flags.length === 0) {
    return `No risk indicators found for seller "${sellerName}" and vessel "${vesselName}". All standard checks passed. Standard monitoring applies.`
  }

  const pattern = detectPattern(flags)

  // Lead sentence: pattern + overall risk level
  const lead = `${PATTERN_LEADS[pattern]} Overall risk: ${overallRisk.toUpperCase()}.`

  // Most critical finding (worst severity flag, already sorted by RISK_ORDER in calling code,
  // but flags are not sorted here — pick by severity)
  const sorted = [...flags].sort(
    (a, b) => RISK_ORDER[a.severity] - RISK_ORDER[b.severity]
  )
  const topFlag = sorted[0]
  const criticalSentence = `Most critical: ${topFlag.reason}`

  // Supporting signals (up to 2 additional unique codes)
  const supporting = sorted
    .slice(1)
    .filter((f, i, arr) => arr.findIndex(x => x.code === f.code) === i)
    .slice(0, 2)
    .map(f => f.reason)

  const parts: string[] = [lead, criticalSentence]
  if (supporting.length > 0) {
    parts.push(`Additionally: ${supporting.join(' ')}`)
  }
  parts.push(RECOMMENDATION[overallRisk])

  return parts.join(' ')
}

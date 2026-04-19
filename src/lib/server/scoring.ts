/**
 * Dynamic authenticity scoring engine for Phase 1.
 *
 * Dimensions (max 75 pts total in Phase 1):
 *   entityExistence     max 25  - does the entity verifiably exist?
 *   assetReality        max 30  - do declared assets match observable data?
 *   documentConsistency max 10  - do AIS/registry signals internally agree?
 *   communityReputation max 10  - what do external inspectors/screeners say?
 *   tradingTrackRecord  max 25  - Phase 2, always 0 for now.
 *
 * Authenticity score is sanction-neutral: it measures how real/verifiable the
 * entity is, independent of whether it appears on a sanctions list.
 *
 * riskLevel is a composite of authenticity + sanction status:
 *   listed  -> always 'critical' regardless of authenticity score
 *   unknown -> capped at 'medium' (sanction ambiguity prevents a 'low' verdict)
 *   not_listed -> derived purely from the authenticity score thresholds
 */

import type { VesselAisData } from '@/lib/ais-types'
import type { RiskLevel, ScoreBreakdown } from '@/lib/types'

// 鈹€鈹€ Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface IntelligenceSnapshot {
  sanctions_hits?:   { url: string }[]
  corporate_info?:   { url: string }[]
  risk_signals?:     { url: string }[]
  existence_check?:  { url: string }[]
  ownership_info?:   { url: string }[]
  psc_records?:      { detained: string | null; num: string }[]
}

export interface ScoringInputs {
  entityType:         'company' | 'vessel' | 'terminal'
  sanctionStatus:     'not_listed' | 'listed' | 'unknown'
  /** Number of industry fraud blacklist hits (from checkFraudAlerts). */
  fraudAlertCount?:   number
  /** True if entity appears on a verified whitelist (e.g., Rotterdam Port Whitelist). */
  whitelisted?:       boolean
  country:            string
  registrationNumber: string | null
  imo?:               string | null
  aisData?:           VesselAisData | null
  intelligence?:      IntelligenceSnapshot | null
  /** Days since company domain was registered. null if no domain or RDAP failed. */
  domainAgeDays?: number | null
  /** True when domain has MX records or is DNS-reachable. False when NXDOMAIN/error AND no MX AND no website. null if unknown. */
  hasWebPresence?: boolean | null
  /**
   * True when the entity has an opacity-indicating GLEIF Reporting Exception
   * (NON_CONSOLIDATING, NON_PUBLIC, or NO_LEI). Deducts 3 pts from communityReputation.
   * Not set for NATURAL_PERSONS exception (informational only).
   */
  reportingExceptionFlag?: boolean
}

export interface ScoreResult {
  breakdown:  ScoreBreakdown
  total:      number
  riskLevel:  RiskLevel
  shellSignalEvidence: string[]
}

// 鈹€鈹€ Helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const HIGH_RISK_CC = new Set([
  'ir', 'ru', 've', 'cu', 'kp', 'sy', 'sd', 'by', 'mm', 'ye',
])

function clamp(n: number, max: number): number {
  return Math.min(max, Math.max(0, Math.round(n)))
}

function isHighRisk(country: string): boolean {
  return HIGH_RISK_CC.has((country ?? '').toLowerCase().slice(0, 2))
}

export function riskLevel(score: number, sanctionStatus: ScoringInputs['sanctionStatus']): RiskLevel {
  if (sanctionStatus === 'listed') return 'critical'
  if (sanctionStatus === 'unknown') {
    // Sanction ambiguity caps the best possible verdict at 'medium' —
    // a high-authenticity entity cannot be cleared as 'low' risk.
    // Low-scoring unknown entities still reach 'high' or 'critical'.
    if (score >= 60) return 'medium'
    if (score >= 35) return 'high'
    return 'critical'
  }
  if (score >= 85) return 'low'
  if (score >= 60) return 'medium'
  if (score >= 35) return 'high'
  return 'critical'
}

// 鈹€鈹€ Vessel scoring 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function scoreVessel(inputs: ScoringInputs) {
  const { country, imo, aisData, intelligence } = inputs
  let E = 0, A = 0, D = 0, C = 0

  // Entity Existence (max 25)
  if (imo && /^\d{7}$/.test(imo)) E += 10   // valid IMO number
  if (aisData?.mmsi)               E += 8    // MMSI resolved, so the vessel is AIS-registered
  if (aisData?.position)           E += 5    // positionally confirmed
  if (country && country !== 'Unknown') E += 2

  // Asset Reality (max 30)
  if (aisData?.position) {
    const ageH = (Date.now() - new Date(aisData.position.lastUpdate).getTime()) / 3_600_000
    A += ageH < 6 ? 10 : ageH < 24 ? 7 : ageH < 72 ? 3 : 0  // AIS recency
    A += aisData.position.draught > 0 ? 5 : 0                  // physically loaded
  }
  const portCalls   = aisData?.portCalls   ?? []
  const darkPeriods = aisData?.darkPeriods ?? []
  A += Math.min(10, portCalls.length * 2)           // port call history (cap +10)
  A -= portCalls.filter(pc => HIGH_RISK_CC.has(pc.countryCode)).length * 3  // -3 per high-risk call
  A += darkPeriods.length === 0 ? 5 : Math.max(-5, -darkPeriods.length * 2) // dark penalty

  // Document Consistency (max 10)
  D += darkPeriods.length === 0 ? 5 : Math.max(0, 5 - darkPeriods.length * 2)
  D += aisData?.position?.destination ? 3 : 0
  D += aisData?.position?.eta         ? 2 : 0

  // Community Reputation (max 10)
  const psc = intelligence?.psc_records
  if (psc && psc.length > 0) {
    const detentions = psc.filter(r => r.detained === 'Y').length
    const avgDefs    = psc.reduce((s, r) => s + (parseInt(r.num, 10) || 0), 0) / psc.length
    C += detentions === 0 ? 5 : Math.max(0, 5 - detentions * 2)
    C += avgDefs < 2 ? 5 : avgDefs < 4 ? 3 : avgDefs < 6 ? 1 : 0
  } else {
    C = 7   // no PSC data, so keep this dimension neutral
  }
  C -= (intelligence?.sanctions_hits?.length ?? 0) * 2  // -2 per sanctions hit

  return { E: clamp(E, 25), A: clamp(A, 30), D: clamp(D, 10), C: clamp(C, 10) }
}

// 鈹€鈹€ Company scoring 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function scoreCompany(inputs: ScoringInputs): {
  E: number; A: number; D: number; C: number; shellSignalEvidence: string[]
} {
  const { country, registrationNumber, intelligence, fraudAlertCount, whitelisted,
          domainAgeDays, hasWebPresence } = inputs
  let E = 0, A = 0, D = 0, C = 0
  const shellSignalEvidence: string[] = []

  // Entity Existence (max 25)
  if (registrationNumber && registrationNumber.length >= 5) E += 10
  if (country && country !== 'Unknown') E += 5
  if (!isHighRisk(country))             E += 5
  if ((intelligence?.corporate_info?.length ?? 0) > 0) E += 5

  // Shell company signal deductions (applied to E before clamping, floor = 0 via clamp)
  if (domainAgeDays !== null && domainAgeDays !== undefined && domainAgeDays < 180) {
    E -= 10
    shellSignalEvidence.push('Domain registered less than 6 months ago — reduced trust signal')
  }
  if (!registrationNumber || registrationNumber.length < 5) {
    E -= 8
    shellSignalEvidence.push('No verifiable registration number on record')
  }
  if (hasWebPresence === false) {
    E -= 5
    shellSignalEvidence.push('No domain, mail records, or website detected — no verifiable web presence')
  }

  // Asset Reality (max 30)
  const corpHits = intelligence?.corporate_info?.length ?? 0
  const riskHits = intelligence?.risk_signals?.length  ?? 0
  A += Math.min(15, corpHits * 3)
  A += riskHits === 0 ? 10 : riskHits === 1 ? 6 : riskHits < 4 ? 3 : 0
  A += !isHighRisk(country) ? 5 : 0

  // Document Consistency (max 10)
  D += (registrationNumber?.length ?? 0) >= 6 ? 5 : 0
  D += riskHits === 0 ? 5 : 0

  // Community Reputation (max 10)
  const sanctionHits = intelligence?.sanctions_hits?.length ?? 0
  const fraudHits    = fraudAlertCount ?? 0
  // Fraud blacklist: community reputation = 0 (overrides all other C bonuses)
  if (fraudHits > 0) {
    C = 0
  } else {
    C += sanctionHits === 0 ? 6 : 0
    C += riskHits === 0 ? 4 : 2
    // Rotterdam Port Whitelist: verified by port authority → +2 bonus
    if (whitelisted) C = Math.min(10, C + 2)
  }
  // GLEIF Reporting Exception: opacity-indicating types reduce trust signal (per D-07)
  if (inputs.reportingExceptionFlag) {
    C = Math.max(0, C - 3)
  }

  return {
    E: clamp(E, 25),
    A: clamp(A, 30),
    D: clamp(D, 10),
    C: clamp(C, 10),
    shellSignalEvidence,
  }
}

// 鈹€鈹€ Terminal scoring 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function scoreTerminal(inputs: ScoringInputs) {
  const { country, intelligence, fraudAlertCount, whitelisted } = inputs
  let E = 0, A = 0, D = 0, C = 0

  // Entity Existence (max 25)
  if (country && country !== 'Unknown') E += 8
  if (!isHighRisk(country))             E += 7
  E += Math.min(10, (intelligence?.existence_check?.length ?? 0) * 4)

  // Asset Reality (max 30)
  const existHits = intelligence?.existence_check?.length ?? 0
  const ownHits   = intelligence?.ownership_info?.length  ?? 0
  A += Math.min(15, existHits * 3)
  A += Math.min(10, ownHits   * 2)
  A += !isHighRisk(country) ? 5 : 0

  // Document Consistency (max 10)
  D += existHits > 0 ? 5 : 0
  D += (intelligence?.risk_signals?.length ?? 0) === 0 ? 5 : 2

  // Community Reputation (max 10)
  const sanctionHits = intelligence?.sanctions_hits?.length ?? 0
  const riskHits     = intelligence?.risk_signals?.length  ?? 0
  const fraudHits    = fraudAlertCount ?? 0
  // Fraud blacklist: community reputation = 0 (storage spoofing is a terminal-specific threat)
  if (fraudHits > 0) {
    C = 0
  } else {
    C += sanctionHits === 0 ? 6 : 0
    C += riskHits === 0 ? 4 : 2
    // Rotterdam Port Whitelist: verified by port authority → +2 bonus
    if (whitelisted) C = Math.min(10, C + 2)
  }

  return { E: clamp(E, 25), A: clamp(A, 30), D: clamp(D, 10), C: clamp(C, 10) }
}

// 鈹€鈹€ Public API 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export function computeScore(inputs: ScoringInputs): ScoreResult {
  let shellSignalEvidence: string[] = []
  let raw: { E: number; A: number; D: number; C: number }

  if (inputs.entityType === 'vessel') {
    raw = scoreVessel(inputs)
  } else if (inputs.entityType === 'company') {
    const result = scoreCompany(inputs)
    shellSignalEvidence = result.shellSignalEvidence
    raw = result
  } else {
    raw = scoreTerminal(inputs)
  }

  const E = raw.E
  const A = raw.A
  const D = raw.D
  const C = raw.C

  const total = E + A + D + C

  return {
    breakdown: {
      entityExistence:     { score: E, maxScore: 25 },
      assetReality:        { score: A, maxScore: 30 },
      tradingTrackRecord:  { score: 0, maxScore: 25 },
      documentConsistency: { score: D, maxScore: 10 },
      communityReputation: { score: C, maxScore: 10 },
    },
    total,
    riskLevel: riskLevel(total, inputs.sanctionStatus),
    shellSignalEvidence,
  }
}


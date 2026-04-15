/**
 * Deterministic trade risk rule engine.
 *
 * Eighteen standard flags (Phase 1 + Phase 2 + Phase 5):
 *   NO_REGISTRY_MATCH          - seller not found in any registry
 *   SANCTION_EXPOSURE          - seller or vessel on a trade sanctions list
 *   LIMITED_BUSINESS_FOOTPRINT - seller has negligible verifiable presence
 *   GEO_MISMATCH               - high-risk jurisdiction in seller, vessel, or port
 *   NO_RECENT_ACTIVITY         - vessel AIS dark or stale for more than 72h
 *   INCONSISTENT_TRADE_STORY   - physical impossibility or AIS contradiction
 *   NEWLY_INCORPORATED_SELLER  - seller is under 24 months old and trading high-value commodity
 *   VESSEL_FLAG_ROUTE_MISMATCH - vessel under a known evasion flag state
 *   MULTIPLE_OPERATOR_CHANGES  - vessel changed operator/owner more than twice in 18 months
 *   VESSEL_COMPLIANCE_RISK     - PSC detentions or chronic deficiency rate above 30%
 *   OFFSHORE_HOLDING_STRUCTURE - GLEIF ultimate parent in a known offshore jurisdiction
 *   PSC_OFFSHORE_CONTROL       - Companies House PSC in a known offshore jurisdiction
 *   SPARSE_REGISTRY_DATA       - seller found only in GLEIF LEI register
 *   OFFSHORE_LOW_SUBSTANCE     - offshore jurisdiction + no direct registry record
 *   KNOWN_FRAUD_ALERT          - seller on industry fraud blacklist
 *   DOMAIN_SPOOFING_RISK       - seller domain resembles legitimate company domain
 *   DOMAIN_WHOIS_RISK          - seller domain has suspicious WHOIS registration signals
 *   RELATED_PARTY_RISK         - director or PSC matches sanctions/warning list entry
 *
 * Each flag includes: code, severity, target, reason, evidence[], dataSource, dataSourceSyncedAt.
 * Rules are deterministic: the same input always produces the same flags.
 */

import type { RiskLevel, BeneficialOwner } from '@/lib/types'
import type { SearchResult } from '@/lib/types'
import type { VesselAisData } from '@/lib/ais-types'
import type { DraftRiskResult } from '@/lib/server/repository'

// ── Types ──────────────────────────────────────────────────────────────────────

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
  | 'OFFSHORE_HOLDING_STRUCTURE'
  | 'PSC_OFFSHORE_CONTROL'
  | 'SPARSE_REGISTRY_DATA'
  | 'OFFSHORE_LOW_SUBSTANCE'
  | 'KNOWN_FRAUD_ALERT'
  | 'DOMAIN_SPOOFING_RISK'
  | 'DOMAIN_WHOIS_RISK'
  | 'RELATED_PARTY_RISK'

export interface TradeFlag {
  code: FlagCode
  severity: RiskLevel
  target: 'seller' | 'vessel' | 'trade'
  reason: string
  evidence: string[]
  /** Human-readable data source name, e.g. "OFAC SDN / EU FSF / UN Consolidated List" */
  dataSource: string
  /** ISO timestamp of last sync for this data source, or null if not tracked per-flag. */
  dataSourceSyncedAt: string | null
}

export interface TradeRuleInput {
  // Seller
  sellerName: string
  sellerDbMatch: SearchResult | null
  sellerSanctioned: boolean
  sellerSanctionSources: string[]
  /** ISO date string from entity metadata_json.incorporationDate or GLEIF LEI registration. Null if unknown. */
  sellerIncorporationDate?: string | null
  /**
   * ISO 3166-1 alpha-2 jurisdiction of the seller's GLEIF ultimate parent entity.
   * Null if not found or GLEIF Level-2 data is unavailable.
   */
  sellerUltimateParentJurisdiction?: string | null

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
  /** PSC deficiency rate (0-1) across all recorded inspections. Null if no data. */
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

  /** UK Companies House PSC list for the seller. Null if not a CH entity. */
  sellerBeneficialOwners?: BeneficialOwner[] | null

  /**
   * Registry source derived from the seller entity id prefix.
   * 'local_db' - found in the local entity database (UUID id)
   * 'acra'     - from Singapore ACRA (`id` starts with `acra:`)
   * 'ch'       - from UK Companies House (`id` starts with `ch:`)
   * 'zefix'    - from Swiss Zefix registry (`id` starts with `zefix:`)
   * 'gleif'    - found only in the GLEIF LEI register (`id` starts with `gleif:`)
   * null       - not found in any registry
   */
  sellerRegistrySource?: 'local_db' | 'acra' | 'ch' | 'zefix' | 'gleif' | 'oc' | null

  /**
   * When true, AIS-dependent rules (NO_RECENT_ACTIVITY, AIS destination mismatch,
   * dark period detection) are skipped. Used when calling from the screen flow
   * where AIS data is not fetched to keep latency acceptable.
   */
  skipAisRules?: boolean

  /**
   * Industry fraud blacklist alerts for the seller, from checkFraudAlerts().
   * Each alert includes source_name and source_url for traceability.
   */
  sellerFraudAlerts?: Array<{
    source_name: string
    source_url: string
    fraud_type: string | null
  }>

  /**
   * Domain risk result for the seller's contact domain, from checkDomain().
   * Null when no domain could be extracted from the trade document.
   */
  sellerDomainCheck?: {
    domain: string
    flagged: boolean
    severity: 'critical' | 'high' | 'medium' | 'low'
    evidence: string[]
    spoofingMatches: Array<{
      legitimateDomain: string
      legitimateCompany: string
      similarityScore: number
    }>
  } | null
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const HIGH_RISK_CC = new Set([
  'ir', 'ru', 've', 'cu', 'kp', 'sy', 'sd', 'by', 'mm', 'ye',
])

/** Flag states associated with sanctions-evasion routing per OFAC/IMO risk lists. */
const EVASION_FLAGS = new Set(['km', 'pw', 'tg', 'sl', 'md'])

/** Offshore/shell jurisdictions for GLEIF ultimate parent ownership check. */
const OFFSHORE_CC = new Set(['VG', 'KY', 'MH', 'SC', 'BZ', 'PA', 'WS', 'VU'])

const OFFSHORE_NAMES: Record<string, string> = {
  VG: 'British Virgin Islands',
  KY: 'Cayman Islands',
  MH: 'Marshall Islands',
  SC: 'Seychelles',
  BZ: 'Belize',
  PA: 'Panama',
  WS: 'Samoa',
  VU: 'Vanuatu',
}

/** High-value bulk energy commodities that amplify counterparty risk. */
const HIGH_VALUE_COMMODITY_RE = /crude|lng|bunker|fuel\s*oil|petroleum/i

function isHighRisk(cc: string | null | undefined): boolean {
  if (!cc) return false
  return HIGH_RISK_CC.has(cc.toLowerCase().slice(0, 2))
}

const RISK_ORDER: Record<RiskLevel, number> = {
  critical: 0, high: 1, medium: 2, low: 3,
}

// ── Rule engine ────────────────────────────────────────────────────────────────

export function runTradeRules(input: TradeRuleInput): TradeFlag[] {
  const flags: TradeFlag[] = []

  // ── Rule 1: SANCTION_EXPOSURE ────────────────────────────────────────────────
  if (input.sellerSanctioned) {
    flags.push({
      code: 'SANCTION_EXPOSURE',
      severity: 'critical',
      target: 'seller',
      reason: `Seller "${input.sellerName}" appears on one or more trade sanctions lists.`,
      evidence: input.sellerSanctionSources.length > 0
        ? input.sellerSanctionSources
        : ['OpenSanctions'],
      dataSource: 'OFAC SDN / EU FSF / UN Consolidated List',
      dataSourceSyncedAt: null,
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
      dataSource: 'OFAC SDN / EU FSF / UN Consolidated List',
      dataSourceSyncedAt: null,
    })
  }

  // ── Rule 2: NO_REGISTRY_MATCH ────────────────────────────────────────────────
  if (!input.sellerDbMatch) {
    flags.push({
      code: 'NO_REGISTRY_MATCH',
      severity: 'high',
      target: 'seller',
      reason: `Seller "${input.sellerName}" could not be found in any company registry (local database, Singapore ACRA, UK Companies House, Swiss Zefix, or GLEIF LEI register).`,
      evidence: ['Local Entity Database', 'Singapore ACRA', 'UK Companies House', 'Swiss Zefix', 'GLEIF LEI Registry'],
      dataSource: 'Company Registry',
      dataSourceSyncedAt: null,
    })
  }

  // ── Rule 3: LIMITED_BUSINESS_FOOTPRINT ──────────────────────────────────────
  if (
    input.sellerDbMatch &&
    input.sellerDbMatch.authenticityScore < 40 &&
    !input.sellerDbMatch.registrationNumber
  ) {
    flags.push({
      code: 'LIMITED_BUSINESS_FOOTPRINT',
      severity: 'high',
      target: 'seller',
      reason: `Seller "${input.sellerName}" has a very low authenticity score (${input.sellerDbMatch.authenticityScore}/100) with no verified registration number - consistent with shell company patterns.`,
      evidence: ['Authenticity Score Engine', 'Company Registry Check'],
      dataSource: 'Company Registry',
      dataSourceSyncedAt: null,
    })
  }

  // ── Rule 4: GEO_MISMATCH ────────────────────────────────────────────────────
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
      dataSource: 'Company Registry',
      dataSourceSyncedAt: null,
    })
  }

  if (portCC && isHighRisk(portCC)) {
    flags.push({
      code: 'GEO_MISMATCH',
      severity: 'high',
      target: 'trade',
      reason: `Loading port "${input.loadingPortName ?? input.loadingPortLocode}" is located in a high-risk sanctioned jurisdiction (${portCC.toUpperCase()}).`,
      evidence: ['Port Database', 'OFAC/UN/EU Sanctioned Country List'],
      dataSource: 'AIS Tracking System',
      dataSourceSyncedAt: null,
    })
  }

  if (vesselCC && isHighRisk(vesselCC)) {
    flags.push({
      code: 'GEO_MISMATCH',
      severity: 'medium',
      target: 'vessel',
      reason: `Vessel is registered under a high-risk flag state: ${vesselCC}.`,
      evidence: ['Vessel Registry', 'AIS Data'],
      dataSource: 'AIS Tracking System',
      dataSourceSyncedAt: null,
    })
  }

  // ── Rule 5: NO_RECENT_ACTIVITY ──────────────────────────────────────────────
  if (input.skipAisRules) {
    // AIS rules are suppressed when the caller did not fetch AIS, such as in document screening.
  } else if (!input.vesselAis || !input.vesselAis.position) {
    flags.push({
      code: 'NO_RECENT_ACTIVITY',
      severity: 'medium',
      target: 'vessel',
      reason: `No AIS position data available for vessel "${input.vesselName}"${input.vesselImo ? ` (IMO ${input.vesselImo})` : ''}. Vessel location cannot be confirmed.`,
      evidence: ['AIS Tracking System (VesselAPI / aisstream)'],
      dataSource: 'AIS Tracking System (VesselAPI / aisstream)',
      dataSourceSyncedAt: null,
    })
  } else {
    const ageH = (Date.now() - new Date(input.vesselAis.position.lastUpdate).getTime()) / 3_600_000
    if (ageH > 72) {
      flags.push({
        code: 'NO_RECENT_ACTIVITY',
        severity: 'medium',
        target: 'vessel',
        reason: `Vessel "${input.vesselName}" AIS signal last received ${Math.round(ageH)} hours ago - vessel tracking is stale.`,
        evidence: [`Last AIS update: ${input.vesselAis.position.lastUpdate}`],
        dataSource: 'AIS Tracking System (VesselAPI / aisstream)',
        dataSourceSyncedAt: null,
      })
    }
  }

  // ── Rule 6: INCONSISTENT_TRADE_STORY ────────────────────────────────────────

  // 6a: Loading point is STS anchorage, not a terminal (no AIS needed)
  if (input.draftRisk?.isStsPort) {
    flags.push({
      code: 'INCONSISTENT_TRADE_STORY',
      severity: 'high',
      target: 'trade',
      reason: input.draftRisk.warning ??
        `Loading point "${input.loadingPortName ?? input.loadingPortLocode}" is a ship-to-ship (STS) anchorage zone, not a terminal berth. A contract specifying delivery here is irregular.`,
      evidence: ['Port Database', 'STS Zone Registry'],
      dataSource: 'Port Database / AIS Tracking System',
      dataSourceSyncedAt: null,
    })
  }

  // 6b: Vessel physically cannot berth because its draft exceeds the port maximum.
  if (input.draftRisk && !input.draftRisk.isStsPort && input.draftRisk.canBerth === false) {
    flags.push({
      code: 'INCONSISTENT_TRADE_STORY',
      severity: 'high',
      target: 'trade',
      reason: input.draftRisk.warning ??
        `Vessel cannot physically berth at the stated loading port - draft exceeds port maximum.`,
      evidence: [
        `Vessel draft: ${input.draftRisk.vesselDraftM ?? 'unknown'}m`,
        `Port max draft: ${input.draftRisk.portMaxDraftM ?? 'unknown'}m`,
        'Port Database',
      ],
      dataSource: 'Port Database / AIS Tracking System',
      dataSourceSyncedAt: null,
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
        dataSource: 'Port Database / AIS Tracking System',
        dataSourceSyncedAt: null,
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
      : input.vesselAis.darkPeriods  // no date provided, so report all dark periods

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
          (dp) => `Dark: ${dp.start} -> ${dp.end ?? 'ongoing'} (${dp.location})`
        ),
        dataSource: 'Port Database / AIS Tracking System',
        dataSourceSyncedAt: null,
      })
    }
  }

  // ── Rule 7: NEWLY_INCORPORATED_SELLER ───────────────────────────────────────
  // Young company (< 24 months) handling high-value bulk energy is elevated risk.
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
        dataSource: 'Company Registry',
        dataSourceSyncedAt: null,
      })
    }
  }

  // ── Rule 8: VESSEL_FLAG_ROUTE_MISMATCH ──────────────────────────────────────
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
        reason: `Vessel "${input.vesselName}" is registered under ${FLAG_NAMES[flagCC] ?? flagCC.toUpperCase()} - a flag state associated with sanctions-evasion routing. Use of such flags for energy cargo warrants enhanced scrutiny.`,
        evidence: [
          `Vessel flag: ${flagCC.toUpperCase()} (${FLAG_NAMES[flagCC] ?? 'unknown'})`,
          'Known evasion flag states: KM, PW, TG, SL, MD',
          'Source: OFAC/IMO flag state risk assessment',
        ],
        dataSource: 'AIS Tracking System / Company Registry',
        dataSourceSyncedAt: null,
      })
    }
  }

  // ── Rule 9: MULTIPLE_OPERATOR_CHANGES ───────────────────────────────────────
  // Rapid ownership/operator turnover is a common obfuscation tactic.
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
      dataSource: 'Company Registry',
      dataSourceSyncedAt: null,
    })
  }

  // ── Rule 10: VESSEL_COMPLIANCE_RISK ─────────────────────────────────────────
  // PSC detention or chronic deficiency is direct evidence of non-compliance.
  if (input.vesselPscDetentions != null && input.vesselPscDetentions > 0) {
    const defPct = input.vesselPscDeficiencyRate != null
      ? `${Math.round(input.vesselPscDeficiencyRate * 100)}%`
      : 'unknown'
    flags.push({
      code: 'VESSEL_COMPLIANCE_RISK',
      severity: 'high',
      target: 'vessel',
      reason: `Vessel "${input.vesselName}" has been detained ${input.vesselPscDetentions} time(s) during Port State Control inspections - indicating serious compliance or seaworthiness deficiencies.`,
      evidence: [
        `PSC detentions: ${input.vesselPscDetentions}`,
        `Deficiency rate: ${defPct}`,
        'Source: Paris MOU / Tokyo MOU / USCG PSC Records',
      ],
      dataSource: 'PSC Detention Records',
      dataSourceSyncedAt: null,
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
      reason: `Vessel "${input.vesselName}" has a PSC deficiency rate of ${Math.round(input.vesselPscDeficiencyRate * 100)}% (threshold: 30%) - indicating recurring maintenance or operational deficiencies across inspections.`,
      evidence: [
        `Deficiency rate: ${Math.round(input.vesselPscDeficiencyRate * 100)}%`,
        'Threshold: > 30%',
        'Source: PSC Inspection Records',
      ],
      dataSource: 'PSC Detention Records',
      dataSourceSyncedAt: null,
    })
  }

  // ── Rule 11: OFFSHORE_HOLDING_STRUCTURE ─────────────────────────────────────
  // GLEIF Level-2 ultimate parent registered in a known offshore jurisdiction.
  if (
    input.sellerUltimateParentJurisdiction &&
    OFFSHORE_CC.has(input.sellerUltimateParentJurisdiction.toUpperCase())
  ) {
    const cc = input.sellerUltimateParentJurisdiction.toUpperCase()
    flags.push({
      code: 'OFFSHORE_HOLDING_STRUCTURE',
      severity: 'high',
      target: 'seller',
      reason: `Seller "${input.sellerName}" is ultimately owned through ${OFFSHORE_NAMES[cc] ?? cc} - a jurisdiction commonly used for opaque holding structures that can obscure beneficial ownership.`,
      evidence: [
        `Ultimate parent jurisdiction: ${cc} (${OFFSHORE_NAMES[cc] ?? 'known offshore jurisdiction'})`,
        'Source: GLEIF Level-2 Relationship Data',
        'Offshore set: BVI, Cayman, Marshall Is., Seychelles, Belize, Panama, Samoa, Vanuatu',
      ],
      dataSource: 'Company Registry',
      dataSourceSyncedAt: null,
    })
  }

  // ── Rule 12: PSC_OFFSHORE_CONTROL ───────────────────────────────────────────
  // UK Companies House PSC with country of residence/address in known offshore set.
  if (input.sellerBeneficialOwners && input.sellerBeneficialOwners.length > 0) {
    for (const psc of input.sellerBeneficialOwners) {
      const residenceCC  = (psc.countryOfResidence ?? '').slice(0, 2).toUpperCase()
      const addressCC    = (psc.addressCountry   ?? '').slice(0, 2).toUpperCase()
      const nationalityCC = (psc.nationality     ?? '').slice(0, 2).toUpperCase()

      const offshoreCC =
        (residenceCC  && OFFSHORE_CC.has(residenceCC))  ? residenceCC  :
        (addressCC    && OFFSHORE_CC.has(addressCC))    ? addressCC    :
        (nationalityCC && OFFSHORE_CC.has(nationalityCC)) ? nationalityCC :
        null

      if (offshoreCC) {
        const countryLabel = OFFSHORE_NAMES[offshoreCC] ?? offshoreCC
        const controlType  = psc.naturesOfControl.join(', ') || 'significant control'
        flags.push({
          code: 'PSC_OFFSHORE_CONTROL',
          severity: 'high',
          target: 'seller',
          reason: `PSC "${psc.name}" - ${controlType} - resident/incorporated in ${countryLabel}. Beneficial owner in an offshore jurisdiction is a key AML indicator.`,
          evidence: [
            `PSC: ${psc.name} (${psc.kind})`,
            `Country: ${countryLabel} (${offshoreCC})`,
            `Control: ${controlType}`,
            'Source: UK Companies House PSC Register',
          ],
          dataSource: 'Companies House PSC Register',
          dataSourceSyncedAt: null,
        })
        break  // one flag per seller is sufficient; avoid duplicate stacking
      }
    }
  }

  // ── Rule 13: SPARSE_REGISTRY_DATA ───────────────────────────────────────────
  // Seller found only in the GLEIF LEI register, with no direct company registry match.
  if (input.sellerRegistrySource === 'gleif') {
    const sellerJurCC = (input.sellerDbMatch?.country ?? '').toUpperCase().slice(0, 2)
    flags.push({
      code: 'SPARSE_REGISTRY_DATA',
      severity: 'medium',
      target: 'seller',
      reason: `Seller "${input.sellerName}" was found only in the GLEIF LEI register - no direct company registry data is available${sellerJurCC ? ` for jurisdiction ${sellerJurCC}` : ''}. Data completeness is limited.`,
      evidence: [
        'GLEIF LEI Registry (fallback)',
        'No match in: Local DB, Singapore ACRA, UK Companies House, Swiss Zefix',
        'LEI registration indicates regulated entity status, but direct registry verification is unavailable',
      ],
      dataSource: 'Company Registry',
      dataSourceSyncedAt: null,
    })
  }

  // ── Rule 14: OFFSHORE_LOW_SUBSTANCE ─────────────────────────────────────────
  // Seller registered in a Tier-C offshore jurisdiction with no direct registry record.
  {
    const sellerJurCC = (
      input.sellerDbMatch?.country ??
      input.sellerDbMatch?.jurisdictionFlag ??
      ''
    ).toUpperCase().slice(0, 2)

    const isOffshore = sellerJurCC && OFFSHORE_CC.has(sellerJurCC)
    const isGleifOnly = input.sellerRegistrySource === 'gleif'
    const isNoMatch   = !input.sellerDbMatch

    if (isOffshore && (isGleifOnly || isNoMatch)) {
      const jurName = OFFSHORE_NAMES[sellerJurCC] ?? sellerJurCC
      flags.push({
        code: 'OFFSHORE_LOW_SUBSTANCE',
        severity: 'high',
        target: 'seller',
        reason: `Seller "${input.sellerName}" is registered in ${jurName} with no verifiable company registry record - consistent with low-substance offshore entity patterns.`,
        evidence: [
          `Jurisdiction: ${jurName} (${sellerJurCC})`,
          isGleifOnly ? 'Registry source: GLEIF LEI only (no direct registry)' : 'No registry match found',
          'Offshore set: BVI, Cayman, Marshall Is., Seychelles, Belize, Panama, Samoa, Vanuatu',
        ],
        dataSource: 'Company Registry',
        dataSourceSyncedAt: null,
      })
    }
  }

  // ── Rule 15: KNOWN_FRAUD_ALERT ───────────────────────────────────────────────
  // Seller matches an entry on an industry fraud blacklist (storage spoofing, fuel scam, etc.)
  if (input.sellerFraudAlerts && input.sellerFraudAlerts.length > 0) {
    const fraudTypes = [...new Set(
      input.sellerFraudAlerts.map((a) => a.fraud_type).filter(Boolean)
    )].join(', ')
    const sourceNames = [...new Set(input.sellerFraudAlerts.map((a) => a.source_name))]
    flags.push({
      code: 'KNOWN_FRAUD_ALERT',
      severity: 'critical',
      target: 'seller',
      reason: `Seller "${input.sellerName}" appears on ${sourceNames.length > 1 ? 'multiple' : 'an'} industry fraud blacklist${sourceNames.length > 1 ? 's' : ''}${fraudTypes ? ` (${fraudTypes})` : ''}.`,
      evidence: input.sellerFraudAlerts.map(
        (a) => `${a.source_name}: ${a.source_url}`
      ),
      dataSource: 'Internal Risk Intelligence',
      dataSourceSyncedAt: null,
    })
  }

  // ── Rule 16: DOMAIN_SPOOFING_RISK ────────────────────────────────────────────
  // A domain found in the trade document closely resembles a legitimate company's
  // official domain -- a classic impersonation technique (typosquatting, TLD swap).
  if (
    input.sellerDomainCheck?.flagged &&
    input.sellerDomainCheck.spoofingMatches.length > 0
  ) {
    const best = input.sellerDomainCheck.spoofingMatches[0]
    flags.push({
      code: 'DOMAIN_SPOOFING_RISK',
      severity: input.sellerDomainCheck.severity === 'critical' ? 'critical' : 'high',
      target: 'seller',
      reason: `Domain "${input.sellerDomainCheck.domain}" in the trade document closely resembles "${best.legitimateDomain}" (${best.legitimateCompany}) -- ${Math.round(best.similarityScore * 100)}% similarity. This is consistent with impersonation fraud.`,
      evidence: input.sellerDomainCheck.evidence,
      dataSource: 'WHOIS / DNS Intelligence',
      dataSourceSyncedAt: null,
    })
  }

  // ── Rule 17: DOMAIN_WHOIS_RISK ───────────────────────────────────────────────
  // WHOIS/RDAP data shows the seller's contact domain has high-risk registration
  // signals: very new domain, short registration, privacy-hidden, or no corporate
  // registrant. Only fires when there is no spoofing match (otherwise Rule 16 covers it).
  if (
    input.sellerDomainCheck?.flagged &&
    input.sellerDomainCheck.spoofingMatches.length === 0 &&
    input.sellerDomainCheck.evidence.length > 0
  ) {
    const severity = input.sellerDomainCheck.severity
    if (severity === 'critical' || severity === 'high' || severity === 'medium') {
      flags.push({
        code: 'DOMAIN_WHOIS_RISK',
        severity,
        target: 'seller',
        reason: `Domain "${input.sellerDomainCheck.domain}" shows suspicious registration patterns: ${input.sellerDomainCheck.evidence[0]}.`,
        evidence: input.sellerDomainCheck.evidence,
        dataSource: 'WHOIS / RDAP Registry',
        dataSourceSyncedAt: null,
      })
    }
  }

  return flags
}

// ── Aggregation helpers ────────────────────────────────────────────────────────

export function overallRiskFromFlags(flags: TradeFlag[]): RiskLevel {
  if (flags.length === 0) return 'low'
  return flags.reduce(
    (worst, f) => RISK_ORDER[f.severity] < RISK_ORDER[worst] ? f.severity : worst,
    'low' as RiskLevel,
  )
}

// ── Verdict engine ─────────────────────────────────────────────────────────────

export type TradeVerdict = 'safe' | 'review' | 'block'

const HARD_BLOCK_CODES: ReadonlySet<FlagCode> = new Set<FlagCode>([
  'SANCTION_EXPOSURE',
  'KNOWN_FRAUD_ALERT',
  'DOMAIN_SPOOFING_RISK',
])

/**
 * Derives a structured Safe / Review / Block verdict from the flag list.
 * Per D-01 (CONTEXT.md): hard block codes override severity rules.
 * RELATED_PARTY_RISK has severity 'high', so flows naturally to 'review'.
 */
export function deriveVerdict(flags: TradeFlag[]): TradeVerdict {
  if (flags.length === 0) return 'safe'
  if (flags.some(f => HARD_BLOCK_CODES.has(f.code))) return 'block'
  if (flags.some(f => f.severity === 'critical')) return 'block'
  if (flags.some(f => f.severity === 'high')) return 'review'
  return 'safe'
}

// ── Flag explanations (human-readable, used by UI and PDF) ────────────────────

export const FLAG_EXPLANATIONS: Record<FlagCode, { title: string; description: string; sourceHint: string }> = {
  SANCTION_EXPOSURE: {
    title: 'Sanctions Exposure',
    description: 'The counterparty or vessel appears on an official trade sanctions list. Proceeding with a sanctioned entity may violate OFAC, EU, or UN regulations and expose your organization to severe penalties.',
    sourceHint: 'OFAC SDN / EU FSF / UN Consolidated List',
  },
  NO_REGISTRY_MATCH: {
    title: 'No Registry Match',
    description: 'The counterparty could not be verified in any company registry. Legitimate trading entities are typically registered in at least one jurisdiction. Absence of a registry record is a significant due-diligence gap.',
    sourceHint: 'Company Registry (Local DB / ACRA / Companies House / Zefix / GLEIF)',
  },
  LIMITED_BUSINESS_FOOTPRINT: {
    title: 'Limited Business Footprint',
    description: 'The counterparty has a very low authenticity score and no verified registration number. This pattern is consistent with shell companies or entities created specifically to facilitate a transaction.',
    sourceHint: 'Authenticity Score Engine / Company Registry',
  },
  GEO_MISMATCH: {
    title: 'Geographic Risk',
    description: 'One or more trade participants (seller, vessel, or port) are linked to a jurisdiction subject to comprehensive trade sanctions. Transactions involving sanctioned jurisdictions require specific licenses and legal review.',
    sourceHint: 'OFAC / UN / EU Sanctioned Country List',
  },
  NO_RECENT_ACTIVITY: {
    title: 'No Recent AIS Activity',
    description: 'The vessel\'s AIS tracking signal is stale or unavailable. A vessel with no recent position data cannot be verified to be where the trade documents claim. This may indicate AIS transponder tampering.',
    sourceHint: 'AIS Tracking System (VesselAPI / aisstream)',
  },
  INCONSISTENT_TRADE_STORY: {
    title: 'Inconsistent Trade Story',
    description: 'Physical or data-level inconsistencies detected in the trade: vessel cannot berth at the stated port, AIS destination does not match, or AIS dark periods coincide with the stated trade date. These patterns are associated with sanctions evasion.',
    sourceHint: 'Port Database / AIS Tracking System',
  },
  NEWLY_INCORPORATED_SELLER: {
    title: 'Newly Incorporated Seller',
    description: 'The seller was incorporated less than 24 months ago and is trading a high-value bulk energy commodity. Very young companies handling crude oil, LNG, or fuel oil are a documented red-flag pattern in trade fraud cases.',
    sourceHint: 'Company Registry',
  },
  VESSEL_FLAG_ROUTE_MISMATCH: {
    title: 'Evasion Flag State',
    description: 'The vessel is registered under a flag state known to be used for sanctions-evasion routing. Flag states such as Comoros, Palau, Togo, Sierra Leone, and Moldova appear disproportionately in sanctioned cargo movements.',
    sourceHint: 'OFAC / IMO Flag State Risk Assessment',
  },
  MULTIPLE_OPERATOR_CHANGES: {
    title: 'Multiple Operator Changes',
    description: 'The vessel has changed operator or registered owner more than twice in 18 months. Rapid ownership transfers are a documented technique used to obscure sanctions exposure and remove liability from vessel history.',
    sourceHint: 'Vessel Registry / AIS History',
  },
  VESSEL_COMPLIANCE_RISK: {
    title: 'Vessel Compliance Risk',
    description: 'The vessel has a record of Port State Control detentions or a deficiency rate above 30%. PSC detentions indicate serious maintenance or operational deficiencies that may also signal reduced operator accountability.',
    sourceHint: 'PSC Detention Records (Paris MOU / Tokyo MOU / USCG)',
  },
  OFFSHORE_HOLDING_STRUCTURE: {
    title: 'Offshore Holding Structure',
    description: 'The seller\'s ultimate parent company is registered in a known offshore jurisdiction (BVI, Cayman Islands, Marshall Islands, Seychelles, Belize, Panama, Samoa, or Vanuatu). These structures are commonly used to obscure beneficial ownership.',
    sourceHint: 'GLEIF Level-2 Relationship Data',
  },
  PSC_OFFSHORE_CONTROL: {
    title: 'Offshore PSC Control',
    description: 'A Person with Significant Control (PSC) of the counterparty company is resident or incorporated in a known offshore jurisdiction. This is a key AML indicator suggesting potential concealment of the true beneficial owner.',
    sourceHint: 'UK Companies House PSC Register',
  },
  SPARSE_REGISTRY_DATA: {
    title: 'Sparse Registry Data',
    description: 'The seller was found only in the GLEIF LEI register with no direct company registry record available. While LEI registration indicates regulated entity status, the lack of direct registry data limits verification depth.',
    sourceHint: 'GLEIF LEI Registry',
  },
  OFFSHORE_LOW_SUBSTANCE: {
    title: 'Offshore Low Substance',
    description: 'The seller is registered in a known offshore jurisdiction with no verifiable company registry record. This combination -- offshore domicile plus absent registry data -- is consistent with low-substance entities used as trade intermediaries.',
    sourceHint: 'Company Registry / GLEIF LEI Registry',
  },
  KNOWN_FRAUD_ALERT: {
    title: 'Known Fraud Alert',
    description: 'The counterparty appears on an industry fraud blacklist. These lists are maintained by port authorities, industry associations, and trade bodies to warn against entities with documented histories of trade fraud or cargo scams.',
    sourceHint: 'Industry Fraud Blacklist',
  },
  DOMAIN_SPOOFING_RISK: {
    title: 'Domain Spoofing Risk',
    description: 'A domain found in the trade document closely resembles the domain of a legitimate, known trading company. Typosquatting and TLD swapping are classic impersonation techniques used to divert payments or goods.',
    sourceHint: 'WHOIS / DNS Intelligence',
  },
  DOMAIN_WHOIS_RISK: {
    title: 'Domain WHOIS Risk',
    description: 'The seller\'s contact domain has suspicious registration signals: newly registered, very short registration period, hidden registrant, or no corporate registrant identity. Fraudulent intermediaries frequently use disposable or anonymous domains.',
    sourceHint: 'WHOIS / RDAP Registry',
  },
  RELATED_PARTY_RISK: {
    title: 'Related Party Risk',
    description: 'A director or beneficial owner of the counterparty company appears to match a sanctions or regulatory warning list entry. Name matching is probabilistic -- human verification by a compliance officer is required before taking action on this flag.',
    sourceHint: 'OFAC SDN / EU FSF / FCA / MAS / DFSA / SCA / CMA Oman / FINMA / SFC',
  },
}

// ── Pattern detection ──────────────────────────────────────────────────────────

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
    (codes.has('LIMITED_BUSINESS_FOOTPRINT') || codes.has('NEWLY_INCORPORATED_SELLER') || codes.has('OFFSHORE_HOLDING_STRUCTURE') || codes.has('PSC_OFFSHORE_CONTROL') || codes.has('OFFSHORE_LOW_SUBSTANCE')) &&
    (codes.has('NO_REGISTRY_MATCH') || codes.has('SANCTION_EXPOSURE'))
  ) return 'SHELL_COMPANY'

  if (codes.has('SANCTION_EXPOSURE')) return 'SANCTIONS_EVASION'

  if (
    codes.has('NO_RECENT_ACTIVITY') &&
    (codes.has('MULTIPLE_OPERATOR_CHANGES') || codes.has('INCONSISTENT_TRADE_STORY'))
  ) return 'DARK_VESSEL'

  if (
    codes.has('LIMITED_BUSINESS_FOOTPRINT') ||
    codes.has('NEWLY_INCORPORATED_SELLER') ||
    codes.has('OFFSHORE_HOLDING_STRUCTURE') ||
    codes.has('PSC_OFFSHORE_CONTROL') ||
    codes.has('OFFSHORE_LOW_SUBSTANCE')
  ) {
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
  // Flags are not sorted here, so choose the highest severity explicitly.
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

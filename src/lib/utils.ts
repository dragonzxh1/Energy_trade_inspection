import type { Company, RiskLevel, ScoreTier, Terminal, Vessel } from './types'
import { GAUGE_CIRCUMFERENCE, RISK_THRESHOLDS, SCORE_TIERS } from './constants'

/**
 * Convert a 2-letter ISO country code to an emoji flag.
 * Falls through unchanged for anything that isn't exactly 2 ASCII letters
 * (e.g. already-emoji strings, 'xx' unknown code → 🇽🇽, etc.).
 */
export function countryCodeToFlag(code: string): string {
  if (!code || code.length !== 2) return code
  const upper = code.toUpperCase()
  if (!/^[A-Z]{2}$/.test(upper)) return code
  return (
    String.fromCodePoint(0x1f1e6 + upper.charCodeAt(0) - 65) +
    String.fromCodePoint(0x1f1e6 + upper.charCodeAt(1) - 65)
  )
}

/**
 * Map a 0-100 authenticity score to a risk level.
 * Higher score = lower risk.
 */
export function getRiskLevel(score: number): RiskLevel {
  for (const { threshold, level } of RISK_THRESHOLDS) {
    if (score >= threshold) return level
  }
  return 'critical'
}

/**
 * Map a 0-100 authenticity score to a score tier label.
 */
export function getScoreTier(score: number): ScoreTier {
  for (const { threshold, tier } of SCORE_TIERS) {
    if (score >= threshold) return tier
  }
  return 'Suspicious'
}

/**
 * Calculate the SVG stroke-dashoffset for the circular gauge.
 * score=0 → full circumference (empty ring)
 * score=100 → 0 (full ring)
 */
export function getGaugeOffset(score: number): number {
  const clamped = Math.max(0, Math.min(100, score))
  return GAUGE_CIRCUMFERENCE * (1 - clamped / 100)
}

/**
 * Get the CSS custom property name for a risk level color.
 */
export function getRiskColor(level: RiskLevel): string {
  const map: Record<RiskLevel, string> = {
    low:      'var(--risk-low)',
    medium:   'var(--risk-medium)',
    high:     'var(--risk-high)',
    critical: 'var(--risk-critical)',
  }
  return map[level]
}

/**
 * Format a date string for display. Returns ISO date for <time datetime> attr.
 */
export function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return isoString
  }
}

/**
 * Generate a template-based risk narrative for a company entity.
 * Phase 1: deterministic templates. Phase 2+: upgrade to LLM summarisation.
 */
export function buildCompanyNarrative(company: Company): string {
  const parts: string[] = []

  // Opening — incorporation
  const countryLine = `${company.jurisdictionFlag} ${company.country}`
  if (company.incorporationDate) {
    const year = new Date(company.incorporationDate).getFullYear()
    parts.push(`${company.name} is a company incorporated in ${countryLine} in ${year}, registered under ${company.registrationNumber}.`)
  } else {
    parts.push(`${company.name} is a company registered in ${countryLine} (registration number: ${company.registrationNumber}).`)
  }

  // Sanction status
  if (company.sanctionStatus === 'not_listed') {
    parts.push(`Sanction screening across OFAC, EU FSF, and UN consolidated lists returned no matches.`)
  } else if (company.sanctionStatus === 'listed') {
    parts.push(`This entity has been matched against one or more international sanction lists. Exercise enhanced due diligence before engaging.`)
  } else {
    parts.push(`Sanction status is currently unresolved; screening is pending.`)
  }

  // Score
  const tier = getScoreTier(company.authenticityScore)
  const maxPhase1 = 75
  if (company.authenticityScore >= 60) {
    parts.push(`The platform assigns an authenticity score of ${company.authenticityScore}/${maxPhase1} (Phase 1 data), rated "${tier}". Core registration and asset details are on record.`)
  } else if (company.authenticityScore >= 30) {
    parts.push(`The authenticity score of ${company.authenticityScore}/${maxPhase1} (Phase 1 data) is rated "${tier}". Some verification dimensions are incomplete.`)
  } else {
    parts.push(`The authenticity score of ${company.authenticityScore}/${maxPhase1} (Phase 1 data) is rated "${tier}". Insufficient data is available to fully verify this entity.`)
  }

  // Directors
  if (company.directors && company.directors.length > 0) {
    const names = company.directors.slice(0, 2).map((d) => d.name).join(' and ')
    const more = company.directors.length > 2 ? ` and ${company.directors.length - 2} other${company.directors.length - 2 > 1 ? 's' : ''}` : ''
    parts.push(`Listed directors include ${names}${more}.`)
  }

  // Risk flags
  if (company.riskFlags.length === 0) {
    parts.push(`No community risk flags have been verified for this entity.`)
  } else {
    const criticalOrHigh = company.riskFlags.filter((f) => f.severity === 'critical' || f.severity === 'high')
    if (criticalOrHigh.length > 0) {
      parts.push(`${company.riskFlags.length} risk flag${company.riskFlags.length > 1 ? 's have' : ' has'} been verified, including ${criticalOrHigh.length} high-severity ${criticalOrHigh.length > 1 ? 'alerts' : 'alert'}.`)
    } else {
      parts.push(`${company.riskFlags.length} risk flag${company.riskFlags.length > 1 ? 's have' : ' has'} been verified for this entity.`)
    }
  }

  return parts.join(' ')
}

/**
 * Generate a template-based risk narrative for a vessel entity.
 */
export function buildVesselNarrative(vessel: Vessel): string {
  const parts: string[] = []

  // Opening — vessel identity
  const typeStr = vessel.vesselType ?? 'vessel'
  if (vessel.yearBuilt) {
    parts.push(`${vessel.name} is a ${typeStr} built in ${vessel.yearBuilt}, registered under the ${vessel.flag} flag (IMO ${vessel.imo}).`)
  } else {
    parts.push(`${vessel.name} is a ${typeStr} registered under the ${vessel.flag} flag (IMO ${vessel.imo}).`)
  }

  // Operator
  if (vessel.currentOperator) {
    parts.push(`${vessel.currentOperator} is listed as the current operator.`)
  }

  // Sanction status
  if (vessel.sanctionStatus === 'not_listed') {
    parts.push(`Sanction screening across OFAC, EU FSF, and UN consolidated lists returned no matches for this vessel.`)
  } else if (vessel.sanctionStatus === 'listed') {
    parts.push(`This vessel has been matched against one or more international sanction lists. Do not engage without legal counsel review.`)
  } else {
    parts.push(`Sanction status is currently unresolved; screening is pending.`)
  }

  // Score
  const tier = getScoreTier(vessel.authenticityScore)
  if (vessel.authenticityScore >= 60) {
    parts.push(`Authenticity score: ${vessel.authenticityScore}/100 ("${tier}"). IMO registration and physical characteristics are on record.`)
  } else if (vessel.authenticityScore >= 30) {
    parts.push(`Authenticity score: ${vessel.authenticityScore}/100 ("${tier}"). Some verification dimensions are incomplete.`)
  } else {
    parts.push(`Authenticity score: ${vessel.authenticityScore}/100 ("${tier}"). Limited data is available for this vessel.`)
  }

  // Gross tonnage context
  if (vessel.grossTonnage) {
    const sizeDesc = vessel.grossTonnage > 100000 ? 'a very large vessel' : vessel.grossTonnage > 30000 ? 'a medium-large vessel' : 'a mid-size vessel'
    parts.push(`At ${vessel.grossTonnage.toLocaleString()} GT, it is classified as ${sizeDesc} for the energy trade sector.`)
  }

  // Risk flags
  if (vessel.riskFlags.length === 0) {
    parts.push(`No community risk flags have been verified for this vessel.`)
  } else {
    const criticalOrHigh = vessel.riskFlags.filter((f) => f.severity === 'critical' || f.severity === 'high')
    if (criticalOrHigh.length > 0) {
      parts.push(`${vessel.riskFlags.length} risk flag${vessel.riskFlags.length > 1 ? 's have' : ' has'} been verified, including ${criticalOrHigh.length} high-severity ${criticalOrHigh.length > 1 ? 'alerts' : 'alert'}.`)
    } else {
      parts.push(`${vessel.riskFlags.length} risk flag${vessel.riskFlags.length > 1 ? 's have' : ' has'} been verified for this vessel.`)
    }
  }

  return parts.join(' ')
}

/**
 * Generate the Schema.org JSON-LD for a company entity page.
 * GEO requirement: structured data on every entity page from day 1.
 */
export function buildCompanyJsonLd(params: {
  name: string
  registrationNumber: string
  country: string
  score: number
  scoreTier: ScoreTier
  sanctionStatus: string
  slug: string
  appUrl: string
  description?: string
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: params.name,
    identifier: params.registrationNumber,
    addressCountry: params.country,
    url: `${params.appUrl}/company/${params.slug}`,
    ...(params.description && { description: params.description }),
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'Authenticity Score',
        value: params.score,
        description: `${params.scoreTier} — ${params.score}/100 authenticity score`,
      },
      {
        '@type': 'PropertyValue',
        name: 'Sanction Status',
        value: params.sanctionStatus,
      },
    ],
  }
}

/**
 * Generate a template-based risk narrative for a terminal entity.
 */
export function buildTerminalNarrative(terminal: Terminal): string {
  const parts: string[] = []

  const locationStr = terminal.location
    ? `${terminal.location}, ${terminal.country}`
    : `${terminal.jurisdictionFlag} ${terminal.country}`

  const typeLabel = terminal.terminalType ?? 'energy'
  parts.push(`${terminal.name} is a ${typeLabel} terminal located in ${locationStr}.`)

  if (terminal.operator) {
    parts.push(`The terminal is operated by ${terminal.operator}.`)
  }

  if (terminal.sanctionStatus === 'not_listed') {
    parts.push(`Sanction screening across OFAC, EU FSF, and UN consolidated lists returned no matches.`)
  } else if (terminal.sanctionStatus === 'listed') {
    parts.push(`This terminal has been matched against one or more international sanction lists. Exercise enhanced due diligence before engaging.`)
  } else {
    parts.push(`Sanction status is currently unresolved; screening is pending.`)
  }

  const tier = getScoreTier(terminal.authenticityScore)
  if (terminal.authenticityScore >= 60) {
    parts.push(`Authenticity score: ${terminal.authenticityScore}/100 ("${tier}"). Core operational details are on record.`)
  } else if (terminal.authenticityScore >= 30) {
    parts.push(`Authenticity score: ${terminal.authenticityScore}/100 ("${tier}"). Some verification dimensions are incomplete.`)
  } else {
    parts.push(`Authenticity score: ${terminal.authenticityScore}/100 ("${tier}"). Insufficient data is available to fully verify this terminal.`)
  }

  if (terminal.riskFlags.length === 0) {
    parts.push(`No community risk flags have been verified for this terminal.`)
  } else {
    const criticalOrHigh = terminal.riskFlags.filter((f) => f.severity === 'critical' || f.severity === 'high')
    if (criticalOrHigh.length > 0) {
      parts.push(`${terminal.riskFlags.length} risk flag${terminal.riskFlags.length > 1 ? 's have' : ' has'} been verified, including ${criticalOrHigh.length} high-severity ${criticalOrHigh.length > 1 ? 'alerts' : 'alert'}.`)
    } else {
      parts.push(`${terminal.riskFlags.length} risk flag${terminal.riskFlags.length > 1 ? 's have' : ' has'} been verified for this terminal.`)
    }
  }

  return parts.join(' ')
}

/**
 * Generate the Schema.org JSON-LD for a terminal entity page.
 */
export function buildTerminalJsonLd(params: {
  name: string
  location?: string
  operator?: string
  country: string
  score: number
  scoreTier: ScoreTier
  sanctionStatus: string
  entityId: string
  appUrl: string
  description?: string
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: params.name,
    addressCountry: params.country,
    url: `${params.appUrl}/terminal/${params.entityId}`,
    ...(params.location && { address: params.location }),
    ...(params.operator && { department: params.operator }),
    ...(params.description && { description: params.description }),
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'Authenticity Score',
        value: params.score,
        description: `${params.scoreTier} — ${params.score}/100 authenticity score`,
      },
      {
        '@type': 'PropertyValue',
        name: 'Sanction Status',
        value: params.sanctionStatus,
      },
    ],
  }
}

/**
 * Generate the Schema.org JSON-LD for a vessel entity page.
 */
export function buildVesselJsonLd(params: {
  name: string
  imo: string
  flag: string
  score: number
  scoreTier: ScoreTier
  sanctionStatus: string
  appUrl: string
  description?: string
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Vehicle',
    name: params.name,
    identifier: params.imo,
    vehicleIdentificationNumber: params.imo,
    url: `${params.appUrl}/vessel/${params.imo}`,
    ...(params.description && { description: params.description }),
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'IMO Number',
        value: params.imo,
      },
      {
        '@type': 'PropertyValue',
        name: 'Flag State',
        value: params.flag,
      },
      {
        '@type': 'PropertyValue',
        name: 'Authenticity Score',
        value: params.score,
        description: `${params.scoreTier} — ${params.score}/100 authenticity score`,
      },
      {
        '@type': 'PropertyValue',
        name: 'Sanction Status',
        value: params.sanctionStatus,
      },
    ],
  }
}

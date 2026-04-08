/**
 * UK Companies House API integration
 * Source: https://developer-specs.company-information.service.gov.uk/
 * License: Open Government Licence v3.0
 * Cost: Free (requires API key from https://developer.companieshouse.gov.uk)
 * Rate limit: 600 requests/5 minutes per key
 *
 * Env: COMPANIES_HOUSE_API_KEY
 */

const CH_BASE = 'https://api.company-information.service.gov.uk'

function getApiKey(): string | null {
  return process.env.COMPANIES_HOUSE_API_KEY ?? null
}

function buildHeaders(): HeadersInit {
  const key = getApiKey()
  if (!key) return { Accept: 'application/json', 'User-Agent': 'EnergyTradeInspection/1.0' }
  // Companies House uses HTTP Basic Auth: key as username, empty password
  const encoded = Buffer.from(`${key}:`).toString('base64')
  return {
    Authorization: `Basic ${encoded}`,
    Accept: 'application/json',
    'User-Agent': 'EnergyTradeInspection/1.0',
  }
}

export interface CHCompany {
  company_number: string
  title: string                       // Company name
  company_type: string                // e.g. "ltd", "plc", "llp"
  company_status: string              // "active" | "dissolved" | "liquidation"
  date_of_creation?: string           // ISO date YYYY-MM-DD
  registered_office_address?: {
    address_line_1?: string
    address_line_2?: string
    locality?: string
    postal_code?: string
    country?: string
  }
  description?: string                // Only in search results
}

interface CHSearchResult {
  items?: CHCompany[]
  total_results?: number
  kind: string
}

/** Regex patterns for UK company registration numbers */
const UK_NUMBER_REGEX = /^(SC|NI|OC|SO|NC|R|IP|SP|IC|SI|NP|NV|RC|SR|NR|NO)?\d{6,8}$/i

export function mightBeUKNumber(s: string): boolean {
  return UK_NUMBER_REGEX.test(s.trim().toUpperCase())
}

/**
 * Search Companies House for companies matching a query string.
 * Returns up to 10 active companies.
 */
export async function searchCompaniesHouse(query: string, limit = 10): Promise<CHCompany[]> {
  if (!query || query.trim().length < 2) return []
  if (!getApiKey()) return []   // Silently skip if not configured

  try {
    const url = new URL('/search/companies', CH_BASE)
    url.searchParams.set('q', query.trim())
    url.searchParams.set('items_per_page', String(Math.min(limit, 20)))

    const response = await fetch(url.toString(), {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 300 },      // Cache 5 min
    } as RequestInit)

    if (!response.ok) return []

    const data: CHSearchResult = await response.json()
    return (data.items ?? []).filter((c) => c.company_status === 'active').slice(0, limit)
  } catch {
    return []
  }
}

/**
 * Fetch a single company by its Companies House number.
 */
export async function getCHCompanyByNumber(number: string): Promise<CHCompany | null> {
  if (!number || !getApiKey()) return null

  try {
    const url = new URL(`/company/${encodeURIComponent(number.toUpperCase())}`, CH_BASE)
    const response = await fetch(url.toString(), {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) return null
    return response.json() as Promise<CHCompany>
  } catch {
    return null
  }
}

/**
 * Build a registered address string from the CH address object.
 */
export function formatCHAddress(addr: CHCompany['registered_office_address']): string | undefined {
  if (!addr) return undefined
  return [addr.address_line_1, addr.address_line_2, addr.locality, addr.postal_code, addr.country]
    .filter(Boolean)
    .join(', ')
}

/**
 * Compute authenticity score components for a Companies House company.
 * entityExistence: active status in UK official registry (max 18/25)
 * documentConsistency: date of creation + registered address (max 9/10)
 * communityReputation: sanction screen result (max 8/10)
 */
export function computeCHScore(
  company: CHCompany,
  sanctionStatus: 'not_listed' | 'listed' | 'unknown' = 'unknown',
) {
  const isActive           = company.company_status === 'active'
  const entityExistence    = isActive ? 18 : 0
  const documentConsistency =
    (company.date_of_creation                         ? 5 : 0) +
    (company.registered_office_address?.address_line_1 ? 4 : 0)
  const communityReputation = sanctionStatus === 'not_listed' ? 8 : 0
  const total = entityExistence + documentConsistency + communityReputation

  return {
    authenticityScore: total,
    scoreBreakdown: {
      entityExistence:     { score: entityExistence,     maxScore: 25 },
      assetReality:        { score: 0,                   maxScore: 30 },
      tradingTrackRecord:  { score: 0,                   maxScore: 25, phase2Pending: true as const },
      documentConsistency: { score: documentConsistency, maxScore: 10 },
      communityReputation: { score: communityReputation, maxScore: 10 },
    },
  }
}

/**
 * Convert a CH company to SearchResult format.
 */
export function chToSearchResult(company: CHCompany) {
  const { authenticityScore } = computeCHScore(company)  // no sanctions in search path
  return {
    id: `ch:${company.company_number}`,
    name: company.title,
    type: 'company' as const,
    country: 'United Kingdom',
    jurisdictionFlag: '🇬🇧',
    sanctionStatus: 'unknown' as const,
    authenticityScore,
    riskLevel: 'medium' as const,
    registrationNumber: company.company_number,
    slug: company.company_number.toLowerCase(),
  }
}

export interface CHOfficer {
  name: string
  role: string
  appointedOn?: string
  nationality?: string
  countryOfResidence?: string
}

export interface CHPSC {
  name: string
  kind: 'individual' | 'corporate-entity' | 'legal-person'
  naturesOfControl: string[]
  nationality?: string
  countryOfResidence?: string
  addressCountry?: string
  notifiedOn?: string
}

/**
 * Fetch active officers for a Companies House company number.
 */
export async function getCHOfficers(companyNumber: string): Promise<CHOfficer[]> {
  if (!companyNumber || !getApiKey()) return []

  try {
    const url = new URL(
      `/company/${encodeURIComponent(companyNumber.toUpperCase())}/officers`,
      CH_BASE,
    )
    url.searchParams.set('items_per_page', '100')

    const response = await fetch(url.toString(), {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(4000),
    })

    if (!response.ok) return []

    const data = await response.json() as {
      items?: Array<{
        name?: string
        officer_role?: string
        appointed_on?: string
        nationality?: string
        country_of_residence?: string
        resigned_on?: string
      }>
    }

    return (data.items ?? [])
      .filter((o) => !o.resigned_on)
      .map((o) => ({
        name:               o.name ?? '',
        role:               o.officer_role ?? '',
        appointedOn:        o.appointed_on,
        nationality:        o.nationality,
        countryOfResidence: o.country_of_residence,
      }))
  } catch {
    return []
  }
}

/**
 * Fetch active persons with significant control for a Companies House company number.
 */
export async function getCHPSC(companyNumber: string): Promise<CHPSC[]> {
  if (!companyNumber || !getApiKey()) return []

  try {
    const url = new URL(
      `/company/${encodeURIComponent(companyNumber.toUpperCase())}/persons-with-significant-control`,
      CH_BASE,
    )
    url.searchParams.set('items_per_page', '100')

    const response = await fetch(url.toString(), {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(4000),
    })

    if (!response.ok) return []

    const data = await response.json() as {
      items?: Array<{
        name?: string
        kind?: string
        natures_of_control?: string[]
        nationality?: string
        country_of_residence?: string
        address?: { country?: string }
        notified_on?: string
        ceased?: boolean
      }>
    }

    return (data.items ?? [])
      .filter((p) => !p.ceased)
      .map((p) => {
        const rawKind = p.kind ?? ''
        const kind: CHPSC['kind'] =
          rawKind.includes('corporate') ? 'corporate-entity'
          : rawKind.includes('legal')   ? 'legal-person'
          : 'individual'
        return {
          name:               p.name ?? '',
          kind,
          naturesOfControl:   p.natures_of_control ?? [],
          nationality:        p.nationality,
          countryOfResidence: p.country_of_residence,
          addressCountry:     p.address?.country,
          notifiedOn:         p.notified_on,
        }
      })
  } catch {
    return []
  }
}

/**
 * Build a Company object from a CH API response (not persisted to DB).
 * Pass sanctionStatus to get accurate communityReputation scoring.
 */
export function buildCHCompany(
  company: CHCompany,
  sanctionStatus: 'not_listed' | 'listed' | 'unknown' = 'unknown',
) {
  const address = formatCHAddress(company.registered_office_address)
  const { authenticityScore, scoreBreakdown } = computeCHScore(company, sanctionStatus)
  return {
    id: `ch:${company.company_number}`,
    type: 'company' as const,
    name: company.title,
    slug: company.company_number.toLowerCase(),
    registrationNumber: company.company_number,
    incorporationDate: company.date_of_creation,
    registeredAddress: address,
    country: 'United Kingdom',
    jurisdictionFlag: '🇬🇧',
    sanctionStatus,
    authenticityScore,
    scoreBreakdown,
    riskLevel: (sanctionStatus === 'listed' ? 'critical' : 'medium') as 'critical' | 'medium',
    riskFlags: [] as never[],
    lastVerified: new Date().toISOString(),
    dataSource: ['Companies House UK'],
  }
}

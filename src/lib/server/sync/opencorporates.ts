/**
 * OpenCorporates API integration.
 * Source: https://api.opencorporates.com/v0.4/
 * License: Open Database License (ODbL) for data; CC-BY-SA for content
 * Free tier: unauthenticated (~10 req/min). Higher limits with OC_API_TOKEN.
 *
 * Covers jurisdictions not served by direct registries:
 * Netherlands (nl), Hong Kong (hk), Germany (de), France (fr), Australia (au),
 * and 140+ others. UK (gb) and Singapore (sg) are already covered by CH and ACRA
 * but OC can serve as a fallback for those too.
 *
 * Env: `OC_API_TOKEN` (optional; set it for higher rate limits)
 */

import type { SanctionStatus } from '@/lib/types'

const OC_BASE = 'https://api.opencorporates.com/v0.4'

export interface OCCompany {
  name: string
  company_number: string
  jurisdiction_code: string     // e.g. "nl", "hk", "de", "gb"
  incorporation_date: string | null
  dissolution_date: string | null
  company_type: string | null
  current_status: string | null // "Active", "Dissolved", etc.
  registered_address?: {
    street_address?: string
    locality?: string
    country?: string
  } | null
  registry_url?: string | null
}

/** Map jurisdiction codes to country names. OpenCorporates uses CLDR-like codes. */
const OC_JURISDICTION_TO_COUNTRY: Record<string, string> = {
  nl: 'Netherlands',   hk: 'Hong Kong',        de: 'Germany',
  fr: 'France',        au: 'Australia',         nz: 'New Zealand',
  ca: 'Canada',        ie: 'Ireland',           se: 'Sweden',
  no: 'Norway',        dk: 'Denmark',           fi: 'Finland',
  be: 'Belgium',       at: 'Austria',           ch: 'Switzerland',
  es: 'Spain',         it: 'Italy',             pt: 'Portugal',
  pl: 'Poland',        cz: 'Czech Republic',    ro: 'Romania',
  gb: 'United Kingdom', sg: 'Singapore',        us: 'United States',
  in: 'India',         jp: 'Japan',             kr: 'South Korea',
  cn: 'China',         br: 'Brazil',            mx: 'Mexico',
  za: 'South Africa',  ng: 'Nigeria',           ae: 'United Arab Emirates',
  sa: 'Saudi Arabia',  tr: 'Turkey',            th: 'Thailand',
  my: 'Malaysia',      id: 'Indonesia',         vn: 'Vietnam',
  ph: 'Philippines',   tw: 'Taiwan',            ua: 'Ukraine',
  ru: 'Russia',        il: 'Israel',            gr: 'Greece',
  cy: 'Cyprus',        mt: 'Malta',             lu: 'Luxembourg',
}

/** Jurisdiction flag emoji map (subset). */
const OC_JURISDICTION_TO_FLAG: Record<string, string> = {
  nl: '🇳🇱', hk: '🇭🇰', de: '🇩🇪', fr: '🇫🇷', au: '🇦🇺',
  nz: '🇳🇿', ca: '🇨🇦', ie: '🇮🇪', se: '🇸🇪', no: '🇳🇴',
  dk: '🇩🇰', fi: '🇫🇮', be: '🇧🇪', at: '🇦🇹', ch: '🇨🇭',
  es: '🇪🇸', it: '🇮🇹', pt: '🇵🇹', pl: '🇵🇱', cz: '🇨🇿',
  gb: '🇬🇧', sg: '🇸🇬', us: '🇺🇸', in: '🇮🇳', jp: '🇯🇵',
  kr: '🇰🇷', br: '🇧🇷', ae: '🇦🇪', sa: '🇸🇦', tr: '🇹🇷',
  my: '🇲🇾', id: '🇮🇩', za: '🇿🇦', ng: '🇳🇬', th: '🇹🇭',
  cn: '🇨🇳', il: '🇮🇱', gr: '🇬🇷', cy: '🇨🇾', lu: '🇱🇺',
}

function getApiToken(): string | null {
  return process.env.OC_API_TOKEN ?? null
}

function buildUrl(path: string, params: Record<string, string> = {}): string {
  const url = new URL(`${OC_BASE}${path}`)
  const token = getApiToken()
  if (token) url.searchParams.set('api_token', token)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCompany(raw: any): OCCompany | null {
  const c = raw?.company ?? raw
  if (!c?.name || !c?.company_number) return null
  return {
    name:               c.name,
    company_number:     c.company_number,
    jurisdiction_code:  (c.jurisdiction_code ?? '').toLowerCase().split('_')[0],
    incorporation_date: c.incorporation_date ?? null,
    dissolution_date:   c.dissolution_date ?? null,
    company_type:       c.company_type ?? null,
    current_status:     c.current_status ?? null,
    registered_address: c.registered_address ?? null,
    registry_url:       c.registry_url ?? null,
  }
}

/**
 * Search OpenCorporates for active companies matching a name.
 * Returns up to `limit` results across all jurisdictions.
 */
export async function searchOpenCorporates(query: string, limit = 5): Promise<OCCompany[]> {
  if (!query || query.trim().length < 2) return []

  try {
    const url = buildUrl('/companies/search', {
      q:           query.trim(),
      inactive:    'false',
      per_page:    String(Math.min(limit, 10)),
    })

    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'EnergyTradeInspection/1.0' },
      signal:  AbortSignal.timeout(5_000),
      next: { revalidate: 300 },
    } as RequestInit)

    if (!res.ok) return []

    const json = await res.json() as {
      results?: { companies?: Array<{ company: unknown }> }
    }
    return (json.results?.companies ?? [])
      .map((item) => parseCompany(item))
      .filter((c): c is OCCompany => c !== null)
      .slice(0, limit)
  } catch {
    return []
  }
}

/**
 * Fetch a single OpenCorporates company by jurisdiction code and company number.
 */
export async function getOCCompanyByNumber(
  jurisdictionCode: string,
  companyNumber: string,
): Promise<OCCompany | null> {
  if (!jurisdictionCode || !companyNumber) return null

  try {
    const url = buildUrl(
      `/companies/${encodeURIComponent(jurisdictionCode)}/${encodeURIComponent(companyNumber)}`
    )
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'EnergyTradeInspection/1.0' },
      signal:  AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null

    const json = await res.json() as { results?: { company?: unknown } }
    return parseCompany(json.results?.company) ?? null
  } catch {
    return null
  }
}

/**
 * Returns true if the string matches the `oc:{jurisdiction}:{number}` ID format.
 */
export function mightBeOCId(s: string): boolean {
  return /^oc:[a-z_]{2,10}:[a-z0-9 /-]+$/i.test(s)
}

/**
 * Compute authenticity score for an OpenCorporates company.
 * `entityExistence`: active in an aggregated official registry (max 15/25, slightly below a direct registry)
 * documentConsistency: incorporation date + address (max 9/10)
 * communityReputation: sanction screen result (max 8/10)
 */
export function computeOCScore(
  c: OCCompany,
  sanctionStatus: SanctionStatus = 'unknown',
) {
  const isActive           = (c.current_status ?? '').toLowerCase().includes('active')
    && !c.dissolution_date
  const entityExistence    = isActive ? 15 : 0   // slightly below direct registry (aggregator)
  const documentConsistency =
    (c.incorporation_date          ? 5 : 0) +
    (c.registered_address?.locality ? 4 : 0)
  const communityReputation = sanctionStatus === 'not_listed' ? 8 : 0
  const total = entityExistence + documentConsistency + communityReputation

  return {
    authenticityScore: total,
    scoreBreakdown: {
      entityExistence:     { score: entityExistence,     maxScore: 25 },
      assetReality:        { score: 0,                   maxScore: 30 },
      tradingTrackRecord:  { score: 0,                   maxScore: 25 },
      documentConsistency: { score: documentConsistency, maxScore: 10 },
      communityReputation: { score: communityReputation, maxScore: 10 },
    },
  }
}

/** Convert an OpenCorporates company to SearchResult format. */
export function ocToSearchResult(c: OCCompany) {
  const jur     = c.jurisdiction_code.split('_')[0]
  const country = OC_JURISDICTION_TO_COUNTRY[jur] ?? jur.toUpperCase()
  const flag    = OC_JURISDICTION_TO_FLAG[jur] ?? ''
  const { authenticityScore } = computeOCScore(c)  // no sanctions in search path
  return {
    id:                 `oc:${c.jurisdiction_code}:${c.company_number}`,
    name:               c.name,
    type:               'company' as const,
    country,
    jurisdictionFlag:   flag,
    sanctionStatus:     'unknown' as const,
    authenticityScore,
    riskLevel:          'medium' as const,
    registrationNumber: c.company_number,
    slug:               `oc-${c.jurisdiction_code}-${c.company_number}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
  }
}

/** Build a Company object from an OpenCorporates record (not persisted to DB). */
export function buildOCCompany(c: OCCompany, sanctionStatus: SanctionStatus) {
  const jur     = c.jurisdiction_code.split('_')[0]
  const country = OC_JURISDICTION_TO_COUNTRY[jur] ?? jur.toUpperCase()
  const flag    = OC_JURISDICTION_TO_FLAG[jur] ?? ''

  const addrParts = [
    c.registered_address?.street_address,
    c.registered_address?.locality,
    c.registered_address?.country,
  ].filter(Boolean)

  const base = {
    id:                 `oc:${c.jurisdiction_code}:${c.company_number}`,
    type:               'company' as const,
    name:               c.name,
    slug:               `oc-${c.jurisdiction_code}-${c.company_number}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    registrationNumber: c.company_number,
    incorporationDate:  c.incorporation_date ?? undefined,
    registeredAddress:  addrParts.length > 0 ? addrParts.join(', ') : undefined,
    country,
    jurisdictionFlag:   flag,
    sanctionStatus,
    riskFlags:          [] as never[],
    lastVerified:       new Date().toISOString(),
    dataSource:         [`OpenCorporates (${country})`],
  }

  // Hard-floor for sanctioned entities — must match scoring.ts LISTED_BREAKDOWN
  if (sanctionStatus === 'listed') {
    return {
      ...base,
      authenticityScore: 7,
      scoreBreakdown: {
        entityExistence:     { score: 3, maxScore: 25 },
        assetReality:        { score: 3, maxScore: 30 },
        tradingTrackRecord:  { score: 0, maxScore: 25 },
        documentConsistency: { score: 1, maxScore: 10 },
        communityReputation: { score: 0, maxScore: 10 },
      },
      riskLevel: 'critical' as const,
    }
  }

  const { authenticityScore, scoreBreakdown } = computeOCScore(c, sanctionStatus)
  return {
    ...base,
    authenticityScore,
    scoreBreakdown,
    riskLevel: 'medium' as const,
  }
}


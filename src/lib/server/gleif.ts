/**
 * GLEIF (Global Legal Entity Identifier Foundation) API client.
 *
 * Provides LEI lookup by company name and ultimate-parent chain resolution.
 * Free tier: no API key required. Approximate rate limit: ~60 req/min.
 *
 * API reference: https://api.gleif.org/api/v1
 */

const GLEIF_BASE = 'https://api.gleif.org/api/v1'

export interface GleifLeiRecord {
  lei: string
  legalName: string
  /**
   * ISO 3166-1 alpha-2 jurisdiction code, e.g. "GB", "VG", "KY".
   * GLEIF may return subdivisions like "GB-ENG" — normalised to first 2 chars.
   */
  jurisdiction: string | null
  /** Country code from the legal address (may differ from jurisdiction). */
  country: string | null
  /**
   * ISO date of initial LEI registration.
   * Valid lower-bound proxy for company age: a company cannot obtain an LEI
   * before it is legally incorporated.
   */
  initialRegistrationDate: string | null
}

// ── Internal helpers ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseRecord(record: any): GleifLeiRecord | null {
  if (!record?.id || !record?.attributes) return null
  const { entity, registration } = record.attributes as {
    entity?: {
      legalName?: { name?: string }
      legalJurisdiction?: string
      legalAddress?: { country?: string }
    }
    registration?: { initialRegistrationDate?: string }
  }
  const jur = entity?.legalJurisdiction ?? null
  return {
    lei:                     record.id as string,
    legalName:               entity?.legalName?.name ?? '',
    jurisdiction:            jur ? jur.slice(0, 2).toUpperCase() : null,
    country:                 entity?.legalAddress?.country ?? null,
    initialRegistrationDate: registration?.initialRegistrationDate ?? null,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

// ── ISO 3166-1 alpha-2 → country name (subset covering common jurisdictions) ──
const ISO_TO_COUNTRY: Record<string, string> = {
  AE: 'United Arab Emirates', AT: 'Austria',   AU: 'Australia',
  BE: 'Belgium',  BH: 'Bahrain',  BR: 'Brazil',  BZ: 'Belize',
  CA: 'Canada',   CH: 'Switzerland', CN: 'China',  CY: 'Cyprus',
  DE: 'Germany',  DK: 'Denmark',  EG: 'Egypt',   ES: 'Spain',
  FR: 'France',   GB: 'United Kingdom', GR: 'Greece',
  HK: 'Hong Kong', ID: 'Indonesia', IE: 'Ireland',  IN: 'India',
  IT: 'Italy',    JP: 'Japan',    KR: 'South Korea', KW: 'Kuwait',
  KY: 'Cayman Islands', LU: 'Luxembourg', MH: 'Marshall Islands',
  MX: 'Mexico',   MY: 'Malaysia', NG: 'Nigeria',  NL: 'Netherlands',
  NO: 'Norway',   NZ: 'New Zealand', OM: 'Oman',  PA: 'Panama',
  PL: 'Poland',   PT: 'Portugal', QA: 'Qatar',   RU: 'Russia',
  SA: 'Saudi Arabia', SC: 'Seychelles', SE: 'Sweden',
  SG: 'Singapore', TH: 'Thailand', TR: 'Turkey',  TW: 'Taiwan',
  UA: 'Ukraine',  US: 'United States', VG: 'British Virgin Islands',
  VN: 'Vietnam',  VU: 'Vanuatu',  WS: 'Samoa',   ZA: 'South Africa',
}

function jurisdictionToCountry(cc: string | null): string {
  if (!cc) return 'Unknown'
  return ISO_TO_COUNTRY[cc.toUpperCase().slice(0, 2)] ?? cc.toUpperCase().slice(0, 2)
}

import type { SanctionStatus } from '@/lib/types'

/**
 * Find the best-matching LEI record for a given company name.
 * Returns null if no match is found or the API is unreachable.
 */
export async function searchGleifByName(name: string): Promise<GleifLeiRecord | null> {
  try {
    const url = new URL(`${GLEIF_BASE}/lei-records`)
    url.searchParams.set('filter[entity.legalName]', name)
    url.searchParams.set('page[size]', '1')

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/vnd.api+json' },
      signal:  AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null

    const json = await res.json() as { data?: unknown[] }
    return parseRecord(json?.data?.[0]) ?? null
  } catch {
    return null
  }
}

/**
 * Resolve the ISO 3166-1 alpha-2 jurisdiction of the ultimate parent entity
 * in the GLEIF Level-2 ownership chain for the given LEI.
 *
 * Returns null when:
 *   - The entity is its own ultimate parent (top of chain / self-referential)
 *   - GLEIF Level-2 data is unavailable (reporting exception or not filed)
 *   - Any network or API error occurs
 *
 * Performs up to 2 sequential GLEIF requests (relationship → parent record).
 */
/**
 * Search GLEIF for up to `limit` LEI records matching a company name.
 * Used as last-resort discovery fallback for jurisdictions without direct registry access.
 */
export async function searchGleifMultiple(name: string, limit = 5): Promise<GleifLeiRecord[]> {
  if (!name || name.trim().length < 2) return []

  try {
    const url = new URL(`${GLEIF_BASE}/lei-records`)
    url.searchParams.set('filter[entity.legalName]', name.trim())
    url.searchParams.set('page[size]', String(Math.min(limit, 20)))

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/vnd.api+json' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return []

    const json = await res.json() as { data?: unknown[] }
    return (json?.data ?? []).map(parseRecord).filter((r): r is GleifLeiRecord => r !== null)
  } catch {
    return []
  }
}

/**
 * Fetch a single LEI record by its LEI code.
 * Returns null if not found or the API is unreachable.
 */
export async function getGleifRecordByLei(lei: string): Promise<GleifLeiRecord | null> {
  if (!lei) return null

  try {
    const res = await fetch(
      `${GLEIF_BASE}/lei-records/${encodeURIComponent(lei)}`,
      {
        headers: { Accept: 'application/vnd.api+json' },
        signal: AbortSignal.timeout(5_000),
      }
    )
    if (!res.ok) return null

    const json = await res.json() as { data?: unknown }
    return parseRecord(json?.data) ?? null
  } catch {
    return null
  }
}

/**
 * Build a Company object from a GLEIF LEI record (not persisted to DB).
 * id prefix: `gleif:${lei}` — signals GLEIF-only provenance to registry source detection.
 */
export function buildGleifCompany(record: GleifLeiRecord, sanctionStatus: SanctionStatus) {
  const cc = record.jurisdiction ?? record.country
  const country = jurisdictionToCountry(cc)

  return {
    id: `gleif:${record.lei}`,
    type: 'company' as const,
    name: record.legalName,
    slug: `lei-${record.lei.toLowerCase()}`,
    registrationNumber: record.lei,
    incorporationDate: record.initialRegistrationDate ?? undefined,
    country,
    jurisdictionFlag: cc ?? '',
    sanctionStatus,
    authenticityScore: 0,
    scoreBreakdown: {
      entityExistence:     { score: 0, maxScore: 25 },
      assetReality:        { score: 0, maxScore: 30 },
      tradingTrackRecord:  { score: 0, maxScore: 25, phase2Pending: true },
      documentConsistency: { score: 0, maxScore: 10 },
      communityReputation: { score: 0, maxScore: 10 },
    },
    riskLevel: (sanctionStatus === 'listed' ? 'critical' : 'medium') as 'critical' | 'medium',
    riskFlags: [] as never[],
    lastVerified: new Date().toISOString(),
    dataSource: ['GLEIF LEI Registry'],
  }
}

export async function getGleifUltimateParentJurisdiction(lei: string): Promise<string | null> {
  try {
    // Step 1: resolve the ultimate-parent relationship to obtain the parent LEI
    const relRes = await fetch(
      `${GLEIF_BASE}/lei-records/${encodeURIComponent(lei)}/ultimate-parent-relationship`,
      {
        headers: { Accept: 'application/vnd.api+json' },
        signal:  AbortSignal.timeout(4_000),
      }
    )
    if (!relRes.ok) return null

    const relJson = await relRes.json() as {
      data?: {
        attributes?: {
          relationship?: {
            endNode?: { nodeID?: string }
          }
        }
      }
    }
    const parentLei = relJson?.data?.attributes?.relationship?.endNode?.nodeID

    // If no parent LEI or self-referential (company is already the ultimate parent)
    if (!parentLei || parentLei === lei) return null

    // Step 2: fetch the parent LEI record to determine its jurisdiction
    const parentRes = await fetch(
      `${GLEIF_BASE}/lei-records/${encodeURIComponent(parentLei)}`,
      {
        headers: { Accept: 'application/vnd.api+json' },
        signal:  AbortSignal.timeout(4_000),
      }
    )
    if (!parentRes.ok) return null

    const parentJson = await parentRes.json() as { data?: unknown }
    return parseRecord(parentJson?.data)?.jurisdiction ?? null
  } catch {
    return null
  }
}

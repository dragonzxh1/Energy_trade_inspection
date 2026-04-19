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
   * GLEIF may return subdivisions like "GB-ENG"; normalize them to the first 2 chars.
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
  /**
   * GLEIF Registration Authority code, e.g. "RA000585" = UK Companies House,
   * "RA000523" = Singapore ACRA. See GLEIF RA list for full mapping.
   */
  registrationAuthorityId: string | null
  /**
   * The entity's registration number within the national registry identified by
   * registrationAuthorityId. This is the actual company number, e.g. "02525200"
   * for a UK company — not the LEI.
   */
  registrationAuthorityEntityId: string | null
}

// 鈹€鈹€ Internal helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseRecord(record: any): GleifLeiRecord | null {
  if (!record?.id || !record?.attributes) return null
  // GLEIF v1 API field names (confirmed against live API 2026-04):
  //   entity.jurisdiction          — ISO 3166-1 alpha-2 (not legalJurisdiction)
  //   entity.registeredAt.id       — RA code e.g. "RA000585"
  //   entity.registeredAs          — local registry number e.g. "10399850"
  const { entity, registration } = record.attributes as {
    entity?: {
      legalName?: { name?: string }
      jurisdiction?: string
      legalAddress?: { country?: string }
      registeredAt?: { id?: string }
      registeredAs?: string | number
    }
    registration?: { initialRegistrationDate?: string }
  }
  const jur = entity?.jurisdiction ?? null
  const regAs = entity?.registeredAs
  return {
    lei:                          record.id as string,
    legalName:                    entity?.legalName?.name ?? '',
    jurisdiction:                 jur ? jur.slice(0, 2).toUpperCase() : null,
    country:                      entity?.legalAddress?.country ?? null,
    initialRegistrationDate:      registration?.initialRegistrationDate ?? null,
    registrationAuthorityId:      entity?.registeredAt?.id ?? null,
    registrationAuthorityEntityId: regAs != null ? String(regAs) : null,
  }
}

// 鈹€鈹€ Public API 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

// ISO 3166-1 alpha-2 to country name mapping for common jurisdictions.
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
import { riskLevel } from '@/lib/server/scoring'
import { db } from '@/lib/server/db'
import type { LeiCacheRow } from '@/lib/server/sync/gleif-golden-copy'

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
 * Performs up to 2 sequential GLEIF requests: relationship, then parent record.
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
 * Opacity-indicating GLEIF Reporting Exception types that reduce the trust signal (per D-07).
 * NATURAL_PERSONS is intentionally excluded — it is informational only and does not indicate
 * ownership opacity.
 */
const OPACITY_EXCEPTION_TYPES = new Set(['NON_CONSOLIDATING', 'NON_PUBLIC', 'NO_LEI'])

/**
 * Build a Company object from a GLEIF LEI record (not persisted to DB).
 * ID prefix `gleif:${lei}` signals GLEIF-only provenance to registry source detection.
 *
 * Scoring note: LEI existence is a weaker signal than a direct registry match and only indicates the entity
 * is regulated enough to have obtained an LEI, but no direct registry verification.
 * entityExistence: 10/25 (has valid LEI)
 * documentConsistency: +5 if registration date is known
 * communityReputation: +8 if not_listed (−3 if opacity-indicating reporting exception)
 * Max score is about 23, which is appropriate for an indirect source.
 */
export function buildGleifCompany(
  record: GleifLeiRecord,
  sanctionStatus: SanctionStatus,
  reportingExceptionType?: string | null,
) {
  const cc = record.jurisdiction ?? record.country
  const country = jurisdictionToCountry(cc)

  const base = {
    id: `gleif:${record.lei}`,
    type: 'company' as const,
    name: record.legalName,
    slug: `lei-${record.lei.toLowerCase()}`,
    registrationNumber: record.registrationAuthorityEntityId ?? record.lei,
    incorporationDate: record.initialRegistrationDate ?? undefined,
    country,
    jurisdictionFlag: cc ?? '',
    sanctionStatus,
    riskFlags: [] as never[],
    lastVerified: new Date().toISOString(),
    dataSource: ['GLEIF LEI Registry'],
  }

  const entityExistence    = 10  // valid LEI = minimal existence signal
  const documentConsistency = record.initialRegistrationDate ? 5 : 0
  const communityReputation = sanctionStatus === 'not_listed' ? 8 : 0
  // GLEIF Reporting Exception: opacity-indicating types reduce trust signal (per D-07)
  // buildGleifCompany uses inline scoring (not computeScore), so deduction is applied here directly.
  const hasOpacityException =
    reportingExceptionType != null && OPACITY_EXCEPTION_TYPES.has(reportingExceptionType)
  const communityReputationFinal = hasOpacityException
    ? Math.max(0, communityReputation - 3)
    : communityReputation
  const authenticityScore = entityExistence + documentConsistency + communityReputationFinal

  return {
    ...base,
    authenticityScore,
    scoreBreakdown: {
      entityExistence:     { score: entityExistence,          maxScore: 25 },
      assetReality:        { score: 0,                        maxScore: 30 },
      tradingTrackRecord:  { score: 0,                        maxScore: 25 },
      documentConsistency: { score: documentConsistency,      maxScore: 10 },
      communityReputation: { score: communityReputationFinal, maxScore: 10 },
    },
    riskLevel: riskLevel(authenticityScore, sanctionStatus),
  }
}

export interface GleifOwnershipChain {
  directParentLei: string | null
  directParentName: string | null
  ultimateParentLei: string | null
  ultimateParentName: string | null
  /** ISO 3166-1 alpha-2 jurisdiction of the ultimate parent entity. */
  ultimateParentJurisdiction: string | null
}

/**
 * Resolve the full GLEIF Level-2 ownership chain for a given LEI.
 *
 * Returns direct parent and ultimate parent with legal name, LEI, and jurisdiction.
 * Cache-first: queries lei_cache. Falls through to live GLEIF API for jurisdiction
 * when the parent is known but not yet cached.
 *
 * Returns null when:
 *   - The entity is its own ultimate parent (top of chain)
 *   - No Level-2 data is available (reporting exception or not filed)
 *   - Any unrecoverable error occurs
 */
export async function getGleifOwnershipChain(lei: string): Promise<GleifOwnershipChain | null> {
  try {
    // Step 1: cache-first lookup for entity's parent LEIs
    let directParentLei: string | null = null
    let ultimateParentLei: string | null = null

    try {
      const { rows } = await db.query<Pick<LeiCacheRow, 'direct_parent_lei' | 'ultimate_parent_lei'>>(
        `SELECT direct_parent_lei, ultimate_parent_lei FROM lei_cache WHERE lei = $1 LIMIT 1`,
        [lei],
      )
      directParentLei = rows[0]?.direct_parent_lei ?? null
      ultimateParentLei = rows[0]?.ultimate_parent_lei ?? null
    } catch {
      // Cache lookup failed — fall through to live API
    }

    // If entity not in cache, use live API to find the ultimate parent LEI
    if (!ultimateParentLei) {
      try {
        const relRes = await fetch(
          `${GLEIF_BASE}/lei-records/${encodeURIComponent(lei)}/ultimate-parent-relationship`,
          { headers: { Accept: 'application/vnd.api+json' }, signal: AbortSignal.timeout(4_000) },
        )
        if (relRes.ok) {
          const relJson = await relRes.json() as {
            data?: { attributes?: { relationship?: { endNode?: { nodeID?: string } } } }
          }
          const parentLei = relJson?.data?.attributes?.relationship?.endNode?.nodeID
          if (parentLei && parentLei !== lei) ultimateParentLei = parentLei
        }
      } catch {
        // Live API failed — leave as null
      }
    }

    // Remove self-referential entries (entity is its own parent)
    if (ultimateParentLei === lei) ultimateParentLei = null
    if (directParentLei === lei) directParentLei = null
    if (!directParentLei && !ultimateParentLei) return null

    // Step 2: batch lookup of parent names and jurisdictions from cache
    const parentLeis = [...new Set(
      [directParentLei, ultimateParentLei].filter((l): l is string => !!l)
    )]

    let directParentName: string | null = null
    let ultimateParentName: string | null = null
    let ultimateParentJurisdiction: string | null = null

    try {
      const { rows: parentRows } = await db.query<
        Pick<LeiCacheRow, 'lei' | 'legal_name' | 'jurisdiction'>
      >(
        `SELECT lei, legal_name, jurisdiction FROM lei_cache WHERE lei = ANY($1)`,
        [parentLeis],
      )
      const parentMap = new Map(parentRows.map(r => [r.lei, r]))
      const directParent  = directParentLei  ? parentMap.get(directParentLei)  : undefined
      const ultimateParent = ultimateParentLei ? parentMap.get(ultimateParentLei) : undefined

      directParentName         = directParent?.legal_name  ?? null
      ultimateParentName       = ultimateParent?.legal_name ?? null
      ultimateParentJurisdiction = ultimateParent?.jurisdiction ?? null
    } catch {
      // Cache lookup for parents failed
    }

    // Fallback to live GLEIF API for jurisdiction when parent is known but not cached
    if (ultimateParentLei && !ultimateParentJurisdiction) {
      try {
        const parentRes = await fetch(
          `${GLEIF_BASE}/lei-records/${encodeURIComponent(ultimateParentLei)}`,
          { headers: { Accept: 'application/vnd.api+json' }, signal: AbortSignal.timeout(4_000) },
        )
        if (parentRes.ok) {
          const parentJson = await parentRes.json() as { data?: unknown }
          ultimateParentJurisdiction = parseRecord(parentJson?.data)?.jurisdiction ?? null
        }
      } catch {
        // Live API fallback failed
      }
    }

    return { directParentLei, directParentName, ultimateParentLei, ultimateParentName, ultimateParentJurisdiction }
  } catch {
    return null
  }
}


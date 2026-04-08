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

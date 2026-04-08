/**
 * Zefix (Swiss Commercial Register) integration.
 * Source: https://www.zefix.admin.ch/ZefixPublicREST/api/v1
 * Auth: HTTP Basic (ZEFIX_USERNAME / ZEFIX_PASSWORD env vars)
 * Gracefully returns [] / null if credentials are not configured.
 */

import type { SanctionStatus } from '@/lib/types'

const ZEFIX_BASE = 'https://www.zefix.admin.ch/ZefixPublicREST/api/v1'

export interface ZefixCompany {
  name: string
  uid: string             // e.g. "CHE-123.456.789"
  ehraid: string          // internal Zefix ID
  legalForm: string       // e.g. "Gesellschaft mit beschränkter Haftung"
  status: string          // "ACTIVE" | "CANCELLED" | ...
  registerOffice: string  // Canton
  address?: {
    street?: string
    city?: string
    swissZipCode?: string
  }
}

function getCredentials(): { username: string; password: string } | null {
  const username = process.env.ZEFIX_USERNAME
  const password = process.env.ZEFIX_PASSWORD
  if (!username || !password) return null
  return { username, password }
}

function buildHeaders(): HeadersInit {
  const creds = getCredentials()
  if (!creds) return { Accept: 'application/json', 'User-Agent': 'EnergyTradeInspection/1.0' }
  const encoded = Buffer.from(`${creds.username}:${creds.password}`).toString('base64')
  return {
    Authorization: `Basic ${encoded}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'EnergyTradeInspection/1.0',
  }
}

/**
 * Search the Swiss Commercial Register by company name.
 * Returns up to `limit` active companies.
 */
export async function searchZefix(query: string, limit = 10): Promise<ZefixCompany[]> {
  if (!query || query.trim().length < 2) return []
  if (!getCredentials()) return []

  try {
    const response = await fetch(`${ZEFIX_BASE}/company/search.json`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ name: query.trim(), maxEntries: limit, activeOnly: true }),
      signal: AbortSignal.timeout(5_000),
      next: { revalidate: 300 },
    })

    if (!response.ok) return []

    const data = await response.json()
    if (!Array.isArray(data)) return []
    return data as ZefixCompany[]
  } catch {
    return []
  }
}

/**
 * Fetch a single company from Zefix by its Swiss UID (CHE-xxx.xxx.xxx).
 */
export async function getZefixByUid(uid: string): Promise<ZefixCompany | null> {
  if (!uid || !getCredentials()) return null

  try {
    const encoded = encodeURIComponent(uid.toUpperCase())
    const response = await fetch(`${ZEFIX_BASE}/company/uid/${encoded}.json`, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(5_000),
    })

    if (!response.ok) return null

    const data = await response.json()
    // API may return a single object or a 1-element array
    if (Array.isArray(data)) return (data[0] as ZefixCompany) ?? null
    return data as ZefixCompany
  } catch {
    return null
  }
}

/** Returns true if the string looks like a Swiss UID (CHE-123.456.789). */
export function mightBeSwissUid(s: string): boolean {
  return /^CHE[-\s]?\d{3}[.\s]?\d{3}[.\s]?\d{3}$/i.test(s.trim())
}

/**
 * Compute authenticity score for a Zefix company.
 * entityExistence: ACTIVE status in Swiss official registry (max 18/25)
 * documentConsistency: canton/registerOffice always present (+3), city address (+4) (max 7/10)
 * communityReputation: sanction screen result (max 8/10)
 */
function computeZefixScore(
  c: ZefixCompany,
  sanctionStatus: SanctionStatus = 'unknown',
) {
  const isActive           = c.status === 'ACTIVE'
  const entityExistence    = isActive ? 18 : 0
  const documentConsistency =
    (c.registerOffice  ? 3 : 0) +  // canton always set for active companies
    (c.address?.city   ? 4 : 0)
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

/** Convert a Zefix company to SearchResult format. */
export function zefixToSearchResult(c: ZefixCompany) {
  const { authenticityScore } = computeZefixScore(c)  // no sanctions in search path
  return {
    id: `zefix:${c.uid}`,
    name: c.name,
    type: 'company' as const,
    country: 'Switzerland',
    jurisdictionFlag: '🇨🇭',
    sanctionStatus: 'unknown' as const,
    authenticityScore,
    riskLevel: 'medium' as const,
    registrationNumber: c.uid,
    slug: c.uid.toLowerCase().replace(/[^a-z0-9]/g, '-'),
  }
}

/** Build a Company object from a Zefix record (not persisted to DB). */
export function buildZefixCompany(c: ZefixCompany, sanctionStatus: SanctionStatus) {
  const addressParts = [c.address?.street, c.address?.swissZipCode, c.address?.city].filter(Boolean)
  const registeredAddress = addressParts.length > 0 ? addressParts.join(', ') : undefined
  const { authenticityScore, scoreBreakdown } = computeZefixScore(c, sanctionStatus)

  return {
    id: `zefix:${c.uid}`,
    type: 'company' as const,
    name: c.name,
    slug: c.uid.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    registrationNumber: c.uid,
    registeredAddress,
    country: 'Switzerland',
    jurisdictionFlag: '🇨🇭',
    sanctionStatus,
    authenticityScore,
    scoreBreakdown,
    riskLevel: (sanctionStatus === 'listed' ? 'critical' : 'medium') as 'critical' | 'medium',
    riskFlags: [] as never[],
    lastVerified: new Date().toISOString(),
    dataSource: ['Zefix Swiss Commercial Register'],
  }
}

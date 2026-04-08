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

/** Convert a Zefix company to SearchResult format. */
export function zefixToSearchResult(c: ZefixCompany) {
  return {
    id: `zefix:${c.uid}`,
    name: c.name,
    type: 'company' as const,
    country: 'Switzerland',
    jurisdictionFlag: '🇨🇭',
    sanctionStatus: 'unknown' as const,
    authenticityScore: 0,
    riskLevel: 'medium' as const,
    registrationNumber: c.uid,
    slug: c.uid.toLowerCase().replace(/[^a-z0-9]/g, '-'),
  }
}

/** Build a Company object from a Zefix record (not persisted to DB). */
export function buildZefixCompany(c: ZefixCompany, sanctionStatus: SanctionStatus) {
  const addressParts = [c.address?.street, c.address?.swissZipCode, c.address?.city].filter(Boolean)
  const registeredAddress = addressParts.length > 0 ? addressParts.join(', ') : undefined

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
    dataSource: ['Zefix Swiss Commercial Register'],
  }
}

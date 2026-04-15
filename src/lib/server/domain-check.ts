/**
 * Domain fraud detection.
 *
 * Two independent checks:
 *
 *   1. WHOIS risk scoring — queries RDAP for registration metadata:
 *        - Domain age (< 90 days = high risk)
 *        - Registration duration (1-year-only = minimum commitment)
 *        - Registrant type (individual / no org = suspicious)
 *        - Privacy protection (hides true owner)
 *      Results cached in domain_whois_cache (48h TTL).
 *
 *   2. Domain spoofing detection — compares the domain against
 *      legitimate_domains using edit-distance + trigram similarity.
 *      Flags domains that closely resemble a known legitimate company's
 *      official domain (typosquatting, TLD-swapping, homoglyph attacks).
 *
 * Public API:
 *   checkDomain(domain)  → full check (WHOIS + spoofing)
 *   extractDomain(text)  → pull domain from email address or URL string
 */

import { db } from '@/lib/server/db'

// ── RDAP server routing ───────────────────────────────────────────────────────
// Maps TLD → RDAP base URL. Falls back to rdap.org for unlisted TLDs.

const RDAP_BASE: Record<string, string> = {
  com: 'https://rdap.verisign.com/com/v1',
  net: 'https://rdap.verisign.com/net/v1',
  org: 'https://rdap.publicinterestregistry.org/rdap',
  io:  'https://rdap.nic.io',
  co:  'https://rdap.identitydigital.services/rdap',
  nl:  'https://rdap.sidn.nl/rdap',
  de:  'https://rdap.denic.de',
  eu:  'https://rdap.nic.eu',
  ae:  'https://rdap.afilias.net/rdap/ae',
  sg:  'https://rdap.sgnic.sg/rdap',
  br:  'https://rdap.registro.br/rdap',
  uk:  'https://rdap.nominet.uk/uk',
  au:  'https://rdap.auda.org.au/rdap',
  fr:  'https://rdap.afnic.fr/rdap',
  no:  'https://rdap.norid.no/rdap',
  ch:  'https://rdap.nic.ch/rdap',
  it:  'https://rdap.nic.it',
  az:  'https://rdap.nic.az/rdap',
  kz:  'https://rdap.nic.kz/rdap',
  mx:  'https://rdap.mx/rdap',
}

const RDAP_FALLBACK = 'https://rdap.org'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WhoisInfo {
  /** Days since the domain was first registered. null if RDAP lookup failed. */
  ageDays: number | null
  /** Total registration duration in days (creation → expiry). */
  durationDays: number | null
  /** True when a privacy/proxy service hides the real registrant. */
  privacyProtected: boolean
  /** Registrant organization name, or null when hidden/absent. */
  registrantOrg: string | null
  /** Registrant country code (ISO 3166-1 alpha-2). */
  registrantCountry: string | null
  /** 0–10 composite risk score based on the signals above. */
  riskScore: number
  /** Human-readable explanation of each risk signal detected. */
  riskSignals: string[]
}

export interface SpoofingMatch {
  /** Official domain of the legitimate company. */
  legitimateDomain: string
  /** Company name associated with that domain. */
  legitimateCompany: string
  /** 0–1 similarity score (1 = identical after normalization). */
  similarityScore: number
}

export interface DomainCheckResult {
  domain: string
  /** WHOIS risk assessment. null when the lookup failed entirely. */
  whois: WhoisInfo | null
  /** Legitimate company domains that are suspiciously similar to this one. */
  spoofingMatches: SpoofingMatch[]
  /** True when any check produced a meaningful risk signal. */
  flagged: boolean
  /** Highest severity across all detected signals. */
  severity: 'critical' | 'high' | 'medium' | 'low'
  /** Evidence strings suitable for use in a TradeFlag. */
  evidence: string[]
}

export interface EmailDomainCheck {
  domain: string
  /** True when at least one MX record resolves for the domain. */
  hasMx: boolean
  /** True when a TXT record starting with 'v=spf1' exists at the root domain. */
  hasSpf: boolean
  /** True when a TXT record starting with 'v=DMARC1' exists at _dmarc.<domain>. */
  hasDmarc: boolean
  /** True when a TXT record was found for any of the probed DKIM selectors. */
  dkimDetected: boolean
  /** First DKIM selector that resolved, or null if none detected. */
  dkimSelector: string | null
  /** Human-readable risk signal strings. */
  riskSignals: string[]
  /** True when !hasSpf || !hasDmarc — missing mail hygiene is a fraud signal. */
  flagged: boolean
  /** Error message when DNS resolution failed (ENOTFOUND, ESERVFAIL, ETIMEOUT). */
  error: string | null
}

export interface DomainIntelResult {
  domain: string
  /** WHOIS risk assessment from checkDomain(). null when RDAP failed entirely. */
  whois: WhoisInfo | null
  /** Legitimate domains that are suspiciously similar. */
  spoofingMatches: SpoofingMatch[]
  /** Email DNS hygiene check. null when DNS resolution failed entirely. */
  email: EmailDomainCheck | null
}

// ── Domain normalization ──────────────────────────────────────────────────────

const COMMON_TLDS =
  /\.(com|net|org|io|co|biz|info|us|uk|eu|de|nl|fr|ae|sg|hk|cn|ru|az|kz|mx|br|au|no|ch|it|za|qa|ng)(\.[a-z]{2})?$/i

/**
 * Strip www, TLD, separators and apply homoglyph normalization so that
 * "vіtol-energy.net" compares equal-ish to "vitol".
 */
export function normalizeDomainForComparison(domain: string): string {
  let d = domain.toLowerCase().replace(/^www\./, '')
  d = d.replace(COMMON_TLDS, '')

  // Homoglyph normalization: Cyrillic lookalikes → Latin equivalents
  d = d
    .replace(/[\u0430\u0410]/g, 'a')   // Cyrillic а А → a
    .replace(/[\u0435\u0415]/g, 'e')   // Cyrillic е Е → e
    .replace(/[\u043e\u041e]/g, 'o')   // Cyrillic о О → o
    .replace(/[\u0440\u0420]/g, 'p')   // Cyrillic р Р → p  (!)
    .replace(/[\u0441\u0421]/g, 'c')   // Cyrillic с С → c
    .replace(/[\u0445\u0425]/g, 'x')   // Cyrillic х Х → x
    .replace(/[\u0456\u0406]/g, 'i')   // Cyrillic і І → i
    .replace(/[\u0405]/g, 's')          // Cyrillic ѕ  → s
    .replace(/0/g, 'o')                 // zero  → o
    .replace(/1/g, 'l')                 // one   → l
    .replace(/rn/g, 'm')               // visual confusion: rn → m
    .replace(/[-_.]/g, '')             // remove separators
    .replace(/\s+/g, '')

  return d
}

/** Extract the registrable domain from a URL or email address. */
export function extractDomain(text: string): string | null {
  if (!text) return null
  const t = text.trim()

  // Email: take the part after @
  const emailMatch = t.match(/@([a-z0-9.-]+\.[a-z]{2,})/i)
  if (emailMatch) return emailMatch[1].toLowerCase()

  // URL: extract hostname
  try {
    const url = t.startsWith('http') ? t : `https://${t}`
    const host = new URL(url).hostname
    return host.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

// ── Similarity algorithms ─────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  // Use two rolling rows for O(n) space
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let curr = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1])
    }
    ;[prev, curr] = [curr, prev]
  }
  return prev[n]
}

function trigramSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const trigrams = (s: string): Set<string> => {
    const set = new Set<string>()
    const p = `  ${s} `
    for (let i = 0; i < p.length - 2; i++) set.add(p.slice(i, i + 3))
    return set
  }

  const ta = trigrams(a)
  const tb = trigrams(b)
  let intersection = 0
  for (const t of ta) if (tb.has(t)) intersection++
  return (2 * intersection) / (ta.size + tb.size)
}

/** Combined 0–1 similarity score between two raw domain strings. */
export function domainSimilarityScore(suspicious: string, legitimate: string): number {
  const s = normalizeDomainForComparison(suspicious)
  const l = normalizeDomainForComparison(legitimate)

  if (!s || !l) return 0
  if (s === l) return 1.0

  // Substring containment: "vitol-energy" ⊃ "vitol"
  if (s.includes(l) || l.includes(s)) {
    // Penalise proportionally to how much was added
    const ratio = Math.min(s.length, l.length) / Math.max(s.length, l.length)
    return 0.7 + 0.15 * ratio
  }

  const editSim = 1 - levenshtein(s, l) / Math.max(s.length, l.length)
  const trigramSim = trigramSimilarity(s, l)
  return Math.max(editSim, trigramSim)
}

// ── RDAP fetching and parsing ─────────────────────────────────────────────────

interface RawWhois {
  registeredAt: Date | null
  expiresAt: Date | null
  registrantOrg: string | null
  registrantName: string | null
  registrantCountry: string | null
  privacyProtected: boolean
  raw: unknown
}

const PRIVACY_KEYWORDS = /privacy|proxy|whoisguard|protect|redact|gdpr|withheld|masked/i

function parseRdapResponse(data: Record<string, unknown>): RawWhois {
  // Parse events for key dates
  const events = (data.events ?? []) as Array<{ eventAction: string; eventDate: string }>
  const getDate = (action: string): Date | null => {
    const ev = events.find((e) => e.eventAction === action)
    return ev ? new Date(ev.eventDate) : null
  }

  let registrantOrg: string | null = null
  let registrantName: string | null = null
  let registrantCountry: string | null = null
  let privacyProtected = false

  const entities = (data.entities ?? []) as Array<Record<string, unknown>>
  for (const entity of entities) {
    const roles = (entity.roles ?? []) as string[]
    if (!roles.includes('registrant')) continue

    // Check remarks for GDPR redaction
    const remarks = (entity.remarks ?? []) as Array<{ description?: string[] }>
    for (const r of remarks) {
      if (r.description?.some((d) => /redacted|withheld/i.test(d))) {
        privacyProtected = true
      }
    }

    // Parse vCard array: [property, params, type, value]
    const vcard = ((entity.vcardArray ?? []) as unknown[][])[1] ?? []
    for (const field of vcard as unknown[][]) {
      const [prop, , , value] = field as [string, unknown, unknown, unknown]
      if (typeof value !== 'string' && !Array.isArray(value)) continue

      if (prop === 'org' && typeof value === 'string') {
        registrantOrg = value || null
      }
      if (prop === 'fn' && typeof value === 'string') {
        registrantName = value || null
      }
      if (prop === 'adr' && Array.isArray(value)) {
        // vCard ADR: [PO Box, Ext Addr, Street, Locality, Region, Postal, Country]
        const country = value[6]
        if (typeof country === 'string' && country.length === 2) {
          registrantCountry = country.toUpperCase()
        }
      }
    }

    // Detect privacy services by registrant name/org
    const nameCheck = `${registrantOrg ?? ''} ${registrantName ?? ''}`
    if (PRIVACY_KEYWORDS.test(nameCheck)) {
      privacyProtected = true
      registrantOrg = null
      registrantName = null
    }
  }

  return {
    registeredAt: getDate('registration'),
    expiresAt: getDate('expiration'),
    registrantOrg,
    registrantName,
    registrantCountry,
    privacyProtected,
    raw: data,
  }
}

async function fetchRdap(domain: string): Promise<RawWhois> {
  const tld = domain.split('.').pop()?.toLowerCase() ?? ''
  const base = RDAP_BASE[tld] ?? RDAP_FALLBACK
  const url = `${base}/domain/${domain}`

  const res = await fetch(url, {
    headers: {
      Accept: 'application/rdap+json',
      'User-Agent': 'EnergyTradeInspection/1.0 (compliance@energytradeinspection.com)',
    },
    signal: AbortSignal.timeout(12_000),
  })

  if (!res.ok) throw new Error(`RDAP HTTP ${res.status} for ${domain}`)
  const data = await res.json() as Record<string, unknown>
  return parseRdapResponse(data)
}

// ── WHOIS cache ───────────────────────────────────────────────────────────────

const CACHE_TTL_HOURS = 48

interface WhoisCacheRow {
  domain: string
  registered_at: string | null
  expires_at: string | null
  duration_days: number | null
  registrant_org: string | null
  registrant_name: string | null
  registrant_country: string | null
  privacy_protected: boolean
  queried_at: string
  error: string | null
}

async function getWhoisCached(domain: string): Promise<WhoisCacheRow | null> {
  const { rows } = await db.query<WhoisCacheRow>(
    `SELECT * FROM domain_whois_cache WHERE domain = $1
     AND queried_at > NOW() - INTERVAL '${CACHE_TTL_HOURS} hours'`,
    [domain]
  )
  return rows[0] ?? null
}

async function upsertWhoisCache(
  domain: string,
  data: RawWhois | null,
  error: string | null
): Promise<void> {
  const durationDays =
    data?.registeredAt && data.expiresAt
      ? Math.round((data.expiresAt.getTime() - data.registeredAt.getTime()) / 86_400_000)
      : null

  await db.query(
    `INSERT INTO domain_whois_cache
       (domain, registered_at, expires_at, duration_days,
        registrant_org, registrant_name, registrant_country,
        privacy_protected, queried_at, error, raw_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10)
     ON CONFLICT (domain) DO UPDATE SET
       registered_at     = EXCLUDED.registered_at,
       expires_at        = EXCLUDED.expires_at,
       duration_days     = EXCLUDED.duration_days,
       registrant_org    = EXCLUDED.registrant_org,
       registrant_name   = EXCLUDED.registrant_name,
       registrant_country= EXCLUDED.registrant_country,
       privacy_protected = EXCLUDED.privacy_protected,
       queried_at        = EXCLUDED.queried_at,
       error             = EXCLUDED.error,
       raw_json          = EXCLUDED.raw_json`,
    [
      domain,
      data?.registeredAt?.toISOString().slice(0, 10) ?? null,
      data?.expiresAt?.toISOString().slice(0, 10) ?? null,
      durationDays,
      data?.registrantOrg ?? null,
      data?.registrantName ?? null,
      data?.registrantCountry ?? null,
      data?.privacyProtected ?? false,
      error,
      data ? JSON.stringify(data.raw) : null,
    ]
  )
}

// ── WHOIS risk scoring ────────────────────────────────────────────────────────

const HIGH_RISK_REGISTRANT_COUNTRIES = new Set([
  'NG', 'GH', 'CM',  // West Africa — common fraud origin
])

function scoreWhois(row: WhoisCacheRow): WhoisInfo {
  const ageDays = row.registered_at
    ? Math.floor((Date.now() - new Date(row.registered_at).getTime()) / 86_400_000)
    : null

  const signals: string[] = []
  let score = 0

  // ── Age ─────────────────────────────────────────────────────────────────────
  if (ageDays !== null) {
    if (ageDays < 30) {
      score += 5
      signals.push(`Domain registered only ${ageDays} days ago — extremely new`)
    } else if (ageDays < 90) {
      score += 4
      signals.push(`Domain registered ${ageDays} days ago (< 3 months)`)
    } else if (ageDays < 180) {
      score += 2
      signals.push(`Domain registered ${ageDays} days ago (< 6 months)`)
    } else if (ageDays < 365) {
      score += 1
      signals.push(`Domain registered ${ageDays} days ago (< 1 year)`)
    }
  }

  // ── Registration duration ────────────────────────────────────────────────────
  if (row.duration_days !== null && row.duration_days <= 400) {
    score += 2
    signals.push('Registered for minimum term (1 year) — low commitment signal')
  }

  // ── Registrant type ──────────────────────────────────────────────────────────
  if (row.privacy_protected) {
    score += 2
    signals.push('WHOIS privacy protection enabled — registrant identity hidden')
  } else if (!row.registrant_org) {
    score += 2
    signals.push('No registrant organization — individual registration for claimed trading company')
  }

  // ── Registrant country ───────────────────────────────────────────────────────
  if (row.registrant_country && HIGH_RISK_REGISTRANT_COUNTRIES.has(row.registrant_country)) {
    score += 1
    signals.push(`Registrant country: ${row.registrant_country} — elevated fraud risk jurisdiction`)
  }

  return {
    ageDays,
    durationDays: row.duration_days,
    privacyProtected: row.privacy_protected,
    registrantOrg: row.registrant_org,
    registrantCountry: row.registrant_country,
    riskScore: Math.min(10, score),
    riskSignals: signals,
  }
}

// ── Spoofing detection against legitimate_domains ─────────────────────────────

const SPOOFING_THRESHOLD = 0.75   // minimum similarity to flag
const EXACT_MATCH_SKIP  = 1.0     // score=1 means identical → not spoofing

interface LegitDomainRow {
  domain: string
  company_name: string
}

async function findSpoofingMatches(domain: string): Promise<SpoofingMatch[]> {
  const normalized = normalizeDomainForComparison(domain)
  if (!normalized || normalized.length < 3) return []

  // The legitimate_domains table is small (typically < 500 rows), so a full scan
  // is acceptable and more reliable than a pg_trgm pre-filter which can miss
  // cases like "vitol-energy.net → vitol.com" (low raw-string trigram similarity
  // but high normalized similarity due to substring containment).
  const { rows } = await db.query<LegitDomainRow>(
    `SELECT domain, company_name FROM legitimate_domains WHERE domain != $1`,
    [domain]
  )

  const matches: SpoofingMatch[] = []
  for (const row of rows) {
    const score = domainSimilarityScore(domain, row.domain)
    if (score >= SPOOFING_THRESHOLD && score < EXACT_MATCH_SKIP) {
      matches.push({
        legitimateDomain: row.domain,
        legitimateCompany: row.company_name,
        similarityScore: Math.round(score * 100) / 100,
      })
    }
  }

  // Sort by highest similarity first
  return matches.sort((a, b) => b.similarityScore - a.similarityScore)
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run both WHOIS and spoofing checks for a domain.
 * WHOIS results are cached for 48 hours.
 * Never throws — returns a low-risk result on any error.
 */
export async function checkDomain(domain: string): Promise<DomainCheckResult> {
  const d = domain.toLowerCase().replace(/^www\./, '').trim()
  if (!d || d.length < 4) {
    return { domain: d, whois: null, spoofingMatches: [], flagged: false, severity: 'low', evidence: [] }
  }

  // ── WHOIS (cached) ──────────────────────────────────────────────────────────
  let whoisInfo: WhoisInfo | null = null
  try {
    let cached = await getWhoisCached(d)
    if (!cached) {
      let raw: RawWhois | null = null
      let err: string | null = null
      try {
        raw = await fetchRdap(d)
      } catch (e) {
        err = String(e)
      }
      await upsertWhoisCache(d, raw, err)
      cached = await getWhoisCached(d)
    }
    if (cached && !cached.error) {
      whoisInfo = scoreWhois(cached)
    }
  } catch {
    // WHOIS failure is non-fatal
  }

  // ── Spoofing detection ──────────────────────────────────────────────────────
  let spoofingMatches: SpoofingMatch[] = []
  try {
    spoofingMatches = await findSpoofingMatches(d)
  } catch {
    // Spoofing check failure is non-fatal
  }

  // ── Build result ────────────────────────────────────────────────────────────
  const evidence: string[] = []
  let severity: 'critical' | 'high' | 'medium' | 'low' = 'low'

  const whoisScore = whoisInfo?.riskScore ?? 0
  const hasSpoofing = spoofingMatches.length > 0
  const topSpoofSim = spoofingMatches[0]?.similarityScore ?? 0

  // Combine signals into severity
  if (hasSpoofing && whoisScore >= 4) {
    severity = 'critical'
  } else if (hasSpoofing || whoisScore >= 6) {
    severity = 'high'
  } else if (whoisScore >= 3) {
    severity = 'medium'
  }

  const flagged = severity !== 'low'

  if (hasSpoofing) {
    const best = spoofingMatches[0]
    evidence.push(
      `Domain "${d}" resembles "${best.legitimateDomain}" (${best.legitimateCompany}) — similarity ${Math.round(topSpoofSim * 100)}%`
    )
  }
  if (whoisInfo) {
    evidence.push(...whoisInfo.riskSignals)
  }

  return { domain: d, whois: whoisInfo, spoofingMatches, flagged, severity, evidence }
}

// ── Email DNS cache ───────────────────────────────────────────────────────────

const EMAIL_CACHE_TTL_HOURS = 48

interface EmailCacheRow {
  domain: string
  has_mx: boolean | null
  has_spf: boolean | null
  has_dmarc: boolean | null
  dkim_detected: boolean | null
  dkim_selector: string | null
  risk_signals: string[] | null
  queried_at: string
  error: string | null
}

async function getEmailCached(domain: string): Promise<EmailCacheRow | null> {
  const { rows } = await db.query<EmailCacheRow>(
    `SELECT * FROM domain_email_cache WHERE domain = $1
     AND queried_at > NOW() - INTERVAL '${EMAIL_CACHE_TTL_HOURS} hours'`,
    [domain]
  )
  return rows[0] ?? null
}

async function upsertEmailCache(domain: string, result: EmailDomainCheck): Promise<void> {
  await db.query(
    `INSERT INTO domain_email_cache
       (domain, has_mx, has_spf, has_dmarc, dkim_detected, dkim_selector, risk_signals, queried_at, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
     ON CONFLICT (domain) DO UPDATE SET
       has_mx        = EXCLUDED.has_mx,
       has_spf       = EXCLUDED.has_spf,
       has_dmarc     = EXCLUDED.has_dmarc,
       dkim_detected = EXCLUDED.dkim_detected,
       dkim_selector = EXCLUDED.dkim_selector,
       risk_signals  = EXCLUDED.risk_signals,
       queried_at    = EXCLUDED.queried_at,
       error         = EXCLUDED.error`,
    [
      domain,
      result.hasMx,
      result.hasSpf,
      result.hasDmarc,
      result.dkimDetected,
      result.dkimSelector,
      result.riskSignals,
      result.error,
    ]
  )
}

// ── Email DNS check ───────────────────────────────────────────────────────────

const DKIM_SELECTORS = ['google', 'mail', 's1', 's2', 'default', 'mimecast', 'selector1', 'selector2']

/**
 * Check email DNS hygiene: MX records, SPF, DMARC, DKIM selector probing.
 * Results cached 48h in domain_email_cache.
 * Never throws — returns error field on failure.
 *
 * IMPORTANT: Treat ENOTFOUND, ESERVFAIL, ETIMEOUT as "unknown" not "absent".
 * The absence of a DNS result must not be reported as "no MX records" — it may
 * be a resolver issue (VPN, firewall). Store the error code in the error field.
 */
export async function checkEmailDomain(domain: string): Promise<EmailDomainCheck> {
  const d = domain.toLowerCase().replace(/^www\./, '').trim()
  if (!d || d.length < 4) {
    return {
      domain: d,
      hasMx: false, hasSpf: false, hasDmarc: false,
      dkimDetected: false, dkimSelector: null,
      riskSignals: ['Invalid domain'], flagged: true, error: 'Invalid domain'
    }
  }

  // ── Cache check ─────────────────────────────────────────────────────────────
  try {
    const cached = await getEmailCached(d)
    if (cached) {
      return {
        domain: d,
        hasMx:         cached.has_mx         ?? false,
        hasSpf:        cached.has_spf         ?? false,
        hasDmarc:      cached.has_dmarc       ?? false,
        dkimDetected:  cached.dkim_detected   ?? false,
        dkimSelector:  cached.dkim_selector,
        riskSignals:   cached.risk_signals    ?? [],
        flagged:       !(cached.has_spf ?? false) || !(cached.has_dmarc ?? false),
        error:         cached.error,
      }
    }
  } catch {
    // Cache read failure is non-fatal — proceed with live DNS lookup
  }

  // ── Live DNS resolution ─────────────────────────────────────────────────────
  // Import here to avoid issues in environments where dns/promises is restricted
  const { resolveMx, resolveTxt } = await import('node:dns/promises')

  let hasMx = false
  let hasSpf = false
  let hasDmarc = false
  let dkimDetected = false
  let dkimSelector: string | null = null
  let topError: string | null = null

  // Parallel: MX + SPF TXT + DMARC TXT
  const [mxResult, txtResult, dmarcResult] = await Promise.allSettled([
    resolveMx(d),
    resolveTxt(d),
    resolveTxt(`_dmarc.${d}`),
  ])

  if (mxResult.status === 'fulfilled') {
    hasMx = mxResult.value.length > 0
  } else {
    // Distinguish "no records" (ENODATA/ENOTFOUND) from resolver failure (ESERVFAIL)
    const code = (mxResult.reason as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
    if (code !== 'ENODATA' && code !== 'ENOTFOUND') {
      // Resolver error — result is unknown, not "no MX"
      topError = `MX lookup: ${code}`
    }
    // ENODATA / ENOTFOUND = confirmed absence of MX records → hasMx stays false
  }

  if (txtResult.status === 'fulfilled') {
    const records = txtResult.value.flat()
    hasSpf = records.some((t) => t.startsWith('v=spf1'))
  } else {
    const code = (txtResult.reason as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
    if (code !== 'ENODATA' && code !== 'ENOTFOUND' && !topError) {
      topError = `TXT lookup: ${code}`
    }
  }

  if (dmarcResult.status === 'fulfilled') {
    const records = dmarcResult.value.flat()
    hasDmarc = records.some((t) => t.startsWith('v=DMARC1'))
  } else {
    const code = (dmarcResult.reason as NodeJS.ErrnoException)?.code ?? 'UNKNOWN'
    if (code !== 'ENODATA' && code !== 'ENOTFOUND' && !topError) {
      topError = `DMARC lookup: ${code}`
    }
  }

  // DKIM: probe common selectors sequentially (stop on first match)
  for (const sel of DKIM_SELECTORS) {
    try {
      const records = await resolveTxt(`${sel}._domainkey.${d}`)
      if (records.length > 0) {
        dkimDetected = true
        dkimSelector = sel
        break
      }
    } catch {
      // NXDOMAIN or any error → try next selector
    }
  }

  // ── Build risk signals ──────────────────────────────────────────────────────
  const riskSignals: string[] = []
  if (!hasMx) riskSignals.push('No MX records — domain cannot receive email')
  if (!hasSpf) riskSignals.push('No SPF record — email sender identity unverified')
  if (!hasDmarc) riskSignals.push('No DMARC record — no anti-spoofing policy')
  if (!dkimDetected) riskSignals.push('DKIM not detectable via selector probing — not confirmed absent')

  const result: EmailDomainCheck = {
    domain: d,
    hasMx,
    hasSpf,
    hasDmarc,
    dkimDetected,
    dkimSelector,
    riskSignals,
    flagged: !hasSpf || !hasDmarc,
    error: topError,
  }

  // ── Cache write (best-effort) ───────────────────────────────────────────────
  try {
    await upsertEmailCache(d, result)
  } catch {
    // Cache write failure is non-fatal
  }

  return result
}

import type { Metadata } from 'next'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import SearchBox from '@/components/search/SearchBox'
import SearchFiltersPanel from '@/components/search/SearchFiltersPanel'
import type { SearchResult } from '@/lib/types'
import { searchEntities, getBrowseEntities, searchSanctionsEntries, type BrowseRow, type SanctionHit, type BrowseResult } from '@/lib/server/repository'
import { checkDomain, type DomainCheckResult } from '@/lib/server/domain-check'

interface PageProps {
  searchParams: Promise<{ q?: string; type?: string; sort?: string }>
}

// Search results are dynamic, so ISR is disabled.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { q } = await searchParams
  const query = q?.trim() ?? ''
  if (!query) return { title: 'Browse Database — Energy Trade Inspection' }
  return {
    title: `"${query}" — Search Results`,
    description: `Sanction status and authenticity scores for counterparties matching "${query}".`,
    robots: { index: false, follow: false },
  }
}

// ── Domain detection ──────────────────────────────────────────────────────────

const DOMAIN_TLDS =
  /\.(com|net|org|io|co|biz|info|us|uk|eu|de|nl|fr|ae|sg|hk|cn|ru|az|kz|mx|br|au|no|ch|it|za|qa|ng|ca|jp|in|id|my|th|vn|pk|ly|me|ai|app|dev|tech|trade|energy)$/i

/**
 * Returns the domain string if the query looks like a domain name or email.
 * Returns null for ordinary company/person/vessel names.
 */
function detectDomainQuery(query: string): string | null {
  const q = query.trim()
  if (!q || q.includes(' ') || q.length < 4) return null

  // Email address: extract the domain part
  const emailMatch = q.match(/^[\w.+\-]+@([\w\-]+(?:\.[\w\-]+)+)$/i)
  if (emailMatch) return emailMatch[1].toLowerCase()

  // Domain name: no spaces, contains a dot, has a recognized TLD
  if (/^[\w\-.]+$/.test(q) && q.includes('.') && DOMAIN_TLDS.test(q)) {
    return q.toLowerCase()
  }
  return null
}

/**
 * Run domain check with a 3-second timeout.
 * WHOIS results are cached (48h TTL), so hits are fast after the first query.
 * If slow or error, returns null (card is simply not shown).
 */
async function runDomainCheck(domain: string): Promise<DomainCheckResult | null> {
  try {
    return await Promise.race([
      checkDomain(domain),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
    ])
  } catch {
    return null
  }
}

// ── Domain risk card ──────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
}

function DomainCheckCard({ result }: { result: DomainCheckResult }) {
  const color = SEVERITY_COLOR[result.severity] ?? '#22c55e'
  const hasSpoofing = result.spoofingMatches.length > 0
  const best = result.spoofingMatches[0]

  return (
    <div
      style={{
        padding: 'var(--space-4) var(--space-5)',
        backgroundColor: result.flagged ? `${color}12` : '#22c55e10',
        border: `1px solid ${result.flagged ? `${color}50` : '#22c55e40'}`,
        borderRadius: '8px',
        marginBottom: 'var(--space-5)',
      }}
      role="alert"
      aria-label={`Domain risk assessment: ${result.severity}`}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: result.flagged ? 'var(--space-3)' : 0 }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
          Domain check
        </span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>
          {result.domain}
        </span>
        <span style={{
          fontSize: '10px', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          backgroundColor: color, color: '#fff', borderRadius: '4px', padding: '2px 7px',
        }}>
          {result.severity}
        </span>
      </div>

      {/* Findings */}
      {result.flagged && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {/* Spoofing match shown first */}
          {hasSpoofing && best && (
            <li style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
              <span style={{ color, flexShrink: 0, fontWeight: 700, fontSize: '13px' }}>!</span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '18px' }}>
                Resembles{' '}
                <strong style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>
                  {best.legitimateDomain}
                </strong>
                {' '}({best.legitimateCompany}) — {Math.round(best.similarityScore * 100)}% similarity
              </span>
            </li>
          )}
          {/* WHOIS signals */}
          {result.evidence
            .filter((e) => !hasSpoofing || !e.startsWith('Domain'))
            .map((e, i) => (
              <li key={i} style={{ display: 'flex', gap: '8px', alignItems: 'baseline' }}>
                <span style={{ color, flexShrink: 0, fontSize: '13px' }}>•</span>
                <span style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: '18px' }}>{e}</span>
              </li>
            ))
          }
        </ul>
      )}

      {!result.flagged && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>
          No spoofing matches or WHOIS risk signals detected.
        </p>
      )}
    </div>
  )
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function search(query: string, type?: string): Promise<SearchResult[]> {
  if (!query || query.length < 2) return []
  try {
    return await searchEntities(query, type)
  } catch {
    return []
  }
}

async function searchSanctions(query: string): Promise<SanctionHit[]> {
  if (!query || query.length < 2) return []
  try {
    return await searchSanctionsEntries(query)
  } catch {
    return []
  }
}

async function getBrowseList(type?: string): Promise<BrowseResult> {
  try {
    return await getBrowseEntities(type)
  } catch {
    return { rows: [], total: 0 }
  }
}

// ── Sanctions hits section ────────────────────────────────────────────────────

function SanctionHitsSection({ hits, query }: { hits: SanctionHit[]; query: string }) {
  return (
    <div style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
      }}>
        <span style={{
          fontSize: '11px', fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: 'var(--status-listed)',
          backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: '4px',
          padding: '2px 8px',
        }}>
          Found in sanctions lists
        </span>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
          Not yet in entity database
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {hits.map((hit) => (
          <div key={hit.id} style={{
            padding: 'var(--space-4) var(--space-5)',
            backgroundColor: 'rgba(239,68,68,0.05)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: '8px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            gap: 'var(--space-4)',
          }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                {hit.name}
              </p>
              {hit.sanctions && (
                <p style={{ fontSize: '12px', color: 'var(--status-listed)', marginBottom: '2px' }}>
                  {hit.sanctions.split(';').slice(0, 2).join(' · ')}
                </p>
              )}
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {hit.schema}
                {hit.countries && ` · ${hit.countries.split(';').slice(0, 3).join(', ')}`}
                {hit.dataset && ` · ${hit.dataset.split(';')[0]}`}
              </p>
            </div>
            <Link
              href={`/screen?q=${encodeURIComponent(hit.name)}`}
              style={{
                flexShrink: 0, fontSize: '12px', fontWeight: 500,
                color: 'var(--accent-primary)', textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Screen entity →
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── No results state ──────────────────────────────────────────────────────────

function NoResultsState({ query, type }: { query: string; type: string }) {
  return (
    <div style={{
      padding: 'var(--space-10)',
      textAlign: 'center',
      backgroundColor: 'var(--bg-surface)',
      borderRadius: '10px',
      border: '1px solid var(--border-subtle)',
    }}>
      <p style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
        No entities found
      </p>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '20px', marginBottom: 'var(--space-5)' }}>
        Try a company name, registration number (e.g. 202012345A), or IMO number (e.g. 9412847).
      </p>
      <Link
        href={`/screen?q=${encodeURIComponent(query)}`}
        style={{
          display: 'inline-block',
          fontSize: '13px', fontWeight: 600,
          color: '#fff',
          backgroundColor: 'var(--accent-primary)',
          borderRadius: '8px',
          padding: '8px 20px',
          textDecoration: 'none',
        }}
      >
        Screen this entity →
      </Link>
      {type && type !== 'all' && (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Link
            href={`/search?q=${encodeURIComponent(query)}`}
            style={{ color: 'var(--accent-primary)', fontSize: '13px' }}
          >
            Search all entity types →
          </Link>
        </div>
      )}
    </div>
  )
}

const TYPE_LABELS: Record<string, string> = {
  all:      'All',
  company:  'Companies',
  vessel:   'Vessels',
  terminal: 'Terminals',
}

type TypeTab = 'all' | 'company' | 'vessel' | 'terminal'

function TypeFilterTabs({ current, query }: { current: string; query: string }) {
  const qParam = query ? `&q=${encodeURIComponent(query)}` : ''
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-6)',
        flexWrap: 'wrap',
      }}
      role="tablist"
      aria-label="Filter by entity type"
    >
      {(['all', 'company', 'vessel', 'terminal'] as TypeTab[]).map((t) => {
        const isActive = current === t || (t === 'all' && !current)
        const href = t === 'all'
          ? `/search${qParam ? `?${qParam.slice(1)}` : ''}`
          : `/search?type=${t}${qParam}`
        return (
          <Link
            key={t}
            href={href}
            role="tab"
            aria-selected={isActive}
            style={{
              fontSize: '13px',
              fontWeight: isActive ? 600 : 400,
              padding: '5px 14px',
              borderRadius: '6px',
              textDecoration: 'none',
              backgroundColor: isActive ? 'var(--accent-primary)' : 'var(--bg-elevated)',
              color: isActive ? '#fff' : 'var(--text-muted)',
              border: '1px solid',
              borderColor: isActive ? 'var(--accent-primary)' : 'var(--border-subtle)',
              transition: 'all 0.15s ease',
            }}
          >
            {TYPE_LABELS[t]}
          </Link>
        )
      })}
    </div>
  )
}

function normalizeToSearchResult(row: BrowseRow): SearchResult {
  return {
    id:               row.id,
    type:             row.entity_type,
    name:             row.name,
    country:          row.country,
    jurisdictionFlag: row.jurisdiction_flag,
    sanctionStatus:   row.sanction_status as SearchResult['sanctionStatus'],
    authenticityScore: row.authenticity_score,
    riskLevel:        row.risk_level as SearchResult['riskLevel'],
    slug:             row.slug ?? undefined,
    imo:              row.imo ?? undefined,
    vesselType:       row.vessel_type ?? undefined,
    registrationNumber: row.registration_number ?? undefined,
  }
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q, type } = await searchParams
  const query  = q?.trim() ?? ''
  const filter = type ?? 'all'

  const detectedDomain = detectDomainQuery(query)

  const hasQuery = query.length >= 2

  const [searchResults, browseResult, domainResult, sanctionHits] = await Promise.all([
    hasQuery ? search(query, type === 'all' ? undefined : type) : Promise.resolve([]),
    hasQuery ? Promise.resolve({ rows: [], total: 0 } as BrowseResult) : getBrowseList(type === 'all' ? undefined : type),
    detectedDomain ? runDomainCheck(detectedDomain) : Promise.resolve(null),
    hasQuery ? searchSanctions(query) : Promise.resolve([]),
  ])

  const items      = hasQuery ? searchResults : []
  const browseList = !hasQuery ? browseResult.rows : []
  const browseTotal = browseResult.total

  return (
    <>
      <Header />
      <main
        style={{
          maxWidth: 'var(--max-width)',
          margin: '0 auto',
          padding: 'var(--space-8) var(--space-4)',
        }}
      >
        {/* Search bar */}
        <div style={{ maxWidth: '640px', marginBottom: 'var(--space-6)' }}>
          <SearchBox />
        </div>

        {/* Type filter tabs */}
        <TypeFilterTabs current={filter} query={query} />

        {/* Domain check card — shown when query looks like a domain or email */}
        {domainResult && <DomainCheckCard result={domainResult} />}

        {hasQuery ? (
          /* ── Search results ── */
          <>
            {/* Sanctions fallback — shown when no entity results */}
            {items.length === 0 && sanctionHits.length > 0 && (
              <SanctionHitsSection hits={sanctionHits} query={query} />
            )}

            {items.length === 0 ? (
              <NoResultsState query={query} type={filter} />
            ) : (
              <SearchFiltersPanel results={items} query={query} entityType={filter} />
            )}
          </>
        ) : (
          /* ── Browse mode (no query) ── */
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: 'var(--space-5)' }}>
              Showing top {browseList.length} of{' '}
              <strong style={{ color: 'var(--text-secondary)' }}>
                {browseTotal.toLocaleString()}
              </strong>{' '}
              entities{type && type !== 'all' && ` · ${TYPE_LABELS[type]}`}
              {' '}— sorted by risk level · search above to find specific entities
            </p>
            <SearchFiltersPanel results={browseList.map(normalizeToSearchResult)} query="" entityType={filter} />
          </>
        )}
      </main>
    </>
  )
}



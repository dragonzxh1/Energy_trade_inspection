import type { Metadata } from 'next'
import Link from 'next/link'
import { getScoreTier } from '@/lib/utils'
import Header from '@/components/layout/Header'
import SanctionBadge from '@/components/entity/SanctionBadge'
import SearchBox from '@/components/search/SearchBox'
import type { SearchResult, RiskLevel } from '@/lib/types'
import { applyMigrations } from '@/lib/server/migrations'
import { searchEntities } from '@/lib/server/repository'
import { db } from '@/lib/server/db'

interface PageProps {
  searchParams: Promise<{ q?: string; type?: string }>
}

// Search results are dynamic — no ISR caching
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

async function search(query: string, type?: string): Promise<SearchResult[]> {
  if (!query || query.length < 2) return []
  try {
    await applyMigrations()
    return await searchEntities(query, type)
  } catch {
    return []
  }
}

interface BrowseRow {
  id: string
  entity_type: 'company' | 'vessel'
  name: string
  slug: string | null
  imo: string | null
  jurisdiction_flag: string
  country: string
  sanction_status: string
  authenticity_score: number
  risk_level: string
  registration_number: string | null
  vessel_type: string | null
}

async function getBrowseEntities(type?: string): Promise<BrowseRow[]> {
  try {
    await applyMigrations()
    const typeFilter = type === 'company' || type === 'vessel'
      ? `AND entity_type = '${type}'`
      : ''
    const { rows } = await db.query<BrowseRow>(`
      SELECT id, entity_type, name, slug, imo, jurisdiction_flag,
             country, sanction_status, authenticity_score, risk_level,
             registration_number,
             metadata_json->>'vesselType' AS vessel_type
      FROM entities
      WHERE 1=1 ${typeFilter}
      ORDER BY
        CASE sanction_status WHEN 'listed' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
        CASE risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        authenticity_score ASC
      LIMIT 30
    `)
    return rows
  } catch {
    return []
  }
}

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: 'var(--status-listed)',
  high:     '#f97316',
  medium:   '#eab308',
  low:      'var(--status-clear)',
}

const TYPE_LABELS: Record<string, string> = {
  all:     'All',
  company: 'Companies',
  vessel:  'Vessels',
}

function TypeFilterTabs({ current, query }: { current: string; query: string }) {
  const qParam = query ? `&q=${encodeURIComponent(query)}` : ''
  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-6)',
      }}
      role="tablist"
      aria-label="Filter by entity type"
    >
      {(['all', 'company', 'vessel'] as const).map((t) => {
        const isActive = current === t || (t === 'all' && !current)
        const href = t === 'all' ? `/search${qParam ? `?${qParam.slice(1)}` : ''}` : `/search?type=${t}${qParam}`
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

function EntityCard({ result }: { result: SearchResult | BrowseRow }) {
  const isBrowseRow = 'entity_type' in result
  const type       = isBrowseRow ? result.entity_type : result.type
  const sanctionStatus = isBrowseRow ? (result as BrowseRow).sanction_status as SearchResult['sanctionStatus'] : result.sanctionStatus
  const score      = isBrowseRow ? (result as BrowseRow).authenticity_score : result.authenticityScore
  const riskLevel  = isBrowseRow ? (result as BrowseRow).risk_level as RiskLevel : result.riskLevel
  const flag       = isBrowseRow ? (result as BrowseRow).jurisdiction_flag : result.jurisdictionFlag
  const vesselType = isBrowseRow ? (result as BrowseRow).vessel_type : result.vesselType
  const regNum     = isBrowseRow ? (result as BrowseRow).registration_number : result.registrationNumber
  const imo        = result.imo
  const slug       = result.slug

  const href = type === 'vessel' ? `/vessel/${imo}` : `/company/${slug}`
  const tier = getScoreTier(score)

  return (
    <li>
      <Link
        href={href}
        className={`search-result-card search-result-card--${sanctionStatus}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-5)',
          backgroundColor: 'var(--bg-surface)',
          borderRadius: '8px',
          borderWidth: '1px',
          borderStyle: 'solid',
          textDecoration: 'none',
          gap: 'var(--space-4)',
        }}
      >
        {/* Left: name + meta */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              marginBottom: '4px',
            }}
          >
            {/* Risk dot */}
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: RISK_COLOR[riskLevel] ?? 'var(--text-muted)',
                flexShrink: 0,
              }}
              title={`Risk: ${riskLevel}`}
            />
            <span
              style={{
                color: 'var(--text-primary)',
                fontSize: '14px',
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {result.name}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {/* Type pill */}
            <span
              style={{
                fontSize: '10px',
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                padding: '1px 6px',
              }}
            >
              {type === 'vessel' ? 'Vessel' : 'Company'}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
              {flag} {result.country}
            </span>
            {type === 'vessel' && vesselType && (
              <>
                <span style={{ color: 'var(--border-subtle)', fontSize: '12px' }}>·</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{vesselType}</span>
              </>
            )}
            {type === 'vessel' && imo && (
              <>
                <span style={{ color: 'var(--border-subtle)', fontSize: '12px' }}>·</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }} className="mono">
                  IMO {imo}
                </span>
              </>
            )}
            {type === 'company' && regNum && (
              <>
                <span style={{ color: 'var(--border-subtle)', fontSize: '12px' }}>·</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }} className="mono">
                  {regNum}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right: score + badge */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '6px',
          }}
        >
          <SanctionBadge status={sanctionStatus} size="sm" />
          <span
            style={{
              fontSize: '11px',
              color: 'var(--text-muted)',
            }}
          >
            Score{' '}
            <strong
              style={{
                color: score >= 70 ? 'var(--status-clear)' : score >= 40 ? '#eab308' : 'var(--status-listed)',
                fontWeight: 600,
              }}
            >
              {score}
            </strong>
            {' '}
            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{tier}</span>
          </span>
        </div>
      </Link>
    </li>
  )
}

export default async function SearchPage({ searchParams }: PageProps) {
  const { q, type } = await searchParams
  const query  = q?.trim() ?? ''
  const filter = type ?? 'all'

  const [searchResults, browseRows] = await Promise.all([
    query ? search(query, type === 'all' ? undefined : type) : Promise.resolve([]),
    query ? Promise.resolve([]) : getBrowseEntities(type === 'all' ? undefined : type),
  ])

  const hasQuery   = query.length >= 2
  const items      = hasQuery ? searchResults : []
  const browseList = !hasQuery ? browseRows : []

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

        {hasQuery ? (
          /* ── Search results ── */
          <>
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: '13px',
                marginBottom: 'var(--space-5)',
              }}
            >
              {items.length} result{items.length !== 1 ? 's' : ''} for{' '}
              <strong style={{ color: 'var(--text-secondary)' }}>&ldquo;{query}&rdquo;</strong>
              {type && type !== 'all' && (
                <span> · {TYPE_LABELS[type]}</span>
              )}
            </p>

            {items.length === 0 ? (
              <div
                style={{
                  padding: 'var(--space-10)',
                  textAlign: 'center',
                  backgroundColor: 'var(--bg-surface)',
                  borderRadius: '10px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <p style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
                  No entities found
                </p>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '20px' }}>
                  Try a company name, registration number (e.g. 202012345A), or IMO number (e.g. 9412847).
                </p>
                {type && type !== 'all' && (
                  <Link
                    href={`/search?q=${encodeURIComponent(query)}`}
                    style={{ display: 'inline-block', marginTop: 'var(--space-4)', color: 'var(--accent-primary)', fontSize: '13px' }}
                  >
                    Search all entity types →
                  </Link>
                )}
              </div>
            ) : (
              <ul
                role="list"
                style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
              >
                {items.map((result) => (
                  <EntityCard key={result.id} result={result} />
                ))}
              </ul>
            )}
          </>
        ) : (
          /* ── Browse mode (no query) ── */
          <>
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: '13px',
                marginBottom: 'var(--space-5)',
              }}
            >
              {browseList.length} entities in database
              {type && type !== 'all' && ` · ${TYPE_LABELS[type]}`}
              {' '}— sorted by risk level
            </p>

            <ul
              role="list"
              style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
            >
              {browseList.map((row) => (
                <EntityCard key={row.id} result={row as unknown as SearchResult} />
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  )
}

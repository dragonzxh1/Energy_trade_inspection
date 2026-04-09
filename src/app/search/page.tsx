import type { Metadata } from 'next'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import SearchBox from '@/components/search/SearchBox'
import SearchFiltersPanel from '@/components/search/SearchFiltersPanel'
import type { SearchResult } from '@/lib/types'
import { applyMigrations } from '@/lib/server/migrations'
import { searchEntities } from '@/lib/server/repository'
import { db } from '@/lib/server/db'

interface PageProps {
  searchParams: Promise<{ q?: string; type?: string; sort?: string }>
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
    const browseType = type === 'company' || type === 'vessel' || type === 'terminal'
      ? type
      : null
    const { rows } = await db.query<BrowseRow>(`
      SELECT id, entity_type, name, slug, imo, jurisdiction_flag,
             country, sanction_status, authenticity_score, risk_level,
             registration_number,
             metadata_json->>'vesselType' AS vessel_type
      FROM entities
      WHERE ($1::text IS NULL OR entity_type = $1)
      ORDER BY
        CASE sanction_status WHEN 'listed' THEN 0 WHEN 'unknown' THEN 1 ELSE 2 END,
        CASE risk_level WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        authenticity_score ASC
      LIMIT 30
    `, [browseType])
    return rows
  } catch {
    return []
  }
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
          items.length === 0 ? (
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
            <SearchFiltersPanel results={items} query={query} entityType={filter} />
          )
        ) : (
          /* ── Browse mode (no query) ── */
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: 'var(--space-5)' }}>
              {browseList.length} entities in database
              {type && type !== 'all' && ` · ${TYPE_LABELS[type]}`}
              {' '}— sorted by risk level
            </p>
            <SearchFiltersPanel results={browseList.map(normalizeToSearchResult)} query="" entityType={filter} />
          </>
        )}
      </main>
    </>
  )
}

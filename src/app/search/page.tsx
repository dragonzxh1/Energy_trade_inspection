import type { Metadata } from 'next'
import Link from 'next/link'
import { getScoreTier } from '@/lib/utils'
import Header from '@/components/layout/Header'
import SanctionBadge from '@/components/entity/SanctionBadge'
import SearchBox from '@/components/search/SearchBox'
import type { SearchResult } from '@/lib/types'
import { applyMigrations } from '@/lib/server/migrations'
import { searchEntities } from '@/lib/server/repository'

interface PageProps {
  searchParams: Promise<{ q?: string; type?: string }>
}

// Search results are dynamic — no ISR caching
export const dynamic = 'force-dynamic'

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const { q } = await searchParams
  const query = q?.trim() ?? ''
  if (!query) return { title: 'Search — Energy Trade Inspection' }
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

export default async function SearchPage({ searchParams }: PageProps) {
  const { q, type } = await searchParams
  const query = q?.trim() ?? ''
  const results = await search(query, type)

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
        {/* Search bar — pre-filled with current query */}
        <div style={{ maxWidth: '640px', marginBottom: 'var(--space-8)' }}>
          <SearchBox />
        </div>

        {query ? (
          <>
            <p
              style={{
                color: 'var(--text-muted)',
                fontSize: '13px',
                marginBottom: 'var(--space-6)',
              }}
            >
              {results.length} result{results.length !== 1 ? 's' : ''} for{' '}
              <strong style={{ color: 'var(--text-secondary)' }}>&ldquo;{query}&rdquo;</strong>
            </p>

            {results.length === 0 ? (
              <div
                style={{
                  padding: 'var(--space-8)',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                }}
              >
                <p style={{ fontSize: '16px', marginBottom: 'var(--space-3)' }}>
                  No entities found
                </p>
                <p style={{ fontSize: '14px' }}>
                  Try searching by company name, registration number, or IMO number.
                </p>
              </div>
            ) : (
              <ul
                role="list"
                style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
              >
                {results.map((result) => {
                  const href =
                    result.type === 'vessel'
                      ? `/vessel/${result.imo}`
                      : `/company/${result.slug}`
                  const tier = getScoreTier(result.authenticityScore)

                  return (
                    <li key={result.id}>
                      <Link
                        href={href}
                        className="search-result-card"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 'var(--space-4) var(--space-5)',
                          backgroundColor: 'var(--bg-surface)',
                          borderRadius: '8px',
                          border: '1px solid',
                          textDecoration: 'none',
                          gap: 'var(--space-4)',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)', marginBottom: '2px' }}>
                            <span
                              style={{
                                color: 'var(--text-primary)',
                                fontSize: '15px',
                                fontWeight: 500,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {result.name}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                              {result.jurisdictionFlag} {result.country}
                            </span>
                            <span style={{ color: 'var(--border-subtle)', fontSize: '12px' }}>·</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                              {result.type === 'vessel' ? `IMO ${result.imo}` : result.registrationNumber}
                            </span>
                            <span style={{ color: 'var(--border-subtle)', fontSize: '12px' }}>·</span>
                            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                              Score: {result.authenticityScore}
                            </span>
                          </div>
                        </div>

                        <div style={{ flexShrink: 0 }}>
                          <SanctionBadge status={result.sanctionStatus} size="sm" />
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
            Enter a company name, registration number, or IMO number to search.
          </p>
        )}
      </main>
    </>
  )
}

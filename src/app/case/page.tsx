import Link from 'next/link'
import { listSeoContent, countSeoContent, getSeoStats } from '@/lib/server/seo-repository'

export const revalidate = 3600

export const metadata = {
  title: 'Sanctions Enforcement Cases',
  description: 'Browse OFAC and DOJ sanctions enforcement cases in energy trade, shipping, and commodities. Risk intelligence by ETI Verify.',
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
}

export default async function CaseListPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams
  const year = params.year ? parseInt(params.year, 10) : undefined
  const riskType = params.risk_type
  const orderBy = params.order ?? 'amount_usd'
  const orderDir = (params.dir as 'ASC' | 'DESC') ?? 'DESC'
  const page = params.page ? parseInt(params.page, 10) : 1
  const perPage = 20

  const [cases, total, stats] = await Promise.all([
    listSeoContent({ type: 'case_study', published: true, year, risk_type: riskType, orderBy, orderDir, limit: perPage, offset: (page - 1) * perPage }),
    countSeoContent({ type: 'case_study', published: true, year, risk_type: riskType }),
    getSeoStats(),
  ])

  const totalPages = Math.ceil(total / perPage)

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
      <h1 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space-2)', fontSize: '24px', fontWeight: 600 }}>
        Sanctions Enforcement Cases
      </h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', marginBottom: 'var(--space-6)' }}>
        {stats.totalCases} cases from OFAC and DOJ spanning {Object.keys(stats.byYear).length} years. Total penalties: {formatCurrency(stats.totalAmount)}.
      </p>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        {Object.entries(stats.byYear).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, 6).map(([y, c]) => (
          <Link key={y} href={`/case?year=${y}`} style={{ textDecoration: 'none' }}>
            <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', padding: 'var(--space-3)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
              <p style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>{c}</p>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{y}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-4)', alignItems: 'center' }}>
        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Filter:</span>
        <Link href="/case" style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: !year && !riskType ? 'var(--accent-primary)' : 'var(--bg-elevated)', color: !year && !riskType ? 'var(--text-on-accent)' : 'var(--text-secondary)', borderRadius: '4px', textDecoration: 'none' }}>All</Link>
        {[2025, 2024, 2023, 2022, 2021, 2020, 2019].map((y) => (
          <Link key={y} href={`/case?year=${y}`} style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: year === y ? 'var(--accent-primary)' : 'var(--bg-elevated)', color: year === y ? 'var(--text-on-accent)' : 'var(--text-secondary)', borderRadius: '4px', textDecoration: 'none' }}>{y}</Link>
        ))}
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginLeft: 'var(--space-3)' }}>Sort:</span>
        <Link href={`/case?order=amount_usd&dir=DESC${year ? `&year=${year}` : ''}`} style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: orderBy === 'amount_usd' ? 'var(--accent-primary)' : 'var(--bg-elevated)', color: orderBy === 'amount_usd' ? 'var(--text-on-accent)' : 'var(--text-secondary)', borderRadius: '4px', textDecoration: 'none' }}>Amount</Link>
        <Link href={`/case?order=year&dir=DESC${year ? `&year=${year}` : ''}`} style={{ fontSize: '12px', padding: '4px 10px', backgroundColor: orderBy === 'year' ? 'var(--accent-primary)' : 'var(--bg-elevated)', color: orderBy === 'year' ? 'var(--text-on-accent)' : 'var(--text-secondary)', borderRadius: '4px', textDecoration: 'none' }}>Year</Link>
      </div>

      {/* Case cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {cases.map((c) => (
          <Link key={c.slug} href={`/case/${c.slug}`} style={{ textDecoration: 'none' }}>
            <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '10px', padding: 'var(--space-4)', border: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-elevated)', padding: '1px 8px', borderRadius: '4px' }}>{c.year}</span>
                  <span style={{ fontSize: '11px', color: 'var(--accent-amber)', backgroundColor: 'rgba(251,191,36,0.1)', padding: '1px 8px', borderRadius: '4px' }}>{c.source_kind}</span>
                </div>
                <h3 style={{ color: 'var(--text-primary)', fontSize: '15px', fontWeight: 500, marginBottom: 'var(--space-1)' }}>{c.title}</h3>
                <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
                  {c.risk_types.slice(0, 4).map((rt) => (
                    <span key={rt} style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{rt}</span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <p style={{ fontSize: '18px', fontWeight: 600, color: c.amount_usd ? 'var(--status-listed)' : 'var(--text-muted)' }}>
                  {formatCurrency(c.amount_usd)}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-6)' }}>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Link key={p} href={`/case?page=${p}${year ? `&year=${year}` : ''}`} style={{ padding: 'var(--space-2) var(--space-3)', backgroundColor: page === p ? 'var(--accent-primary)' : 'var(--bg-elevated)', color: page === p ? 'var(--text-on-accent)' : 'var(--text-secondary)', borderRadius: '6px', textDecoration: 'none', fontSize: '13px' }}>
              {p}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

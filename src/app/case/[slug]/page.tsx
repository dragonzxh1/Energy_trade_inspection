import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getSeoContentBySlug, incrementPageViews } from '@/lib/server/seo-repository'
import type { SeoContent } from '@/lib/server/seo-repository'
import fs from 'fs'
import path from 'path'

interface PageProps {
  params: Promise<{ slug: string }>
}

export const revalidate = 86400

interface RawSeed {
  slug: string
  title: string
  year: number
  entities: string[]
  industry_focus: string
  amount_usd: number | null
  source_kind: string
  source_urls: string[]
  verified_facts: string[]
  risk_types: string[]
  legal_disclaimer: string
}

function getSeedBySlug(slug: string): RawSeed | undefined {
  const seedPath = path.join(process.cwd(), 'data', 'seed-cases.json')
  const seeds = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as RawSeed[]
  return seeds.find((s) => s.slug === slug)
}

function seedToContent(seed: RawSeed): SeoContent {
  return {
    id: '',
    content_type: 'case_study',
    slug: seed.slug,
    title: seed.title,
    year: seed.year,
    verified_facts: seed.verified_facts.map((f, i) => ({ fact: f, source_index: i < seed.source_urls.length ? i : 0 })),
    source_urls: seed.source_urls,
    source_level: 'official',
    source_kind: seed.source_kind,
    risk_types: seed.risk_types,
    entities: seed.entities,
    industry_focus: seed.industry_focus,
    amount_usd: seed.amount_usd,
    legal_disclaimer: seed.legal_disclaimer,
    narrative: null,
    meta_description: null,
    meta_keywords: null,
    faq: null,
    structured_data: null,
    published: true,
    indexed_at: null,
    page_views: 0,
    created_at: new Date(),
    updated_at: new Date(),
  }
}

export async function generateStaticParams() {
  const seedPath = path.join(process.cwd(), 'data', 'seed-cases.json')
  const seeds = JSON.parse(fs.readFileSync(seedPath, 'utf8')) as { slug: string }[]
  return seeds.map((s) => ({ slug: s.slug }))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const seed = getSeedBySlug(slug)
  if (!seed) return { title: 'Case Not Found' }
  return {
    title: seed.title,
    description: `${seed.title} — OFAC sanctions case (${seed.year}). ETI Verify risk intelligence.`,
  }
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return 'Not disclosed'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
}

function KeyFactCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '10px', padding: 'var(--space-4)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 'var(--space-2)' }}>{label}</p>
      <p style={{ color: highlight ? 'var(--status-listed)' : 'var(--text-primary)', fontSize: highlight ? '24px' : '16px', fontWeight: 600 }}>{value}</p>
    </div>
  )
}

function RiskTag({ tag }: { tag: string }) {
  return (
    <Link href={`/case?risk_type=${encodeURIComponent(tag)}`} style={{ display: 'inline-block', padding: '4px 12px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '20px', fontSize: '12px', color: 'var(--text-secondary)', textDecoration: 'none', marginRight: '8px', marginBottom: '8px' }}>
      {tag}
    </Link>
  )
}

export default async function CasePage({ params }: PageProps) {
  const { slug } = await params
  let content: SeoContent | null = null

  try {
    content = await getSeoContentBySlug(slug)
  } catch {
    // DB unavailable at build time — fall through to seed JSON
  }

  // Fallback to seed JSON if not yet in DB (build time or pre-seed)
  if (!content) {
    const seed = getSeedBySlug(slug)
    if (!seed) notFound()
    content = seedToContent(seed)
  }

  if (!content.published) notFound()

  // Fire-and-forget page view increment
  try {
    incrementPageViews(slug).catch(() => {})
  } catch {
    // ignore
  }

  const hasDetailedFacts = content.verified_facts.length > 1 || content.verified_facts[0]?.fact.length > 150

  return (
    <>
      {content.structured_data && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(content.structured_data) }} />
      )}

      <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
        {/* Breadcrumb */}
        <nav style={{ marginBottom: 'var(--space-4)', fontSize: '12px', color: 'var(--text-muted)' }}>
          <Link href="/" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>Home</Link>
          {' / '}
          <Link href="/case" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>Cases</Link>
          {' / '}
          <span style={{ color: 'var(--text-secondary)' }}>{content.title}</span>
        </nav>

        {/* Hero */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', alignItems: 'center' }}>
            {content.year && <span style={{ fontSize: '12px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-elevated)', padding: '2px 10px', borderRadius: '4px' }}>{content.year}</span>}
            {content.source_kind && <span style={{ fontSize: '12px', color: 'var(--accent-amber)', backgroundColor: 'rgba(251,191,36,0.1)', padding: '2px 10px', borderRadius: '4px' }}>{content.source_kind}</span>}
            {content.industry_focus && <span style={{ fontSize: '12px', color: 'var(--accent-primary)', backgroundColor: 'rgba(59,130,246,0.1)', padding: '2px 10px', borderRadius: '4px' }}>{content.industry_focus}</span>}
          </div>
          <h1 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space-3)', fontSize: '28px', fontWeight: 600 }}>{content.title}</h1>
          {content.narrative && <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '24px', maxWidth: '700px' }}>{content.narrative}</p>}
        </div>

        {/* Key Facts */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
          <KeyFactCard label="Civil Penalty" value={formatCurrency(content.amount_usd)} highlight />
          <KeyFactCard label="Year" value={String(content.year ?? '—')} />
          <KeyFactCard label="Source" value={content.source_kind} />
          <KeyFactCard label="Entities" value={content.entities.length.toString()} />
        </div>

        {/* Verified Facts */}
        {hasDetailedFacts && (
          <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '10px', padding: 'var(--space-5)', border: '1px solid var(--border-subtle)', marginBottom: 'var(--space-6)' }}>
            <h2 style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-4)' }}>Verified Facts</h2>
            <ol style={{ paddingLeft: 'var(--space-5)', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '22px' }}>
              {content.verified_facts.map((fact, i) => (
                <li key={i} style={{ marginBottom: 'var(--space-2)' }}>
                  {fact.fact}
                  {content.source_urls[fact.source_index ?? 0] && (
                    <a href={content.source_urls[fact.source_index ?? 0]} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', fontSize: '11px', marginLeft: '8px', textDecoration: 'none' }}>[Source]</a>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Risk Types */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>Risk Categories</h2>
          <div>{content.risk_types.map((tag) => <RiskTag key={tag} tag={tag} />)}</div>
        </div>

        {/* Entities */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>Involved Entities</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {content.entities.map((entity) => (
              <span key={entity} style={{ display: 'inline-block', padding: 'var(--space-2) var(--space-3)', backgroundColor: 'var(--bg-elevated)', borderRadius: '6px', fontSize: '13px', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}>{entity}</span>
            ))}
          </div>
        </div>

        {/* FAQ */}
        {content.faq && content.faq.length > 0 && (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-4)' }}>Frequently Asked Questions</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {content.faq.map((f, i) => (
                <details key={i} style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', border: '1px solid var(--border-subtle)', padding: 'var(--space-3) var(--space-4)' }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500 }}>{f.question}</summary>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '22px', marginTop: 'var(--space-3)', paddingLeft: 'var(--space-2)' }}>{f.answer}</p>
                </details>
              ))}
            </div>
          </div>
        )}

        {/* CTA */}
        <div style={{ backgroundColor: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: '10px', padding: 'var(--space-5)', marginBottom: 'var(--space-6)', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: 500, marginBottom: 'var(--space-3)' }}>Screen your counterparties against sanctions and trade risk</p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/screen" style={{ display: 'inline-block', backgroundColor: 'var(--accent-primary)', color: 'var(--text-on-accent)', padding: 'var(--space-3) var(--space-5)', borderRadius: '8px', fontSize: '14px', fontWeight: 500, textDecoration: 'none' }}>Screen a Counterparty</Link>
            <Link href="/trade" style={{ display: 'inline-block', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-primary)', padding: 'var(--space-3) var(--space-5)', borderRadius: '8px', fontSize: '14px', fontWeight: 500, textDecoration: 'none', border: '1px solid var(--border-subtle)' }}>Run Trade Check</Link>
          </div>
        </div>

        {/* Disclaimer */}
        <p style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '18px', textAlign: 'center' }}>{content.legal_disclaimer}</p>
      </div>
    </>
  )
}

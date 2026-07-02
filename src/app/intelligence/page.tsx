import type { Metadata } from 'next'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import IntelligenceCard from '@/components/intelligence/IntelligenceCard'
import {
  formatContentSubtypeLabel,
  INTELLIGENCE_COMMODITIES,
  type IntelligenceCommoditySlug,
} from '@/lib/intelligence'
import { countSeoContent, listPublishedIntelligenceContent } from '@/lib/server/seo-repository'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Market Intelligence',
  description:
    'Energy market intelligence for crude, diesel, LNG, shipping, and sanctions. Structured for traders and compliance teams.',
}

interface PageProps {
  searchParams: Promise<{ commodity?: string; subtype?: string; region?: string }>
}

export default async function IntelligencePage({ searchParams }: PageProps) {
  const params = await searchParams
  const commodity = INTELLIGENCE_COMMODITIES.find((item) => item.slug === params.commodity)?.slug as IntelligenceCommoditySlug | undefined
  const subtype = params.subtype?.trim() || undefined
  const region = params.region?.trim() || undefined

  const [items, total] = await Promise.all([
    listPublishedIntelligenceContent({
      commodity,
      content_subtype: subtype,
      region,
      limit: 24,
    }),
    countSeoContent({
      types: ['market_brief', 'commodity_update', 'intelligence_article'],
      published: true,
      internal_only: false,
      commodity,
      content_subtype: subtype,
      region,
    }),
  ])

  const featuredCommodity = commodity
    ? INTELLIGENCE_COMMODITIES.find((item) => item.slug === commodity) ?? null
    : null

  return (
    <>
      <Header />
      <main style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-8) var(--space-4) var(--space-12)' }}>
        <section style={{ marginBottom: 'var(--space-8)' }}>
          <p style={{ color: 'var(--brand-400)', fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>
            Intelligence Feed
          </p>
          <h1 style={{ color: 'var(--text-on-accent)', fontSize: '34px', fontWeight: 600, marginBottom: 'var(--space-3)', letterSpacing: '-0.02em' }}>
            Energy market intelligence, organized by commodity.
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: '24px', maxWidth: '760px' }}>
            ETI ingests source documents, classifies them into a structured knowledge base, and turns them into analyst-friendly briefings for traders and compliance teams.
          </p>
        </section>

        <section style={{ marginBottom: 'var(--space-8)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <Link
              href="/intelligence"
              style={{
                textDecoration: 'none',
                borderRadius: '999px',
                padding: '8px 14px',
                fontSize: '12px',
                backgroundColor: !commodity ? 'var(--brand-400)' : 'var(--bg-elevated)',
                color: !commodity ? 'var(--text-on-accent)' : 'var(--text-secondary)',
              }}
            >
              All commodities
            </Link>
            {INTELLIGENCE_COMMODITIES.map((item) => (
              <Link
                key={item.slug}
                href={`/intelligence/${item.slug}`}
                style={{
                  textDecoration: 'none',
                  borderRadius: '999px',
                  padding: '8px 14px',
                  fontSize: '12px',
                  backgroundColor: commodity === item.slug ? item.accent : 'var(--bg-elevated)',
                  color: commodity === item.slug ? 'var(--text-on-accent)' : item.accent,
                }}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 'var(--space-6)', alignItems: 'start' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ color: 'var(--text-primary)', fontSize: '22px', fontWeight: 600 }}>
                  {featuredCommodity ? featuredCommodity.label : 'Latest intelligence'}
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                  {total} published item{total === 1 ? '' : 's'}
                  {subtype && ` · ${formatContentSubtypeLabel(subtype)}`}
                  {region && ` · ${region}`}
                </p>
              </div>
            </div>

            {items.length === 0 ? (
              <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: 'var(--space-8)' }}>
                <p style={{ color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
                  No intelligence articles published yet
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '22px' }}>
                  Once new Telegram source files are ingested and reviewed, they will appear here grouped by commodity and region.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
                {items.map((item) => {
                  const itemCommodity = item.commodity ?? 'sanctions-compliance'
                  return (
                    <IntelligenceCard
                      key={item.id}
                      item={item}
                      href={`/intelligence/${itemCommodity}/${item.slug}`}
                    />
                  )
                })}
              </div>
            )}
          </div>

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: 'var(--space-5)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
                Channels
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Link href="/intelligence?subtype=daily_briefing" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '13px' }}>Daily briefings</Link>
                <Link href="/intelligence?subtype=shipment_update" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '13px' }}>Shipment updates</Link>
                <Link href="/intelligence?subtype=pricing_signal" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '13px' }}>Pricing signals</Link>
                <Link href="/case" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '13px' }}>Sanctions cases</Link>
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: 'var(--space-5)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
                Workflow
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '22px' }}>
                Telegram attachments flow into a raw ingestion queue, then Dify drafts an English web article and a Chinese WeChat long-form draft for human review before publication.
              </p>
            </div>
          </aside>
        </section>
      </main>
    </>
  )
}

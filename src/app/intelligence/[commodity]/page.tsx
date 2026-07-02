import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Header from '@/components/layout/Header'
import IntelligenceCard from '@/components/intelligence/IntelligenceCard'
import { getCommodityMeta, INTELLIGENCE_COMMODITIES } from '@/lib/intelligence'
import { getPublishedIntelligenceByCommodity } from '@/lib/server/seo-repository'

interface PageProps {
  params: Promise<{ commodity: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { commodity } = await params
  const meta = getCommodityMeta(commodity)
  if (!meta) return { title: 'Commodity intelligence' }
  return {
    title: `${meta.label} Intelligence`,
    description: `Latest ${meta.label.toLowerCase()} market intelligence, shipment updates, and trader-focused risk analysis.`,
  }
}

export async function generateStaticParams() {
  return INTELLIGENCE_COMMODITIES.map((commodity) => ({ commodity: commodity.slug }))
}

export default async function CommodityIntelligencePage({ params }: PageProps) {
  const { commodity } = await params
  const meta = getCommodityMeta(commodity)
  if (!meta) notFound()

  const items = await getPublishedIntelligenceByCommodity(meta.slug)

  return (
    <>
      <Header />
      <main style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-8) var(--space-4) var(--space-12)' }}>
        <section style={{ marginBottom: 'var(--space-8)' }}>
          <p style={{ color: meta.accent, fontSize: '12px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>
            {meta.shortLabel}
          </p>
          <h1 style={{ color: 'var(--text-on-accent)', fontSize: '34px', fontWeight: 600, marginBottom: 'var(--space-3)', letterSpacing: '-0.02em' }}>
            {meta.label} intelligence hub
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: '24px', maxWidth: '760px' }}>
            Curated source-file intelligence for {meta.label.toLowerCase()}, normalized into trader briefings, risk cues, and structured summaries for compliance review.
          </p>
        </section>

        {items.length === 0 ? (
          <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: 'var(--space-8)' }}>
            <p style={{ color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600, marginBottom: 'var(--space-2)' }}>
              No published {meta.label.toLowerCase()} intelligence yet
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '22px' }}>
              New items will appear here once Telegram source documents are parsed, classified into {meta.label}, and approved for publication.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            {items.map((item) => (
              <IntelligenceCard key={item.id} item={item} href={`/intelligence/${meta.slug}/${item.slug}`} />
            ))}
          </div>
        )}
      </main>
    </>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Header from '@/components/layout/Header'
import { formatContentSubtypeLabel, formatContentTypeLabel, getCommodityMeta } from '@/lib/intelligence'
import { getSeoContentBySlug } from '@/lib/server/seo-repository'

interface PageProps {
  params: Promise<{ commodity: string; slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const content = await getSeoContentBySlug(slug)
  if (!content) return { title: 'Intelligence not found' }
  return {
    title: content.title,
    description: content.meta_description ?? content.why_it_matters ?? 'Energy market intelligence by ETI Verify.',
  }
}

function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC'
}

export default async function IntelligenceDetailPage({ params }: PageProps) {
  const { commodity, slug } = await params
  const content = await getSeoContentBySlug(slug)
  const commodityMeta = getCommodityMeta(commodity)

  if (!content || !content.published || content.internal_only) notFound()
  if (!commodityMeta || content.commodity !== commodityMeta.slug) notFound()

  return (
    <>
      <Header />
      <main style={{ maxWidth: '980px', margin: '0 auto', padding: 'var(--space-8) var(--space-4) var(--space-12)' }}>
        <nav style={{ marginBottom: 'var(--space-4)', fontSize: '12px', color: 'var(--text-muted)' }}>
          <Link href="/" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>Home</Link>
          {' / '}
          <Link href="/intelligence" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>Intelligence</Link>
          {' / '}
          <Link href={`/intelligence/${commodityMeta.slug}`} style={{ color: commodityMeta.accent, textDecoration: 'none' }}>{commodityMeta.label}</Link>
        </nav>

        <section style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontSize: '11px', color: commodityMeta.accent, backgroundColor: `${commodityMeta.accent}18`, padding: '3px 10px', borderRadius: '999px' }}>
              {commodityMeta.label}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--brand-400)', backgroundColor: 'rgba(56,189,248,0.12)', padding: '3px 10px', borderRadius: '999px' }}>
              {formatContentTypeLabel(content.content_type)}
            </span>
            {content.content_subtype && (
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-elevated)', padding: '3px 10px', borderRadius: '999px' }}>
                {formatContentSubtypeLabel(content.content_subtype)}
              </span>
            )}
            {content.region && (
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-elevated)', padding: '3px 10px', borderRadius: '999px' }}>
                {content.region}
              </span>
            )}
          </div>

          <h1 style={{ color: 'var(--text-on-accent)', fontSize: '36px', fontWeight: 600, lineHeight: 1.2, marginBottom: 'var(--space-3)' }}>
            {content.title}
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '15px', lineHeight: '24px', maxWidth: '800px' }}>
            {content.meta_description ?? content.narrative ?? 'Structured intelligence extracted from source files and reviewed for publishing.'}
          </p>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 'var(--space-6)', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: 'var(--space-5)' }}>
              <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Why it matters</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '24px' }}>
                {content.why_it_matters ?? 'This item has been normalized into a trading and compliance summary for ETI readers.'}
              </p>
            </div>

            <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: 'var(--space-5)' }}>
              <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Summary</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '24px', whiteSpace: 'pre-wrap' }}>
                {content.narrative ?? content.language_variants?.website_en?.article ?? content.language_variants?.website_en?.summary ?? 'Narrative summary pending.'}
              </p>
            </div>

            {content.key_facts && content.key_facts.length > 0 && (
              <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: 'var(--space-5)' }}>
                <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Key facts</h2>
                <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '24px' }}>
                  {content.key_facts.map((fact) => <li key={fact}>{fact}</li>)}
                </ul>
              </div>
            )}

            {content.verified_facts.length > 0 && (
              <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: 'var(--space-5)' }}>
                <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Extracted facts</h2>
                <ol style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '24px' }}>
                  {content.verified_facts.map((fact, index) => (
                    <li key={`${fact.fact}-${index}`}>
                      {fact.fact}
                      {content.source_urls[fact.source_index ?? 0] && (
                        <a
                          href={content.source_urls[fact.source_index ?? 0]}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ marginLeft: '8px', color: 'var(--accent-primary)', textDecoration: 'none', fontSize: '12px' }}
                        >
                          Source
                        </a>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div style={{ backgroundColor: 'rgba(56,189,248,0.08)', border: '1px solid rgba(56,189,248,0.24)', borderRadius: '14px', padding: 'var(--space-5)' }}>
              <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Use ETI on this signal</h2>
              <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <Link href="/search" className="btn-primary" style={{ textDecoration: 'none', padding: '10px 18px', borderRadius: '10px' }}>Search counterparties</Link>
                <Link href="/screen" style={{ textDecoration: 'none', padding: '10px 18px', borderRadius: '10px', border: '1px solid var(--border-solid)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-elevated)' }}>Screen a document</Link>
                <Link href="/trade" style={{ textDecoration: 'none', padding: '10px 18px', borderRadius: '10px', border: '1px solid var(--border-solid)', color: 'var(--text-primary)', backgroundColor: 'var(--bg-elevated)' }}>Run trade check</Link>
              </div>
            </div>
          </div>

          <aside style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: 'var(--space-5)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
                Source document
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                <span>File: {content.source_file_name ?? content.source_document_json?.source_file_name ?? 'Unknown'}</span>
                <span>Date: {formatTimestamp(content.source_published_at ?? content.source_document_json?.source_date)}</span>
                <span>Channel: {content.source_channel ?? 'Telegram feed'}</span>
                <span>Confidence: {content.parser_confidence !== null ? `${Math.round(content.parser_confidence * 100)}%` : 'Pending review'}</span>
                <span>Review: {content.review_status}</span>
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: 'var(--space-5)' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
                Risk & topic tags
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {content.risk_types.map((tag) => (
                  <span key={tag} style={{ fontSize: '11px', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-elevated)', padding: '3px 8px', borderRadius: '999px' }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {content.language_variants?.wechat_zh && (
              <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '14px', padding: 'var(--space-5)' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
                  WeChat draft readiness
                </p>
                <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '22px' }}>
                  A Chinese long-form draft is available for manual WeChat publishing after editorial review.
                </p>
              </div>
            )}
          </aside>
        </section>
      </main>
    </>
  )
}

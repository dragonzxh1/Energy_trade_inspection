import Link from 'next/link'
import { formatContentSubtypeLabel, formatContentTypeLabel, getCommodityMeta } from '@/lib/intelligence'
import type { SeoContent } from '@/lib/server/seo-repository'

interface IntelligenceCardProps {
  item: SeoContent
  href: string
}

function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return 'Unknown date'
  return new Date(value).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export default function IntelligenceCard({ item, href }: IntelligenceCardProps) {
  const commodity = getCommodityMeta(item.commodity)
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '14px',
        padding: 'var(--space-5)',
        textDecoration: 'none',
      }}
      className="entity-card"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {commodity && (
            <span style={{ fontSize: '11px', fontWeight: 700, color: commodity.accent }}>
              {commodity.shortLabel}
            </span>
          )}
          <span style={{ fontSize: '11px', color: 'var(--brand-400)' }}>{formatContentTypeLabel(item.content_type)}</span>
          {item.content_subtype && (
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {formatContentSubtypeLabel(item.content_subtype)}
            </span>
          )}
        </div>
        <span style={{ color: 'var(--text-faint)', fontSize: '12px', whiteSpace: 'nowrap' }}>
          {formatTimestamp(item.source_published_at ?? item.updated_at)}
        </span>
      </div>

      <h3 style={{ color: 'var(--text-primary)', fontSize: '17px', lineHeight: 1.4, fontWeight: 600, marginBottom: 'var(--space-2)' }}>
        {item.title}
      </h3>

      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '22px', marginBottom: 'var(--space-3)' }}>
        {item.meta_description ?? item.narrative ?? item.why_it_matters ?? 'Structured market intelligence summary.'}
      </p>

      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        {commodity && (
          <span style={{ fontSize: '11px', color: commodity.accent, backgroundColor: `${commodity.accent}18`, padding: '2px 8px', borderRadius: '999px' }}>
            {commodity.label}
          </span>
        )}
        {item.region && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', backgroundColor: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: '999px' }}>
            {item.region}
          </span>
        )}
        {item.risk_types.slice(0, 3).map((tag) => (
          <span key={tag} style={{ fontSize: '11px', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: '999px' }}>
            {tag}
          </span>
        ))}
      </div>

      <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
        Why it matters: {item.why_it_matters ?? 'Signals are normalized for trading and compliance teams.'}
      </div>
    </Link>
  )
}

import Link from 'next/link'
import { formatContentSubtypeLabel, formatContentTypeLabel, getCommodityMeta } from '@/lib/intelligence'
import type { AdminContentOpsSnapshot, ContentIngestionItem, SeoContent } from '@/lib/server/seo-repository'

interface ContentOpsPanelProps {
  snapshot: AdminContentOpsSnapshot
}

function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC'
}

function statusColor(status: string): string {
  if (status === 'published' || status === 'distributed') return 'var(--status-clear)'
  if (status === 'reviewed' || status === 'review') return 'var(--brand-400)'
  if (status === 'failed' || status === 'rejected') return 'var(--status-listed)'
  return 'var(--accent-amber)'
}

function QueueTable({ items, kind }: { items: ContentIngestionItem[]; kind: string }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-solid)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border-subtle)' }}>
        <h3 style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: 600 }}>{kind}</h3>
      </div>
      {items.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', padding: 'var(--space-5)' }}>
          No items in this queue yet.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['File', 'Commodity', 'Status', 'Confidence', 'Message Time'].map((label) => (
                  <th
                    key={label}
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '11px',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      textAlign: 'left',
                      padding: 'var(--space-3) var(--space-4)',
                      backgroundColor: 'var(--bg-elevated)',
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const commodity = getCommodityMeta(item.commodity)
                return (
                  <tr key={item.id} style={{ borderTop: index === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <div style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500 }}>{item.file_name}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{item.source_channel} · {item.media_type}</div>
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: commodity?.accent ?? 'var(--text-secondary)', fontSize: '13px' }}>
                      {commodity?.label ?? item.commodity ?? 'Unclassified'}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: statusColor(item.processing_status), fontSize: '12px', fontWeight: 600 }}>
                      {item.processing_status}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--text-secondary)', fontSize: '13px' }}>
                      {item.parser_confidence !== null ? `${Math.round(item.parser_confidence * 100)}%` : '—'}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--text-muted)', fontSize: '12px' }}>
                      {formatTimestamp(item.message_timestamp)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ContentTable({ items, title }: { items: SeoContent[]; title: string }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-solid)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border-subtle)' }}>
        <h3 style={{ color: 'var(--text-primary)', fontSize: '16px', fontWeight: 600 }}>{title}</h3>
      </div>
      {items.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', padding: 'var(--space-5)' }}>
          No content found.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((item, index) => {
            const commodity = getCommodityMeta(item.commodity)
            const detailPath = commodity ? `/intelligence/${commodity.slug}/${item.slug}` : `/case/${item.slug}`
            return (
              <div
                key={item.id}
                style={{
                  padding: 'var(--space-4)',
                  borderTop: index === 0 ? 'none' : '1px solid var(--border-subtle)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--space-4)',
                  alignItems: 'flex-start',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: 'var(--brand-400)' }}>{formatContentTypeLabel(item.content_type)}</span>
                    {commodity && <span style={{ fontSize: '11px', color: commodity.accent }}>{commodity.label}</span>}
                    {item.content_subtype && (
                      <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {formatContentSubtypeLabel(item.content_subtype)}
                      </span>
                    )}
                  </div>
                  <Link href={detailPath} style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 600, fontSize: '14px' }}>
                    {item.title}
                  </Link>
                  <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '6px' }}>
                    Review: <span style={{ color: statusColor(item.review_status) }}>{item.review_status}</span>
                    {' · '}
                    Distribution: <span style={{ color: statusColor(item.distribution_status) }}>{item.distribution_status}</span>
                    {' · '}
                    Source: {item.source_channel ?? item.source_kind}
                  </p>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                  {formatTimestamp(item.updated_at)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function ContentOpsPanel({ snapshot }: ContentOpsPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
        <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-solid)', borderRadius: '12px', padding: 'var(--space-4)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Published Intelligence</p>
          <p style={{ color: 'var(--text-primary)', fontSize: '26px', fontWeight: 700 }}>{snapshot.stats.totalPublished}</p>
        </div>
        <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-solid)', borderRadius: '12px', padding: 'var(--space-4)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Draft Articles</p>
          <p style={{ color: 'var(--text-primary)', fontSize: '26px', fontWeight: 700 }}>{snapshot.stats.totalDrafts}</p>
        </div>
        <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-solid)', borderRadius: '12px', padding: 'var(--space-4)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Commodities</p>
          <p style={{ color: 'var(--text-primary)', fontSize: '26px', fontWeight: 700 }}>{snapshot.stats.commodityCounts.length}</p>
        </div>
      </div>

      <QueueTable items={snapshot.ingestionQueue} kind="Raw Ingestion Queue" />
      <ContentTable items={snapshot.parsedKnowledgeEntries} title="Parsed Knowledge Entries" />
      <ContentTable items={snapshot.draftArticles} title="Draft Articles" />
      <ContentTable items={snapshot.reviewQueue} title="Review & Publish Queue" />
    </div>
  )
}

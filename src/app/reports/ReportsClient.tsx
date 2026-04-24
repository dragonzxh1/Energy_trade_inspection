'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { TradeSessionRow, ScreeningSessionRow } from '@/lib/server/report-history'

// ── Constants ─────────────────────────────────────────────────────────────────

const RISK_COLOR: Record<string, string> = {
  critical: 'var(--status-listed)',
  high:     'var(--risk-high)',
  medium:   'var(--accent-amber)',
  low:      'var(--status-clear)',
}

const RISK_LABEL: Record<string, string> = {
  critical: 'CRITICAL',
  high:     'HIGH',
  medium:   'MEDIUM',
  low:      'LOW',
}

const secondaryBtnStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--text-muted)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '7px',
  padding: '6px 14px',
  fontSize: '13px',
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
  transition: 'all 0.12s ease',
  textDecoration: 'none',
  display: 'inline-block',
  lineHeight: 1,
}

const dangerBtnStyle: React.CSSProperties = {
  ...secondaryBtnStyle,
  color: 'var(--status-listed)',
  border: '1px solid color-mix(in srgb, var(--status-listed) 40%, transparent)',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RiskBadge({ risk }: { risk: string }) {
  const color = RISK_COLOR[risk] ?? 'var(--text-muted)'
  const label = RISK_LABEL[risk] ?? risk.toUpperCase()
  return (
    <span
      style={{
        fontSize:        '11px',
        fontWeight:      600,
        letterSpacing:   '0.04em',
        textTransform:   'uppercase',
        color,
        backgroundColor: 'color-mix(in srgb, ' + color + ' 10%, transparent)',
        border:          '1px solid color-mix(in srgb, ' + color + ' 25%, transparent)',
        borderRadius:    '4px',
        padding:         '2px 7px',
        flexShrink:      0,
      }}
    >
      {label}
    </span>
  )
}

function RowShell({ children }: { children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display:         'flex',
        alignItems:      'center',
        gap:             '16px',
        padding:         '12px 16px',
        backgroundColor: hovered ? 'var(--bg-elevated)' : 'var(--bg-surface)',
        border:          '1px solid var(--border-subtle)',
        borderTop:       '1px solid var(--border-default)',
        borderRadius:    '10px',
        boxShadow:       '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
        transition:      'background 0.1s ease',
        cursor:          'default',
      }}
    >
      {children}
    </div>
  )
}

// ── Delete confirm inline ─────────────────────────────────────────────────────

function DeleteConfirm({
  onConfirm,
  onCancel,
  pending,
}: {
  onConfirm: () => void
  onCancel:  () => void
  pending:   boolean
}) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
      <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
        {pending ? 'Deleting…' : 'Delete?'}
      </span>
      {!pending && (
        <>
          <button type="button" onClick={onConfirm} style={dangerBtnStyle}>Yes</button>
          <button type="button" onClick={onCancel} style={secondaryBtnStyle}>No</button>
        </>
      )}
    </span>
  )
}

// ── Trade row ─────────────────────────────────────────────────────────────────

function TradeRow({
  row,
  onDelete,
}: {
  row:      TradeSessionRow
  onDelete: (id: string) => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition]  = useTransition()
  const input = row.input_json

  function handleConfirm() {
    startTransition(async () => {
      await onDelete(row.id)
    })
  }

  return (
    <RowShell>
      <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0, minWidth: '90px' }}>
        {formatDate(row.created_at)}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
          {input.seller}
        </span>
        {input.vessel && (
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {' · '}{input.vessel}
          </span>
        )}
        {(input.loadingPort || input.commodity) && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block' }}>
            {[input.loadingPort, input.commodity].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>

      {row.flag_count > 0 && (
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>
          {row.flag_count} flag{row.flag_count !== 1 ? 's' : ''}
        </span>
      )}

      <RiskBadge risk={row.overall_risk} />

      {confirming ? (
        <DeleteConfirm
          onConfirm={handleConfirm}
          onCancel={() => setConfirming(false)}
          pending={pending}
        />
      ) : (
        <>
          <Link href={`/trade?sessionId=${row.id}`} style={secondaryBtnStyle}>View</Link>
          <a href={`/api/trade/${row.id}/report`} style={secondaryBtnStyle}>PDF</a>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            title="Delete"
            style={{
              background:  'none',
              border:      'none',
              cursor:      'pointer',
              color:       'var(--text-muted)',
              fontSize:    '14px',
              padding:     '4px 6px',
              flexShrink:  0,
              lineHeight:  1,
            }}
          >
            ✕
          </button>
        </>
      )}
    </RowShell>
  )
}

// ── Screening row ─────────────────────────────────────────────────────────────

function ScreeningRow({
  row,
  onDelete,
}: {
  row:      ScreeningSessionRow
  onDelete: (id: string) => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition]  = useTransition()

  function handleConfirm() {
    startTransition(async () => {
      await onDelete(row.id)
    })
  }

  return (
    <RowShell>
      <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0, minWidth: '90px' }}>
        {formatDate(row.created_at)}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize:     '13px',
            fontWeight:   500,
            color:        'var(--text-primary)',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
            display:      'block',
          }}
          title={row.filename}
        >
          {row.filename}
        </span>
        {row.entity_count > 0 && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {row.entity_count} entit{row.entity_count !== 1 ? 'ies' : 'y'} screened
          </span>
        )}
      </div>

      <RiskBadge risk={row.overall_risk ?? 'unknown'} />

      {confirming ? (
        <DeleteConfirm
          onConfirm={handleConfirm}
          onCancel={() => setConfirming(false)}
          pending={pending}
        />
      ) : (
        <>
          <Link href={`/screen?sessionId=${row.id}`} style={secondaryBtnStyle}>View</Link>
          <a href={`/api/screen/report?sessionId=${row.id}`} style={secondaryBtnStyle}>PDF</a>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            title="Delete"
            style={{
              background:  'none',
              border:      'none',
              cursor:      'pointer',
              color:       'var(--text-muted)',
              fontSize:    '14px',
              padding:     '4px 6px',
              flexShrink:  0,
              lineHeight:  1,
            }}
          >
            ✕
          </button>
        </>
      )}
    </RowShell>
  )
}

// ── Section ───────────────────────────────────────────────────────────────────

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <h2
      style={{
        fontSize:      '11px',
        fontWeight:    600,
        color:         'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.07em',
        marginBottom:  '12px',
      }}
    >
      {label}
      <span style={{ fontWeight: 400, marginLeft: '6px' }}>({count})</span>
    </h2>
  )
}

function EmptyState({ message, cta }: { message: string; cta: { href: string; label: string } }) {
  return (
    <div
      style={{
        padding:      'var(--space-8)',
        textAlign:    'center',
        border:       '1px dashed rgba(255,255,255,0.07)',
        borderRadius: '8px',
        color:        '#8b8b9a',
        fontSize:     '13px',
      }}
    >
      <p style={{ margin: '0 0 var(--space-3)' }}>{message}</p>
      <Link href={cta.href} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
        {cta.label} →
      </Link>
    </div>
  )
}

function LoadMoreButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      style={{
        display:      'block',
        margin:       'var(--space-3) auto 0',
        background:   'var(--bg-elevated)',
        border:       '1px solid var(--border-subtle)',
        borderRadius: '6px',
        padding:      '6px 20px',
        fontSize:     '12px',
        color:        'var(--text-muted)',
        cursor:       loading ? 'default' : 'pointer',
        fontFamily:   'inherit',
      }}
    >
      {loading ? 'Loading…' : 'Load more'}
    </button>
  )
}

// ── Section container with load-more + delete ─────────────────────────────────

function TradeSection({
  initial,
  total,
  pageSize,
}: {
  initial:  TradeSessionRow[]
  total:    number
  pageSize: number
}) {
  const [rows, setRows]       = useState<TradeSessionRow[]>(initial)
  const [loading, setLoading] = useState(false)

  async function loadMore() {
    setLoading(true)
    try {
      const res  = await fetch(`/api/reports?type=trade&offset=${rows.length}&limit=${pageSize}`)
      if (!res.ok) { setLoading(false); return }
      const data = await res.json() as { rows: TradeSessionRow[] }
      if (Array.isArray(data.rows)) {
        setRows(prev => [...prev, ...data.rows])
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/reports?type=trade&id=${id}`, { method: 'DELETE' })
    if (!res.ok) {
      console.error('Delete failed', res.status)
      return
    }
    setRows(prev => prev.filter(r => r.id !== id))
  }

  const hasMore = rows.length < total

  return (
    <section style={{ marginBottom: 'var(--space-8)' }}>
      <SectionHeading label="Trade Checks" count={total} />
      {rows.length === 0 ? (
        <EmptyState
          message="No trade checks yet."
          cta={{ href: '/trade', label: 'Run a trade check' }}
        />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {rows.map(row => (
              <TradeRow key={row.id} row={row} onDelete={handleDelete} />
            ))}
          </div>
          {hasMore && <LoadMoreButton onClick={loadMore} loading={loading} />}
        </>
      )}
    </section>
  )
}

function ScreeningSection({
  initial,
  total,
  pageSize,
}: {
  initial:  ScreeningSessionRow[]
  total:    number
  pageSize: number
}) {
  const [rows, setRows]       = useState<ScreeningSessionRow[]>(initial)
  const [loading, setLoading] = useState(false)

  async function loadMore() {
    setLoading(true)
    try {
      const res  = await fetch(`/api/reports?type=screening&offset=${rows.length}&limit=${pageSize}`)
      if (!res.ok) { setLoading(false); return }
      const data = await res.json() as { rows: ScreeningSessionRow[] }
      if (Array.isArray(data.rows)) {
        setRows(prev => [...prev, ...data.rows])
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/reports?type=screening&id=${id}`, { method: 'DELETE' })
    if (!res.ok) {
      console.error('Delete failed', res.status)
      return
    }
    setRows(prev => prev.filter(r => r.id !== id))
  }

  const hasMore = rows.length < total

  return (
    <section>
      <SectionHeading label="Document Screenings" count={total} />
      {rows.length === 0 ? (
        <EmptyState
          message="No document screenings yet."
          cta={{ href: '/screen', label: 'Screen a document' }}
        />
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {rows.map(row => (
              <ScreeningRow key={row.id} row={row} onDelete={handleDelete} />
            ))}
          </div>
          {hasMore && <LoadMoreButton onClick={loadMore} loading={loading} />}
        </>
      )}
    </section>
  )
}

// ── Root export ───────────────────────────────────────────────────────────────

export default function ReportsClient({
  initialTrade,
  initialScreening,
  tradeTotal,
  screeningTotal,
  pageSize,
}: {
  initialTrade:     TradeSessionRow[]
  initialScreening: ScreeningSessionRow[]
  tradeTotal:       number
  screeningTotal:   number
  pageSize:         number
}) {
  return (
    <>
      <TradeSection    initial={initialTrade}     total={tradeTotal}     pageSize={pageSize} />
      <ScreeningSection initial={initialScreening} total={screeningTotal} pageSize={pageSize} />
    </>
  )
}

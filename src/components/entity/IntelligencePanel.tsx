'use client'

import { useEffect, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface TavilyResult {
  title: string
  url: string
  domain: string
  snippet: string
  provider_score: number | null
}

interface PscDeficiency {
  seq_no:      number
  code:        string | null
  description: string | null
  ground:      string | null
}

interface PscInspection {
  mou:       string
  port:      string
  authority: string
  num:       string
  detained:  string | null
  risk:      string | null
  detail:    PscDeficiency[]
  type_ins:  string
  date_ins:  string
}

interface IntelligenceData {
  sanctions_hits:    TavilyResult[]
  // company:
  corporate_info?:   TavilyResult[]
  risk_signals?:     TavilyResult[]
  // vessel:
  port_state_control?: TavilyResult[]
  tracking_info?:    TavilyResult[]
  psc_records?:      PscInspection[]   // HiFleet structured PSC data
  // terminal:
  existence_check?:  TavilyResult[]
  ownership_info?:   TavilyResult[]
  error?: string
}

// ── Styles (inline so no server/client mismatch) ──────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  borderRadius: '10px',
  padding: 'var(--space-5)',
  border: '1px solid var(--border-subtle)',
}

const sectionTitle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: 'var(--space-4)',
}

const emptyState: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  textAlign: 'center',
  padding: 'var(--space-8) 0',
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ResultItem({ result }: { result: TavilyResult }) {
  const snippet = result.snippet
    ? result.snippet.slice(0, 220) + (result.snippet.length > 220 ? '…' : '')
    : ''
  return (
    <div style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <a
        href={result.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: 'var(--accent-primary)',
          fontSize: '13px',
          fontWeight: 500,
          textDecoration: 'none',
          wordBreak: 'break-word',
        }}
      >
        {result.title || result.domain}
      </a>
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
        {result.domain}
      </p>
      {snippet && (
        <p style={{ color: 'var(--text-secondary)', fontSize: '12px', lineHeight: '18px', marginTop: '4px' }}>
          {snippet}
        </p>
      )}
    </div>
  )
}

// ── PSC record components ──────────────────────────────────────────────────────

function PscBadge({ detained }: { detained: string | null }) {
  const isDetained = detained === 'Y'
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: '10px',
        fontSize: '11px',
        fontWeight: 600,
        backgroundColor: isDetained ? 'var(--status-alert)' : 'var(--status-clear)',
        color: '#fff',
        marginLeft: '8px',
        verticalAlign: 'middle',
      }}
    >
      {isDetained ? 'DETAINED' : 'CLEAR'}
    </span>
  )
}

function PscRecord({ record }: { record: PscInspection }) {
  const defCount = parseInt(record.num, 10) || 0
  return (
    <div
      style={{
        padding: 'var(--space-3) 0',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
          {record.port.trim()}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          · {record.authority}
        </span>
        <PscBadge detained={record.detained} />
      </div>

      {/* Meta row */}
      <div style={{ marginTop: '3px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {record.date_ins}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {record.type_ins}
        </span>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          {record.mou}
        </span>
        {defCount > 0 && (
          <span style={{ fontSize: '11px', color: defCount >= 3 ? 'var(--status-alert)' : 'var(--text-secondary)' }}>
            {defCount} deficienc{defCount === 1 ? 'y' : 'ies'}
          </span>
        )}
      </div>

      {/* Risk label */}
      {record.risk && (
        <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '3px' }}>
          {record.risk}
        </p>
      )}

      {/* Deficiency list */}
      {record.detail.length > 0 && (
        <ul style={{ marginTop: '6px', paddingLeft: '16px', listStyle: 'disc' }}>
          {record.detail.map((d) => (
            <li key={d.seq_no} style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '18px' }}>
              {d.description || d.code || '—'}
              {d.ground === 'Yes' && (
                <span style={{ marginLeft: '6px', color: 'var(--status-alert)', fontWeight: 600 }}>
                  ⚑ Ground for detention
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PscSection({ records }: { records: PscInspection[] }) {
  const totalDef   = records.reduce((s, r) => s + (parseInt(r.num, 10) || 0), 0)
  const detentions = records.filter((r) => r.detained === 'Y').length

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <p style={sectionTitle}>Port State Control — HiFleet</p>
        {records.length > 0 && (
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {records.length} inspections · {totalDef} deficiencies · {detentions} detention{detentions !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      {records.length === 0 ? (
        <p style={emptyState}>No PSC inspection records found.</p>
      ) : (
        records.map((r, i) => <PscRecord key={i} record={r} />)
      )}
    </div>
  )
}

function Section({ title, results }: { title: string; results: TavilyResult[] }) {
  return (
    <div style={card}>
      <p style={sectionTitle}>{title}</p>
      {results.length === 0 ? (
        <p style={emptyState}>No results found.</p>
      ) : (
        results.map((r, i) => <ResultItem key={i} result={r} />)
      )}
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {[120, 160, 140].map((w, i) => (
        <div key={i} style={card}>
          <div
            style={{
              height: '10px',
              width: `${w}px`,
              borderRadius: '4px',
              backgroundColor: 'var(--border-subtle)',
              marginBottom: 'var(--space-5)',
              opacity: 0.6,
            }}
          />
          {[1, 2, 3].map((j) => (
            <div
              key={j}
              style={{
                height: '12px',
                borderRadius: '4px',
                backgroundColor: 'var(--border-subtle)',
                marginBottom: 'var(--space-3)',
                opacity: 0.4,
                width: j === 3 ? '60%' : '100%',
              }}
            />
          ))}
        </div>
      ))}
      <p style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
        Searching public sources via Tavily…
      </p>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  entityType: 'company' | 'vessel' | 'terminal'
  entityKey:  string   // company slug, vessel IMO, or terminal id/slug
}

export default function IntelligencePanel({ entityType, entityKey }: Props) {
  const [data,   setData]   = useState<IntelligenceData | null>(null)
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    const url = `/api/intelligence/${entityType}/${encodeURIComponent(entityKey)}`

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<IntelligenceData>
      })
      .then((d) => {
        if (!cancelled) {
          setData(d)
          setStatus('done')
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => { cancelled = true }
  }, [entityType, entityKey])

  if (status === 'loading') return <Skeleton />

  if (status === 'error' || !data || data.error) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Web Intelligence</p>
        <p style={emptyState}>
          Intelligence data unavailable. Ensure TAVILY_API_KEY is configured.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Section title="Sanctions &amp; Designations" results={data.sanctions_hits ?? []} />
      {entityType === 'vessel' && (
        <>
          {/* 优先展示 HiFleet 结构化 PSC 数据；无 key 时降级为 Tavily 搜索结果 */}
          {(data.psc_records && data.psc_records.length > 0)
            ? <PscSection records={data.psc_records} />
            : <Section title="Port State Control" results={data.port_state_control ?? []} />
          }
          <Section title="AIS Tracking &amp; Position" results={data.tracking_info ?? []} />
        </>
      )}
      {entityType === 'company' && (
        <>
          <Section title="Corporate Information" results={data.corporate_info ?? []} />
          <Section title="Risk Signals"          results={data.risk_signals ?? []} />
        </>
      )}
      {entityType === 'terminal' && (
        <>
          <Section title="Existence Verification" results={data.existence_check ?? []} />
          <Section title="Ownership &amp; Operator" results={data.ownership_info ?? []} />
          <Section title="Risk Signals"             results={data.risk_signals ?? []} />
        </>
      )}
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '16px' }}>
        Web intelligence sourced from Tavily Search. Results reflect publicly available
        information and should be verified against primary sources.
      </p>
    </div>
  )
}

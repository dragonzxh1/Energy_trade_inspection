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

interface IntelligenceData {
  sanctions_hits:    TavilyResult[]
  // company:
  corporate_info?:   TavilyResult[]
  risk_signals?:     TavilyResult[]
  // vessel:
  port_state_control?: TavilyResult[]
  tracking_info?:    TavilyResult[]
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
  entityType: 'company' | 'vessel'
  entityKey:  string   // company slug or vessel IMO
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

  const isVessel = entityType === 'vessel'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Section title="Sanctions &amp; Designations" results={data.sanctions_hits ?? []} />
      {isVessel ? (
        <>
          <Section title="Port State Control"       results={data.port_state_control ?? []} />
          <Section title="AIS Tracking &amp; Position" results={data.tracking_info ?? []} />
        </>
      ) : (
        <>
          <Section title="Corporate Information" results={data.corporate_info ?? []} />
          <Section title="Risk Signals"          results={data.risk_signals ?? []} />
        </>
      )}
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '16px' }}>
        Web intelligence sourced from Tavily Search. Results reflect publicly available
        information and should be verified against primary sources.
      </p>
    </div>
  )
}

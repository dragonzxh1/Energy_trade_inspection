'use client'

import { useState } from 'react'
import type { DraftRiskResult } from '@/lib/server/repository'

interface DraftCheckResponse extends DraftRiskResult {
  imo: string
  locode: string
  draughtSource: 'ais_cache' | 'entity_metadata' | 'unavailable'
}

interface Props {
  imo: string
}

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

export default function DraftCheckPanel({ imo }: Props) {
  const [locode, setLocode]   = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState<DraftCheckResponse | null>(null)
  const [error, setError]     = useState<string | null>(null)

  async function handleCheck() {
    const code = locode.trim().toUpperCase()
    if (!code || !/^[A-Z]{2}[A-Z0-9]{3}$/.test(code)) {
      setError('Enter a valid 5-character LOCODE (e.g. SGSIN, CNSHA).')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/ais/vessel/${imo}/draft-check?locode=${code}`)
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Check failed. Please try again.')
      } else {
        setResult(json as DraftCheckResponse)
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Result colours ──────────────────────────────────────────────────────────
  function statusColor(r: DraftCheckResponse): string {
    if (r.isStsPort)  return '#f97316'   // orange — STS zone
    if (!r.canBerth)  return '#ef4444'   // red — draft exceeds limit
    if (r.marginM != null && r.marginM < 1) return '#eab308' // yellow — tight
    return '#22c55e'                      // green — clear
  }

  function statusLabel(r: DraftCheckResponse): string {
    if (r.isStsPort)  return 'STS Anchorage Zone'
    if (!r.canBerth)  return 'Cannot Berth — Draft Exceeded'
    if (r.marginM != null && r.marginM < 1) return 'Tight Clearance'
    return 'Can Berth'
  }

  const DRAUGHT_SOURCE_LABEL: Record<DraftCheckResponse['draughtSource'], string> = {
    ais_cache:       'AIS (live)',
    entity_metadata: 'Design draught',
    unavailable:     'No draught data',
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Port Draft Risk Check</p>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 'var(--space-4)', lineHeight: '18px' }}>
        Enter a loading port LOCODE to check whether this vessel can physically berth
        based on current draught and port depth limits.
      </p>

      {/* Input row */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <input
          type="text"
          value={locode}
          onChange={(e) => setLocode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && !loading && handleCheck()}
          placeholder="e.g. SGSIN"
          maxLength={5}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '8px 10px',
            backgroundColor: 'var(--bg-elevated)',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'var(--border-subtle)',
            borderRadius: '6px',
            color: 'var(--text-primary)',
            fontSize: '13px',
            fontFamily: 'var(--font-mono, monospace)',
            outline: 'none',
          }}
        />
        <button
          onClick={handleCheck}
          disabled={loading}
          style={{
            padding: '8px 16px',
            backgroundColor: loading ? 'var(--bg-elevated)' : 'var(--accent-primary)',
            color: loading ? 'var(--text-muted)' : '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: loading ? 'not-allowed' : 'pointer',
            flexShrink: 0,
            fontFamily: 'inherit',
          }}
        >
          {loading ? 'Checking…' : 'Check'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <p style={{ fontSize: '12px', color: '#ef4444', marginBottom: 'var(--space-3)' }}>
          {error}
        </p>
      )}

      {/* Result */}
      {result && (
        <div
          style={{
            borderRadius: '8px',
            border: `1px solid ${statusColor(result)}40`,
            backgroundColor: `${statusColor(result)}0d`,
            padding: 'var(--space-4)',
          }}
        >
          {/* Status badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
            <span
              style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: statusColor(result),
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: '13px', fontWeight: 600, color: statusColor(result) }}>
              {statusLabel(result)}
            </span>
          </div>

          {/* Warning message */}
          {result.warning && (
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)', lineHeight: '18px' }}>
              {result.warning}
            </p>
          )}

          {/* Metrics grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
            {[
              {
                label: 'Vessel Draught',
                value: result.vesselDraftM != null ? `${result.vesselDraftM.toFixed(1)} m` : '—',
                sub: DRAUGHT_SOURCE_LABEL[result.draughtSource],
              },
              {
                label: 'Port Max Draft',
                value: result.portMaxDraftM != null ? `${result.portMaxDraftM.toFixed(1)} m` : '—',
                sub: result.locode,
              },
              {
                label: 'Clearance',
                value: result.marginM != null
                  ? `${result.marginM >= 0 ? '+' : ''}${result.marginM.toFixed(1)} m`
                  : result.isStsPort ? 'N/A' : '—',
                sub: result.marginM != null && result.marginM < 0 ? 'Over limit' : result.marginM != null && result.marginM < 1 ? 'Tight' : '',
              },
            ].map(({ label, value, sub }) => (
              <div
                key={label}
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  borderRadius: '6px',
                  padding: 'var(--space-3)',
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'var(--font-mono, monospace)' }}>
                  {value}
                </p>
                <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{label}</p>
                {sub && (
                  <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px', opacity: 0.7 }}>{sub}</p>
                )}
              </div>
            ))}
          </div>

          {/* STS explanation */}
          {result.isStsPort && (
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: 'var(--space-3)', lineHeight: '16px' }}>
              Ship-to-ship transfer zones are offshore anchorages used for cargo transhipment between vessels.
              They are not commercial berths. Contracts specifying terminal delivery at an STS zone are irregular
              and may indicate sanctions evasion activity.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

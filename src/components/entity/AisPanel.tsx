'use client'

import { useEffect, useState } from 'react'
import type { VesselAisData, PortCall, AisDarkPeriod } from '@/lib/ais-types'
import { navStatusLabel, navStatusColor } from '@/lib/ais-utils'

// ── Activity Timeline ──────────────────────────────────────────────────────────

interface TimelineSegment {
  kind: 'dark' | 'port' | 'highRisk'
  label: string
  startMs: number
  endMs: number
  durationHours: number | null
}

const HIGH_RISK_CC = new Set(['ir', 'ru', 've', 'cu', 'kp', 'sy', 'sd', 'by', 'mm', 'ye'])

function ActivityTimeline({
  darkPeriods,
  portCalls,
}: {
  darkPeriods: AisDarkPeriod[]
  portCalls: PortCall[]
}) {
  const [active, setActive] = useState<TimelineSegment | null>(null)

  const now = Date.now()
  // Window: 6 months back or earliest event, whichever is earlier
  const sixMonthsAgo = now - 180 * 24 * 3_600_000

  const segments: TimelineSegment[] = []

  for (const dp of darkPeriods) {
    const startMs = new Date(dp.start).getTime()
    const endMs   = dp.end ? new Date(dp.end).getTime() : now
    if (endMs < sixMonthsAgo) continue
    segments.push({
      kind:          'dark',
      label:         `AIS dark — ${dp.location}`,
      startMs:       Math.max(startMs, sixMonthsAgo),
      endMs:         Math.min(endMs, now),
      durationHours: dp.durationHours,
    })
  }

  for (const pc of portCalls) {
    const startMs = new Date(pc.arrival).getTime()
    const endMs   = pc.departure ? new Date(pc.departure).getTime() : now
    if (endMs < sixMonthsAgo) continue
    const isHighRisk = HIGH_RISK_CC.has(pc.countryCode)
    segments.push({
      kind:          isHighRisk ? 'highRisk' : 'port',
      label:         `${pc.portName} (${pc.locode})${isHighRisk ? ' — HIGH RISK' : ''}`,
      startMs:       Math.max(startMs, sixMonthsAgo),
      endMs:         Math.min(endMs, now),
      durationHours: pc.durationHours,
    })
  }

  const windowMs = now - sixMonthsAgo

  function pct(ms: number) {
    return ((ms - sixMonthsAgo) / windowMs) * 100
  }

  const SEG_COLOR: Record<TimelineSegment['kind'], string> = {
    dark:     'rgba(239,68,68,0.75)',
    port:     'rgba(59,130,246,0.55)',
    highRisk: 'rgba(249,115,22,0.80)',
  }

  // Month tick marks
  const ticks: { label: string; pct: number }[] = []
  const cursor = new Date(sixMonthsAgo)
  cursor.setDate(1)
  cursor.setHours(0, 0, 0, 0)
  while (cursor.getTime() < now) {
    const p = pct(cursor.getTime())
    if (p >= 0 && p <= 100) {
      ticks.push({
        label: cursor.toLocaleDateString('en-US', { month: 'short' }),
        pct: p,
      })
    }
    cursor.setMonth(cursor.getMonth() + 1)
  }

  if (segments.length === 0 && portCalls.length === 0 && darkPeriods.length === 0) {
    return null
  }

  return (
    <div style={{ marginBottom: 'var(--space-5)' }}>
      <p style={{
        color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600,
        letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '8px',
      }}>
        Activity Timeline — Last 6 Months
      </p>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '8px' }}>
        {[
          { color: SEG_COLOR.dark,     label: 'AIS dark period' },
          { color: SEG_COLOR.highRisk, label: 'High-risk port' },
          { color: SEG_COLOR.port,     label: 'Port call' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', backgroundColor: color, flexShrink: 0 }} />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Timeline bar */}
      <div style={{
        position: 'relative',
        height: '28px',
        backgroundColor: 'var(--bg-elevated)',
        borderRadius: '4px',
        overflow: 'hidden',
        marginBottom: '4px',
      }}>
        {segments.map((seg, i) => {
          const left  = pct(seg.startMs)
          const width = pct(seg.endMs) - left
          if (width < 0.1) return null
          return (
            <div
              key={i}
              onClick={() => setActive(active?.label === seg.label && active?.startMs === seg.startMs ? null : seg)}
              title={seg.label}
              style={{
                position: 'absolute',
                top: 0, bottom: 0,
                left: `${left}%`,
                width: `${Math.max(width, 0.5)}%`,
                backgroundColor: SEG_COLOR[seg.kind],
                cursor: 'pointer',
                transition: 'opacity 0.15s',
                opacity: active && active.startMs !== seg.startMs ? 0.5 : 1,
              }}
            />
          )
        })}

        {/* "Now" marker */}
        <div style={{
          position: 'absolute',
          right: 0, top: 0, bottom: 0,
          width: '2px',
          backgroundColor: 'var(--text-muted)',
          opacity: 0.4,
        }} />
      </div>

      {/* Month ticks */}
      <div style={{ position: 'relative', height: '14px' }}>
        {ticks.map((t) => (
          <span
            key={t.label + t.pct}
            style={{
              position: 'absolute',
              left: `${t.pct}%`,
              transform: 'translateX(-50%)',
              fontSize: '9px',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </span>
        ))}
        <span style={{
          position: 'absolute', right: 0,
          fontSize: '9px', color: 'var(--text-muted)',
        }}>
          Now
        </span>
      </div>

      {/* Active segment tooltip */}
      {active && (
        <div style={{
          marginTop: '8px',
          padding: '8px 10px',
          backgroundColor: 'var(--bg-elevated)',
          borderRadius: '6px',
          border: '1px solid var(--border-subtle)',
          fontSize: '11px',
        }}>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{active.label}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
            {new Date(active.startMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {' → '}
            {active.endMs >= now - 60_000
              ? 'now'
              : new Date(active.endMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          {active.durationHours != null && (
            <span style={{ color: 'var(--text-muted)', marginLeft: '8px' }}>
              · {active.durationHours >= 24
                  ? `${Math.round(active.durationHours / 24)}d`
                  : `${active.durationHours}h`}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────

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

const rowLabel: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '13px',
  width: '160px',
  flexShrink: 0,
  marginRight: 'var(--space-4)',
}

// ── Country flag emoji ─────────────────────────────────────────────────────────

function countryFlag(code: string): string {
  if (!code || code.length !== 2) return ''
  const offset = 0x1F1E6 - 0x41
  return String.fromCodePoint(code.toUpperCase().charCodeAt(0) + offset)
       + String.fromCodePoint(code.toUpperCase().charCodeAt(1) + offset)
}

// ── Draught gauge ──────────────────────────────────────────────────────────────

function DraughtGauge({ current, max }: { current: number; max: number }) {
  const pct   = max > 0 ? Math.min(100, Math.round((current / max) * 100)) : 0
  const color = pct >= 85 ? 'var(--status-listed)'
              : pct >= 60 ? '#eab308'
              : 'var(--text-muted)'
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>Draught (load indicator)</span>
        <span style={{ color, fontSize: '12px', fontWeight: 600 }}>
          {current.toFixed(1)} m / {max.toFixed(1)} m — {pct}%
        </span>
      </div>
      <div style={{ height: '6px', backgroundColor: 'var(--bg-elevated)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: '100%', transform: `scaleX(${pct / 100})`, transformOrigin: 'left', backgroundColor: color, borderRadius: '3px', transition: 'transform 0.4s ease' }} />
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px' }}>
        {pct >= 85 ? 'Heavily loaded — likely carrying full cargo'
         : pct >= 60 ? 'Partially loaded'
         : 'Light load / ballast — possibly empty'}
      </p>
    </div>
  )
}

// ── Position card ──────────────────────────────────────────────────────────────

function PositionCard({ data }: { data: VesselAisData }) {
  const pos = data.position
  if (!pos) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Current Position</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>No AIS position available.</p>
      </div>
    )
  }

  const statusColor = navStatusColor(pos.status)
  const lastUpdateDate = new Date(pos.lastUpdate)
  const minutesAgo = Math.round((Date.now() - lastUpdateDate.getTime()) / 60_000)
  const ageLabel = minutesAgo < 60
    ? `${minutesAgo}m ago`
    : minutesAgo < 1440
    ? `${Math.round(minutesAgo / 60)}h ago`
    : `${Math.round(minutesAgo / 1440)}d ago`

  const lat = pos.lat.toFixed(4)
  const lon = pos.lon.toFixed(4)
  const latDir = pos.lat >= 0 ? 'N' : 'S'
  const lonDir = pos.lon >= 0 ? 'E' : 'W'

  const mtLink = `https://www.marinetraffic.com/en/ais/details/ships/imo:${data.imo}`

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
        <p style={{ ...sectionTitle, marginBottom: 0 }}>Current Position</p>
        <span style={{
          fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
          color: statusColor, backgroundColor: `${statusColor}18`,
          padding: '2px 8px', borderRadius: '4px',
        }}>
          {navStatusLabel(pos.status)}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
        {[
          { label: 'Coordinates', value: `${Math.abs(parseFloat(lat))}° ${latDir}, ${Math.abs(parseFloat(lon))}° ${lonDir}` },
          { label: 'Speed', value: pos.speed > 0 ? `${pos.speed.toFixed(1)} kn` : 'Stopped' },
          { label: 'Course', value: pos.speed > 0 ? `${pos.course}°` : '—' },
          { label: 'Last AIS signal', value: ageLabel },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: 'var(--space-3)', backgroundColor: 'var(--bg-elevated)', borderRadius: '8px' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '4px' }}>{label}</p>
            <p style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500 }}>{value}</p>
          </div>
        ))}
      </div>

      {(pos.destination || pos.eta) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) 0', borderTop: '1px solid var(--border-subtle)', marginBottom: 'var(--space-4)' }}>
          <span style={rowLabel}>Destination</span>
          <span style={{ color: 'var(--text-primary)', fontSize: '13px', textAlign: 'right' }}>
            <span className="mono">{pos.destination || '—'}</span>
            {pos.eta && (
              <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: '8px' }}>
                ETA {new Date(pos.eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </span>
        </div>
      )}

      <div style={{ marginBottom: 'var(--space-4)' }}>
        <DraughtGauge current={pos.draught} max={pos.maxDraught} />
      </div>

      <a
        href={mtLink}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-block',
          fontSize: '12px',
          color: 'var(--accent-primary)',
          textDecoration: 'none',
        }}
      >
        View on MarineTraffic ↗
      </a>

      {data.provider === 'mock' && (
        <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: 'var(--space-3)', fontStyle: 'italic' }}>
          Demo data — connect AIS provider in .env.local for live positions
        </p>
      )}
    </div>
  )
}

// ── Port call history ──────────────────────────────────────────────────────────

const HIGH_RISK_COUNTRIES = new Set(['ir', 'ru', 've', 'cu', 'kp', 'sy', 'sd', 'by', 'mm', 'ye'])

function PortCallRow({ call }: { call: PortCall }) {
  const isHighRisk = HIGH_RISK_COUNTRIES.has(call.countryCode)
  const arrivalDate = new Date(call.arrival)
  const departDate  = call.departure ? new Date(call.departure) : null

  const durationLabel = call.durationHours != null
    ? call.durationHours >= 24
      ? `${Math.round(call.durationHours / 24)}d ${call.durationHours % 24}h`
      : `${call.durationHours}h`
    : 'In port'

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      padding: 'var(--space-3) 0',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <span style={{ fontSize: '18px', lineHeight: '1', marginTop: '1px' }}>
          {countryFlag(call.countryCode)}
        </span>
        <div>
          <p style={{
            color: isHighRisk ? 'var(--status-listed)' : 'var(--text-primary)',
            fontSize: '13px', fontWeight: 500,
          }}>
            {call.portName}
            {isHighRisk && (
              <span style={{
                fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.06em', color: 'var(--status-listed)',
                backgroundColor: 'rgba(239,68,68,0.1)',
                padding: '1px 5px', borderRadius: '3px', marginLeft: '6px',
              }}>
                High-risk
              </span>
            )}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
            {call.portCountry} · <span className="mono">{call.locode}</span>
          </p>
        </div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 'var(--space-3)' }}>
        <p style={{ color: 'var(--text-primary)', fontSize: '12px' }}>
          {arrivalDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
          {departDate ? `${durationLabel} stay` : 'Currently in port'}
        </p>
      </div>
    </div>
  )
}

function PortCallsCard({ portCalls, provider }: { portCalls: PortCall[]; provider: string }) {
  const highRiskCount = portCalls.filter((c) => HIGH_RISK_COUNTRIES.has(c.countryCode)).length

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <p style={{ ...sectionTitle, marginBottom: 0 }}>
          Port Call History {portCalls.length > 0 ? `(${portCalls.length})` : ''}
        </p>
        {highRiskCount > 0 && (
          <span style={{
            fontSize: '11px', fontWeight: 600, color: 'var(--status-listed)',
            backgroundColor: 'rgba(239,68,68,0.1)', padding: '2px 8px', borderRadius: '4px',
          }}>
            {highRiskCount} high-risk port{highRiskCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {portCalls.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', padding: 'var(--space-4) 0', fontStyle: 'italic' }}>
          {provider === 'aisstream'
            ? 'Port call history requires historical AIS data — upgrade to a premium provider.'
            : 'No port call history available.'}
        </p>
      ) : (
        portCalls.map((call, i) => <PortCallRow key={i} call={call} />)
      )}
    </div>
  )
}

// ── AIS dark periods ───────────────────────────────────────────────────────────

function darkSeverity(hours: number | null): { color: string; label: string } {
  if (hours == null)    return { color: '#f97316', label: 'Ongoing' }
  if (hours >= 24 * 30) return { color: '#ef4444', label: 'Critical' }
  if (hours >= 24 * 7)  return { color: '#f97316', label: 'High' }
  return { color: '#eab308', label: 'Medium' }
}

function DarkPeriodRow({
  period,
  maxHours,
}: {
  period: AisDarkPeriod
  maxHours: number
}) {
  const start = new Date(period.start)
  const end   = period.end ? new Date(period.end) : null
  const hours = period.durationHours

  const durationLabel = hours == null
    ? 'Ongoing'
    : hours >= 24
      ? `${Math.round(hours / 24)}d ${hours % 24}h`
      : `${hours}h`

  const { color, label } = darkSeverity(hours)
  const barPct = maxHours > 0 && hours != null ? Math.min(100, (hours / maxHours) * 100) : 100

  return (
    <div style={{
      padding: 'var(--space-3) 0',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
        <div>
          <p style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500 }}>
            {period.location}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
            {start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {end ? ` → ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ' → now'}
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 'var(--space-3)' }}>
          <span style={{
            display: 'inline-block',
            fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
            color, backgroundColor: `${color}18`,
            padding: '2px 6px', borderRadius: '4px',
            marginBottom: '4px',
          }}>
            {label}
          </span>
          <p style={{ color, fontSize: '12px', fontWeight: 600 }}>{durationLabel}</p>
        </div>
      </div>

      {/* Relative duration bar */}
      <div style={{ height: '3px', backgroundColor: 'var(--bg-elevated)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${barPct}%`,
          backgroundColor: color,
          borderRadius: '2px',
          opacity: 0.7,
        }} />
      </div>
    </div>
  )
}

function DarkPeriodsCard({
  darkPeriods,
  portCalls,
  provider,
}: {
  darkPeriods: AisDarkPeriod[]
  portCalls: PortCall[]
  provider: string
}) {
  const maxHours = Math.max(0, ...darkPeriods.map((d) => d.durationHours ?? 0))

  const hasTimeline = darkPeriods.length > 0 || portCalls.length > 0

  if (darkPeriods.length === 0) {
    return (
      <div style={card}>
        <p style={sectionTitle}>AIS Dark Periods</p>
        {hasTimeline && (
          <ActivityTimeline darkPeriods={darkPeriods} portCalls={portCalls} />
        )}
        {provider === 'aisstream' ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', fontStyle: 'italic' }}>
            Dark period analysis requires historical AIS data — upgrade to a premium provider.
          </p>
        ) : (
          <p style={{ color: 'var(--status-clear)', fontSize: '13px' }}>
            No AIS dark periods detected in recent history.
          </p>
        )}
      </div>
    )
  }

  const criticalCount = darkPeriods.filter((d) => (d.durationHours ?? 0) >= 24 * 30).length
  const highCount     = darkPeriods.filter((d) => {
    const h = d.durationHours ?? 0
    return h >= 24 * 7 && h < 24 * 30
  }).length

  return (
    <div style={{ ...card, borderColor: 'rgba(239,68,68,0.3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <p style={{ ...sectionTitle, marginBottom: 0, color: 'var(--status-listed)' }}>
          AIS Dark Periods ({darkPeriods.length})
        </p>
        <div style={{ display: 'flex', gap: '6px' }}>
          {criticalCount > 0 && (
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
              {criticalCount} critical
            </span>
          )}
          {highCount > 0 && (
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#f97316', backgroundColor: 'rgba(249,115,22,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
              {highCount} high
            </span>
          )}
        </div>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: 'var(--space-4)', lineHeight: '18px' }}>
        AIS transponder signal was absent for the durations below.
        Intentional disabling near sanctioned ports is a known evasion technique.
      </p>

      {/* Visual timeline */}
      <ActivityTimeline darkPeriods={darkPeriods} portCalls={portCalls} />

      {/* Dark period list */}
      {darkPeriods.map((p, i) => (
        <DarkPeriodRow key={i} period={p} maxHours={maxHours} />
      ))}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AisPanel({ imo }: { imo: string }) {
  const [data, setData] = useState<VesselAisData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/ais/vessel/${imo}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<VesselAisData>
      })
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to load AIS data')
        setLoading(false)
      })
  }, [imo])

  if (loading) {
    return (
      <div style={card}>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Loading AIS data…</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={card}>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>AIS data unavailable.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PositionCard data={data} />
      <DarkPeriodsCard darkPeriods={data.darkPeriods} portCalls={data.portCalls} provider={data.provider} />
      <PortCallsCard portCalls={data.portCalls} provider={data.provider} />
    </div>
  )
}

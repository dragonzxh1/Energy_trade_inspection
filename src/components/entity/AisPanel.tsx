'use client'

import { useEffect, useState } from 'react'
import type { VesselAisData, PortCall, AisDarkPeriod } from '@/lib/ais-types'
import { navStatusLabel, navStatusColor } from '@/lib/ais-utils'

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
        <div style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: '3px', transition: 'width 0.4s ease' }} />
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

  const mtLink = `https://www.marinetraffic.com/en/ais/home/centerx:${pos.lon.toFixed(2)}/centery:${pos.lat.toFixed(2)}/zoom:10`

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

function DarkPeriodRow({ period }: { period: AisDarkPeriod }) {
  const start = new Date(period.start)
  const durationLabel = period.durationHours != null
    ? period.durationHours >= 24
      ? `${Math.round(period.durationHours / 24)}d ${period.durationHours % 24}h`
      : `${period.durationHours}h`
    : 'Ongoing'

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 'var(--space-3) 0',
      borderBottom: '1px solid var(--border-subtle)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span style={{ fontSize: '16px' }}>⚠</span>
        <div>
          <p style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500 }}>
            AIS signal lost — {period.location}
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
            {start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      </div>
      <span style={{
        color: 'var(--status-listed)', fontSize: '12px', fontWeight: 600,
        flexShrink: 0, marginLeft: 'var(--space-3)',
      }}>
        {durationLabel}
      </span>
    </div>
  )
}

function DarkPeriodsCard({ darkPeriods, provider }: { darkPeriods: AisDarkPeriod[]; provider: string }) {
  if (darkPeriods.length === 0) {
    return (
      <div style={card}>
        <p style={sectionTitle}>AIS Dark Periods</p>
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

  return (
    <div style={{ ...card, borderColor: 'rgba(239,68,68,0.3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <p style={{ ...sectionTitle, marginBottom: 0, color: 'var(--status-listed)' }}>
          AIS Dark Periods ({darkPeriods.length})
        </p>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: 'var(--space-3)' }}>
        AIS transponder signal was absent for the durations below. Intentional disabling is a known evasion technique.
      </p>
      {darkPeriods.map((p, i) => <DarkPeriodRow key={i} period={p} />)}
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
      <DarkPeriodsCard darkPeriods={data.darkPeriods} provider={data.provider} />
      <PortCallsCard portCalls={data.portCalls} provider={data.provider} />
    </div>
  )
}

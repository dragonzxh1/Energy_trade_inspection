'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { TradeCheckResult, TradePartyResult, TradeVesselResult, TradePortResult } from '@/app/api/trade/route'
import type { TradeFlag, TradeVerdict } from '@/lib/server/trade-rules'
import { FLAG_EXPLANATIONS } from '@/lib/server/trade-rules'
import type { RiskLevel } from '@/lib/types'
// GlowLoader import retained (not deleted), LoadingView uses inline progress bar instead
import GlowLoader from '@/components/ui/GlowLoader'

// ── TOKEN (all hardcoded values live here; never scatter magic strings) ──────
const TOKEN = {
  surface:      '#111113',
  elevated:     '#1e1e24',
  elevated2:    '#26262e',
  border:       'rgba(255,255,255,0.07)',
  borderHover:  'rgba(255,255,255,0.14)',
  primary:      '#6366f1',
  text:         '#f1f1f3',
  textMuted:    '#8b8b9a',
  textSubtle:   '#55556a',
} as const

// ── Design tokens ─────────────────────────────────────────────────────────────

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#fbbf24',
  low:      '#4ade80',
}
const RISK_BG: Record<RiskLevel, string> = {
  critical: 'rgba(239,68,68,0.10)',
  high:     'rgba(249,115,22,0.08)',
  medium:   'rgba(234,179,8,0.08)',
  low:      'rgba(34,197,94,0.06)',
}
const RISK_BORDER: Record<RiskLevel, string> = {
  critical: 'rgba(239,68,68,0.30)',
  high:     'rgba(249,115,22,0.25)',
  medium:   'rgba(234,179,8,0.25)',
  low:      'rgba(34,197,94,0.20)',
}

const FLAG_LABEL: Record<string, string> = {
  NO_REGISTRY_MATCH:          'No Registry Match',
  SANCTION_EXPOSURE:          'Sanction Exposure',
  LIMITED_BUSINESS_FOOTPRINT: 'Limited Business Footprint',
  GEO_MISMATCH:               'Geographic Mismatch',
  NO_RECENT_ACTIVITY:         'No Recent Activity',
  INCONSISTENT_TRADE_STORY:   'Inconsistent Trade Story',
  NEWLY_INCORPORATED_SELLER:  'Newly Incorporated Seller',
  VESSEL_FLAG_ROUTE_MISMATCH: 'Evasion Flag State',
  MULTIPLE_OPERATOR_CHANGES:  'Multiple Operator Changes',
  VESSEL_COMPLIANCE_RISK:     'Vessel Compliance Risk',
  OFFSHORE_HOLDING_STRUCTURE: 'Offshore Holding Structure',
  PSC_OFFSHORE_CONTROL:       'Offshore PSC Control',
  SPARSE_REGISTRY_DATA:       'Sparse Registry Data',
  OFFSHORE_LOW_SUBSTANCE:     'Offshore Low Substance',
  KNOWN_FRAUD_ALERT:          'Known Fraud Alert',
  DOMAIN_SPOOFING_RISK:       'Domain Spoofing Risk',
  DOMAIN_WHOIS_RISK:          'Domain WHOIS Risk',
  RELATED_PARTY_RISK:         'Related Party Risk',
}

const TARGET_LABEL: Record<string, string> = {
  seller: 'Seller',
  vessel: 'Vessel',
  trade:  'Trade',
}

const VERDICT_RISK_MAP: Record<TradeVerdict, RiskLevel> = {
  block:  'critical',
  review: 'high',
  safe:   'low',
}

const VERDICT_DISPLAY: Record<TradeVerdict, string> = {
  block:  'BLOCK',
  review: 'REVIEW',
  safe:   'SAFE',
}

// ── Secondary button style (Watch trade, Export PDF, New check) ───────────────
const secondaryBtnStyle: React.CSSProperties = {
  background: '#1e1e24',
  color: '#8b8b9a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: '7px',
  padding: '6px 14px',
  fontSize: '13px',
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
  transition: 'all 0.12s ease',
  textDecoration: 'none',
  display: 'inline-block',
}

// ── Recent Checks (localStorage) ─────────────────────────────────────────────

const LS_KEY = 'eti_recent_trade_checks'
const MAX_RECENT = 5

interface RecentCheck {
  seller: string
  vessel?: string
  commodity?: string
  loadingPort?: string
  overallRisk: RiskLevel
  checkedAt: string  // ISO string
}

function getRecent(): RecentCheck[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as RecentCheck[]
  } catch { return [] }
}

function pushRecent(entry: RecentCheck) {
  const list = [entry, ...getRecent().filter(
    r => r.seller !== entry.seller || r.vessel !== entry.vessel
  )]
  localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_RECENT)))
}

// ── Badges ────────────────────────────────────────────────────────────────────

function VerdictLabel({ verdict }: { verdict: TradeVerdict }) {
  const level = VERDICT_RISK_MAP[verdict]
  return (
    <span
      aria-label={`Compliance verdict: ${verdict}`}
      style={{
        fontSize: '12px',
        fontWeight: 590,
        letterSpacing: '0.06em',
        color: RISK_COLOR[level],
        backgroundColor: RISK_BG[level],
        border: `1px solid ${RISK_BORDER[level]}`,
        borderRadius: '4px',
        padding: '4px 12px',
      }}
    >
      {VERDICT_DISPLAY[verdict]}
    </span>
  )
}

function fmt(iso: string | null | undefined) {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

function RiskBadge({ level, large }: { level: RiskLevel; large?: boolean }) {
  return (
    <span style={{
      fontSize: large ? '13px' : '10px',
      fontWeight: 700,
      letterSpacing: '0.06em',
      color: RISK_COLOR[level],
      backgroundColor: RISK_BG[level],
      border: `1px solid ${RISK_BORDER[level]}`,
      borderRadius: '4px',
      padding: large ? '4px 12px' : '2px 7px',
    }}>
      {level.toUpperCase()}
    </span>
  )
}

function SanctionBadge({ status }: { status: string }) {
  const color =
    status === 'listed'     ? '#ef4444' :
    status === 'not_listed' ? '#22c55e' : 'var(--text-muted)'
  const label =
    status === 'listed'     ? 'SANCTIONED' :
    status === 'not_listed' ? 'CLEAR'      : 'UNKNOWN'
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
      color, backgroundColor: `${color}18`, border: `1px solid ${color}44`,
      borderRadius: '4px', padding: '2px 7px',
    }}>
      {label}
    </span>
  )
}

// ── Form ──────────────────────────────────────────────────────────────────────

interface FormValues {
  seller: string
  vessel: string
  imo: string
  date: string
  loadingPort: string
  commodity: string
  sellerDomain: string
}

function inputStyleNew(key: string, focused: string | null, hasError?: boolean): React.CSSProperties {
  const isFocused = focused === key
  return {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: 'rgba(0,0,0,0.28)',
    border: `1px solid ${
      hasError    ? 'rgba(239,68,68,0.5)' :
      isFocused   ? '#6366f1'             :
                    TOKEN.border
    }`,
    boxShadow: isFocused
      ? 'inset 0 2px 3px rgba(0,0,0,0.3), 0 0 0 2px rgba(99,102,241,0.18)'
      : 'inset 0 2px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(0,0,0,0.12)',
    borderRadius: '7px',
    color: TOKEN.text,
    fontSize: '13px',
    fontFamily: 'inherit',
    padding: '8px 12px',
    outline: 'none',
  }
}

interface TradeFormProps {
  values: FormValues
  setValues: React.Dispatch<React.SetStateAction<FormValues>>
  onSubmit: (v: FormValues) => void
}

function TradeForm({ values, setValues, onSubmit }: TradeFormProps) {
  const [touched, setTouched] = useState({ seller: false })
  const [focused, setFocused] = useState<string | null>(null)
  const [btnHover, setBtnHover] = useState(false)

  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues(v => ({ ...v, [k]: e.target.value }))

  const sellerErr = touched.seller && values.seller.trim().length < 2

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched({ seller: true })
    if (values.seller.trim().length < 2) return
    onSubmit(values)
  }

  // Single-column field renderer
  const field = (label: string, key: keyof FormValues, placeholder: string, hint?: string, required?: boolean, type = 'text') => {
    const hasError = key === 'seller' && touched.seller && values[key].trim().length < 2
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <label style={{
          fontSize: '11px', fontWeight: 500, color: TOKEN.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.07em',
        }}>
          {label}{required && <span style={{ color: '#ef4444', marginLeft: '3px' }}>*</span>}
        </label>
        <input
          type={type}
          value={values[key]}
          onChange={set(key)}
          onFocus={() => setFocused(key)}
          onBlur={() => { if (key === 'seller') setTouched(t => ({ ...t, seller: true })); setFocused(null) }}
          placeholder={placeholder}
          style={inputStyleNew(key, focused, hasError)}
        />
        {hint && <span style={{ fontSize: '11px', color: TOKEN.textSubtle }}>{hint}</span>}
        {hasError && <span style={{ fontSize: '11px', color: '#ef4444' }}>Required</span>}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Single-column layout, field order per CONTEXT.md § Form 布局调整 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {field('Seller / Counterparty', 'seller', 'e.g. ZHENFU ENERGY (HAINAN) CO., LTD', undefined, true)}
        {field('Vessel Name', 'vessel', 'e.g. MV START', 'Optional — leave blank to screen seller only')}
        {field('IMO Number', 'imo', '7-digit number', 'Optional — improves vessel lookup accuracy')}
        {field('Trade Date', 'date', '', 'Used to correlate AIS dark periods', false, 'date')}
        {field('Loading Port (LOCODE)', 'loadingPort', 'e.g. CNHAK, SGSIN, AEDXB', 'UN/LOCODE — enables draft risk and geo checks')}
        {field('Commodity', 'commodity', 'e.g. Fuel Oil, Crude Oil, LNG', 'Optional context')}
        {field('Seller Domain (optional)', 'sellerDomain', 'e.g. seller.com', 'Used for domain fraud detection')}
      </div>

      <div style={{ marginTop: '20px' }}>
        <button
          type="submit"
          onMouseEnter={() => setBtnHover(true)}
          onMouseLeave={() => setBtnHover(false)}
          style={btnHover ? {
            width: '100%',
            padding: '11px 0',
            background: 'linear-gradient(180deg, #818cf8 0%, #6366f1 100%)',
            color: '#fff',
            border: '1px solid rgba(99,102,241,0.45)',
            boxShadow: '0 1px 0 rgba(255,255,255,0.12) inset, 0 4px 10px rgba(99,102,241,0.35)',
            borderRadius: '7px',
            fontSize: '13px',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
            letterSpacing: '0.01em',
            transition: 'all 0.12s ease',
            transform: 'translateY(-1px)',
          } : {
            width: '100%',
            padding: '11px 0',
            background: 'linear-gradient(180deg, #7578f2 0%, #5558e8 100%)',
            color: '#fff',
            border: '1px solid rgba(99,102,241,0.45)',
            boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)',
            borderRadius: '7px',
            fontSize: '13px',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
            letterSpacing: '0.01em',
            transition: 'all 0.12s ease',
          }}
        >
          Run Trade Check →
        </button>
      </div>
    </form>
  )
}

// ── Loading view (inline progress bar, replaces GlowLoader) ──────────────────

function LoadingView({ seller, vessel }: { seller: string; vessel: string }) {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (barRef.current) barRef.current.style.width = '100%'
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      minHeight: '400px', gap: '16px',
    }}>
      <p style={{ fontSize: '14px', color: TOKEN.textMuted, margin: 0 }}>Screening trade...</p>
      <div style={{
        width: '200px', height: '3px',
        background: 'rgba(0,0,0,0.35)',
        borderRadius: '2px', overflow: 'hidden',
      }}>
        <div
          ref={barRef}
          style={{
            height: '100%', background: TOKEN.primary,
            width: '0%', transition: 'width 1.4s ease',
          }}
        />
      </div>
      <p style={{ fontSize: '12px', color: TOKEN.textSubtle, margin: 0 }}>
        {seller}{vessel ? ` · ${vessel}` : ''}
      </p>
    </div>
  )
}

// ── Flag card ─────────────────────────────────────────────────────────────────

function FlagCard({ flag }: { flag: TradeFlag }) {
  return (
    <div style={{
      backgroundColor: RISK_BG[flag.severity],
      border: `1px solid ${RISK_BORDER[flag.severity]}`,
      borderRadius: '8px',
      padding: 'var(--space-4)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em',
          color: RISK_COLOR[flag.severity],
          backgroundColor: `${RISK_COLOR[flag.severity]}18`,
          border: `1px solid ${RISK_COLOR[flag.severity]}44`,
          borderRadius: '4px', padding: '2px 8px',
        }}>
          {flag.severity.toUpperCase()}
        </span>
        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.03em' }}>
          {FLAG_LABEL[flag.code] ?? flag.code}
        </span>
        <span style={{
          fontSize: '10px', color: 'var(--text-muted)',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '4px', padding: '1px 6px',
        }}>
          {TARGET_LABEL[flag.target] ?? flag.target}
        </span>
      </div>
      {/* Reason */}
      <p style={{ fontSize: '13px', color: 'var(--text-primary)', margin: '0 0 var(--space-2)' }}>
        {flag.reason}
      </p>
      {/* Evidence chips */}
      {flag.evidence.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {flag.evidence.map((ev, i) => (
            <span key={i} style={{
              fontSize: '10px', color: 'var(--text-muted)',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px', padding: '2px 8px',
            }}>
              {ev}
            </span>
          ))}
        </div>
      )}
      {/* Explanation + data source attribution (DECISION-03) */}
      {(() => {
        const explanation = FLAG_EXPLANATIONS[flag.code as keyof typeof FLAG_EXPLANATIONS]
        if (!explanation) return null
        return (
          <div style={{
            borderTop: '1px solid var(--border-subtle)',
            marginTop: 'var(--space-2)',
            paddingTop: 'var(--space-2)',
          }}>
            <p style={{ fontSize: '12px', fontWeight: 590, color: 'var(--text-primary)', margin: '0 0 4px' }}>
              What this means
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: '0 0 4px' }}>
              {explanation.description}
            </p>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, fontFamily: 'var(--font-mono)' }}>
              {'Source: '}
              <span style={{ fontFamily: 'inherit' }}>{flag.dataSource}</span>
              {flag.dataSourceSyncedAt
                ? ` · Last synced: ${new Date(flag.dataSourceSyncedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`
                : ' · Last synced: Unknown'}
            </p>
          </div>
        )
      })()}
    </div>
  )
}

// ── Party card (seller / buyer) ───────────────────────────────────────────────

function PartyCard({ label, party }: { label: string; party: TradePartyResult }) {
  const href = party.dbMatch?.slug ? `/company/${party.dbMatch.slug}` : null

  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: '8px',
      padding: 'var(--space-4)',
    }}>
      <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', margin: '0 0 6px' }}>
        {label}
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div style={{ minWidth: 0 }}>
          {href ? (
            <Link href={href} style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
              {party.name} →
            </Link>
          ) : (
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              {party.name}
            </p>
          )}
          {party.dbMatch && (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '3px 0 0' }}>
              {party.dbMatch.jurisdictionFlag} {party.dbMatch.country}
              {party.dbMatch.registrationNumber && (
                <span style={{ marginLeft: '8px', fontFamily: 'monospace', fontSize: '11px' }}>
                  {party.dbMatch.registrationNumber}
                </span>
              )}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end', flexShrink: 0 }}>
          <RiskBadge level={party.riskLevel} />
          <SanctionBadge status={party.sanctionStatus} />
        </div>
      </div>
      {(party.icijConnections > 0) && (
        <p style={{ fontSize: '12px', color: '#f97316', margin: 'var(--space-2) 0 0' }}>
          ⚠ {party.icijConnections} ICIJ offshore connection{party.icijConnections !== 1 ? 's' : ''}
        </p>
      )}
      {party.incorporationDate && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 'var(--space-2) 0 0' }}>
          Incorporated {new Date(party.incorporationDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
        </p>
      )}
      {party.ultimateParentJurisdiction && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 'var(--space-1) 0 0' }}>
          Ultimate parent: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{party.ultimateParentJurisdiction}</span>
        </p>
      )}
      {!party.dbMatch && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 'var(--space-2) 0 0', fontStyle: 'italic' }}>
          Not found in company registries
        </p>
      )}
    </div>
  )
}

// ── Vessel card ───────────────────────────────────────────────────────────────

function VesselCard({ vessel }: { vessel: TradeVesselResult }) {
  const href = vessel.imo ? `/vessel/${vessel.imo}` : null

  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: '8px',
      padding: 'var(--space-4)',
    }}>
      <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', margin: '0 0 6px' }}>
        Vessel
      </p>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div style={{ minWidth: 0 }}>
          {href ? (
            <Link href={href} style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', textDecoration: 'none' }}>
              {vessel.name} →
            </Link>
          ) : (
            <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{vessel.name}</p>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: '4px', flexWrap: 'wrap' }}>
            {vessel.imo && (
              <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                IMO {vessel.imo}
              </span>
            )}
            {vessel.dbMatch && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                {vessel.dbMatch.jurisdictionFlag} {vessel.dbMatch.country}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end', flexShrink: 0 }}>
          <RiskBadge level={vessel.riskLevel} />
          <SanctionBadge status={vessel.sanctionStatus} />
        </div>
      </div>

      {/* AIS / PSC detail */}
      <div style={{
        display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-3)',
        paddingTop: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)',
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '12px', color: vessel.hasRecentAis ? '#22c55e' : 'var(--text-muted)' }}>
          AIS: {vessel.hasRecentAis ? `Live (${vessel.lastAisUpdate ? new Date(vessel.lastAisUpdate).toLocaleDateString() : 'recent'})` : 'No recent signal'}
        </span>
        {vessel.darkPeriods > 0 && (
          <span style={{ fontSize: '12px', color: '#f97316' }}>
            ⚠ {vessel.darkPeriods} dark period{vessel.darkPeriods !== 1 ? 's' : ''}
          </span>
        )}
        {vessel.psc && vessel.psc.totalInspections > 0 && (
          <span style={{
            fontSize: '12px',
            color: vessel.psc.detentions > 0 ? '#f97316' : 'var(--text-muted)',
          }}>
            PSC: {vessel.psc.totalInspections} inspection{vessel.psc.totalInspections !== 1 ? 's' : ''},
            {' '}{vessel.psc.detentions} detention{vessel.psc.detentions !== 1 ? 's' : ''},
            {' '}{Math.round(vessel.psc.deficiencyRate * 100)}% deficiency rate
          </span>
        )}
        {vessel.psc && vessel.psc.totalInspections === 0 && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>PSC: No records</span>
        )}
      </div>
    </div>
  )
}

// ── Port card ─────────────────────────────────────────────────────────────────

function PortCard({ port }: { port: TradePortResult }) {
  const hasWarning = port.isStsZone || port.draftRisk?.canBerth === false

  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: `1px solid ${hasWarning ? RISK_BORDER.high : 'var(--border-subtle)'}`,
      borderRadius: '8px',
      padding: 'var(--space-4)',
    }}>
      <p style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', margin: '0 0 6px' }}>
        Loading Port
      </p>
      <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 4px' }}>
        {port.name ?? port.locode}
        {port.name && (
          <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: '6px', fontSize: '12px' }}>
            ({port.locode})
          </span>
        )}
      </p>

      {!port.found && (
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '4px 0 0', fontStyle: 'italic' }}>
          Port not found in database — geo and draft checks skipped
        </p>
      )}

      {port.isStsZone && (
        <p style={{ fontSize: '12px', color: '#f97316', margin: '6px 0 0' }}>
          ⚠ STS anchorage zone — not a terminal berth
        </p>
      )}

      {port.draftRisk && !port.isStsZone && (
        <p style={{
          fontSize: '12px',
          color: port.draftRisk.canBerth === false ? '#ef4444' : 'var(--text-muted)',
          margin: '6px 0 0',
        }}>
          {port.draftRisk.warning ??
            (port.draftRisk.portMaxDraftM
              ? `Max draft: ${port.draftRisk.portMaxDraftM}m${port.draftRisk.vesselDraftM ? ` · Vessel: ${port.draftRisk.vesselDraftM}m` : ''}`
              : 'Draft data not available')}
        </p>
      )}
    </div>
  )
}

// ── Overall risk banner ───────────────────────────────────────────────────────

function ResultBanner({ result }: { result: TradeCheckResult }) {
  const { overallRisk, flags, checkedAt, input } = result
  const critical = flags.filter(f => f.severity === 'critical').length
  const high     = flags.filter(f => f.severity === 'high').length

  const HEADLINE: Record<RiskLevel, string> = {
    critical: 'Critical Risk — Immediate concern detected',
    high:     'High Risk — Significant flags require attention',
    medium:   'Medium Risk — Further due diligence recommended',
    low:      'Low Risk — No significant flags detected',
  }

  return (
    <div style={{
      backgroundColor: RISK_BG[overallRisk],
      border: `1px solid ${RISK_BORDER[overallRisk]}`,
      borderRadius: '10px',
      padding: 'var(--space-5)',
      marginBottom: 'var(--space-6)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
        {result.verdict && <VerdictLabel verdict={result.verdict} />}
        <RiskBadge level={overallRisk} large />
        <span style={{ fontSize: '14px', fontWeight: 590, color: 'var(--text-primary)' }}>
          {HEADLINE[overallRisk]}
        </span>
      </div>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 4px' }}>
        {input.seller}{input.vessel ? ` · ${input.vessel}` : ''}{result.vessel.imo ? ` (IMO ${result.vessel.imo})` : ''}{input.loadingPort ? ` · ${input.loadingPort}` : ''}
        {input.date ? ` · ${input.date}` : ''}
      </p>
      <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
        {flags.length} flag{flags.length !== 1 ? 's' : ''} raised
        {critical > 0 && <span style={{ color: '#ef4444', marginLeft: '8px' }}>· {critical} critical</span>}
        {high > 0 && <span style={{ color: '#f97316', marginLeft: '8px' }}>· {high} high</span>}
        <span style={{ marginLeft: '8px' }}>· Checked {fmt(checkedAt)}</span>
      </p>
    </div>
  )
}

// ── Save trade watch button ───────────────────────────────────────────────────

type WatchState = 'idle' | 'saving' | 'watching' | 'error'

function SaveTradeWatchButton({ result }: { result: TradeCheckResult }) {
  const [state, setState] = useState<WatchState>('idle')

  const toggle = useCallback(async () => {
    if (state === 'saving') return
    setState('saving')
    try {
      const res = await fetch('/api/watchlist/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerName:            result.input.seller,
          vesselName:            result.input.vessel,
          vesselImo:             result.vessel.imo,
          loadingPort:           result.input.loadingPort,
          tradeDate:             result.input.date,
          lastOverallRisk:       result.overallRisk,
          lastFlagCount:         result.flags.length,
          lastSellerSanctioned:  result.seller.sanctionStatus === 'listed',
          lastVesselSanctioned:  result.vessel.sanctionStatus === 'listed',
          lastPscDetentions:     result.vessel.psc?.detentions ?? null,
        }),
      })
      if (!res.ok) {
        setState('error')
        return
      }
      const json = await res.json() as { watching: boolean }
      setState(json.watching ? 'watching' : 'idle')
    } catch {
      setState('error')
    }
  }, [state, result])

  const label =
    state === 'saving'   ? 'Saving...' :
    state === 'watching' ? 'Watching' :
    state === 'error'    ? 'Error - retry' :
    'Watch trade'

  return (
    <button
      onClick={toggle}
      style={state === 'watching'
        ? { ...secondaryBtnStyle, color: '#6366f1', borderColor: '#6366f1' }
        : secondaryBtnStyle
      }
    >
      {label}
    </button>
  )
}

// ── Results view ──────────────────────────────────────────────────────────────

function ResultsView({ result, onReset }: { result: TradeCheckResult; onReset: () => void }) {
  return (
    <>
      <ResultBanner result={result} />

      {result.sanctionDegraded && (
        <div style={{
          backgroundColor: 'rgba(234,179,8,0.08)',
          border: '1px solid rgba(234,179,8,0.25)',
          borderRadius: '8px',
          padding: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#eab308', margin: '0 0 4px' }}>
            Sanction data may be incomplete
          </p>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, lineHeight: '1.5' }}>
            The OpenSanctions API was unavailable during this check. Cached data was used where available.
            Manual verification against OFAC, EU FSF, and UN consolidated lists is recommended.
          </p>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginBottom: 'var(--space-5)', flexWrap: 'wrap' }}>
        <SaveTradeWatchButton result={result} />
        <a
          href={`/api/trade/${result.id}/report`}
          download
          style={{ ...secondaryBtnStyle, display: 'inline-block', textDecoration: 'none' }}
        >
          Export Audit PDF
        </a>
        <button
          onClick={onReset}
          style={secondaryBtnStyle}
        >
          New check
        </button>
      </div>

      {/* Flags are the core output. */}
      {result.flags.length > 0 && (
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-3)', letterSpacing: '0.03em' }}>
            RISK FLAGS ({result.flags.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {result.flags.map((flag, i) => <FlagCard key={i} flag={flag} />)}
          </div>
        </section>
      )}

      {result.flags.length === 0 && (
        <div style={{
          backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
          borderRadius: '8px', padding: 'var(--space-5)', marginBottom: 'var(--space-6)',
          textAlign: 'center',
        }}>
          <p style={{ fontSize: '14px', fontWeight: 500, color: '#22c55e', marginBottom: '4px' }}>
            No flags raised
          </p>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
            {result.summary}
          </p>
        </div>
      )}

      {/* Entity detail cards */}
      <section>
        <h2 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 'var(--space-3)', letterSpacing: '0.03em' }}>
          COUNTERPARTY DETAILS
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <PartyCard label="Seller" party={result.seller} />
          {result.vessel.name && <VesselCard vessel={result.vessel} />}
          {result.port && <PortCard port={result.port} />}
        </div>
      </section>
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type RightPanelState = 'empty' | 'loading' | 'result' | 'error'

export default function TradeClient({ initialSessionId }: { initialSessionId?: string }) {
  const searchParams = useSearchParams()
  const initSeller   = searchParams.get('seller') ?? ''
  const initVessel   = searchParams.get('vessel') ?? ''

  // FormValues lifted to parent — Recent Checks needs write access via setValues
  const [values, setValues] = useState<FormValues>({
    seller: initSeller, vessel: initVessel,
    imo: '', date: '', loadingPort: '', commodity: '', sellerDomain: '',
  })

  const [panelState, setPanelState] = useState<RightPanelState>('empty')
  const [result, setResult]         = useState<TradeCheckResult | null>(null)
  const [error, setError]           = useState('')
  const [lastInput, setInput]       = useState<FormValues | null>(null)

  // Recent Checks state (SSR-safe: only access localStorage in useEffect)
  const [recent, setRecent] = useState<RecentCheck[]>([])
  useEffect(() => { setRecent(getRecent()) }, [])

  // Restore session from Reports page navigation
  useEffect(() => {
    if (!initialSessionId) return
    setPanelState('loading')
    setInput({ seller: '', vessel: '', imo: '', date: '', loadingPort: '', commodity: '', sellerDomain: '' })
    fetch(`/api/trade/${encodeURIComponent(initialSessionId)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setResult(data as TradeCheckResult); setPanelState('result') })
      .catch(() => { setError('Could not load report.'); setPanelState('error') })
  }, [initialSessionId])

  async function submit(v: FormValues) {
    setInput(v)
    setPanelState('loading')
    setError('')
    try {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seller:       v.seller.trim(),
          vessel:       v.vessel.trim(),
          imo:          v.imo.trim() || undefined,
          date:         v.date || undefined,
          loadingPort:  v.loadingPort.trim() || undefined,
          commodity:    v.commodity.trim() || undefined,
          sellerDomain: v.sellerDomain.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'Trade check failed.')
        setPanelState('error')
        return
      }
      const tradeResult = json as TradeCheckResult
      setResult(tradeResult)
      setPanelState('result')

      // Write to Recent Checks
      const entry: RecentCheck = {
        seller:      v.seller.trim(),
        vessel:      v.vessel.trim() || undefined,
        commodity:   v.commodity.trim() || undefined,
        loadingPort: v.loadingPort.trim() || undefined,
        overallRisk: tradeResult.overallRisk,
        checkedAt:   new Date().toISOString(),
      }
      pushRecent(entry)
      setRecent(getRecent())
    } catch {
      setError('Network error. Please try again.')
      setPanelState('error')
    }
  }

  function reset() {
    setPanelState('empty')
    setResult(null)
    setError('')
  }

  return (
    // Split Panel shell (Pattern B — Variant B confirmed winner)
    <div style={{
      display: 'grid',
      gridTemplateColumns: '380px 1fr',
      minHeight: 'calc(100vh - 44px)',
    }}>
      {/* Left column: form + Recent Checks */}
      <div style={{
        borderRight: `1px solid ${TOKEN.border}`,
        padding: '32px 24px',
        overflowY: 'auto',
        background: TOKEN.surface,
      }}>
        {/* Page title */}
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 700, color: TOKEN.text, margin: '0 0 6px' }}>
            Trade Check
          </h1>
          <p style={{ fontSize: '13px', color: TOKEN.textMuted, lineHeight: '1.5', margin: 0 }}>
            Screen seller, vessel, and port against sanctions, AIS, and registry data.
          </p>
        </div>

        {/* Form */}
        <TradeForm values={values} setValues={setValues} onSubmit={submit} />

        {/* Error display (left column below form) */}
        {panelState === 'error' && (
          <div style={{
            marginTop: '16px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: '7px',
            padding: '12px 14px',
          }}>
            <p style={{ fontSize: '13px', fontWeight: 500, color: '#ef4444', margin: '0 0 4px' }}>
              Check failed
            </p>
            <p style={{ fontSize: '12px', color: TOKEN.textMuted, margin: 0 }}>{error}</p>
          </div>
        )}

        {/* Recent Checks (below form, only when history exists) */}
        {recent.length > 0 && (
          <div style={{ marginTop: '32px' }}>
            <div style={{
              fontSize: '11px', color: TOKEN.textSubtle,
              textTransform: 'uppercase', letterSpacing: '0.07em',
              marginBottom: '12px',
            }}>
              Recent Checks
            </div>
            {recent.map((r, i) => (
              <div
                key={i}
                onClick={() => setValues({
                  seller:      r.seller,
                  vessel:      r.vessel ?? '',
                  commodity:   r.commodity ?? '',
                  loadingPort: r.loadingPort ?? '',
                  imo:         '',
                  date:        '',
                  sellerDomain: '',
                })}
                style={{ padding: '8px 10px', borderRadius: '7px', cursor: 'pointer', transition: 'background 0.1s ease' }}
                onMouseEnter={e => (e.currentTarget.style.background = TOKEN.elevated)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontSize: '13px', fontWeight: 500, color: TOKEN.text }}>
                  {r.seller}
                </div>
                <div style={{ fontSize: '11px', color: TOKEN.textMuted }}>
                  {[r.commodity, r.loadingPort].filter(Boolean).join(' · ')}
                  {(r.commodity || r.loadingPort) ? ' · ' : ''}
                  <span style={{ color: RISK_COLOR[r.overallRisk] }}>
                    {r.overallRisk.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right column: three-state panel */}
      <div style={{ padding: '32px', overflowY: 'auto' }}>
        {panelState === 'empty' && (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            minHeight: '400px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '28px', color: TOKEN.textSubtle, marginBottom: '12px' }}>⚡</div>
            <p style={{ fontSize: '14px', color: TOKEN.textSubtle, margin: 0 }}>
              Run a trade check to see results
            </p>
          </div>
        )}

        {panelState === 'loading' && lastInput && (
          <LoadingView seller={lastInput.seller} vessel={lastInput.vessel} />
        )}

        {panelState === 'result' && result && (
          <ResultsView result={result} onReset={reset} />
        )}

        {/* error state: right panel stays empty (error shown in left column) */}
        {panelState === 'error' && (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            minHeight: '400px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '28px', color: TOKEN.textSubtle, marginBottom: '12px' }}>⚡</div>
            <p style={{ fontSize: '14px', color: TOKEN.textSubtle, margin: 0 }}>
              Run a trade check to see results
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

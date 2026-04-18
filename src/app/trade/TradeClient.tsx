'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { TradeCheckResult, TradePartyResult, TradeVesselResult, TradePortResult } from '@/app/api/trade/route'
import type { TradeFlag, TradeVerdict } from '@/lib/server/trade-rules'
import { FLAG_EXPLANATIONS } from '@/lib/server/trade-rules'
import type { RiskLevel } from '@/lib/types'
import GlowLoader from '@/components/ui/GlowLoader'

// 鈹€鈹€ Design tokens 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
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

// 鈹€鈹€ Badges 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€ Form 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

interface FormValues {
  seller: string
  vessel: string
  imo: string
  date: string
  loadingPort: string
  commodity: string
  sellerDomain: string   // NEW (D-02)
}

function inputStyle(hasError?: boolean): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box' as const,
    backgroundColor: 'var(--bg-elevated)',
    border: `1px solid ${hasError ? 'rgba(239,68,68,0.5)' : 'var(--border-subtle)'}`,
    borderRadius: '6px',
    color: 'var(--text-primary)',
    fontSize: '13px',
    fontFamily: 'inherit',
    padding: '8px 12px',
    outline: 'none',
  }
}

function labelStyle(): React.CSSProperties {
  return {
    display: 'block',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    marginBottom: '6px',
    letterSpacing: '0.02em',
  }
}

function hintStyle(): React.CSSProperties {
  return { fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }
}

function TradeForm({ onSubmit, initialSeller = '', initialVessel = '' }: {
  onSubmit: (v: FormValues) => void
  initialSeller?: string
  initialVessel?: string
}) {
  const [values, setValues] = useState<FormValues>({
    seller: initialSeller, vessel: initialVessel, imo: '', date: '', loadingPort: '', commodity: '',
    sellerDomain: '',   // NEW
  })
  const [touched, setTouched] = useState({ seller: false })

  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues(v => ({ ...v, [k]: e.target.value }))

  const blur = (k: 'seller') => () =>
    setTouched(t => ({ ...t, [k]: true }))

  const sellerErr = touched.seller && values.seller.trim().length < 2

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched({ seller: true })
    if (values.seller.trim().length < 2) return
    onSubmit(values)
  }

  const field = (
    label: string,
    key: keyof FormValues,
    placeholder: string,
    hint?: string,
    required?: boolean,
    type = 'text',
  ) => {
    const isReq = key === 'seller'
    const hasError = isReq && touched.seller && values[key].trim().length < 2

    return (
      <div>
        <label style={labelStyle()}>
          {label}
          {required && <span style={{ color: '#ef4444', marginLeft: '3px' }}>*</span>}
        </label>
        <input
          type={type}
          value={values[key]}
          onChange={set(key)}
          onBlur={isReq ? blur(key as 'seller') : undefined}
          placeholder={placeholder}
          style={inputStyle(hasError)}
        />
        {hint && <p style={hintStyle()}>{hint}</p>}
        {hasError && (
          <p style={{ ...hintStyle(), color: '#ef4444', marginTop: '4px' }}>
            Required
          </p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        {field('Seller / Counterparty', 'seller', 'e.g. ZHENFU ENERGY (HAINAN) CO., LTD', undefined, true)}
        {field('Vessel Name', 'vessel', 'e.g. MV START', 'Optional — leave blank to screen seller only')}
              {field('IMO Number', 'imo', '7-digit number', 'Optional — improves vessel lookup accuracy')}
        {field('Trade Date', 'date', '', 'Used to correlate AIS dark periods', false, 'date')}
        {field('Loading Port (LOCODE)', 'loadingPort', 'e.g. CNHAK, SGSIN, AEDXB',
                'UN/LOCODE — enables draft risk and geo checks')}
        {field('Commodity', 'commodity', 'e.g. Fuel Oil, Crude Oil, LNG', 'Optional context')}
        {field(
          'Seller domain (optional)',
          'sellerDomain',
          'e.g. seller.com or contact@seller.com',
          'Used for domain fraud detection — leave blank to skip',
        )}
      </div>

      <div style={{ marginTop: 'var(--space-6)' }}>
        <button
          type="submit"
          style={{
            width: '100%',
            fontSize: '14px',
            fontWeight: 600,
            color: '#fff',
            backgroundColor: 'var(--accent-primary)',
            border: 'none',
            borderRadius: '8px',
            padding: '11px 0',
            cursor: 'pointer',
            letterSpacing: '0.01em',
          }}
        >
              Run Trade Check →
            </button>
      </div>
    </form>
  )
}

// 鈹€鈹€ Loading view 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const STEPS = [
  { keyword: 'Screening',  label: 'Screening seller against sanctions lists...' },
  { keyword: 'Searching',  label: 'Looking up seller in company registries...' },
  { keyword: 'Checking',   label: 'Checking vessel AIS and PSC records...' },
  { keyword: 'Analyzing',  label: 'Running geographic and draft risk checks...' },
  { keyword: 'Running',    label: 'Applying trade rule engine...' },
]

function LoadingView({ seller, vessel }: { seller: string; vessel: string }) {
  return (
    <GlowLoader
      steps={STEPS}
      subtext={vessel ? `${seller} · ${vessel}` : seller}
    />
  )
}

// 鈹€鈹€ Flag card 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€ Party card (seller / buyer) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€ Vessel card 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€ Port card 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€ Overall risk banner 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

// 鈹€鈹€ Save trade watch button 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
      style={{
        fontSize: '13px',
        color: state === 'watching' ? 'var(--accent-primary)' : 'var(--text-muted)',
        backgroundColor: 'var(--bg-elevated)',
        border: `1px solid ${state === 'watching' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
        borderRadius: '6px', padding: '6px 14px', cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  )
}

// 鈹€鈹€ Results view 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
          style={{
            fontSize: '13px', color: 'var(--accent-primary)',
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px', padding: '6px 14px',
            textDecoration: 'none', display: 'inline-block',
          }}
        >
                Export Audit PDF
        </a>
        <button
          onClick={onReset}
          style={{
            fontSize: '13px', color: 'var(--text-muted)',
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px', padding: '6px 14px', cursor: 'pointer',
            fontFamily: 'inherit',
          }}
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

// 鈹€鈹€ Main component 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

type ViewState = 'form' | 'loading' | 'results' | 'error'

export default function TradeClient({ initialSessionId }: { initialSessionId?: string }) {
  const searchParams  = useSearchParams()
  const initSeller    = searchParams.get('seller') ?? ''
  const initVessel    = searchParams.get('vessel') ?? ''

  const [view, setView]       = useState<ViewState>('form')
  const [result, setResult]   = useState<TradeCheckResult | null>(null)
  const [error, setError]     = useState('')
  const [lastInput, setInput] = useState<FormValues | null>(null)

  // Restore a previous session when navigating from Reports
  useEffect(() => {
    if (!initialSessionId) return
    setView('loading')
    setInput({ seller: '', vessel: '', imo: '', date: '', loadingPort: '', commodity: '', sellerDomain: '' })
    fetch(`/api/trade/${encodeURIComponent(initialSessionId)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { setResult(data as TradeCheckResult); setView('results') })
      .catch(() => { setError('Could not load report.'); setView('error') })
  }, [initialSessionId])

  async function submit(values: FormValues) {
    setInput(values)
    setView('loading')
    setError('')

    try {
      const res = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seller:      values.seller.trim(),
          vessel:      values.vessel.trim(),
          imo:         values.imo.trim() || undefined,
          date:        values.date || undefined,
          loadingPort: values.loadingPort.trim() || undefined,
          commodity:   values.commodity.trim() || undefined,
          sellerDomain: values.sellerDomain.trim() || undefined,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'Trade check failed.')
        setView('error')
        return
      }

      setResult(json as TradeCheckResult)
      setView('results')
    } catch {
      setError('Network error. Please try again.')
      setView('error')
    }
  }

  function reset() {
    setView('form')
    setResult(null)
    setError('')
  }

  return (
    <div style={{ maxWidth: '760px', margin: '0 auto' }}>

      {/* Page heading */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
          Trade Check
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: '1.6', margin: 0 }}>
          Input a seller and vessel to run a multi-source risk check: sanctions screening,
          company registry lookup, AIS vessel tracking, PSC inspection history, and geographic
          mismatch detection with deterministic flags and evidence references.
        </p>
      </div>

      {/* Form */}
      {(view === 'form' || view === 'error') && (
        <>
          <div style={{
            backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
            borderRadius: '10px', padding: 'var(--space-6)', marginBottom: 'var(--space-4)',
          }}>
            <TradeForm onSubmit={submit} initialSeller={initSeller} initialVessel={initVessel} />
          </div>

          {view === 'error' && (
            <div style={{
              backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: '8px', padding: 'var(--space-4)',
            }}>
              <p style={{ fontSize: '14px', fontWeight: 500, color: '#ef4444', margin: '0 0 4px' }}>
                Check failed
              </p>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{error}</p>
            </div>
          )}
        </>
      )}

      {/* Loading */}
      {view === 'loading' && lastInput && (
        <LoadingView seller={lastInput.seller} vessel={lastInput.vessel} />
      )}

      {/* Results */}
      {view === 'results' && result && (
        <ResultsView result={result} onReset={reset} />
      )}
    </div>
  )
}


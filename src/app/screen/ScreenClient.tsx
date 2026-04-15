'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ScreeningReport, EntityScreeningResult, TradeAssessmentResult } from '@/app/api/screen/route'
import type { RiskLevel } from '@/lib/types'
import GlowLoader from '@/components/ui/GlowLoader'

// 鈹€鈹€ Helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
  low:      'rgba(34,197,94,0.08)',
}

const RISK_BORDER: Record<RiskLevel, string> = {
  critical: 'rgba(239,68,68,0.30)',
  high:     'rgba(249,115,22,0.25)',
  medium:   'rgba(234,179,8,0.25)',
  low:      'rgba(34,197,94,0.25)',
}

const RISK_LABEL: Record<RiskLevel, string> = {
  critical: 'CRITICAL',
  high:     'HIGH',
  medium:   'MEDIUM',
  low:      'LOW',
}

const TYPE_LABEL: Record<string, string> = {
  company: 'Company',
  person:  'Person',
  vessel:  'Vessel',
}

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// 鈹€鈹€ Sanction badge 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function SanctionBadge({ status }: { status: string }) {
  const color =
    status === 'listed'     ? '#ef4444' :
    status === 'not_listed' ? '#22c55e' : 'var(--text-muted)'
  const label =
    status === 'listed'     ? 'SANCTIONED' :
    status === 'not_listed' ? 'CLEAR'      : 'UNKNOWN'

  return (
    <span
      style={{
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.05em',
        color,
        backgroundColor: `${color}18`,
        border: `1px solid ${color}44`,
        borderRadius: '4px',
        padding: '2px 7px',
      }}
    >
      {label}
    </span>
  )
}

// 鈹€鈹€ Risk badge 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span
      style={{
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.05em',
        color: RISK_COLOR[level],
        backgroundColor: RISK_BG[level],
        border: `1px solid ${RISK_BORDER[level]}`,
        borderRadius: '4px',
        padding: '2px 7px',
      }}
    >
      {RISK_LABEL[level]}
    </span>
  )
}

// 鈹€鈹€ Entity result card 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function EntityCard({ result }: { result: EntityScreeningResult }) {
  const { extracted, sanctionStatus, dbEntity, icijConnections, pscDeficiencyRate, riskLevel, needsManualReview } =
    result
  const icijCount = icijConnections?.length ?? 0
  const href =
    extracted.type === 'vessel' && (extracted.imo || dbEntity?.imo)
      ? `/vessel/${extracted.imo ?? dbEntity?.imo}`
      : extracted.type === 'company' && dbEntity?.slug
      ? `/company/${dbEntity.slug}`
      : null

  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderRadius: '8px',
        border: `1px solid ${
          riskLevel === 'critical' ? RISK_BORDER.critical :
          riskLevel === 'high'     ? RISK_BORDER.high     :
          'var(--border-subtle)'
        }`,
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Type pill */}
          <span
            style={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase' as const,
              color: 'var(--text-muted)',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              padding: '1px 6px',
              marginBottom: '6px',
              display: 'inline-block',
            }}
          >
            {TYPE_LABEL[extracted.type] ?? extracted.type}
          </span>
          {/* Name */}
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
            {href ? (
              <Link href={href} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                  {extracted.name} →
                </Link>
            ) : (
              extracted.name
            )}
          </div>
          {/* Sub-info */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' as const, fontSize: '12px', color: 'var(--text-muted)' }}>
            {extracted.imo && <span>IMO {extracted.imo}</span>}
            {extracted.passport && <span>Passport: {extracted.passport}</span>}
            {dbEntity && (
              <span style={{ color: 'var(--text-secondary)' }}>
                {dbEntity.jurisdictionFlag} {dbEntity.country}
              </span>
            )}
          </div>
        </div>
        {/* Badges */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '6px', alignItems: 'flex-end', flexShrink: 0 }}>
          <RiskBadge level={riskLevel} />
          <SanctionBadge status={sanctionStatus} />
        </div>
      </div>

      {/* Flags row */}
      {(icijCount > 0 || pscDeficiencyRate != null) && (
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-3)',
            flexWrap: 'wrap' as const,
            paddingTop: 'var(--space-2)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {icijCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: '#eab308' }}>
                  ⚠ {icijCount} ICIJ offshore connection{icijCount !== 1 ? 's' : ''}
              </span>
              {needsManualReview && (
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    color: '#eab308',
                    backgroundColor: 'rgba(234,179,8,0.12)',
                    border: '1px solid rgba(234,179,8,0.35)',
                    borderRadius: '4px',
                    padding: '1px 6px',
                  }}
                >
                  VERIFY MANUALLY
                </span>
              )}
            </span>
          )}
          {pscDeficiencyRate != null && (
            <span
              style={{
                fontSize: '12px',
                color: pscDeficiencyRate > 0.3 ? '#f97316' : 'var(--text-muted)',
              }}
            >
              PSC deficiency rate: {Math.round(pscDeficiencyRate * 100)}%
            </span>
          )}
        </div>
      )}

      {/* Context excerpt */}
      {extracted.context && (
        <p
          style={{
            fontSize: '11px',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            margin: 0,
            paddingTop: 'var(--space-1)',
          }}
        >
          &ldquo;{extracted.context}&rdquo;
        </p>
      )}
    </div>
  )
}

// 鈹€鈹€ Trade assessment card 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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
}

function TradeAssessmentCard({ assessment }: { assessment: TradeAssessmentResult }) {
  const { params, flags, overallRisk: risk, summary } = assessment

  return (
    <div
      style={{
        backgroundColor: RISK_BG[risk],
        border: `1px solid ${RISK_BORDER[risk]}`,
        borderRadius: '10px',
        padding: 'var(--space-5)',
        marginBottom: 'var(--space-6)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <p
          style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            margin: 0,
            flex: 1,
          }}
        >
          Trade Assessment
        </p>
        <span
          style={{
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.06em',
            color: RISK_COLOR[risk],
            backgroundColor: `${RISK_COLOR[risk]}18`,
            border: `1px solid ${RISK_COLOR[risk]}44`,
            borderRadius: '4px',
            padding: '2px 8px',
          }}
        >
          {RISK_LABEL[risk]}
        </span>
      </div>

      {/* Extracted trade parameters */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        {[
          { label: 'Seller',    value: params.seller },
          { label: 'Vessel',    value: params.vessel },
          { label: 'Port',      value: params.loadingPort },
          { label: 'Commodity', value: params.commodity },
          { label: 'Date',      value: params.tradeDate },
        ]
          .filter((f) => f.value)
          .map(({ label, value }) => (
            <div
              key={label}
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderRadius: '6px',
                padding: 'var(--space-3)',
              }}
            >
              <p style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '3px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {label}
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-primary)', fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {value}
              </p>
            </div>
          ))}
      </div>

      {/* Summary */}
      <p
        style={{
          fontSize: '13px',
          color: 'var(--text-secondary)',
          lineHeight: '20px',
          marginBottom: flags.length > 0 ? 'var(--space-4)' : 0,
        }}
      >
        {summary}
      </p>

      {/* Flags */}
      {flags.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {flags.map((flag, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 'var(--space-3)',
                padding: 'var(--space-3)',
                backgroundColor: 'var(--bg-elevated)',
                borderRadius: '6px',
                borderLeft: `3px solid ${RISK_COLOR[flag.severity]}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '4px' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 700,
                      color: RISK_COLOR[flag.severity],
                      letterSpacing: '0.04em',
                    }}
                  >
                    {flag.severity.toUpperCase()}
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono, monospace)',
                      letterSpacing: '0.03em',
                    }}
                  >
                    {FLAG_LABEL[flag.code] ?? flag.code}
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: '18px' }}>
                  {flag.reason}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AIS disclaimer */}
      <p
        style={{
          fontSize: '11px',
          color: 'var(--text-muted)',
          marginTop: 'var(--space-3)',
          opacity: 0.7,
        }}
      >
        AIS tracking and draft risk not checked in screening mode. Run a full trade check for complete verification.
      </p>
    </div>
  )
}

// 鈹€鈹€ Overall risk banner 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function OverallRiskBanner({ report }: { report: ScreeningReport }) {
  const { overallRisk, entities, filename, screenedAt, tradeAssessment } = report

  const listedCount   = entities.filter((e) => e.sanctionStatus === 'listed').length
  const icijCount     = entities.filter((e) => (e.icijConnections?.length ?? 0) > 0).length
  const highRiskCount = entities.filter((e) => e.riskLevel === 'high' || e.riskLevel === 'critical').length
  const fraudCount    = entities.filter((e) => (e.fraudAlerts?.length ?? 0) > 0).length

  // Build a specific reason string so users understand what drove the overall score.
  function buildReason(): string {
    if (listedCount > 0)
      return `${listedCount} sanctioned entit${listedCount !== 1 ? 'ies' : 'y'} detected`
    if (fraudCount > 0)
      return `${fraudCount} entit${fraudCount !== 1 ? 'ies' : 'y'} on industry fraud blacklist`
    if (highRiskCount > 0)
      return `${highRiskCount} high-risk entit${highRiskCount !== 1 ? 'ies' : 'y'} in document`
    if (icijCount > 0)
      return `${icijCount} entit${icijCount !== 1 ? 'ies' : 'y'} with ICIJ offshore connections`
    return 'Review entity profiles below'
  }

  // Detect trade/entity disagreement: trade says low but entities drove a higher score.
  const tradeRisk = tradeAssessment?.overallRisk
  const entityDrivenRisk = (overallRisk === 'high' || overallRisk === 'critical') &&
    (tradeRisk === 'low' || tradeRisk === 'medium')

  return (
    <div
      style={{
        backgroundColor: RISK_BG[overallRisk],
        border: `1px solid ${RISK_BORDER[overallRisk]}`,
        borderRadius: '10px',
        padding: 'var(--space-5)',
        marginBottom: 'var(--space-6)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
        <span style={{ fontSize: '20px', fontWeight: 700, color: RISK_COLOR[overallRisk] }}>
          {RISK_LABEL[overallRisk]}
        </span>
        <span style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
          {buildReason()}
        </span>
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
        {entities.length} entit{entities.length !== 1 ? 'ies' : 'y'} extracted from{' '}
        <strong style={{ color: 'var(--text-secondary)' }}>{filename}</strong>
        {' '}· Screened {fmt(screenedAt)}
        {listedCount > 0 && (
          <span style={{ color: '#ef4444', marginLeft: '8px' }}>
            · {listedCount} sanction hit{listedCount !== 1 ? 's' : ''}
          </span>
        )}
        {icijCount > 0 && (
          <span style={{ color: '#f97316', marginLeft: '8px' }}>
            · {icijCount} ICIJ flag{icijCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      {/* Explain the discrepancy when trade assessment and entity risk disagree */}
      {entityDrivenRisk && (
        <p style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginTop: 'var(--space-3)',
          paddingTop: 'var(--space-3)',
          borderTop: `1px solid ${RISK_BORDER[overallRisk]}`,
          lineHeight: '18px',
        }}>
          The trade structure itself shows no red flags (see Trade Assessment below).
          The overall risk rating reflects the inherent risk profiles of the entities
          extracted from this document — not the transaction itself.
        </p>
      )}
    </div>
  )
}

// 鈹€鈹€ Loading state 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const LOADING_STEPS = [
  { keyword: 'Parsing',    label: 'Parsing document...' },
  { keyword: 'Extracting', label: 'Extracting entities with AI...' },
  { keyword: 'Analyzing',  label: 'Extracting trade parameters...' },
  { keyword: 'Screening',  label: 'Screening against sanctions lists...' },
  { keyword: 'Checking',   label: 'Checking ICIJ offshore leaks database...' },
  { keyword: 'Running',    label: 'Running trade rules engine...' },
]

function LoadingView({ filename }: { filename: string }) {
  return (
    <GlowLoader
      steps={LOADING_STEPS}
      subtext={filename}
    />
  )
}

// 鈹€鈹€ Upload zone 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function UploadZone({
  onFile,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  onFile: (f: File) => void
  isDragging: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${isDragging ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
        borderRadius: '12px',
        padding: 'var(--space-12) var(--space-6)',
        textAlign: 'center',
        cursor: 'pointer',
        backgroundColor: isDragging ? 'rgba(59,130,246,0.05)' : 'var(--bg-surface)',
        transition: 'all 0.15s ease',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.xlsx"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
        }}
      />
              <div style={{ fontSize: '32px', marginBottom: 'var(--space-3)' }}>📄</div>
      <p style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
        Drop your contract here or click to upload
      </p>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: 'var(--space-4)' }}>
              PDF, DOCX, or XLSX · Max 10 MB
      </p>
      <span
        style={{
          display: 'inline-block',
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--accent-primary)',
          backgroundColor: 'rgba(59,130,246,0.1)',
          border: '1px solid rgba(59,130,246,0.3)',
          borderRadius: '6px',
          padding: '6px 16px',
        }}
      >
        Select file
      </span>
    </div>
  )
}

// 鈹€鈹€ Main component 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

type ViewState = 'upload' | 'loading' | 'results' | 'error'

export default function ScreenClient({ initialSessionId }: { initialSessionId?: string }) {
  const router                  = useRouter()
  const [view, setView]         = useState<ViewState>('upload')
  const [isDragging, setIsDrag] = useState(false)
  const [filename, setFilename] = useState('')
  const [report, setReport]     = useState<ScreeningReport | null>(null)
  const [error, setError]       = useState('')

  // Restore a previous session on page load (e.g. when navigating back).
  useEffect(() => {
    if (!initialSessionId || report !== null) return
    fetch(`/api/screen?sessionId=${encodeURIComponent(initialSessionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setReport(data as ScreeningReport)
          setView('results')
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId])

  const handleFile = useCallback(async (file: File) => {
    setFilename(file.name)
    setView('loading')
    setError('')

    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch('/api/screen', { method: 'POST', body: form })
      const json = await res.json()

      if (!res.ok) {
        setError((json as { error?: string }).error ?? 'Screening failed.')
        setView('error')
        return
      }

      const data = json as ScreeningReport
      setReport(data)
      setView('results')
      // Write sessionId into the URL so the user can navigate away and return.
      router.replace(`/screen?sessionId=${encodeURIComponent(data.id)}`)
    } catch {
      setError('Network error. Please try again.')
      setView('error')
    }
  }, [router])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDrag(true)
  }, [])

  const onDragLeave = useCallback(() => setIsDrag(false), [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDrag(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFile(file)
    },
    [handleFile]
  )

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto' }}>
      {/* 鈹€鈹€ Page heading 鈹€鈹€ */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <h1
          style={{
            fontSize: '24px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginBottom: 'var(--space-2)',
          }}
        >
          Document Screening
        </h1>
        <p style={{ fontSize: '14px', color: 'var(--text-muted)', lineHeight: '1.6' }}>
          Upload a trade contract to automatically extract counterparties, directors,
              and vessels — then screen them all against sanctions lists and ICIJ offshore
          leak data in one step.
        </p>
      </div>

      {/* 鈹€鈹€ Upload state 鈹€鈹€ */}
      {view === 'upload' && (
        <UploadZone
          onFile={handleFile}
          isDragging={isDragging}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        />
      )}

      {/* 鈹€鈹€ Loading state 鈹€鈹€ */}
      {view === 'loading' && <LoadingView filename={filename} />}

      {/* 鈹€鈹€ Error state 鈹€鈹€ */}
      {view === 'error' && (
        <div
          style={{
            backgroundColor: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderRadius: '8px',
            padding: 'var(--space-5)',
            marginBottom: 'var(--space-4)',
          }}
        >
          <p style={{ fontSize: '14px', fontWeight: 500, color: '#ef4444', marginBottom: 'var(--space-2)' }}>
            Screening failed
          </p>
          <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>{error}</p>
        </div>
      )}
      {view === 'error' && (
        <button
          onClick={() => { setView('upload'); setReport(null); router.replace('/screen') }}
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--accent-primary)',
            backgroundColor: 'transparent',
            border: '1px solid var(--accent-primary)',
            borderRadius: '6px',
            padding: '6px 16px',
            cursor: 'pointer',
          }}
        >
          Try another file
        </button>
      )}

      {/* 鈹€鈹€ Results state 鈹€鈹€ */}
      {view === 'results' && report && (
        <>
          {/* Overall risk banner */}
          <OverallRiskBanner report={report} />

          {/* Actions */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 'var(--space-5)',
            }}
          >
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              {report.entities.length} entit{report.entities.length !== 1 ? 'ies' : 'y'} found and screened
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button
                onClick={() => { setView('upload'); setReport(null); router.replace('/screen') }}
                style={{
                  fontSize: '13px',
                  color: 'var(--text-muted)',
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  cursor: 'pointer',
                }}
              >
                Screen another
              </button>
              <a
                href={`/api/screen/report?sessionId=${report.id}`}
                style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#fff',
                  backgroundColor: 'var(--accent-primary)',
                  border: '1px solid var(--accent-primary)',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  textDecoration: 'none',
                  display: 'inline-block',
                }}
              >
                Download PDF Report
              </a>
            </div>
          </div>

            {/* Trade assessment shown above the entity list when trade params were extracted. */}
          {report.tradeAssessment && (
            <TradeAssessmentCard assessment={report.tradeAssessment} />
          )}

          {/* Entity list */}
          <p
            style={{
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-3)',
            }}
          >
            Entities Screened ({report.entities.length})
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {report.entities.map((result, i) => (
              <EntityCard key={i} result={result} />
            ))}
          </div>

          {/* Bottom download CTA */}
          <div
            style={{
              marginTop: 'var(--space-8)',
              textAlign: 'center',
              padding: 'var(--space-6)',
              backgroundColor: 'var(--bg-surface)',
              borderRadius: '10px',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }}>
              Download a formatted PDF compliance report for your records.
            </p>
            <a
              href={`/api/screen/report?sessionId=${report.id}`}
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: '#fff',
                backgroundColor: 'var(--accent-primary)',
                borderRadius: '8px',
                padding: '10px 24px',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Download PDF Report
            </a>
          </div>
        </>
      )}

      {/* Spin keyframe injected inline via the style tag. */}
      {view === 'loading' && (
        // eslint-disable-next-line react/no-danger
        <style dangerouslySetInnerHTML={{ __html: '@keyframes spin { to { transform: rotate(360deg); } }' }} />
      )}
    </div>
  )
}


'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ScreeningReport, EntityScreeningResult, TradeAssessmentResult } from '@/app/api/screen/route'
import type { RiskLevel } from '@/lib/types'

// ── TOKEN (all hardcoded values live here; never scatter magic strings) ──────
const TOKEN = {
  surface:      'var(--bg-surface)',
  elevated:     'var(--bg-elevated)',
  elevated2:    'color-mix(in srgb, var(--bg-elevated) 80%, var(--bg-primary))',
  border:       'var(--border-subtle)',
  borderHover:  'color-mix(in srgb, var(--accent-primary) 40%, var(--border-subtle))',
  primary:      'var(--accent-primary)',
  text:         'var(--text-primary)',
  textMuted:    'var(--text-muted)',
  textSubtle:   'var(--text-faint)',
} as const

// ── Secondary button style ────────────────────────────────────────────────────
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
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: 'var(--status-listed)',
  high:     'var(--risk-high)',
  medium:   'var(--accent-amber)',
  low:      'var(--status-clear)',
}

const RISK_BG: Record<RiskLevel, string> = {
  critical: 'color-mix(in srgb, var(--status-listed) 10%, transparent)',
  high:     'color-mix(in srgb, var(--risk-high) 8%, transparent)',
  medium:   'color-mix(in srgb, var(--accent-amber) 8%, transparent)',
  low:      'color-mix(in srgb, var(--status-clear) 8%, transparent)',
}

const RISK_BORDER: Record<RiskLevel, string> = {
  critical: 'color-mix(in srgb, var(--status-listed) 30%, transparent)',
  high:     'color-mix(in srgb, var(--risk-high) 25%, transparent)',
  medium:   'color-mix(in srgb, var(--accent-amber) 25%, transparent)',
  low:      'color-mix(in srgb, var(--status-clear) 25%, transparent)',
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

// ── panelState type ───────────────────────────────────────────────────────────
type PanelState = 'upload' | 'loading' | 'result' | 'error'

// ── LoadingView (inline progress bar, replaces GlowLoader) ───────────────────

function LoadingView({ filename, step }: { filename: string; step: string }) {
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
      <p style={{ fontSize: '14px', color: TOKEN.textMuted, margin: 0 }}>{step}</p>
      <div style={{
        width: '200px', height: '4px',
        background: 'rgba(0,0,0,0.35)',
        borderRadius: '2px', overflow: 'hidden',
      }}>
        <div ref={barRef} style={{
          height: '100%', background: TOKEN.primary,
          width: '0%', transition: 'width 1.4s ease',
        }} />
      </div>
      <p style={{ fontSize: '12px', color: TOKEN.textSubtle, margin: 0 }}>{filename}</p>
    </div>
  )
}

// ── Upload empty state (right panel) ─────────────────────────────────────────

function UploadEmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      minHeight: '400px', textAlign: 'center', gap: '12px',
    }}>
      <div style={{ fontSize: '28px', color: TOKEN.textSubtle }}>📄</div>
      <p style={{ fontSize: '14px', color: TOKEN.textSubtle, margin: 0 }}>
        Upload a document to see screening results
      </p>
      <p style={{ fontSize: '12px', color: TOKEN.textSubtle, margin: 0 }}>
        Parties are extracted automatically
      </p>
    </div>
  )
}

// ── Sanction badge ────────────────────────────────────────────────────────────

function SanctionBadge({ status }: { status: string }) {
  const color =
    status === 'listed'     ? 'var(--status-listed)' :
    status === 'not_listed' ? 'var(--status-clear)' : TOKEN.textMuted
  const label =
    status === 'listed'     ? 'SANCTIONED' :
    status === 'not_listed' ? 'CLEAR'      : 'UNKNOWN'

  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
      color, backgroundColor: 'color-mix(in srgb, ' + color + ' 10%, transparent)', border: `1px solid color-mix(in srgb, ` + color + ` 25%, transparent)`,
      borderRadius: '4px', padding: '2px 7px',
    }}>
      {label}
    </span>
  )
}

// ── Risk badge ────────────────────────────────────────────────────────────────

function RiskBadge({ level }: { level: RiskLevel }) {
  return (
    <span style={{
      fontSize: '10px', fontWeight: 700, letterSpacing: '0.05em',
      color: RISK_COLOR[level],
      backgroundColor: RISK_BG[level],
      border: `1px solid ${RISK_BORDER[level]}`,
      borderRadius: '4px', padding: '2px 7px',
    }}>
      {RISK_LABEL[level]}
    </span>
  )
}

// ── Entity result card ────────────────────────────────────────────────────────

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
    <div style={{
      backgroundColor: TOKEN.elevated,
      borderRadius: '8px',
      border: `1px solid ${
        riskLevel === 'critical' ? RISK_BORDER.critical :
        riskLevel === 'high'     ? RISK_BORDER.high     :
        TOKEN.border
      }`,
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Type pill */}
          <span style={{
            fontSize: '10px', fontWeight: 600, letterSpacing: '0.05em',
            textTransform: 'uppercase' as const,
            color: TOKEN.textMuted,
            backgroundColor: TOKEN.elevated2,
            border: `1px solid ${TOKEN.border}`,
            borderRadius: '4px', padding: '1px 6px',
            marginBottom: '6px', display: 'inline-block',
          }}>
            {TYPE_LABEL[extracted.type] ?? extracted.type}
          </span>
          {/* Name */}
          <div style={{ fontSize: '14px', fontWeight: 600, color: TOKEN.text, marginBottom: '4px' }}>
            {href ? (
              <Link href={href} style={{ color: TOKEN.text, textDecoration: 'none' }}>
                {extracted.name} →
              </Link>
            ) : (
              extracted.name
            )}
          </div>
          {/* Sub-info */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' as const, fontSize: '12px', color: TOKEN.textMuted }}>
            {extracted.imo && <span>IMO {extracted.imo}</span>}
            {extracted.passport && <span>Passport: {extracted.passport}</span>}
            {dbEntity && (
              <span style={{ color: TOKEN.textMuted }}>
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
        <div style={{
          display: 'flex', gap: '12px', flexWrap: 'wrap' as const,
          paddingTop: '8px', borderTop: `1px solid ${TOKEN.border}`,
        }}>
          {icijCount > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--accent-amber)' }}>
                ⚠ {icijCount} ICIJ offshore connection{icijCount !== 1 ? 's' : ''}
              </span>
              {needsManualReview && (
                <span style={{
                  fontSize: '10px', fontWeight: 600, letterSpacing: '0.04em',
                  color: 'var(--accent-amber)', backgroundColor: 'color-mix(in srgb, var(--accent-amber) 12%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--accent-amber) 35%, transparent)',
                  borderRadius: '4px', padding: '1px 6px',
                }}>
                  VERIFY MANUALLY
                </span>
              )}
            </span>
          )}
          {pscDeficiencyRate != null && (
            <span style={{
              fontSize: '12px',
              color: pscDeficiencyRate > 0.3 ? 'var(--risk-high)' : TOKEN.textMuted,
            }}>
              PSC deficiency rate: {Math.round(pscDeficiencyRate * 100)}%
            </span>
          )}
        </div>
      )}

      {/* Context excerpt */}
      {extracted.context && (
        <p style={{
          fontSize: '11px', color: TOKEN.textMuted, fontStyle: 'italic',
          margin: 0, paddingTop: '4px',
        }}>
          &ldquo;{extracted.context}&rdquo;
        </p>
      )}
    </div>
  )
}

// ── Trade assessment card ─────────────────────────────────────────────────────

function TradeAssessmentCard({ assessment }: { assessment: TradeAssessmentResult }) {
  const { params, flags, overallRisk: risk, summary } = assessment

  return (
    <div style={{
      backgroundColor: RISK_BG[risk],
      border: `1px solid ${RISK_BORDER[risk]}`,
      borderRadius: '10px',
      padding: '20px',
      marginBottom: '24px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <p style={{
          fontSize: '11px', fontWeight: 600, letterSpacing: '0.08em',
          textTransform: 'uppercase', color: TOKEN.textMuted,
          margin: 0, flex: 1,
        }}>
          Trade Assessment
        </p>
        <span style={{
          fontSize: '11px', fontWeight: 700, letterSpacing: '0.06em',
          color: RISK_COLOR[risk],
          backgroundColor: 'color-mix(in srgb, ' + RISK_COLOR[risk] + ' 10%, transparent)',
          border: `1px solid color-mix(in srgb, ` + RISK_COLOR[risk] + ` 25%, transparent)`,
          borderRadius: '4px', padding: '2px 8px',
        }}>
          {RISK_LABEL[risk]}
        </span>
      </div>

      {/* Extracted trade parameters */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: '12px', marginBottom: '16px',
      }}>
        {[
          { label: 'Seller',    value: params.seller },
          { label: 'Vessel',    value: params.vessel },
          { label: 'Port',      value: params.loadingPort },
          { label: 'Commodity', value: params.commodity },
          { label: 'Date',      value: params.tradeDate },
        ]
          .filter((f) => f.value)
          .map(({ label, value }) => (
            <div key={label} style={{ backgroundColor: TOKEN.elevated, borderRadius: '6px', padding: '12px' }}>
              <p style={{ fontSize: '10px', color: TOKEN.textMuted, marginBottom: '3px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {label}
              </p>
              <p style={{ fontSize: '12px', color: TOKEN.text, fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {value}
              </p>
            </div>
          ))}
      </div>

      {/* Summary */}
      <p style={{ fontSize: '13px', color: TOKEN.textMuted, lineHeight: '20px', marginBottom: flags.length > 0 ? '16px' : 0 }}>
        {summary}
      </p>

      {/* Flags */}
      {flags.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {flags.map((flag, i) => (
            <div key={i} style={{
              display: 'flex', gap: '12px', padding: '12px',
              backgroundColor: TOKEN.elevated, borderRadius: '6px',
              borderLeft: `3px solid ${RISK_COLOR[flag.severity]}`,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{
                    fontSize: '10px', fontWeight: 700,
                    color: RISK_COLOR[flag.severity], letterSpacing: '0.04em',
                  }}>
                    {flag.severity.toUpperCase()}
                  </span>
                  <span style={{
                    fontSize: '10px', fontWeight: 600, color: TOKEN.textMuted,
                    fontFamily: 'var(--font-mono, monospace)', letterSpacing: '0.03em',
                  }}>
                    {FLAG_LABEL[flag.code] ?? flag.code}
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: TOKEN.textMuted, margin: 0, lineHeight: '18px' }}>
                  {flag.reason}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* AIS disclaimer */}
      <p style={{ fontSize: '11px', color: TOKEN.textMuted, marginTop: '12px', opacity: 0.7 }}>
        AIS tracking and draft risk not checked in screening mode. Run a full trade check for complete verification.
      </p>
    </div>
  )
}

// ── Overall risk banner ───────────────────────────────────────────────────────

function OverallRiskBanner({ report }: { report: ScreeningReport }) {
  const { overallRisk, entities, filename, screenedAt, tradeAssessment } = report

  const listedCount   = entities.filter((e) => e.sanctionStatus === 'listed').length
  const icijCount     = entities.filter((e) => (e.icijConnections?.length ?? 0) > 0).length
  const highRiskCount = entities.filter((e) => e.riskLevel === 'high' || e.riskLevel === 'critical').length
  const fraudCount    = entities.filter((e) => (e.fraudAlerts?.length ?? 0) > 0).length

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

  const tradeRisk = tradeAssessment?.overallRisk
  const entityDrivenRisk = (overallRisk === 'high' || overallRisk === 'critical') &&
    (tradeRisk === 'low' || tradeRisk === 'medium')

  return (
    <div style={{
      backgroundColor: RISK_BG[overallRisk],
      border: `1px solid ${RISK_BORDER[overallRisk]}`,
      borderRadius: '10px', padding: '20px', marginBottom: '24px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
        <span style={{ fontSize: '20px', fontWeight: 700, color: RISK_COLOR[overallRisk] }}>
          {RISK_LABEL[overallRisk]}
        </span>
        <span style={{ fontSize: '14px', fontWeight: 500, color: TOKEN.text }}>
          {buildReason()}
        </span>
      </div>
      <div style={{ fontSize: '12px', color: TOKEN.textMuted }}>
        {entities.length} entit{entities.length !== 1 ? 'ies' : 'y'} extracted from{' '}
        <strong style={{ color: TOKEN.textMuted }}>{filename}</strong>
        {' '}· Screened {fmt(screenedAt)}
        {listedCount > 0 && (
          <span style={{ color: 'var(--status-listed)', marginLeft: '8px' }}>
            · {listedCount} sanction hit{listedCount !== 1 ? 's' : ''}
          </span>
        )}
        {icijCount > 0 && (
          <span style={{ color: 'var(--risk-high)', marginLeft: '8px' }}>
            · {icijCount} ICIJ flag{icijCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      {entityDrivenRisk && (
        <p style={{
          fontSize: '12px', color: TOKEN.textMuted,
          marginTop: '12px', paddingTop: '12px',
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

// ── Result view (right panel) ─────────────────────────────────────────────────

function ResultView({ report, onReset }: { report: ScreeningReport; onReset: () => void }) {
  return (
    <>
      <OverallRiskBanner report={report} />

      {/* Actions */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: '20px',
      }}>
        <p style={{ fontSize: '13px', color: TOKEN.textMuted, margin: 0 }}>
          {report.entities.length} entit{report.entities.length !== 1 ? 'ies' : 'y'} found and screened
        </p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={onReset} style={secondaryBtnStyle}>
            Screen another
          </button>
          <a
            href={`/api/screen/report?sessionId=${report.id}`}
            style={{
              ...secondaryBtnStyle,
              background: 'linear-gradient(180deg, var(--brand-600) 0%, var(--brand-500) 100%)',
              color: '#fff',
              border: '1px solid rgba(99,102,241,0.45)',
              boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)',
            }}
          >
            Download PDF Report
          </a>
        </div>
      </div>

      {/* Trade assessment shown above entity list when trade params were extracted */}
      {report.tradeAssessment && (
        <TradeAssessmentCard assessment={report.tradeAssessment} />
      )}

      {/* Entity list */}
      <p style={{
        fontSize: '11px', fontWeight: 600, letterSpacing: '0.07em',
        textTransform: 'uppercase', color: TOKEN.textSubtle,
        marginBottom: '12px',
      }}>
        Entities Screened ({report.entities.length})
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {report.entities.map((result, i) => (
          <EntityCard key={i} result={result} />
        ))}
      </div>

      {/* Bottom download CTA */}
      <div style={{
        marginTop: '32px', textAlign: 'center', padding: '24px',
        backgroundColor: TOKEN.elevated,
        borderRadius: '10px', border: `1px solid ${TOKEN.border}`,
      }}>
        <p style={{ fontSize: '13px', color: TOKEN.textMuted, marginBottom: '12px' }}>
          Download a formatted PDF compliance report for your records.
        </p>
        <a
          href={`/api/screen/report?sessionId=${report.id}`}
          style={{
            fontSize: '14px', fontWeight: 600, color: '#fff',
            background: 'linear-gradient(180deg, var(--brand-600) 0%, var(--brand-500) 100%)',
            borderRadius: '7px', padding: '10px 24px',
            textDecoration: 'none', display: 'inline-block',
            border: '1px solid rgba(99,102,241,0.45)',
            boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)',
          }}
        >
          Download PDF Report
        </a>
      </div>
    </>
  )
}

// ── Error view (right panel) ──────────────────────────────────────────────────

function ErrorView({ message, onReset }: { message: string; onReset: () => void }) {
  return (
    <div style={{ padding: '32px 0' }}>
      <div style={{
        backgroundColor: 'rgba(239,68,68,0.08)',
        border: '1px solid rgba(239,68,68,0.25)',
        borderRadius: '8px', padding: '20px', marginBottom: '16px',
      }}>
        <p style={{ fontSize: '14px', fontWeight: 500, color: 'var(--status-listed)', marginBottom: '8px' }}>
          Screening failed
        </p>
        <p style={{ fontSize: '13px', color: TOKEN.textMuted, margin: 0 }}>{message}</p>
      </div>
      <button onClick={onReset} style={secondaryBtnStyle}>
        Try another file
      </button>
    </div>
  )
}

// ── Upload zone (left panel) ──────────────────────────────────────────────────

function UploadZone({
  onFile,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  disabled,
}: {
  onFile: (f: File) => void
  isDragging: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      onDragOver={disabled ? undefined : onDragOver}
      onDragLeave={disabled ? undefined : onDragLeave}
      onDrop={disabled ? undefined : onDrop}
      onClick={() => { if (!disabled) inputRef.current?.click() }}
      style={{
        border: `1.5px dashed ${isDragging ? TOKEN.primary : 'rgba(255,255,255,0.12)'}`,
        borderRadius: '10px',
        minHeight: '160px',
        padding: '32px 24px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        backgroundColor: isDragging ? 'rgba(99,102,241,0.08)' : 'rgba(0,0,0,0.2)',
        transition: 'all 0.15s ease',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '8px',
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
      <div style={{ fontSize: '28px', color: isDragging ? TOKEN.primary : TOKEN.textSubtle }}>📄</div>
      <p style={{ fontSize: '14px', fontWeight: 500, color: TOKEN.textMuted, margin: 0 }}>
        Drop file here or click to browse
      </p>
      <p style={{ fontSize: '12px', color: TOKEN.textSubtle, margin: 0 }}>
        PDF, DOCX, or XLSX · Max 10 MB
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ScreenClient({ initialSessionId }: { initialSessionId?: string }) {
  const router                        = useRouter()
  const [panelState, setPanelState]   = useState<PanelState>('upload')
  const [isDragging, setIsDrag]       = useState(false)
  const [file, setFile]               = useState<File | null>(null)
  const [report, setReport]           = useState<ScreeningReport | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [loadingStep, setLoadingStep] = useState('Uploading\u2026')
  const [isPrimaryHover, setIsPrimaryHover] = useState(false)
  const [includeTradeAssessment, setIncludeTradeAssessment] = useState(true)

  // Restore a previous session on page load (e.g. when navigating back).
  useEffect(() => {
    if (!initialSessionId || report !== null) return
    fetch(`/api/screen?sessionId=${encodeURIComponent(initialSessionId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setReport(data as ScreeningReport)
          setPanelState('result')
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId])

  const handleFile = useCallback(async (f: File) => {
    setFile(f)
    setPanelState('loading')
    setLoadingStep('Uploading\u2026')
    setErrorMessage('')

    const form = new FormData()
    form.append('file', f)
    if (!includeTradeAssessment) form.append('skipTradeAssessment', '1')

    try {
      setLoadingStep('Extracting parties\u2026')
      const res = await fetch('/api/screen', { method: 'POST', body: form })
      setLoadingStep('Screening entities\u2026')
      const json = await res.json()

      if (!res.ok) {
        setErrorMessage((json as { error?: string }).error ?? 'Screening failed.')
        setPanelState('error')
        return
      }

      const data = json as ScreeningReport
      setReport(data)
      setPanelState('result')
      // Write sessionId into the URL so the user can navigate away and return.
      router.replace(`/screen?sessionId=${encodeURIComponent(data.id)}`)
    } catch {
      setErrorMessage('Network error. Please try again.')
      setPanelState('error')
    }
  }, [router, includeTradeAssessment])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDrag(true)
  }, [])

  const onDragLeave = useCallback(() => setIsDrag(false), [])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDrag(false)
      const f = e.dataTransfer.files[0]
      if (f) handleFile(f)
    },
    [handleFile]
  )

  const handleReset = useCallback(() => {
    setFile(null)
    setReport(null)
    setPanelState('upload')
    router.replace('/screen')
  }, [router])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (file && panelState !== 'loading') handleFile(file)
  }, [file, panelState, handleFile])

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '420px 1fr',
      minHeight: 'calc(100vh - 44px)',
    }}>
      {/* LEFT: upload zone + options */}
      <div style={{
        borderRight: `1px solid ${TOKEN.border}`,
        padding: '32px 24px',
        overflowY: 'auto',
        background: TOKEN.surface,
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      }}>
        <h2 style={{
          fontSize: '11px', color: TOKEN.textSubtle,
          textTransform: 'uppercase', letterSpacing: '0.07em',
          margin: 0,
        }}>
          Screen Document
        </h2>

        <UploadZone
          onFile={handleFile}
          isDragging={isDragging}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          disabled={panelState === 'loading'}
        />

        {file && (
          <p style={{ fontSize: '12px', color: TOKEN.textMuted, margin: 0 }}>
            Selected: {file.name}
          </p>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Options */}
          <label style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            fontSize: '13px', color: TOKEN.textMuted, cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={includeTradeAssessment}
              onChange={(e) => setIncludeTradeAssessment(e.target.checked)}
              style={{ accentColor: TOKEN.primary }}
            />
            Include trade assessment
          </label>

          <button
            type="submit"
            disabled={!file || panelState === 'loading'}
            onMouseEnter={() => setIsPrimaryHover(true)}
            onMouseLeave={() => setIsPrimaryHover(false)}
            style={{
              width: '100%',
              padding: '11px 0',
              background: isPrimaryHover
                ? 'linear-gradient(180deg, #818cf8 0%, #6366f1 100%)'
                : 'linear-gradient(180deg, #7578f2 0%, #5558e8 100%)',
              color: '#fff',
              border: '1px solid rgba(99,102,241,0.45)',
              boxShadow: isPrimaryHover
                ? '0 1px 0 rgba(255,255,255,0.12) inset, 0 4px 10px rgba(99,102,241,0.35)'
                : '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)',
              borderRadius: '7px', fontSize: '13px', fontWeight: 500,
              fontFamily: 'inherit',
              cursor: !file || panelState === 'loading' ? 'not-allowed' : 'pointer',
              transition: 'all 0.12s ease',
              transform: isPrimaryHover && !!file && panelState !== 'loading' ? 'translateY(-1px)' : 'none',
              opacity: !file ? 0.5 : 1,
            }}
          >
            {panelState === 'loading' ? 'Screening\u2026' : 'Screen Document \u2192'}
          </button>
        </form>
      </div>

      {/* RIGHT: upload / loading / result / error */}
      <div style={{ padding: '32px', overflowY: 'auto' }}>
        {panelState === 'upload' && <UploadEmptyState />}
        {panelState === 'loading' && (
          <LoadingView filename={file?.name ?? ''} step={loadingStep} />
        )}
        {panelState === 'result' && report && (
          <ResultView report={report} onReset={handleReset} />
        )}
        {panelState === 'error' && (
          <ErrorView message={errorMessage} onReset={handleReset} />
        )}
      </div>
    </div>
  )
}

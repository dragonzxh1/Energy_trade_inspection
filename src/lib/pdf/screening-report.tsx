/**
 * Screening Report PDF — rendered server-side via @react-pdf/renderer.
 * Used by /api/screen/report for Starter+ users.
 *
 * Displays: overall risk banner · per-entity cards (sanctions, ICIJ, PSC).
 */

import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { ScreeningReport, EntityScreeningResult, TradeAssessmentResult } from '@/app/api/screen/route'
import type { RiskLevel } from '@/lib/types'

// ── Palette (matches report.tsx) ──────────────────────────────────────────────

const C = {
  bg:        '#0a0f1a',
  surface:   '#111827',
  border:    '#1e2a3a',
  accent:    '#3b82f6',
  textPri:   '#f0f4ff',
  textSec:   '#8fa3c3',
  textMuted: '#4d6380',
  listed:    '#ef4444',
  clear:     '#22c55e',
  warn:      '#f97316',
  yellow:    '#eab308',
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    backgroundColor: C.bg,
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 48,
    fontFamily: 'Helvetica',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
    paddingBottom: 16,
    borderBottom: `1 solid ${C.border}`,
  },
  brand:    { fontSize: 18, fontFamily: 'Helvetica-Bold', color: C.textPri, letterSpacing: -0.5 },
  brandSub: { fontSize: 9, color: C.textMuted, marginTop: 3 },
  reportDate: { fontSize: 9, color: C.textMuted, textAlign: 'right' },

  // Overall risk banner
  riskBanner: {
    borderRadius: 6,
    padding: 14,
    marginBottom: 20,
  },
  riskBannerTitle: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  riskBannerSub:   { fontSize: 9, color: C.textSec },

  // Meta row
  metaRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  metaBox: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 6,
    padding: 12,
    border: `1 solid ${C.border}`,
  },
  metaLabel: { fontSize: 8, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },
  metaValue: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: C.textPri },
  metaNote:  { fontSize: 8, color: C.textMuted, marginTop: 3 },

  // Section title
  sectionTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 20,
  },

  // Entity card
  entityCard: {
    backgroundColor: C.surface,
    borderRadius: 6,
    padding: 12,
    border: `1 solid ${C.border}`,
    marginBottom: 8,
  },
  entityCardCritical: {
    backgroundColor: 'rgba(239,68,68,0.07)',
    borderRadius: 6,
    padding: 12,
    border: `1 solid rgba(239,68,68,0.3)`,
    marginBottom: 8,
  },
  entityCardHigh: {
    backgroundColor: 'rgba(249,115,22,0.07)',
    borderRadius: 6,
    padding: 12,
    border: `1 solid rgba(249,115,22,0.25)`,
    marginBottom: 8,
  },
  entityName:    { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.textPri, marginBottom: 4 },
  entityTypePill: { fontSize: 8, color: C.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  entityRow:     { flexDirection: 'row', marginBottom: 3 },
  entityLabel:   { width: 130, fontSize: 9, color: C.textMuted },
  entityValue:   { flex: 1, fontSize: 9, color: C.textPri },

  // Status badges
  badgeListed:    { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.listed },
  badgeClear:     { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.clear },
  badgeUnknown:   { fontSize: 8, color: C.textMuted },
  badgeCritical:  { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.listed },
  badgeHigh:      { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.warn },
  badgeMedium:    { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.yellow },
  badgeLow:       { fontSize: 8, color: C.textMuted },

  // Context excerpt
  context: { fontSize: 8, color: C.textMuted, fontStyle: 'italic', marginTop: 6, lineHeight: 1.4 },

  // ICIJ warning
  icijNote: { fontSize: 8, color: C.warn, marginTop: 4 },

  // Trade assessment
  tradeParamRow: { flexDirection: 'row', marginBottom: 3 },
  tradeParamLabel: { width: 120, fontSize: 9, color: C.textMuted },
  tradeParamValue: { flex: 1, fontSize: 9, color: C.textPri },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 5,
    paddingBottom: 5,
    borderBottom: `1 solid ${C.border}`,
  },
  flagSeverityDot: { width: 6, height: 6, borderRadius: 3, marginTop: 3, flexShrink: 0 },
  flagBody: { flex: 1 },
  flagReason: { fontSize: 9, color: C.textPri, marginBottom: 2 },
  flagEvidence: { fontSize: 8, color: C.textMuted, lineHeight: 1.4 },
  tradeSummary: {
    fontSize: 9,
    color: C.textSec,
    lineHeight: 1.5,
    marginTop: 8,
    padding: 10,
    backgroundColor: C.surface,
    borderRadius: 4,
    border: `1 solid ${C.border}`,
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTop: `1 solid ${C.border}`,
    paddingTop: 10,
  },
  footerText: { fontSize: 8, color: C.textMuted },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    })
  } catch {
    return iso
  }
}

function riskColor(level: RiskLevel): string {
  if (level === 'critical') return C.listed
  if (level === 'high')     return C.warn
  if (level === 'medium')   return C.yellow
  return C.clear
}

function riskBgStyle(level: RiskLevel) {
  if (level === 'critical') return { ...s.riskBanner, backgroundColor: 'rgba(239,68,68,0.12)', border: `1 solid rgba(239,68,68,0.35)` }
  if (level === 'high')     return { ...s.riskBanner, backgroundColor: 'rgba(249,115,22,0.10)', border: `1 solid rgba(249,115,22,0.30)` }
  if (level === 'medium')   return { ...s.riskBanner, backgroundColor: 'rgba(234,179,8,0.10)', border: `1 solid rgba(234,179,8,0.30)` }
  return { ...s.riskBanner, backgroundColor: 'rgba(34,197,94,0.10)', border: `1 solid rgba(34,197,94,0.30)` }
}

function riskBannerText(level: RiskLevel): string {
  if (level === 'critical') return 'CRITICAL RISK — Sanctioned entity detected in document'
  if (level === 'high')     return 'HIGH RISK — ICIJ offshore leak connections or elevated risk found'
  if (level === 'medium')   return 'MEDIUM RISK — Further due diligence recommended'
  return 'LOW RISK — No immediate flags detected'
}

function entityCardStyle(level: RiskLevel) {
  if (level === 'critical') return s.entityCardCritical
  if (level === 'high')     return s.entityCardHigh
  return s.entityCard
}

function sanctionBadge(status: string) {
  if (status === 'listed')     return <Text style={s.badgeListed}>LISTED</Text>
  if (status === 'not_listed') return <Text style={s.badgeClear}>NOT LISTED</Text>
  return <Text style={s.badgeUnknown}>UNKNOWN</Text>
}

function riskBadge(level: RiskLevel) {
  if (level === 'critical') return <Text style={s.badgeCritical}>CRITICAL</Text>
  if (level === 'high')     return <Text style={s.badgeHigh}>HIGH</Text>
  if (level === 'medium')   return <Text style={s.badgeMedium}>MEDIUM</Text>
  return <Text style={s.badgeLow}>LOW</Text>
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ReportHeader({ generatedAt }: { generatedAt: string }) {
  return (
    <View style={s.header}>
      <View>
        <Text style={s.brand}>ETI</Text>
        <Text style={s.brandSub}>Energy Trade Inspection</Text>
      </View>
      <View>
        <Text style={s.reportDate}>Document Screening Report</Text>
        <Text style={s.reportDate}>Generated {generatedAt}</Text>
      </View>
    </View>
  )
}

function ReportFooter() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>
        energytradeinspection.com — For authorized compliance use only
      </Text>
      <Text
        style={s.footerText}
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  )
}

function EntityCard({ result }: { result: EntityScreeningResult }) {
  const { extracted, sanctionStatus, dbEntity, icijConnections, pscDeficiencyRate, riskLevel } =
    result
  const icijCount = icijConnections?.length ?? 0

  return (
    <View style={entityCardStyle(riskLevel)}>
      {/* Name + type */}
      <Text style={s.entityTypePill}>
        {extracted.type.toUpperCase()}
        {extracted.imo ? ` · IMO ${extracted.imo}` : ''}
        {extracted.passport ? ` · Passport: ${extracted.passport}` : ''}
      </Text>
      <Text style={s.entityName}>{extracted.name}</Text>

      {/* Sanction status */}
      <View style={s.entityRow}>
        <Text style={s.entityLabel}>Sanctions</Text>
        {sanctionBadge(sanctionStatus)}
      </View>

      {/* Risk level */}
      <View style={s.entityRow}>
        <Text style={s.entityLabel}>Risk Level</Text>
        {riskBadge(riskLevel)}
      </View>

      {/* DB match */}
      {dbEntity && (
        <View style={s.entityRow}>
          <Text style={s.entityLabel}>Database Match</Text>
          <Text style={s.entityValue}>
            {dbEntity.name} (score {dbEntity.authenticityScore})
          </Text>
        </View>
      )}

      {/* ICIJ connections */}
      {icijCount > 0 && (
        <View style={s.entityRow}>
          <Text style={s.entityLabel}>ICIJ Offshore Links</Text>
          <Text style={s.entityValue}>{icijCount} connection{icijCount !== 1 ? 's' : ''}</Text>
        </View>
      )}
      {icijCount > 0 && (
        <Text style={s.icijNote}>
          Offshore leak connections detected — review ICIJ database for details
        </Text>
      )}

      {/* PSC deficiency rate */}
      {pscDeficiencyRate != null && (
        <View style={s.entityRow}>
          <Text style={s.entityLabel}>PSC Deficiency Rate</Text>
          <Text style={s.entityValue}>
            {Math.round(pscDeficiencyRate * 100)}%
            {pscDeficiencyRate > 0.3 ? ' — Elevated' : ''}
          </Text>
        </View>
      )}

      {/* Context excerpt */}
      {extracted.context && (
        <Text style={s.context}>&ldquo;{extracted.context}&rdquo;</Text>
      )}
    </View>
  )
}

// ── Trade Assessment Section ──────────────────────────────────────────────────

const FLAG_SEVERITY_COLOR: Record<string, string> = {
  critical: C.listed,
  high:     C.warn,
  medium:   C.yellow,
  low:      C.clear,
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

function TradeAssessmentSection({ assessment }: { assessment: TradeAssessmentResult }) {
  const { params, flags, overallRisk, summary } = assessment

  return (
    <View>
      <Text style={s.sectionTitle}>Trade Assessment</Text>

      {/* Extracted trade parameters */}
      <View style={{ ...s.entityCard, marginBottom: 10 }}>
        <Text style={{ ...s.entityTypePill, marginBottom: 8 }}>Extracted Trade Parameters</Text>
        {params.seller && (
          <View style={s.tradeParamRow}>
            <Text style={s.tradeParamLabel}>Seller</Text>
            <Text style={s.tradeParamValue}>{params.seller}</Text>
          </View>
        )}
        {params.vessel && (
          <View style={s.tradeParamRow}>
            <Text style={s.tradeParamLabel}>Vessel</Text>
            <Text style={s.tradeParamValue}>
              {params.vessel}{params.imo ? ` (IMO ${params.imo})` : ''}
            </Text>
          </View>
        )}
        {params.loadingPort && (
          <View style={s.tradeParamRow}>
            <Text style={s.tradeParamLabel}>Loading Port</Text>
            <Text style={s.tradeParamValue}>{params.loadingPort}</Text>
          </View>
        )}
        {params.commodity && (
          <View style={s.tradeParamRow}>
            <Text style={s.tradeParamLabel}>Commodity</Text>
            <Text style={s.tradeParamValue}>{params.commodity}</Text>
          </View>
        )}
        {params.tradeDate && (
          <View style={s.tradeParamRow}>
            <Text style={s.tradeParamLabel}>Trade Date</Text>
            <Text style={s.tradeParamValue}>{params.tradeDate}</Text>
          </View>
        )}
        <View style={{ ...s.tradeParamRow, marginTop: 4 }}>
          <Text style={s.tradeParamLabel}>Trade Risk</Text>
          {riskBadge(overallRisk)}
        </View>
      </View>

      {/* Flags */}
      {flags.length > 0 && (
        <View style={{ ...s.entityCard, marginBottom: 10 }}>
          <Text style={{ ...s.entityTypePill, marginBottom: 8 }}>
            Risk Flags ({flags.length})
          </Text>
          {flags.map((flag, i) => (
            <View key={i} style={s.flagRow}>
              <View
                style={{
                  ...s.flagSeverityDot,
                  backgroundColor: FLAG_SEVERITY_COLOR[flag.severity] ?? C.textMuted,
                }}
              />
              <View style={s.flagBody}>
                <Text style={s.flagReason}>
                  {FLAG_LABEL[flag.code] ?? flag.code} — {flag.reason}
                </Text>
                {flag.evidence.slice(0, 2).map((ev, j) => (
                  <Text key={j} style={s.flagEvidence}>• {ev}</Text>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Analyst summary */}
      <Text style={s.tradeSummary}>{summary}</Text>
    </View>
  )
}

// ── Main document ─────────────────────────────────────────────────────────────

export function ScreeningReportDocument({
  report,
  generatedAt,
}: {
  report: ScreeningReport
  generatedAt: string
}) {
  const { filename, screenedAt, overallRisk, entities, tradeAssessment } = report

  return (
    <Document
      title={`Screening Report — ${filename}`}
      author="Energy Trade Inspection"
      subject="Document entity risk screening"
    >
      <Page size="A4" style={s.page}>
        <ReportHeader generatedAt={generatedAt} />

        {/* Overall risk banner */}
        <View style={riskBgStyle(overallRisk)}>
          <Text
            style={{
              ...s.riskBannerTitle,
              color: riskColor(overallRisk),
            }}
          >
            {riskBannerText(overallRisk)}
          </Text>
          <Text style={s.riskBannerSub}>
            Screened {fmtDate(screenedAt)} · {entities.length} entit{entities.length !== 1 ? 'ies' : 'y'} extracted from {filename}
          </Text>
        </View>

        {/* Summary stats */}
        <View style={s.metaRow}>
          <View style={s.metaBox}>
            <Text style={s.metaLabel}>Overall Risk</Text>
            <Text style={{ ...s.metaValue, color: riskColor(overallRisk) }}>
              {overallRisk.toUpperCase()}
            </Text>
          </View>
          <View style={s.metaBox}>
            <Text style={s.metaLabel}>Entities Screened</Text>
            <Text style={s.metaValue}>{entities.length}</Text>
            <Text style={s.metaNote}>
              {entities.filter((e) => e.extracted.type === 'company').length} co ·{' '}
              {entities.filter((e) => e.extracted.type === 'person').length} person ·{' '}
              {entities.filter((e) => e.extracted.type === 'vessel').length} vessel
            </Text>
          </View>
          <View style={s.metaBox}>
            <Text style={s.metaLabel}>Sanction Hits</Text>
            <Text
              style={{
                ...s.metaValue,
                color:
                  entities.some((e) => e.sanctionStatus === 'listed') ? C.listed : C.clear,
              }}
            >
              {entities.filter((e) => e.sanctionStatus === 'listed').length}
            </Text>
            <Text style={s.metaNote}>
              {entities.filter((e) => (e.icijConnections?.length ?? 0) > 0).length} ICIJ flag
              {entities.filter((e) => (e.icijConnections?.length ?? 0) > 0).length !== 1
                ? 's'
                : ''}
            </Text>
          </View>
        </View>

        {/* Entity cards */}
        <Text style={s.sectionTitle}>
          Screened Entities ({entities.length})
        </Text>

        {entities.map((result, i) => (
          <EntityCard key={i} result={result} />
        ))}

        {/* Trade assessment (when available) */}
        {tradeAssessment && (
          <TradeAssessmentSection assessment={tradeAssessment} />
        )}

        <ReportFooter />
      </Page>
    </Document>
  )
}

/**
 * PDF report document — rendered server-side via @react-pdf/renderer.
 * Used by /api/report/[id]/route.ts for Starter+ users.
 */

import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import type { Company, Vessel } from '@/lib/types'
import { getScoreTier } from '@/lib/utils'

// ── Palette ───────────────────────────────────────────────────────────────────

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
  white:     '#ffffff',
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  page: {
    backgroundColor: C.bg,
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 48,
    fontFamily: 'Helvetica',
  },
  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 28,
    paddingBottom: 16,
    borderBottom: `1 solid ${C.border}`,
  },
  brand: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    color: C.textPri,
    letterSpacing: -0.5,
  },
  brandSub: {
    fontSize: 9,
    color: C.textMuted,
    marginTop: 3,
  },
  reportDate: {
    fontSize: 9,
    color: C.textMuted,
    textAlign: 'right',
  },
  // Entity header
  entityType: {
    fontSize: 9,
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  entityName: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    color: C.textPri,
    marginBottom: 4,
  },
  entitySub: {
    fontSize: 11,
    color: C.textSec,
    fontFamily: 'Helvetica',
    marginBottom: 20,
  },
  // Score row
  scoreRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  scoreBox: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 6,
    padding: 14,
    border: `1 solid ${C.border}`,
  },
  scoreLabel: {
    fontSize: 8,
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  scoreValue: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: C.accent,
  },
  scoreValueGood: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: C.clear,
  },
  scoreValueBad: {
    fontSize: 20,
    fontFamily: 'Helvetica-Bold',
    color: C.listed,
  },
  scoreNote: {
    fontSize: 8,
    color: C.textMuted,
    marginTop: 3,
  },
  // Section
  sectionTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginTop: 20,
  },
  // Table rows
  row: {
    flexDirection: 'row',
    paddingVertical: 7,
    borderBottom: `1 solid ${C.border}`,
  },
  rowLabel: {
    width: 160,
    fontSize: 10,
    color: C.textMuted,
  },
  rowValue: {
    flex: 1,
    fontSize: 10,
    color: C.textPri,
  },
  // Director / flag cards
  card: {
    backgroundColor: C.surface,
    borderRadius: 6,
    padding: 12,
    border: `1 solid ${C.border}`,
    marginBottom: 8,
  },
  cardName: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: C.textPri,
    marginBottom: 3,
  },
  cardSub: {
    fontSize: 9,
    color: C.textSec,
  },
  // Risk severity pill
  severityCritical: { color: C.listed,  fontSize: 9, fontFamily: 'Helvetica-Bold' },
  severityHigh:     { color: '#f97316', fontSize: 9, fontFamily: 'Helvetica-Bold' },
  severityMedium:   { color: '#eab308', fontSize: 9, fontFamily: 'Helvetica-Bold' },
  severityLow:      { color: C.textMuted, fontSize: 9, fontFamily: 'Helvetica-Bold' },
  // Footer
  footer: {
    position: 'absolute',
    bottom: 28,
    left: 48,
    right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTop: `1 solid ${C.border}`,
    paddingTop: 10,
  },
  footerText: {
    fontSize: 8,
    color: C.textMuted,
  },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
}

function sanctionLabel(status: string) {
  if (status === 'listed')     return 'LISTED'
  if (status === 'not_listed') return 'NOT LISTED'
  return 'UNKNOWN'
}

function severityStyle(sev: string) {
  if (sev === 'critical') return s.severityCritical
  if (sev === 'high')     return s.severityHigh
  if (sev === 'medium')   return s.severityMedium
  return s.severityLow
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
        <Text style={s.reportDate}>Confidential Compliance Report</Text>
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

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  )
}

// ── Company PDF ───────────────────────────────────────────────────────────────

export function CompanyReportDocument({
  company,
  generatedAt,
}: {
  company: Company
  generatedAt: string
}) {
  const tier = getScoreTier(company.authenticityScore)

  return (
    <Document
      title={`${company.name} — Compliance Report`}
      author="Energy Trade Inspection"
      subject="Sanction screening and authenticity verification"
    >
      <Page size="A4" style={s.page}>
        <ReportHeader generatedAt={generatedAt} />

        {/* Entity identity */}
        <Text style={s.entityType}>Company Report</Text>
        <Text style={s.entityName}>{company.name}</Text>
        <Text style={s.entitySub}>
          {company.jurisdictionFlag} {company.country} · {company.registrationNumber}
        </Text>

        {/* Score cards */}
        <View style={s.scoreRow}>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Authenticity Score</Text>
            <Text style={s.scoreValue}>{company.authenticityScore}/100</Text>
            <Text style={s.scoreNote}>{tier}</Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Sanction Status</Text>
            <Text style={
              company.sanctionStatus === 'listed'
                ? s.scoreValueBad
                : company.sanctionStatus === 'not_listed'
                ? s.scoreValueGood
                : s.scoreValue
            }>
              {sanctionLabel(company.sanctionStatus)}
            </Text>
            <Text style={s.scoreNote}>OFAC · EU FSF · UN</Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Risk Level</Text>
            <Text style={s.scoreValue}>{company.riskLevel.toUpperCase()}</Text>
            <Text style={s.scoreNote}>Last verified {fmtDate(company.lastVerified)}</Text>
          </View>
        </View>

        {/* Registration */}
        <Text style={s.sectionTitle}>Registration Details</Text>
        <InfoRow label="Legal name"       value={company.name} />
        <InfoRow label="Registration no." value={company.registrationNumber} />
        <InfoRow label="Country"          value={`${company.jurisdictionFlag} ${company.country}`} />
        {company.incorporationDate && (
          <InfoRow label="Incorporation date" value={fmtDate(company.incorporationDate)} />
        )}
        {company.registeredAddress && (
          <InfoRow label="Registered address" value={company.registeredAddress} />
        )}

        {/* Score breakdown */}
        <Text style={s.sectionTitle}>Score Breakdown</Text>
        <InfoRow
          label="Entity Existence"
          value={`${company.scoreBreakdown.entityExistence.score} / ${company.scoreBreakdown.entityExistence.maxScore}`}
        />
        <InfoRow
          label="Asset Reality"
          value={`${company.scoreBreakdown.assetReality.score} / ${company.scoreBreakdown.assetReality.maxScore}`}
        />
        <InfoRow
          label="Document Consistency"
          value={`${company.scoreBreakdown.documentConsistency.score} / ${company.scoreBreakdown.documentConsistency.maxScore}`}
        />
        <InfoRow
          label="Community Reputation"
          value={`${company.scoreBreakdown.communityReputation.score} / ${company.scoreBreakdown.communityReputation.maxScore}`}
        />
        <InfoRow
          label="Trading Track Record"
          value="Pending (Phase 2)"
        />

        {/* Directors */}
        {company.directors && company.directors.length > 0 && (
          <>
            <Text style={s.sectionTitle}>
              Directors &amp; Officers ({company.directors.length})
            </Text>
            {company.directors.map((d) => (
              <View key={d.id} style={s.card}>
                <Text style={s.cardName}>{d.name}</Text>
                <Text style={s.cardSub}>
                  {d.role}
                  {d.nationality ? ` · ${d.nationality}` : ''}
                  {d.appointedDate ? ` · Since ${new Date(d.appointedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}` : ''}
                </Text>
              </View>
            ))}
          </>
        )}

        {/* Associated vessels */}
        {company.vessels && company.vessels.length > 0 && (
          <>
            <Text style={s.sectionTitle}>
              Associated Vessels ({company.vessels.length})
            </Text>
            {company.vessels.map((v) => (
              <View key={v.imo} style={s.card}>
                <Text style={s.cardName}>{v.name}</Text>
                <Text style={s.cardSub}>IMO {v.imo} · {v.flag}</Text>
              </View>
            ))}
          </>
        )}

        {/* Risk flags */}
        {company.riskFlags && company.riskFlags.length > 0 && (
          <>
            <Text style={s.sectionTitle}>
              Risk Flags ({company.riskFlags.length})
            </Text>
            {company.riskFlags.map((f) => (
              <View key={f.id} style={s.row}>
                <Text style={s.rowLabel}>{f.category}</Text>
                <Text style={severityStyle(f.severity)}>{f.severity.toUpperCase()}</Text>
                <Text style={{ ...s.rowValue, textAlign: 'right', color: C.textMuted, fontSize: 9 }}>
                  {fmtDate(f.submittedAt)}
                </Text>
              </View>
            ))}
          </>
        )}

        {/* Data sources */}
        <Text style={s.sectionTitle}>Data Sources</Text>
        {company.dataSource.map((src) => (
          <InfoRow key={src} label={src} value="Active" />
        ))}

        <ReportFooter />
      </Page>
    </Document>
  )
}

// ── Vessel PDF ────────────────────────────────────────────────────────────────

export function VesselReportDocument({
  vessel,
  generatedAt,
}: {
  vessel: Vessel
  generatedAt: string
}) {
  const tier = getScoreTier(vessel.authenticityScore)

  return (
    <Document
      title={`${vessel.name} (IMO ${vessel.imo}) — Compliance Report`}
      author="Energy Trade Inspection"
      subject="Sanction screening and authenticity verification"
    >
      <Page size="A4" style={s.page}>
        <ReportHeader generatedAt={generatedAt} />

        {/* Entity identity */}
        <Text style={s.entityType}>Vessel Report</Text>
        <Text style={s.entityName}>{vessel.name}</Text>
        <Text style={s.entitySub}>
          {vessel.jurisdictionFlag} {vessel.flag} · IMO {vessel.imo} · {vessel.vesselType}
        </Text>

        {/* Score cards */}
        <View style={s.scoreRow}>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Authenticity Score</Text>
            <Text style={s.scoreValue}>{vessel.authenticityScore}/100</Text>
            <Text style={s.scoreNote}>{tier}</Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Sanction Status</Text>
            <Text style={
              vessel.sanctionStatus === 'listed'
                ? s.scoreValueBad
                : vessel.sanctionStatus === 'not_listed'
                ? s.scoreValueGood
                : s.scoreValue
            }>
              {sanctionLabel(vessel.sanctionStatus)}
            </Text>
            <Text style={s.scoreNote}>OFAC · EU FSF · UN</Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Risk Level</Text>
            <Text style={s.scoreValue}>{vessel.riskLevel.toUpperCase()}</Text>
            <Text style={s.scoreNote}>Last verified {fmtDate(vessel.lastVerified)}</Text>
          </View>
        </View>

        {/* Vessel particulars */}
        <Text style={s.sectionTitle}>Vessel Particulars</Text>
        <InfoRow label="Vessel name"  value={vessel.name} />
        <InfoRow label="IMO number"   value={vessel.imo} />
        {vessel.mmsi && <InfoRow label="MMSI" value={vessel.mmsi} />}
        <InfoRow label="Vessel type"  value={vessel.vesselType} />
        <InfoRow label="Flag state"   value={`${vessel.jurisdictionFlag} ${vessel.flag}`} />
        {vessel.grossTonnage && (
          <InfoRow label="Gross tonnage" value={`${vessel.grossTonnage.toLocaleString()} GT`} />
        )}
        {vessel.yearBuilt && (
          <InfoRow label="Year built" value={String(vessel.yearBuilt)} />
        )}
        {vessel.currentOperator && (
          <InfoRow label="Current operator" value={vessel.currentOperator} />
        )}

        {/* Score breakdown */}
        <Text style={s.sectionTitle}>Score Breakdown</Text>
        <InfoRow
          label="Entity Existence"
          value={`${vessel.scoreBreakdown.entityExistence.score} / ${vessel.scoreBreakdown.entityExistence.maxScore}`}
        />
        <InfoRow
          label="Asset Reality"
          value={`${vessel.scoreBreakdown.assetReality.score} / ${vessel.scoreBreakdown.assetReality.maxScore}`}
        />
        <InfoRow
          label="Document Consistency"
          value={`${vessel.scoreBreakdown.documentConsistency.score} / ${vessel.scoreBreakdown.documentConsistency.maxScore}`}
        />
        <InfoRow
          label="Community Reputation"
          value={`${vessel.scoreBreakdown.communityReputation.score} / ${vessel.scoreBreakdown.communityReputation.maxScore}`}
        />
        <InfoRow
          label="Trading Track Record"
          value="Pending (Phase 2)"
        />

        {/* Risk flags */}
        {vessel.riskFlags && vessel.riskFlags.length > 0 && (
          <>
            <Text style={s.sectionTitle}>
              Risk Flags ({vessel.riskFlags.length})
            </Text>
            {vessel.riskFlags.map((f) => (
              <View key={f.id} style={s.row}>
                <Text style={s.rowLabel}>{f.category}</Text>
                <Text style={severityStyle(f.severity)}>{f.severity.toUpperCase()}</Text>
                <Text style={{ ...s.rowValue, textAlign: 'right', color: C.textMuted, fontSize: 9 }}>
                  {fmtDate(f.submittedAt)}
                </Text>
              </View>
            ))}
          </>
        )}

        {/* Data sources */}
        <Text style={s.sectionTitle}>Data Sources</Text>
        {vessel.dataSource.map((src) => (
          <InfoRow key={src} label={src} value="Active" />
        ))}

        <ReportFooter />
      </Page>
    </Document>
  )
}

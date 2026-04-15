/**
 * PDF report document — rendered server-side via @react-pdf/renderer.
 * Used by /api/report/[id]/route.ts for Starter+ users.
 *
 * Supports: Company · Vessel (with optional AIS snapshot) · Terminal
 * Optional intelligence section included for all entity types.
 */

import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import type { Company, Terminal, Vessel } from '@/lib/types'
import type { VesselAisData } from '@/lib/ais-types'
import { getScoreTier } from '@/lib/utils'

// ── Intelligence shape (minimal cast from cache JSONB) ────────────────────────

interface TavilySnippet {
  title?: string
  url?: string
  domain?: string
  snippet?: string
}

interface IntelCache {
  sanctions_hits?:    TavilySnippet[]
  existence_check?:   TavilySnippet[]
  registration_info?: TavilySnippet[]
  ownership_info?:    TavilySnippet[]
  risk_signals?:      TavilySnippet[]
  tracking_info?:     TavilySnippet[]
}

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
  warn:      '#f97316',
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
  // Sanction warning banner
  sanctionBanner: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
    border: `1 solid rgba(239,68,68,0.35)`,
  },
  sanctionBannerText: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.listed,
  },
  sanctionBannerSub: {
    fontSize: 9,
    color: C.textSec,
    marginTop: 4,
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
  // Cards (director, vessel, port call)
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
  // Risk severity
  severityCritical: { color: C.listed,   fontSize: 9, fontFamily: 'Helvetica-Bold' },
  severityHigh:     { color: C.warn,     fontSize: 9, fontFamily: 'Helvetica-Bold' },
  severityMedium:   { color: '#eab308',  fontSize: 9, fontFamily: 'Helvetica-Bold' },
  severityLow:      { color: C.textMuted, fontSize: 9, fontFamily: 'Helvetica-Bold' },
  // Dark period warning card
  warnCard: {
    backgroundColor: 'rgba(249,115,22,0.08)',
    borderRadius: 6,
    padding: 12,
    border: `1 solid rgba(249,115,22,0.25)`,
    marginBottom: 8,
  },
  warnCardTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.warn,
    marginBottom: 3,
  },
  warnCardSub: {
    fontSize: 9,
    color: C.textSec,
  },
  // Intelligence snippet
  intelCard: {
    backgroundColor: C.surface,
    borderRadius: 5,
    padding: 10,
    border: `1 solid ${C.border}`,
    marginBottom: 6,
  },
  intelTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: C.textPri,
    marginBottom: 3,
  },
  intelDomain: {
    fontSize: 8,
    color: C.accent,
    marginBottom: 4,
  },
  intelSnippet: {
    fontSize: 9,
    color: C.textSec,
    lineHeight: 1.5,
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
  footerText: {
    fontSize: 8,
    color: C.textMuted,
  },
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

function fmtDateShort(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
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

function navStatusLabel(status: string): string {
  const map: Record<string, string> = {
    underway_engine:          'Underway (engine)',
    anchored:                 'Anchored',
    moored:                   'Moored',
    restricted_manoeuvrability: 'Restricted manoeuvrability',
    not_under_command:        'Not under command',
    undefined:                'Unknown',
  }
  return map[status] ?? status
}

// ── Shared sub-components ─────────────────────────────────────────────────────

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

function SanctionBanner() {
  return (
    <View style={s.sanctionBanner}>
      <Text style={s.sanctionBannerText}>
        SANCTIONS ALERT — This entity appears on one or more international sanction lists.
      </Text>
      <Text style={s.sanctionBannerSub}>
        Exercise enhanced due diligence. Consult legal counsel before engaging.
        Screening covers OFAC, EU FSF, and UN consolidated lists.
      </Text>
    </View>
  )
}

function ScoreBreakdownSection({ breakdown }: { breakdown: Company['scoreBreakdown'] }) {
  return (
    <>
      <Text style={s.sectionTitle}>Score Breakdown</Text>
      <InfoRow
        label="Entity Existence"
        value={`${breakdown.entityExistence.score} / ${breakdown.entityExistence.maxScore}`}
      />
      <InfoRow
        label="Asset Reality"
        value={`${breakdown.assetReality.score} / ${breakdown.assetReality.maxScore}`}
      />
      <InfoRow
        label="Document Consistency"
        value={`${breakdown.documentConsistency.score} / ${breakdown.documentConsistency.maxScore}`}
      />
      <InfoRow
        label="Community Reputation"
        value={`${breakdown.communityReputation.score} / ${breakdown.communityReputation.maxScore}`}
      />
      <InfoRow label="Trading Track Record" value="Pending (Phase 2)" />
    </>
  )
}

function RiskFlagsSection({ flags }: { flags: Company['riskFlags'] }) {
  if (!flags?.length) return null
  return (
    <>
      <Text style={s.sectionTitle}>Risk Flags ({flags.length})</Text>
      {flags.map((f) => (
        <View key={f.id} style={s.row}>
          <Text style={s.rowLabel}>{f.category}</Text>
          <Text style={severityStyle(f.severity)}>{f.severity.toUpperCase()}</Text>
          <Text style={{ ...s.rowValue, textAlign: 'right', color: C.textMuted, fontSize: 9 }}>
            {fmtDate(f.submittedAt)}
          </Text>
        </View>
      ))}
    </>
  )
}

function DataSourcesSection({ sources }: { sources: string[] }) {
  return (
    <>
      <Text style={s.sectionTitle}>Data Sources</Text>
      {sources.map((src) => (
        <InfoRow key={src} label={src} value="Active" />
      ))}
    </>
  )
}

// ── Intelligence section ──────────────────────────────────────────────────────

function IntelSnippets({ label, items }: { label: string; items: TavilySnippet[] }) {
  if (!items.length) return null
  const top = items.slice(0, 3)
  return (
    <>
      <Text style={{ ...s.sectionTitle, marginTop: 12 }}>
        {label} ({items.length} {items.length === 1 ? 'result' : 'results'})
      </Text>
      {top.map((item, i) => (
        <View key={i} style={s.intelCard}>
          {item.title ? <Text style={s.intelTitle}>{item.title}</Text> : null}
          {item.domain ? <Text style={s.intelDomain}>{item.domain}</Text> : null}
          {item.snippet ? (
            <Text style={s.intelSnippet}>
              {item.snippet.length > 280 ? item.snippet.slice(0, 280) + '…' : item.snippet}
            </Text>
          ) : null}
        </View>
      ))}
      {items.length > 3 && (
        <Text style={{ fontSize: 9, color: C.textMuted, marginBottom: 4 }}>
          +{items.length - 3} more result{items.length - 3 > 1 ? 's' : ''} — view full report online
        </Text>
      )}
    </>
  )
}

function IntelligenceSection({ intel, entityType }: { intel: IntelCache; entityType: string }) {
  const hasSanctionHits    = (intel.sanctions_hits?.length ?? 0) > 0
  const hasExistence       = (intel.existence_check?.length ?? 0) > 0
  const hasRegistration    = (intel.registration_info?.length ?? 0) > 0
  const hasOwnership       = (intel.ownership_info?.length ?? 0) > 0
  const hasRiskSignals     = (intel.risk_signals?.length ?? 0) > 0
  const hasTracking        = (intel.tracking_info?.length ?? 0) > 0

  const hasAny = hasSanctionHits || hasExistence || hasRegistration ||
                 hasOwnership || hasRiskSignals || hasTracking
  if (!hasAny) return null

  return (
    <>
      <Text style={{ ...s.sectionTitle, marginTop: 24 }}>Web Intelligence (Tavily)</Text>

      {hasSanctionHits && (
        <IntelSnippets label="Sanctions Hits" items={intel.sanctions_hits!} />
      )}
      {hasExistence && entityType !== 'company' && (
        <IntelSnippets label="Existence Verification" items={intel.existence_check!} />
      )}
      {hasRegistration && entityType === 'company' && (
        <IntelSnippets label="Registration Info" items={intel.registration_info!} />
      )}
      {hasOwnership && (
        <IntelSnippets label="Ownership & Operator Info" items={intel.ownership_info!} />
      )}
      {hasRiskSignals && (
        <IntelSnippets label="Risk Signals" items={intel.risk_signals!} />
      )}
      {hasTracking && (
        <IntelSnippets label="Tracking Info" items={intel.tracking_info!} />
      )}
    </>
  )
}

// ── AIS section (vessel only) ─────────────────────────────────────────────────

function AisSection({ ais }: { ais: VesselAisData }) {
  const pos = ais.position

  return (
    <>
      <Text style={s.sectionTitle}>AIS Tracking Data</Text>
      <Text style={{ fontSize: 8, color: C.textMuted, marginBottom: 8 }}>
        Source: {ais.provider} · Data as of {fmtDateShort(ais.fetchedAt)}
      </Text>

      {pos ? (
        <>
          <InfoRow label="Latitude / Longitude" value={`${pos.lat.toFixed(4)}°, ${pos.lon.toFixed(4)}°`} />
          <InfoRow label="Speed"                value={`${pos.speed} kn`} />
          <InfoRow label="Navigation status"    value={navStatusLabel(pos.status)} />
          {pos.destination && <InfoRow label="Destination" value={pos.destination} />}
          {pos.eta         && <InfoRow label="ETA"         value={pos.eta} />}
          {pos.draught > 0 && (
            <InfoRow label="Current draught" value={`${pos.draught.toFixed(1)} m`} />
          )}
          <InfoRow label="Last AIS update" value={fmtDateShort(pos.lastUpdate)} />
        </>
      ) : (
        <InfoRow label="Position" value="No live position available" />
      )}

      {/* Recent port calls */}
      {ais.portCalls.length > 0 && (
        <>
          <Text style={{ ...s.sectionTitle, marginTop: 14 }}>
            Recent Port Calls ({ais.portCalls.length})
          </Text>
          {ais.portCalls.slice(0, 6).map((pc, i) => (
            <View key={i} style={s.card}>
              <Text style={s.cardName}>
                {pc.portName} {pc.locode ? `(${pc.locode})` : ''} · {pc.portCountry}
              </Text>
              <Text style={s.cardSub}>
                Arrived {fmtDateShort(pc.arrival)}
                {pc.departure ? ` · Departed ${fmtDateShort(pc.departure)}` : ' · Still in port'}
                {pc.durationHours != null
                  ? ` · ${pc.durationHours < 24
                      ? `${pc.durationHours}h`
                      : `${Math.round(pc.durationHours / 24)}d`}`
                  : ''}
                {pc.event !== 'port_call' ? ` · ${pc.event.replace('_', ' ')}` : ''}
              </Text>
            </View>
          ))}
          {ais.portCalls.length > 6 && (
            <Text style={{ fontSize: 9, color: C.textMuted, marginBottom: 4 }}>
              +{ais.portCalls.length - 6} earlier calls — view online for full history
            </Text>
          )}
        </>
      )}

      {/* Dark periods */}
      {ais.darkPeriods.length > 0 && (
        <>
          <Text style={{ ...s.sectionTitle, marginTop: 14 }}>
            AIS Dark Periods ({ais.darkPeriods.length}) — Elevated Risk
          </Text>
          {ais.darkPeriods.map((dp, i) => (
            <View key={i} style={s.warnCard}>
              <Text style={s.warnCardTitle}>
                Signal loss {fmtDateShort(dp.start)}
                {dp.end ? ` – ${fmtDateShort(dp.end)}` : ' (ongoing)'}
                {dp.durationHours != null
                  ? ` · ${dp.durationHours < 24
                      ? `${dp.durationHours}h`
                      : `${Math.round(dp.durationHours / 24)}d`}`
                  : ''}
              </Text>
              {dp.location && (
                <Text style={s.warnCardSub}>Last known location: {dp.location}</Text>
              )}
            </View>
          ))}
        </>
      )}
    </>
  )
}

// ── Company PDF ───────────────────────────────────────────────────────────────

export function CompanyReportDocument({
  company,
  generatedAt,
  intel,
}: {
  company: Company
  generatedAt: string
  intel?: IntelCache
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

        {company.sanctionStatus === 'listed' && <SanctionBanner />}

        <Text style={s.entityType}>Company Report</Text>
        <Text style={s.entityName}>{company.name}</Text>
        <Text style={s.entitySub}>
          {company.jurisdictionFlag} {company.country} · {company.registrationNumber}
        </Text>

        <View style={s.scoreRow}>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Authenticity Score</Text>
            <Text style={s.scoreValue}>{company.authenticityScore}/100</Text>
            <Text style={s.scoreNote}>{tier}</Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Sanction Status</Text>
            <Text style={
              company.sanctionStatus === 'listed'     ? s.scoreValueBad  :
              company.sanctionStatus === 'not_listed' ? s.scoreValueGood : s.scoreValue
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
        <InfoRow label="Legal name"          value={company.name} />
        <InfoRow label="Registration no."    value={company.registrationNumber} />
        <InfoRow label="Country"             value={`${company.jurisdictionFlag} ${company.country}`} />
        {company.incorporationDate && (
          <InfoRow label="Incorporation date" value={fmtDate(company.incorporationDate)} />
        )}
        {company.registeredAddress && (
          <InfoRow label="Registered address" value={company.registeredAddress} />
        )}

        <ScoreBreakdownSection breakdown={company.scoreBreakdown} />

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
                  {d.appointedDate
                    ? ` · Since ${new Date(d.appointedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}`
                    : ''}
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

        <RiskFlagsSection flags={company.riskFlags} />

        {intel && <IntelligenceSection intel={intel} entityType="company" />}

        <DataSourcesSection sources={company.dataSource} />

        <ReportFooter />
      </Page>
    </Document>
  )
}

// ── Vessel PDF ────────────────────────────────────────────────────────────────

export function VesselReportDocument({
  vessel,
  generatedAt,
  ais,
  intel,
}: {
  vessel: Vessel
  generatedAt: string
  ais?: VesselAisData
  intel?: IntelCache
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

        {vessel.sanctionStatus === 'listed' && <SanctionBanner />}

        <Text style={s.entityType}>Vessel Report</Text>
        <Text style={s.entityName}>{vessel.name}</Text>
        <Text style={s.entitySub}>
          {vessel.jurisdictionFlag} {vessel.flag} · IMO {vessel.imo} · {vessel.vesselType}
        </Text>

        <View style={s.scoreRow}>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Authenticity Score</Text>
            <Text style={s.scoreValue}>{vessel.authenticityScore}/100</Text>
            <Text style={s.scoreNote}>{tier}</Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Sanction Status</Text>
            <Text style={
              vessel.sanctionStatus === 'listed'     ? s.scoreValueBad  :
              vessel.sanctionStatus === 'not_listed' ? s.scoreValueGood : s.scoreValue
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
        <InfoRow label="Vessel name"       value={vessel.name} />
        <InfoRow label="IMO number"        value={vessel.imo} />
        {vessel.mmsi && <InfoRow label="MMSI" value={vessel.mmsi} />}
        <InfoRow label="Vessel type"       value={vessel.vesselType} />
        <InfoRow label="Flag state"        value={`${vessel.jurisdictionFlag} ${vessel.flag}`} />
        {vessel.grossTonnage && (
          <InfoRow label="Gross tonnage"   value={`${vessel.grossTonnage.toLocaleString()} GT`} />
        )}
        {vessel.yearBuilt && (
          <InfoRow label="Year built"      value={String(vessel.yearBuilt)} />
        )}
        {vessel.currentOperator && (
          <InfoRow label="Current operator" value={vessel.currentOperator} />
        )}

        <ScoreBreakdownSection breakdown={vessel.scoreBreakdown} />

        {ais && <AisSection ais={ais} />}

        <RiskFlagsSection flags={vessel.riskFlags} />

        {intel && <IntelligenceSection intel={intel} entityType="vessel" />}

        <DataSourcesSection sources={vessel.dataSource} />

        <ReportFooter />
      </Page>
    </Document>
  )
}

// ── Terminal PDF ──────────────────────────────────────────────────────────────

export function TerminalReportDocument({
  terminal,
  generatedAt,
  intel,
}: {
  terminal: Terminal
  generatedAt: string
  intel?: IntelCache
}) {
  const tier = getScoreTier(terminal.authenticityScore)

  return (
    <Document
      title={`${terminal.name} — Compliance Report`}
      author="Energy Trade Inspection"
      subject="Sanction screening and authenticity verification"
    >
      <Page size="A4" style={s.page}>
        <ReportHeader generatedAt={generatedAt} />

        {terminal.sanctionStatus === 'listed' && <SanctionBanner />}

        <Text style={s.entityType}>Terminal Report</Text>
        <Text style={s.entityName}>{terminal.name}</Text>
        <Text style={s.entitySub}>
          {terminal.jurisdictionFlag} {terminal.country}
          {terminal.location ? ` · ${terminal.location}` : ''}
          {terminal.terminalType ? ` · ${terminal.terminalType}` : ''}
        </Text>

        <View style={s.scoreRow}>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Authenticity Score</Text>
            <Text style={s.scoreValue}>{terminal.authenticityScore}/100</Text>
            <Text style={s.scoreNote}>{tier}</Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Sanction Status</Text>
            <Text style={
              terminal.sanctionStatus === 'listed'     ? s.scoreValueBad  :
              terminal.sanctionStatus === 'not_listed' ? s.scoreValueGood : s.scoreValue
            }>
              {sanctionLabel(terminal.sanctionStatus)}
            </Text>
            <Text style={s.scoreNote}>OFAC · EU FSF · UN</Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Risk Level</Text>
            <Text style={s.scoreValue}>{terminal.riskLevel.toUpperCase()}</Text>
            <Text style={s.scoreNote}>Last verified {fmtDate(terminal.lastVerified)}</Text>
          </View>
        </View>

        {/* Terminal particulars */}
        <Text style={s.sectionTitle}>Terminal Particulars</Text>
        <InfoRow label="Terminal name"   value={terminal.name} />
        {terminal.terminalType && (
          <InfoRow label="Terminal type"   value={terminal.terminalType} />
        )}
        <InfoRow label="Country"          value={`${terminal.jurisdictionFlag} ${terminal.country}`} />
        {terminal.location && (
          <InfoRow label="Location"        value={terminal.location} />
        )}
        {terminal.operator && (
          <InfoRow label="Operator"        value={terminal.operator} />
        )}
        {terminal.capacity != null && (
          <InfoRow label="Capacity"        value={`${terminal.capacity.toLocaleString()} m³`} />
        )}

        <ScoreBreakdownSection breakdown={terminal.scoreBreakdown} />

        <RiskFlagsSection flags={terminal.riskFlags} />

        {intel && <IntelligenceSection intel={intel} entityType="terminal" />}

        <DataSourcesSection sources={terminal.dataSource} />

        <ReportFooter />
      </Page>
    </Document>
  )
}

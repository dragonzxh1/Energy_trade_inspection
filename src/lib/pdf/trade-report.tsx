/**
 * Trade risk check PDF report.
 * Rendered server-side via @react-pdf/renderer.
 * Used by GET /api/trade/[id]/report.
 */

import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import type { TradeCheckResult, TradePartyResult, TradeVesselResult, TradePortResult } from '@/app/api/trade/route'
import type { TradeFlag } from '@/lib/server/trade-rules'
import type { RiskLevel } from '@/lib/types'

// ── Palette (same as entity report) ──────────────────────────────────────────

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
  medium:    '#eab308',
}

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: C.listed,
  high:     C.warn,
  medium:   C.medium,
  low:      C.clear,
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
  brand:     { fontSize: 18, fontFamily: 'Helvetica-Bold', color: C.textPri, letterSpacing: -0.5 },
  brandSub:  { fontSize: 9,  color: C.textMuted, marginTop: 3 },
  reportDate:{ fontSize: 9,  color: C.textMuted, textAlign: 'right' },

  // Overall risk banner
  riskBanner: {
    borderRadius: 6,
    padding: 14,
    marginBottom: 20,
  },
  riskBannerLabel:  { fontSize: 8,  fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  riskBannerValue:  { fontSize: 24, fontFamily: 'Helvetica-Bold' },
  riskBannerSummary:{ fontSize: 9,  marginTop: 6, lineHeight: 1.5 },

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
  rowLabel: { width: 150, fontSize: 10, color: C.textMuted },
  rowValue: { flex: 1,    fontSize: 10, color: C.textPri   },

  // Flag card
  flagCard: {
    borderRadius: 6,
    padding: 12,
    marginBottom: 8,
    border: `1 solid ${C.border}`,
  },
  flagHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  flagCode:    { fontSize: 9,  fontFamily: 'Helvetica-Bold', flex: 1 },
  flagTarget:  { fontSize: 8,  color: C.textMuted, marginLeft: 8 },
  flagReason:  { fontSize: 9,  color: C.textSec,  lineHeight: 1.5, marginBottom: 4 },
  flagEvLabel: { fontSize: 8,  color: C.textMuted, marginBottom: 2 },
  flagEvItem:  { fontSize: 8,  color: C.textMuted, paddingLeft: 8, marginBottom: 1 },

  // Summary score boxes
  scoreRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  scoreBox: {
    flex: 1,
    backgroundColor: C.surface,
    borderRadius: 6,
    padding: 12,
    border: `1 solid ${C.border}`,
  },
  scoreLabel: { fontSize: 8, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },
  scoreValue: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  scoreNote:  { fontSize: 8,  color: C.textMuted, marginTop: 3 },

  // Party / vessel card
  partyCard: {
    backgroundColor: C.surface,
    borderRadius: 6,
    padding: 12,
    border: `1 solid ${C.border}`,
    marginBottom: 8,
  },
  partyName: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.textPri, marginBottom: 3 },
  partySub:  { fontSize: 9,  color: C.textSec, marginBottom: 6 },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 24, left: 48, right: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTop: `1 solid ${C.border}`,
    paddingTop: 10,
  },
  footerText: { fontSize: 8, color: C.textMuted },
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch { return iso }
}

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    })
  } catch { return iso }
}

const FLAG_LABEL: Record<string, string> = {
  NO_REGISTRY_MATCH:          'No Registry Match',
  SANCTION_EXPOSURE:          'Sanction Exposure',
  LIMITED_BUSINESS_FOOTPRINT: 'Limited Business Footprint',
  GEO_MISMATCH:               'Geographic Mismatch',
  NO_RECENT_ACTIVITY:         'No Recent AIS Activity',
  INCONSISTENT_TRADE_STORY:   'Inconsistent Trade Story',
}

const TARGET_LABEL: Record<string, string> = {
  seller: 'Counterparty',
  vessel: 'Vessel',
  trade:  'Trade',
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
        <Text style={s.reportDate}>Trade Risk Check Report</Text>
        <Text style={s.reportDate}>Generated {generatedAt}</Text>
      </View>
    </View>
  )
}

function ReportFooter() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>energytradeinspection.com — For authorized compliance use only</Text>
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

function RiskBanner({ result }: { result: TradeCheckResult }) {
  const color = RISK_COLOR[result.overallRisk]
  return (
    <View style={[s.riskBanner, { backgroundColor: `${color}18`, border: `1 solid ${color}50` }]}>
      <Text style={[s.riskBannerLabel, { color }]}>Overall Risk Assessment</Text>
      <Text style={[s.riskBannerValue, { color }]}>{result.overallRisk.toUpperCase()}</Text>
      <Text style={[s.riskBannerSummary, { color: C.textSec }]}>{result.summary}</Text>
    </View>
  )
}

function FlagSection({ flags }: { flags: TradeFlag[] }) {
  if (flags.length === 0) {
    return (
      <>
        <Text style={s.sectionTitle}>Risk Flags</Text>
        <Text style={{ fontSize: 10, color: C.textMuted }}>No risk flags raised.</Text>
      </>
    )
  }

  const sorted = [...flags].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 }
    return order[a.severity] - order[b.severity]
  })

  return (
    <>
      <Text style={s.sectionTitle}>Risk Flags ({flags.length})</Text>
      {sorted.map((f, i) => {
        const color = RISK_COLOR[f.severity]
        return (
          <View key={i} style={[s.flagCard, { backgroundColor: `${color}0d`, border: `1 solid ${color}30` }]}>
            <View style={s.flagHeader}>
              <Text style={[s.flagCode, { color }]}>
                {FLAG_LABEL[f.code] ?? f.code} — {f.severity.toUpperCase()}
              </Text>
              <Text style={s.flagTarget}>{TARGET_LABEL[f.target] ?? f.target}</Text>
            </View>
            <Text style={s.flagReason}>{f.reason}</Text>
            {f.evidence.length > 0 && (
              <>
                <Text style={s.flagEvLabel}>Evidence:</Text>
                {f.evidence.map((ev, j) => (
                  <Text key={j} style={s.flagEvItem}>· {ev}</Text>
                ))}
              </>
            )}
          </View>
        )
      })}
    </>
  )
}

function SellerSection({ seller }: { seller: TradePartyResult }) {
  const sanctionColor = seller.sanctionStatus === 'listed' ? C.listed : C.clear
  return (
    <>
      <Text style={s.sectionTitle}>Counterparty (Seller)</Text>
      <View style={s.partyCard}>
        <Text style={s.partyName}>{seller.name}</Text>
        <Text style={[s.partySub, { color: sanctionColor }]}>
          {seller.sanctionStatus === 'listed' ? 'SANCTIONED' : 'Not sanctioned'}
          {seller.sanctionSources.length > 0 ? ` — ${seller.sanctionSources.slice(0, 2).join(', ')}` : ''}
        </Text>
        <InfoRow label="Risk level"        value={seller.riskLevel.toUpperCase()} />
        <InfoRow label="Registry match"    value={seller.dbMatch ? seller.dbMatch.name : 'Not found in registry'} />
        {seller.dbMatch?.registrationNumber && (
          <InfoRow label="Registration no." value={seller.dbMatch.registrationNumber} />
        )}
        {seller.dbMatch?.country && (
          <InfoRow label="Jurisdiction"     value={seller.dbMatch.country.toUpperCase()} />
        )}
        <InfoRow label="ICIJ connections"  value={seller.icijConnections > 0 ? `${seller.icijConnections} link(s) found` : 'None detected'} />
      </View>
    </>
  )
}

function VesselSection({ vessel }: { vessel: TradeVesselResult }) {
  const sanctionColor = vessel.sanctionStatus === 'listed' ? C.listed : C.clear
  const aisAgeOk = vessel.hasRecentAis
  return (
    <>
      <Text style={s.sectionTitle}>Vessel</Text>
      <View style={s.partyCard}>
        <Text style={s.partyName}>
          {vessel.name}{vessel.imo ? ` (IMO ${vessel.imo})` : ''}
        </Text>
        <Text style={[s.partySub, { color: sanctionColor }]}>
          {vessel.sanctionStatus === 'listed' ? 'SANCTIONED' : 'Not sanctioned'}
          {vessel.sanctionSources.length > 0 ? ` — ${vessel.sanctionSources.slice(0, 2).join(', ')}` : ''}
        </Text>
        <InfoRow label="Risk level"      value={vessel.riskLevel.toUpperCase()} />
        <InfoRow label="Registry match"  value={vessel.dbMatch ? vessel.dbMatch.name : 'Not found in registry'} />
        {vessel.dbMatch?.country && (
          <InfoRow label="Flag state"    value={vessel.dbMatch.country.toUpperCase()} />
        )}
        <InfoRow
          label="AIS tracking"
          value={aisAgeOk
            ? `Active — last update ${fmtDate(vessel.lastAisUpdate)}`
            : vessel.lastAisUpdate
              ? `Stale — last update ${fmtDate(vessel.lastAisUpdate)}`
              : 'No AIS data available'}
        />
        <InfoRow label="AIS dark periods" value={vessel.darkPeriods > 0 ? `${vessel.darkPeriods} period(s) detected` : 'None detected'} />
        {vessel.psc && vessel.psc.totalInspections > 0 && (
          <InfoRow
            label="PSC inspections"
            value={`${vessel.psc.totalInspections} total · ${vessel.psc.detentions} detention(s) · ${Math.round(vessel.psc.deficiencyRate * 100)}% deficiency rate`}
          />
        )}
      </View>
    </>
  )
}

function PortSection({ port }: { port: TradePortResult }) {
  return (
    <>
      <Text style={s.sectionTitle}>Loading Port</Text>
      <View style={s.partyCard}>
        <Text style={s.partyName}>
          {port.name ?? port.locode}
          {port.name && port.locode !== port.name ? ` (${port.locode})` : ''}
        </Text>
        <Text style={s.partySub}>
          {port.found ? 'Port found in database' : 'Port not found in database'}
          {port.isStsZone ? ' · STS Anchorage Zone' : ''}
        </Text>
        {port.isStsZone && (
          <Text style={{ fontSize: 9, color: C.warn, marginBottom: 6 }}>
            This is a ship-to-ship transfer anchorage, not a commercial berth.
          </Text>
        )}
        {port.draftRisk?.vesselDraftM != null && (
          <InfoRow label="Vessel draught"   value={`${port.draftRisk.vesselDraftM.toFixed(1)} m`} />
        )}
        {port.draftRisk?.portMaxDraftM != null && (
          <InfoRow label="Port max draft"   value={`${port.draftRisk.portMaxDraftM.toFixed(1)} m`} />
        )}
        {port.draftRisk?.marginM != null && (
          <InfoRow
            label="Draft clearance"
            value={`${port.draftRisk.marginM >= 0 ? '+' : ''}${port.draftRisk.marginM.toFixed(1)} m${port.draftRisk.marginM < 0 ? ' — CANNOT BERTH' : ''}`}
          />
        )}
        {port.draftRisk?.warning && (
          <Text style={{ fontSize: 9, color: C.listed, marginTop: 4, lineHeight: 1.5 }}>
            {port.draftRisk.warning}
          </Text>
        )}
      </View>
    </>
  )
}

// ── Main document ─────────────────────────────────────────────────────────────

export function TradeReportDocument({ result }: { result: TradeCheckResult }) {
  const generatedAt = fmtDateTime(new Date().toISOString())
  const criticalCount = result.flags.filter(f => f.severity === 'critical').length
  const highCount     = result.flags.filter(f => f.severity === 'high').length

  return (
    <Document
      title={`Trade Risk Check — ${result.input.seller} / ${result.input.vessel}`}
      author="Energy Trade Inspection"
      subject="Trade transaction risk assessment"
    >
      <Page size="A4" style={s.page}>
        <ReportHeader generatedAt={generatedAt} />

        {/* Overall risk banner */}
        <RiskBanner result={result} />

        {/* Transaction summary */}
        <Text style={s.sectionTitle}>Transaction Details</Text>
        <InfoRow label="Seller / Counterparty" value={result.input.seller} />
        <InfoRow label="Vessel"                value={result.input.vessel + (result.vessel.imo ? ` (IMO ${result.vessel.imo})` : '')} />
        {result.input.date && (
          <InfoRow label="Trade date"          value={fmtDate(result.input.date)} />
        )}
        {result.input.loadingPort && (
          <InfoRow label="Loading port"        value={result.input.loadingPort + (result.port?.name ? ` — ${result.port.name}` : '')} />
        )}
        {result.input.commodity && (
          <InfoRow label="Commodity"           value={result.input.commodity} />
        )}
        <InfoRow label="Check reference"       value={result.id} />
        <InfoRow label="Checked at"            value={fmtDateTime(result.checkedAt)} />

        {/* Score summary boxes */}
        <View style={[s.scoreRow, { marginTop: 20 }]}>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Overall Risk</Text>
            <Text style={[s.scoreValue, { color: RISK_COLOR[result.overallRisk] }]}>
              {result.overallRisk.toUpperCase()}
            </Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Flags Raised</Text>
            <Text style={[s.scoreValue, { color: result.flags.length > 0 ? C.warn : C.clear }]}>
              {result.flags.length}
            </Text>
            <Text style={s.scoreNote}>
              {criticalCount > 0 ? `${criticalCount} critical` : ''}
              {criticalCount > 0 && highCount > 0 ? ' · ' : ''}
              {highCount > 0 ? `${highCount} high` : ''}
              {result.flags.length === 0 ? 'None' : ''}
            </Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Seller Status</Text>
            <Text style={[s.scoreValue, { color: result.seller.sanctionStatus === 'listed' ? C.listed : C.clear, fontSize: 12 }]}>
              {result.seller.sanctionStatus === 'listed' ? 'SANCTIONED' : 'NOT LISTED'}
            </Text>
            <Text style={s.scoreNote}>OFAC · EU FSF · UN</Text>
          </View>
          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>Vessel Status</Text>
            <Text style={[s.scoreValue, { color: result.vessel.sanctionStatus === 'listed' ? C.listed : C.clear, fontSize: 12 }]}>
              {result.vessel.sanctionStatus === 'listed' ? 'SANCTIONED' : 'NOT LISTED'}
            </Text>
            <Text style={s.scoreNote}>OFAC · EU FSF · UN</Text>
          </View>
        </View>

        {/* Risk flags */}
        <FlagSection flags={result.flags} />

        {/* Seller details */}
        <SellerSection seller={result.seller} />

        {/* Vessel details */}
        <VesselSection vessel={result.vessel} />

        {/* Port details */}
        {result.port && <PortSection port={result.port} />}

        {/* Disclaimer */}
        <Text style={{ ...s.sectionTitle, marginTop: 28 }}>Disclaimer</Text>
        <Text style={{ fontSize: 8, color: C.textMuted, lineHeight: 1.6 }}>
          This report is generated automatically based on data available at the time of the check.
          It is intended as a compliance tool to assist due diligence, not as a definitive legal
          determination. Users are responsible for verifying findings and consulting legal counsel
          before making compliance decisions. Data sources include OpenSanctions (OFAC, EU FSF, UN,
          UK OFSI), AIS tracking providers, and public maritime registries.
        </Text>

        <ReportFooter />
      </Page>
    </Document>
  )
}

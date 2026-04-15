import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getScoreTier, buildVesselJsonLd, buildVesselNarrative } from '@/lib/utils'
import SanctionBadge from '@/components/entity/SanctionBadge'
import RiskBadge from '@/components/entity/RiskBadge'
import ScoreGauge from '@/components/entity/ScoreGauge'
import TabNav from '@/components/entity/TabNav'
import ContentLock from '@/components/entity/ContentLock'
import Header from '@/components/layout/Header'
import type { Vessel } from '@/lib/types'
import { getEntityByKey, getPscSummary, getPscInspections } from '@/lib/server/repository'
import type { PscSummary, PscInspection } from '@/lib/server/repository'
import { consumeQuota } from '@/lib/server/quota'
import { auth } from '@/auth'
import { getEntityWatchState } from '@/lib/server/watchlist'
import WatchButton from '@/components/entity/WatchButton'
import IntelligencePanel from '@/components/entity/IntelligencePanel'
import AisPanel from '@/components/entity/AisPanel'
import DraftCheckPanel from '@/components/entity/DraftCheckPanel'
import WarningBadge from '@/components/entity/WarningBadge'
import { getWarningHits } from '@/lib/server/warning-lists'
import type { WarningHit } from '@/lib/types'

interface PageProps {
  params: Promise<{ imo: string }>
}

export const revalidate = 86400

async function getVessel(imo: string): Promise<Vessel | null> {
  const entity = await getEntityByKey(imo)
  if (!entity || entity.type !== 'vessel') return null
  return entity as Vessel
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { imo } = await params
  const vessel = await getVessel(imo)
  if (!vessel) return { title: 'Vessel Not Found' }
  const tier = getScoreTier(vessel.authenticityScore)
  return {
    title: `${vessel.name} (IMO ${vessel.imo}) — Sanction Status & Verification`,
    description: `${vessel.name}, IMO ${vessel.imo} — ${tier}. Authenticity score: ${vessel.authenticityScore}/100. Sanction status: ${vessel.sanctionStatus.replace('_', ' ')}. Flag: ${vessel.flag}.`,
  }
}

// 鈹€鈹€ Shared styles 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

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

const row: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  padding: 'var(--space-3) 0',
  borderBottom: '1px solid var(--border-subtle)',
}

const rowLabel: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '13px',
  flexShrink: 0,
  marginRight: 'var(--space-4)',
  width: '160px',
}

const rowValue: React.CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: '13px',
  textAlign: 'right',
}

const emptyState: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  textAlign: 'center',
  padding: 'var(--space-8) 0',
}

// 鈹€鈹€ Tab panel components 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div style={row}>
      <span style={rowLabel}>{label}</span>
      <span style={rowValue}>{value}</span>
    </div>
  )
}

function VesselDetailsPanel({ vessel }: { vessel: Vessel }) {
  return (
    <div style={card}>
      <p style={sectionTitle}>Vessel Particulars</p>
      <InfoRow label="IMO number"    value={<span className="mono">{vessel.imo}</span>} />
      {vessel.mmsi && <InfoRow label="MMSI" value={<span className="mono">{vessel.mmsi}</span>} />}
      <InfoRow label="Vessel name"   value={vessel.name} />
      <InfoRow label="Vessel type"   value={vessel.vesselType} />
      <InfoRow label="Flag state"    value={`${vessel.jurisdictionFlag} ${vessel.flag}`} />
      {vessel.grossTonnage && (
        <InfoRow label="Gross tonnage" value={vessel.grossTonnage.toLocaleString() + ' GT'} />
      )}
      {vessel.yearBuilt && (
        <InfoRow label="Year built"    value={String(vessel.yearBuilt)} />
      )}
      {vessel.currentOperator && (
        <InfoRow label="Current operator" value={vessel.currentOperator} />
      )}
      {vessel.ownerCompanySlug && (
        <InfoRow
          label="Owner company"
          value={
            <a
              href={`/company/${vessel.ownerCompanySlug}`}
              style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}
            >
              View Profile
            </a>
          }
        />
      )}
      <InfoRow
        label="Sanction status"
        value={
          <span
            style={{
              color: vessel.sanctionStatus === 'listed'
                ? 'var(--status-listed)'
                : vessel.sanctionStatus === 'not_listed'
                ? 'var(--status-clear)'
                : 'var(--text-muted)',
              fontWeight: 500,
            }}
          >
            {vessel.sanctionStatus === 'not_listed'
              ? 'Not Listed'
              : vessel.sanctionStatus === 'listed'
              ? 'Listed'
              : 'Unknown'}
          </span>
        }
      />
      <InfoRow
        label="Last verified"
        value={new Date(vessel.lastVerified).toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
        })}
      />
    </div>
  )
}

function RiskFlagsPanel({ vessel }: { vessel: Vessel }) {
  const SEVERITY_COLOR: Record<string, string> = {
    critical: 'var(--status-listed)',
    high:     '#f97316',
    medium:   '#eab308',
    low:      'var(--text-muted)',
  }

  if (!vessel.riskFlags?.length) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Risk Flags</p>
        <p style={emptyState}>No risk flags have been submitted for this vessel.</p>
      </div>
    )
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Risk Flags ({vessel.riskFlags.length})</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {vessel.riskFlags.map((f) => (
          <div
            key={f.id}
            className="data-row"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3) 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: SEVERITY_COLOR[f.severity] ?? 'var(--text-muted)',
                  flexShrink: 0,
                }}
              />
              <div>
                <p style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500 }}>
                  {f.category}
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
                  {new Date(f.submittedAt).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </p>
              </div>
            </div>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: SEVERITY_COLOR[f.severity] ?? 'var(--text-muted)',
              }}
            >
              {f.severity}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PscSummaryPanel({ summary }: { summary: PscSummary }) {
  const resultColor = (result: string | null) => {
    if (result === 'detained')      return 'var(--status-listed)'
    if (result === 'deficiency')    return '#f97316'
    if (result === 'no_deficiency') return 'var(--status-clear)'
    return 'var(--text-muted)'
  }
  const resultLabel = (result: string | null) => {
    if (result === 'detained')      return 'Detained'
    if (result === 'deficiency')    return 'Deficiency found'
    if (result === 'no_deficiency') return 'No deficiency'
    return '-'
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Port State Control Summary</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        {[
          { label: 'Inspections', value: summary.totalInspections },
          { label: 'Detentions',  value: summary.detentions },
          { label: 'Deficiency rate', value: summary.totalInspections > 0 ? `${Math.round(summary.deficiencyRate * 100)}%` : '-' },
        ].map(({ label, value }) => (
          <div key={label} style={{ textAlign: 'center', padding: 'var(--space-3)', backgroundColor: 'var(--bg-elevated)', borderRadius: '8px' }}>
            <p style={{ color: 'var(--text-primary)', fontSize: '20px', fontWeight: 700 }}>{value}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>{label}</p>
          </div>
        ))}
      </div>
      {summary.lastInspectionDate && (
        <div style={{ ...row, borderBottom: 'none' }}>
          <span style={rowLabel}>Last inspection</span>
          <span style={rowValue}>
            {new Date(summary.lastInspectionDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
            {' '}
            <span style={{ color: resultColor(summary.lastResult), fontWeight: 500 }}>
              ({resultLabel(summary.lastResult)})
            </span>
          </span>
        </div>
      )}
      {summary.totalInspections === 0 && (
        <p style={emptyState}>No port state control inspections on record.</p>
      )}
    </div>
  )
}

function PscInspectionsPanel({ inspections }: { inspections: PscInspection[] }) {
  const RESULT_COLOR: Record<string, string> = {
    detained:      'var(--status-listed)',
    deficiency:    '#f97316',
    no_deficiency: 'var(--status-clear)',
  }
  const RESULT_LABEL: Record<string, string> = {
    detained:      'Detained',
    deficiency:    'Deficiency',
    no_deficiency: 'Clear',
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Recent Inspections ({inspections.length})</p>
      {inspections.map((ins) => (
        <div key={ins.id} className="data-row" style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500 }}>
                  {ins.portName ?? ins.portLocode ?? 'Unknown port'} · {ins.authority}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
                {new Date(ins.inspectionDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                  {ins.deficiencyCount > 0 && ` · ${ins.deficiencyCount} deficienc${ins.deficiencyCount === 1 ? 'y' : 'ies'}`}
                  {ins.detentionDays && ` · Detained ${ins.detentionDays}d`}
              </p>
              {ins.deficiencies.length > 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '4px', fontStyle: 'italic' }}>
                  {ins.deficiencies.slice(0, 3).join(', ')}{ins.deficiencies.length > 3 ? '...' : ''}
                </p>
              )}
            </div>
            <span style={{
              fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: RESULT_COLOR[ins.result] ?? 'var(--text-muted)',
              flexShrink: 0, marginLeft: 'var(--space-3)',
            }}>
              {RESULT_LABEL[ins.result] ?? ins.result}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function SourcesPanel({ sources }: { sources: string[] }) {
  const SOURCE_LINKS: Record<string, string> = {
    'IMO GISIS':     'https://gisis.imo.org',
    'Paris MOU':     'https://www.parismou.org',
    'OpenSanctions': 'https://www.opensanctions.org',
    'VesselFinder':  'https://www.vesselfinder.com',
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Data Sources</p>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {sources.map((src) => (
          <div
            key={src}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3) 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <span style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{src}</span>
            {SOURCE_LINKS[src] && (
              <a
                href={SOURCE_LINKS[src]}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent-primary)', fontSize: '12px', textDecoration: 'none' }}
              >
                View Source
              </a>
            )}
          </div>
        ))}
      </div>
      <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px', lineHeight: '18px' }}>
        Vessel data sourced from international maritime registries.
        Sanction screening covers OFAC, EU FSF, and UN lists.
      </p>
    </div>
  )
}

// 鈹€鈹€ Quota exceeded 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function QuotaExceededPage({ resetDate }: { resetDate: string }) {
  const reset = new Date(resetDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  return (
    <>
      <Header />
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8) var(--space-4)' }}>
        <div style={{ maxWidth: '400px', textAlign: 'center' }}>
          <p style={{ fontSize: '32px', marginBottom: 'var(--space-5)' }}>!</p>
          <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
            Monthly query limit reached
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '22px', marginBottom: 'var(--space-6)' }}>
            Your free plan includes 5 sanction checks per month.
            Your quota resets on {reset}. Upgrade for more access.
          </p>
          <Link
            href="/pricing"
            style={{
              display: 'inline-block',
              backgroundColor: 'var(--accent-primary)', color: '#fff',
              padding: 'var(--space-3) var(--space-6)', borderRadius: '8px',
              fontSize: '14px', fontWeight: 500, textDecoration: 'none',
            }}
          >
            Upgrade plan
          </Link>
          <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px' }}>
            Already upgraded?{' '}
            <Link href="/" style={{ color: 'var(--accent-primary)' }}>Return home</Link>
          </p>
        </div>
      </div>
    </>
  )
}

// 鈹€鈹€ Page 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export default async function VesselPage({ params }: PageProps) {
  const [{ imo }, session] = await Promise.all([params, auth()])

  // Quota enforcement for authenticated users
  if (session?.user) {
    const plan  = session.user.plan ?? 'free'
    const quota = await consumeQuota(session.user.id, plan, imo, imo)
    if (quota.blocked) return <QuotaExceededPage resetDate={quota.resetDate} />
  }

  const vessel = await getVessel(imo)

  if (!vessel) notFound()

  const tier    = getScoreTier(vessel.authenticityScore)
  const appUrl  = process.env.NEXT_PUBLIC_APP_URL ?? 'https://energytradeinspection.com'
  const plan    = session?.user?.plan ?? 'free'
  const f3Unlocked = !!session?.user && plan !== 'free'
  const lockReason = !session?.user ? 'guest' : 'free'

  // Watchlist check + PSC data (fetched in parallel)
  let isWatching = false
  const [watchlistRows, pscSummary, pscInspections] = await Promise.all([
    session?.user && (plan === 'professional' || plan === 'enterprise')
      ? getEntityWatchState(session.user.id, vessel.id)
      : Promise.resolve(false),
    getPscSummary(vessel.imo),
    f3Unlocked ? getPscInspections(vessel.imo, 10) : Promise.resolve([]),
  ])
  isWatching = watchlistRows

  const warningHits: WarningHit[] = await getWarningHits(vessel.name, 'vessel')

  const jsonLd = buildVesselJsonLd({
    name: vessel.name,
    imo: vessel.imo,
    flag: vessel.flag,
    score: vessel.authenticityScore,
    scoreTier: tier,
    sanctionStatus: vessel.sanctionStatus,
    appUrl,
    description: buildVesselNarrative(vessel),
  })

  const tabs = [
    { id: 'details',       label: 'Vessel Details' },
    { id: 'ais',           label: 'AIS Tracking' },
    { id: 'draft',         label: 'Draft Risk' },
    { id: 'flags',         label: 'Risk Flags' },
    { id: 'history',       label: 'PSC History' },
    { id: 'intelligence',  label: 'Intelligence' },
    { id: 'sources',       label: 'Sources' },
  ]

  const panels = [
    <VesselDetailsPanel key="details" vessel={vessel} />,
    <ContentLock key="ais" unlocked={f3Unlocked} reason={lockReason}>
      <AisPanel imo={vessel.imo} />
    </ContentLock>,
    <ContentLock key="draft" unlocked={f3Unlocked} reason={lockReason}>
      <DraftCheckPanel imo={vessel.imo} />
    </ContentLock>,
    <ContentLock key="flags" unlocked={f3Unlocked} reason={lockReason}>
      <RiskFlagsPanel vessel={vessel} />
    </ContentLock>,
    <div key="history" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <PscSummaryPanel summary={pscSummary} />
      <ContentLock unlocked={f3Unlocked} reason={lockReason}>
        <PscInspectionsPanel inspections={pscInspections} />
      </ContentLock>
    </div>,
    <ContentLock key="intelligence" unlocked={f3Unlocked} reason={lockReason}>
      <IntelligencePanel entityType="vessel" entityKey={vessel.imo} />
    </ContentLock>,
    <SourcesPanel key="sources" sources={vessel.dataSource} />,
  ]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Header entityName={vessel.name} sanctionStatus={vessel.sanctionStatus} />

      <div
        style={{
          maxWidth: 'var(--max-width)',
          margin: '0 auto',
          padding: 'var(--space-6) var(--space-4)',
        }}
      >
        <div className="entity-layout">
          <aside aria-label="Vessel summary" className="animate-fade-in-up">
            <ScoreGauge
              score={vessel.authenticityScore}
              tier={tier}
              breakdown={f3Unlocked ? vessel.scoreBreakdown : null}
              showBreakdown={f3Unlocked}
            />
            <div style={{ marginTop: 'var(--space-4)' }}>
              <SanctionBadge status={vessel.sanctionStatus} />
            </div>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <RiskBadge level={vessel.riskLevel} />
            </div>
            {warningHits.length > 0 && (
              <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                {warningHits.map(hit => (
                  <WarningBadge
                    key={hit.source}
                    source={hit.source}
                    sourceName={hit.source_name}
                    jurisdiction={hit.jurisdiction}
                  />
                ))}
              </div>
            )}

            {f3Unlocked ? (
              <a
                href={`/api/report/${vessel.imo}`}
                download
                style={{
                  display: 'block',
                  marginTop: 'var(--space-5)',
                  padding: 'var(--space-2) var(--space-3)',
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--accent-primary)',
                  fontSize: '12px',
                  fontWeight: 500,
                  textDecoration: 'none',
                  textAlign: 'center',
                }}
              >
                ↓ Download PDF Report
              </a>
            ) : (
              <p style={{ marginTop: 'var(--space-5)', color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center' }}>
                PDF export — Starter+
              </p>
            )}

            <WatchButton
              entityId={vessel.id}
              entityType="vessel"
              entityKey={vessel.imo}
              entityName={vessel.name}
              sanctionStatus={vessel.sanctionStatus}
              initialWatching={isWatching}
              plan={plan}
            />

            {/* External trackers */}
            <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <p style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '2px' }}>
                Track Vessel
              </p>
              <a
                href={`https://www.marinetraffic.com/en/ais/details/ships/imo:${vessel.imo}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  padding: 'var(--space-2) var(--space-3)',
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  textDecoration: 'none',
                  textAlign: 'center',
                }}
              >
                MarineTraffic
              </a>
              <a
                href={`https://www.vesselfinder.com/vessels?name=${encodeURIComponent(vessel.name)}&imo=${vessel.imo}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  padding: 'var(--space-2) var(--space-3)',
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  color: 'var(--text-muted)',
                  fontSize: '12px',
                  textDecoration: 'none',
                  textAlign: 'center',
                }}
              >
                VesselFinder
              </a>
            </div>
          </aside>

          <main className="animate-fade-in-up-delay-1">
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                {vessel.jurisdictionFlag} {vessel.flag} · {vessel.vesselType}
              </span>
            </div>
            <h1 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
              {vessel.name}
            </h1>
            <p
              className="mono"
              style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}
            >
              IMO {vessel.imo}
            </p>

            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '13px',
                lineHeight: '22px',
                marginBottom: 'var(--space-6)',
                maxWidth: '600px',
              }}
            >
              {buildVesselNarrative(vessel)}
            </p>

            <TabNav tabs={tabs} defaultTab="details" panels={panels} />
          </main>
        </div>
      </div>
    </>
  )
}





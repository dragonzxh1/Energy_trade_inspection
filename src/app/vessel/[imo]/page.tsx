import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getScoreTier, buildVesselJsonLd, buildVesselNarrative } from '@/lib/utils'
import SanctionBadge from '@/components/entity/SanctionBadge'
import RiskBadge from '@/components/entity/RiskBadge'
import ScoreGauge from '@/components/entity/ScoreGauge'
import TabNav from '@/components/entity/TabNav'
import Header from '@/components/layout/Header'
import type { Vessel } from '@/lib/types'
import { applyMigrations } from '@/lib/server/migrations'
import { getEntityByKey } from '@/lib/server/repository'

interface PageProps {
  params: Promise<{ imo: string }>
}

export const revalidate = 86400

async function getVessel(imo: string): Promise<Vessel | null> {
  await applyMigrations()
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

// ── Shared styles ────────────────────────────────────────────────────────────

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

// ── Tab panel components ─────────────────────────────────────────────────────

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
              View profile ↗
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

function PortHistoryPanel() {
  return (
    <div style={card}>
      <p style={sectionTitle}>Port State Control History</p>
      <div
        style={{
          textAlign: 'center',
          padding: 'var(--space-8) 0',
        }}
      >
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
          Port History — Phase 2
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '20px', maxWidth: '320px', margin: '0 auto' }}>
          Paris MOU and Tokyo MOU port state control inspection records will be available in Phase 2.
        </p>
      </div>
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
                View source ↗
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function VesselPage({ params }: PageProps) {
  const { imo } = await params
  const vessel = await getVessel(imo)

  if (!vessel) notFound()

  const tier = getScoreTier(vessel.authenticityScore)
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://energytradeinspection.com'

  const jsonLd = buildVesselJsonLd({
    name: vessel.name,
    imo: vessel.imo,
    flag: vessel.flag,
    score: vessel.authenticityScore,
    scoreTier: tier,
    sanctionStatus: vessel.sanctionStatus,
    appUrl,
  })

  const tabs = [
    { id: 'details',  label: 'Vessel Details' },
    { id: 'flags',    label: 'Risk Flags' },
    { id: 'history',  label: 'Port History' },
    { id: 'sources',  label: 'Sources' },
  ]

  const panels = [
    <VesselDetailsPanel key="details" vessel={vessel} />,
    <RiskFlagsPanel     key="flags"   vessel={vessel} />,
    <PortHistoryPanel   key="history" />,
    <SourcesPanel       key="sources" sources={vessel.dataSource} />,
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
              breakdown={vessel.scoreBreakdown}
            />
            <div style={{ marginTop: 'var(--space-4)' }}>
              <SanctionBadge status={vessel.sanctionStatus} />
            </div>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <RiskBadge level={vessel.riskLevel} />
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

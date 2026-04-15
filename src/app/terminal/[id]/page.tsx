import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getScoreTier, buildTerminalJsonLd, buildTerminalNarrative } from '@/lib/utils'
import SanctionBadge from '@/components/entity/SanctionBadge'
import RiskBadge from '@/components/entity/RiskBadge'
import ScoreGauge from '@/components/entity/ScoreGauge'
import TabNav from '@/components/entity/TabNav'
import ContentLock from '@/components/entity/ContentLock'
import Header from '@/components/layout/Header'
import type { Terminal } from '@/lib/types'
import { getEntityByKey } from '@/lib/server/repository'
import { consumeQuota } from '@/lib/server/quota'
import { auth } from '@/auth'
import { getEntityWatchState } from '@/lib/server/watchlist'
import WatchButton from '@/components/entity/WatchButton'
import IntelligencePanel from '@/components/entity/IntelligencePanel'
import WarningBadge from '@/components/entity/WarningBadge'
import { getWarningHits } from '@/lib/server/warning-lists'
import type { WarningHit } from '@/lib/types'

interface PageProps {
  params: Promise<{ id: string }>
}

export const revalidate = 86400

async function getTerminal(id: string): Promise<Terminal | null> {
  const entity = await getEntityByKey(id)
  if (!entity || entity.type !== 'terminal') return null
  return entity as Terminal
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const terminal = await getTerminal(id)
  if (!terminal) return { title: 'Terminal Not Found' }
  const tier = getScoreTier(terminal.authenticityScore)
  const locationPart = terminal.location ? `, ${terminal.location}` : ''
  return {
    title: `${terminal.name}${locationPart} — Sanction Status & Verification`,
    description: `${terminal.name} — ${tier}. Authenticity score: ${terminal.authenticityScore}/100. Sanction status: ${terminal.sanctionStatus.replace('_', ' ')}. Country: ${terminal.country}.`,
    openGraph: {
      title: `${terminal.name} — Energy Trade Inspection`,
      description: `Sanction status, authenticity score, and risk analysis for ${terminal.name}.`,
    },
  }
}

// ── Shared styles ─────────────────────────────────────────────────────────────

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

// ── Tab panel components ──────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null
  return (
    <div style={row}>
      <span style={rowLabel}>{label}</span>
      <span style={rowValue}>{value}</span>
    </div>
  )
}

function TerminalDetailsPanel({ terminal }: { terminal: Terminal }) {
  return (
    <div style={card}>
      <p style={sectionTitle}>Terminal Particulars</p>
      <InfoRow label="Terminal name"   value={terminal.name} />
      {terminal.terminalType && (
        <InfoRow label="Terminal type"   value={terminal.terminalType} />
      )}
      <InfoRow label="Country"         value={`${terminal.jurisdictionFlag} ${terminal.country}`} />
      {terminal.location && (
        <InfoRow label="Location"        value={terminal.location} />
      )}
      {terminal.operator && (
        <InfoRow label="Operator"        value={terminal.operator} />
      )}
      {terminal.capacity != null && (
        <InfoRow
          label="Capacity"
          value={`${terminal.capacity.toLocaleString()} m³`}
        />
      )}
      {terminal.ownerCompanySlug && (
        <InfoRow
          label="Owner company"
          value={
            <a
              href={`/company/${terminal.ownerCompanySlug}`}
              style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}
            >
              View profile ↗
            </a>
          }
        />
      )}
      {(terminal.name || terminal.location) && (
        <InfoRow
          label="View on map"
          value={
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                [terminal.name, terminal.location, terminal.country].filter(Boolean).join(' ')
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}
            >
              Google Maps ↗
            </a>
          }
        />
      )}
      <InfoRow
        label="Sanction status"
        value={
          <span
            style={{
              color: terminal.sanctionStatus === 'listed'
                ? 'var(--status-listed)'
                : terminal.sanctionStatus === 'not_listed'
                ? 'var(--status-clear)'
                : 'var(--text-muted)',
              fontWeight: 500,
            }}
          >
            {terminal.sanctionStatus === 'not_listed'
              ? 'Not Listed'
              : terminal.sanctionStatus === 'listed'
              ? 'Listed'
              : 'Unknown'}
          </span>
        }
      />
      <InfoRow
        label="Last verified"
        value={new Date(terminal.lastVerified).toLocaleDateString('en-US', {
          year: 'numeric', month: 'short', day: 'numeric',
        })}
      />
    </div>
  )
}

function RiskFlagsPanel({ terminal }: { terminal: Terminal }) {
  const SEVERITY_COLOR: Record<string, string> = {
    critical: 'var(--status-listed)',
    high:     '#f97316',
    medium:   '#eab308',
    low:      'var(--text-muted)',
  }

  if (!terminal.riskFlags?.length) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Risk Flags</p>
        <p style={emptyState}>No risk flags have been submitted for this terminal.</p>
      </div>
    )
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Risk Flags ({terminal.riskFlags.length})</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {terminal.riskFlags.map((f) => (
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

function SourcesPanel({ sources }: { sources: string[] }) {
  const SOURCE_LINKS: Record<string, string> = {
    'OpenSanctions': 'https://www.opensanctions.org',
    'UN Comtrade':   'https://comtradeplus.un.org',
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
        Terminal data sourced from trade registries and energy sector databases.
        Sanction screening covers OFAC, EU FSF, and UN lists.
      </p>
    </div>
  )
}

// ── Quota exceeded ─────────────────────────────────────────────────────────────

function QuotaExceededPage({ resetDate }: { resetDate: string }) {
  const reset = new Date(resetDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
  return (
    <>
      <Header />
      <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8) var(--space-4)' }}>
        <div style={{ maxWidth: '400px', textAlign: 'center' }}>
          <p style={{ fontSize: '32px', marginBottom: 'var(--space-5)' }}>⚠</p>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function TerminalPage({ params }: PageProps) {
  const [{ id }, session] = await Promise.all([params, auth()])

  // Quota enforcement for authenticated users
  if (session?.user) {
    const plan  = session.user.plan ?? 'free'
    const quota = await consumeQuota(session.user.id, plan, id, id)
    if (quota.blocked) return <QuotaExceededPage resetDate={quota.resetDate} />
  }

  const terminal = await getTerminal(id)

  if (!terminal) notFound()

  const tier       = getScoreTier(terminal.authenticityScore)
  const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? 'https://energytradeinspection.com'
  const plan       = session?.user?.plan ?? 'free'
  const f3Unlocked = !!session?.user && plan !== 'free'
  const lockReason = !session?.user ? 'guest' : 'free'

  // Watchlist check
  const isWatching =
    !!session?.user &&
    (plan === 'professional' || plan === 'enterprise')
      ? await getEntityWatchState(session.user.id, terminal.id)
      : false

  const warningHits: WarningHit[] = await getWarningHits(terminal.name, 'terminal')

  // Intelligence key: same as rescore.ts — slug ?? id
  const intelKey = terminal.slug ?? terminal.id

  const jsonLd = buildTerminalJsonLd({
    name:           terminal.name,
    location:       terminal.location,
    operator:       terminal.operator,
    country:        terminal.country,
    score:          terminal.authenticityScore,
    scoreTier:      tier,
    sanctionStatus: terminal.sanctionStatus,
    entityId:       terminal.id,
    appUrl,
    description:    buildTerminalNarrative(terminal),
  })

  const tabs = [
    { id: 'details',      label: 'Terminal Details' },
    { id: 'flags',        label: 'Risk Flags' },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'sources',      label: 'Sources' },
  ]

  const panels = [
    <TerminalDetailsPanel key="details" terminal={terminal} />,
    <ContentLock key="flags" unlocked={f3Unlocked} reason={lockReason}>
      <RiskFlagsPanel terminal={terminal} />
    </ContentLock>,
    <ContentLock key="intelligence" unlocked={f3Unlocked} reason={lockReason}>
      <IntelligencePanel entityType="terminal" entityKey={intelKey} />
    </ContentLock>,
    <SourcesPanel key="sources" sources={terminal.dataSource} />,
  ]

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <Header entityName={terminal.name} sanctionStatus={terminal.sanctionStatus} />

      <div
        style={{
          maxWidth: 'var(--max-width)',
          margin: '0 auto',
          padding: 'var(--space-6) var(--space-4)',
        }}
      >
        <div className="entity-layout">
          <aside aria-label="Terminal summary" className="animate-fade-in-up">
            <ScoreGauge
              score={terminal.authenticityScore}
              tier={tier}
              breakdown={f3Unlocked ? terminal.scoreBreakdown : null}
              showBreakdown={f3Unlocked}
            />
            <div style={{ marginTop: 'var(--space-4)' }}>
              <SanctionBadge status={terminal.sanctionStatus} />
            </div>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <RiskBadge level={terminal.riskLevel} />
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
                href={`/api/report/${terminal.id}`}
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
              entityId={terminal.id}
              entityType="terminal"
              entityKey={intelKey}
              entityName={terminal.name}
              sanctionStatus={terminal.sanctionStatus}
              initialWatching={isWatching}
              plan={plan}
            />
          </aside>

          <main className="animate-fade-in-up-delay-1">
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                {terminal.jurisdictionFlag} {terminal.country}
                {terminal.location && ` · ${terminal.location}`}
                {terminal.terminalType && ` · ${terminal.terminalType}`}
              </span>
            </div>
            <h1 style={{ color: 'var(--text-primary)', marginBottom: 'var(--space-2)' }}>
              {terminal.name}
            </h1>
            {terminal.operator && (
              <p
                style={{ color: 'var(--text-secondary)', marginBottom: 'var(--space-4)' }}
              >
                Operated by {terminal.operator}
              </p>
            )}

            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '13px',
                lineHeight: '22px',
                marginBottom: 'var(--space-6)',
                maxWidth: '600px',
              }}
            >
              {buildTerminalNarrative(terminal)}
            </p>

            <TabNav tabs={tabs} defaultTab="details" panels={panels} />
          </main>
        </div>
      </div>
    </>
  )
}





/**
 * /reports — Report history page.
 *
 * Shows the user's past trade checks and document screenings,
 * each with a PDF download link.
 *
 * Access: Starter+ plan users only.
 */

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { auth } from '@/auth'
import { getReportHistory, type ScreeningSessionRow, type TradeSessionRow } from '@/lib/server/report-history'

export const metadata: Metadata = {
  title: 'Reports — Energy Trade Inspection',
  robots: { index: false, follow: false },
}

// ── Types ─────────────────────────────────────────────────────────────────────

// ── Constants ─────────────────────────────────────────────────────────────────

const RISK_COLOR: Record<string, string> = {
  critical: 'var(--status-listed)',
  high:     '#f97316',
  medium:   '#f59e0b',
  low:      'var(--status-clear)',
}

const RISK_LABEL: Record<string, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day:   '2-digit',
    month: 'short',
    year:  'numeric',
  })
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ReportsPage() {

  const session = await auth()
  if (!session?.user) redirect('/sign-in?callbackUrl=/reports')

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return (
      <>
        <Header />
        <main style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}>
          <UpgradePrompt />
        </main>
      </>
    )
  }

  const userId = session.user.id

  const { tradeSessions, screeningSessions } = await getReportHistory(userId)

  return (
    <>
      <Header />
      <main
        style={{
          maxWidth: 'var(--max-width)',
          margin:   '0 auto',
          padding:  'var(--space-8) var(--space-4)',
        }}
      >
        <h1
          style={{
            fontSize:     '20px',
            fontWeight:   600,
            marginBottom: 'var(--space-6)',
            color:        'var(--text-primary)',
          }}
        >
          Reports
        </h1>

        {/* ── Trade Checks ── */}
        <section style={{ marginBottom: 'var(--space-8)' }}>
          <SectionHeading label="Trade Checks" count={tradeSessions.length} />
          {tradeSessions.length === 0 ? (
            <EmptyState
              message="No trade checks yet."
              cta={{ href: '/trade', label: 'Run a trade check' }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {tradeSessions.map((row) => (
                <TradeRow key={row.id} row={row} />
              ))}
            </div>
          )}
        </section>

        {/* ── Document Screenings ── */}
        <section>
          <SectionHeading label="Document Screenings" count={screeningSessions.length} />
          {screeningSessions.length === 0 ? (
            <EmptyState
              message="No document screenings yet."
              cta={{ href: '/screen', label: 'Screen a document' }}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {screeningSessions.map((row) => (
                <ScreeningRow key={row.id} row={row} />
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <h2
      style={{
        fontSize:      '12px',
        fontWeight:    600,
        color:         'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom:  'var(--space-3)',
      }}
    >
      {label}
      <span style={{ fontWeight: 400, marginLeft: '6px' }}>({count})</span>
    </h2>
  )
}

function RiskBadge({ risk }: { risk: string }) {
  const color = RISK_COLOR[risk] ?? 'var(--text-muted)'
  const label = RISK_LABEL[risk] ?? risk
  return (
    <span
      style={{
        fontSize:      '11px',
        fontWeight:    600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        color,
        border:        `1px solid ${color}`,
        borderRadius:  '4px',
        padding:       '2px 7px',
        flexShrink:    0,
      }}
    >
      {label}
    </span>
  )
}

function PdfLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        fontSize:    '12px',
        color:       'var(--accent-primary)',
        textDecoration: 'none',
        border:      '1px solid var(--accent-primary)',
        borderRadius: '4px',
        padding:     '4px 10px',
        flexShrink:  0,
      }}
    >
      PDF
    </Link>
  )
}

function RowShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display:         'flex',
        alignItems:      'center',
        gap:             'var(--space-4)',
        padding:         'var(--space-3) var(--space-4)',
        backgroundColor: 'var(--surface-card)',
        border:          '1px solid var(--border-subtle)',
        borderRadius:    '8px',
      }}
    >
      {children}
    </div>
  )
}

function TradeRow({ row }: { row: TradeSessionRow }) {
  const input = row.input_json
  return (
    <RowShell>
      <span
        style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0, minWidth: '90px' }}
      >
        {formatDate(row.created_at)}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
          {input.seller}
        </span>
        {input.vessel && (
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            {' · '}{input.vessel}
          </span>
        )}
        {(input.loadingPort || input.commodity) && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block' }}>
            {[input.loadingPort, input.commodity].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>

      {row.flag_count > 0 && (
        <span style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0 }}>
          {row.flag_count} flag{row.flag_count !== 1 ? 's' : ''}
        </span>
      )}

      <RiskBadge risk={row.overall_risk} />
      <PdfLink href={`/api/trade/${row.id}/report`} />
    </RowShell>
  )
}

function ScreeningRow({ row }: { row: ScreeningSessionRow }) {
  return (
    <RowShell>
      <span
        style={{ fontSize: '12px', color: 'var(--text-muted)', flexShrink: 0, minWidth: '90px' }}
      >
        {formatDate(row.created_at)}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize:     '13px',
            fontWeight:   500,
            color:        'var(--text-primary)',
            overflow:     'hidden',
            textOverflow: 'ellipsis',
            whiteSpace:   'nowrap',
            display:      'block',
          }}
          title={row.filename}
        >
          {row.filename}
        </span>
        {row.entity_count > 0 && (
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            {row.entity_count} entit{row.entity_count !== 1 ? 'ies' : 'y'} screened
          </span>
        )}
      </div>

      <RiskBadge risk={row.overall_risk ?? 'unknown'} />
      <PdfLink href={`/api/screen/report?sessionId=${row.id}`} />
    </RowShell>
  )
}

function EmptyState({
  message,
  cta,
}: {
  message: string
  cta: { href: string; label: string }
}) {
  return (
    <div
      style={{
        padding:   'var(--space-8)',
        textAlign: 'center',
        border:    '1px dashed var(--border-subtle)',
        borderRadius: '8px',
        color:     'var(--text-muted)',
        fontSize:  '13px',
      }}
    >
      <p style={{ margin: '0 0 var(--space-3)' }}>{message}</p>
      <Link href={cta.href} style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>
        {cta.label} →
      </Link>
    </div>
  )
}

function UpgradePrompt() {
  return (
    <div
      style={{
        padding:      'var(--space-8)',
        textAlign:    'center',
        border:       '1px dashed var(--border-subtle)',
        borderRadius: '8px',
      }}
    >
      <p
        style={{
          color:        'var(--text-secondary)',
          marginBottom: 'var(--space-4)',
          fontSize:     '14px',
        }}
      >
        Report history is available on Starter and above.
      </p>
      <Link
        href="/pricing"
        style={{
          backgroundColor: 'var(--accent-primary)',
          color:           '#fff',
          textDecoration:  'none',
          padding:         '8px 20px',
          borderRadius:    '6px',
          fontSize:        '13px',
          fontWeight:      500,
        }}
      >
        Upgrade
      </Link>
    </div>
  )
}



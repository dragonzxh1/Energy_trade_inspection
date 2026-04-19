import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import RefreshButton from '@/components/watchlist/RefreshButton'
import WatchedTradesRefreshButton from '@/components/watchlist/WatchedTradesRefreshButton'
import { auth } from '@/auth'
import {
  dismissWatchlistAlert,
  getWatchlistPageData,
  removeWatchedTrade,
  removeWatchlistItem,
  type WatchlistAlertRow as AlertRow,
  type WatchlistItemRow as WatchlistRow,
  type WatchedTradeRow,
} from '@/lib/server/watchlist'

export const metadata: Metadata = {
  title: 'Watchlist — Energy Trade Inspection',
}

// ── Types ────────────────────────────────────────────────────────────────────────────────────────────────────────────

// ── Constants ────────────────────────────────────────────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  listed:     '#ef4444',
  not_listed: '#22c55e',
  unknown:    '#55556a',
}

const STATUS_LABEL: Record<string, string> = {
  listed:     'Listed',
  not_listed: 'Not Listed',
  unknown:    'Unknown',
}

const secondaryBtn: React.CSSProperties = {
  background: '#1e1e24',
  color: '#8b8b9a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: '7px',
  padding: '6px 14px',
  fontSize: '13px',
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
  transition: 'all 0.12s ease',
}

// ── Server actions ────────────────────────────────────────────────────────────────────────────────────────────────────

async function removeFromWatchlist(id: string) {
  'use server'
  const session = await auth()
  if (!session?.user) return
  await removeWatchlistItem(session.user.id, id)
}

async function dismissAlert(alertId: string) {
  'use server'
  const session = await auth()
  if (!session?.user) return
  await dismissWatchlistAlert(session.user.id, alertId)
}

async function removeWatchedTradeAction(tradeId: string) {
  'use server'
  const s = await auth()
  if (!s?.user) return
  await removeWatchedTrade(s.user.id, tradeId)
}

// ── Helper: entity URL ────────────────────────────────────────────────────────────────────────────────────────────────

function entityHref(type: string, key: string): string {
  if (type === 'company')  return `/company/${key}`
  if (type === 'terminal') return `/terminal/${key}`
  return `/vessel/${key}`
}

// ── Sub-components ────────────────────────────────────────────────────────────────────────────────────────────────────

function AlertsSection({ alerts }: { alerts: AlertRow[] }) {
  if (alerts.length === 0) return null

  return (
    <div
      style={{
        marginBottom: 'var(--space-6)',
        backgroundColor: 'rgba(249,115,22,0.06)',
        border: '1px solid rgba(249,115,22,0.25)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid rgba(249,115,22,0.2)',
        }}
      >
        <span style={{ fontSize: '16px' }}>!</span>
        <p style={{ color: '#f97316', fontSize: '13px', fontWeight: 600 }}>
          {alerts.length} unread {alerts.length === 1 ? 'alert' : 'alerts'}
        </p>
      </div>

      {/* Alert rows */}
      {alerts.map((alert, idx) => {
        const isLast = idx === alerts.length - 1
        const dismissAction = dismissAlert.bind(null, alert.id)
        const href = entityHref(alert.entity_type, alert.entity_key)

        return (
          <div
            key={alert.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 'var(--space-4)',
              padding: 'var(--space-4) var(--space-5)',
              borderBottom: isLast ? 'none' : '1px solid rgba(249,115,22,0.12)',
            }}
          >
            <div>
              <p style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500, marginBottom: '3px' }}>
                <Link
                  href={href}
                  style={{ color: 'var(--text-primary)', textDecoration: 'none' }}
                >
                  {alert.entity_name}
                </Link>
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  {' '}status changed
                </span>
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                <span style={{ color: STATUS_COLOR[alert.old_value ?? ''] ?? '#55556a' }}>
                  {STATUS_LABEL[alert.old_value ?? ''] ?? alert.old_value ?? '-'}
                </span>
              {' →'}
                <span
                  style={{
                    color: STATUS_COLOR[alert.new_value ?? ''] ?? '#55556a',
                    fontWeight: 600,
                  }}
                >
                  {STATUS_LABEL[alert.new_value ?? ''] ?? alert.new_value ?? '-'}
                </span>
              {' · '}
                {new Date(alert.created_at).toLocaleDateString('en-US', {
                  month: 'short', day: 'numeric',
                })}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexShrink: 0 }}>
              <Link
                href={href}
                style={{
                  fontSize: '12px', color: 'var(--accent-primary)',
                  textDecoration: 'none', fontWeight: 500,
                }}
              >
                View
              </Link>
              <form action={dismissAction}>
                <button
                  type="submit"
                  className="wl-btn"
                  style={secondaryBtn}
                >
                  Dismiss
                </button>
              </form>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export default async function WatchlistPage() {
  const session = await auth()
  if (!session?.user) redirect('/sign-in')

  const plan     = session.user.plan ?? 'free'
  const canWatch = plan === 'professional' || plan === 'enterprise'

  if (!canWatch) {
    return (
      <>
        <Header />
        <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8) var(--space-4)' }}>
          <div style={{ maxWidth: '400px', textAlign: 'center' }}>
          <p style={{ fontSize: '32px', marginBottom: 'var(--space-5)' }}>👀</p>
            <h2 style={{ color: 'var(--text-primary)', fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
              Watchlist is a Professional feature
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '22px', marginBottom: 'var(--space-6)' }}>
              Monitor entities for sanction status changes and get alerted when something changes.
              Available on Professional and Enterprise plans.
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
              Upgrade to Professional
            </Link>
          </div>
        </div>
      </>
    )
  }

  const { items: rows, alerts: alertRows, trades: tradeRows, lastCheckedAt } =
    await getWatchlistPageData(session.user.id)

  return (
    <>
      <Header />
      <style>{`
        .wl-row:hover { background: rgba(255,255,255,0.02) !important; }
        .wl-btn:hover { background: #26262e !important; transform: translateY(-1px); }
      `}</style>

      <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-10) var(--space-4)' }}>
        {/* Page header */}
        <div
          style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 'var(--space-4)',
            marginBottom: 'var(--space-6)',
          }}
        >
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-1)' }}>
              Watchlist
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {rows.length} {rows.length === 1 ? 'entity' : 'entities'} monitored
              {alertRows.length > 0 && (
                <span style={{ color: '#f97316', fontWeight: 600 }}>
                {' · '}{alertRows.length} unread {alertRows.length === 1 ? 'alert' : 'alerts'}
                </span>
              )}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            <RefreshButton lastCheckedAt={lastCheckedAt} entityCount={rows.length} />
            <Link
              href="/"
              style={{
                fontSize: '13px', color: 'var(--accent-primary)',
                textDecoration: 'none', fontWeight: 500,
              }}
            >
              + Add entities
            </Link>
          </div>
        </div>

        {/* Unread alerts */}
        <AlertsSection alerts={alertRows} />

        {rows.length === 0 ? (
          /* Empty state */
          <div style={{
            backgroundColor: '#111113',
            border: '1px solid rgba(255,255,255,0.07)',
            borderTop: '1px solid rgba(255,255,255,0.09)',
            borderRadius: '10px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
            padding: 'var(--space-12)',
            textAlign: 'center',
          }}>
            <p style={{ fontSize: '32px', marginBottom: 'var(--space-4)' }}>👀</p>
            <p style={{ color: 'var(--text-primary)', fontSize: '15px', fontWeight: 500, marginBottom: 'var(--space-2)' }}>
              No entities on your watchlist yet
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '20px', maxWidth: '320px', margin: '0 auto var(--space-6)' }}>
              Open any company, vessel, or terminal page and click &ldquo;Add to Watchlist&rdquo; to monitor it for sanction changes.
            </p>
            <Link
              href="/"
              style={{
                display: 'inline-block',
                backgroundColor: 'var(--accent-primary)', color: '#fff',
                padding: 'var(--space-2) var(--space-5)', borderRadius: '6px',
                fontSize: '13px', fontWeight: 500, textDecoration: 'none',
              }}
            >
              Search entities
            </Link>
          </div>
        ) : (
          /* Watchlist table */
          <div style={{
            backgroundColor: '#111113',
            border: '1px solid rgba(255,255,255,0.07)',
            borderTop: '1px solid rgba(255,255,255,0.09)',
            borderRadius: '10px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
            overflow: 'hidden',
          }}>
            {/* Column headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 80px 130px 80px 70px',
              padding: 'var(--space-3) var(--space-5)',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              backgroundColor: '#1e1e24',
            }}>
              {['Entity', 'Type', 'Status', 'Added', ''].map((h) => (
                <span key={h} style={{
                  color: '#55556a', fontSize: '11px',
                  fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>
                  {h}
                </span>
              ))}
            </div>

            {rows.map((item, idx) => {
              const href = entityHref(item.entity_type, item.entity_key)
              const isLast = idx === rows.length - 1
              const removeAction = removeFromWatchlist.bind(null, item.id)
              const statusChanged = item.current_sanction_status !== item.sanction_status
              const statusColor = STATUS_COLOR[item.current_sanction_status] ?? '#55556a'

              return (
                <div
                  key={item.id}
                  className="wl-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 80px 130px 80px 70px',
                    padding: 'var(--space-4) var(--space-5)',
                    borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.07)',
                    alignItems: 'center',
                    transition: 'background 0.1s ease',
                    backgroundColor: statusChanged
                      ? 'rgba(249,115,22,0.04)'
                      : undefined,
                  }}
                >
                  {/* Name */}
                  <Link
                    href={href}
                    style={{
                      color: 'var(--text-primary)', fontSize: '14px',
                      fontWeight: 500, textDecoration: 'none',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {item.entity_name}
                  </Link>

                  {/* Type */}
                  <span style={{
                    color: '#8b8b9a', fontSize: '12px',
                    textTransform: 'capitalize',
                  }}>
                    {item.entity_type}
                  </span>

                  {/* Current sanction status — pill */}
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{
                      fontSize: '11px', fontWeight: 600, letterSpacing: '0.04em',
                      textTransform: 'uppercase' as const,
                      color: statusColor,
                      backgroundColor: `${statusColor}18`,
                      border: `1px solid ${statusColor}44`,
                      borderRadius: '4px',
                      padding: '2px 7px',
                    }}>
                      {STATUS_LABEL[item.current_sanction_status] ?? 'Unknown'}
                    </span>
                    {statusChanged && (
                      <span
                        title={`Changed from ${STATUS_LABEL[item.sanction_status] ?? item.sanction_status}`}
                        style={{ fontSize: '10px', color: '#f97316', fontWeight: 700 }}
                      >
                    ⚠                      </span>
                    )}
                  </span>

                  {/* Added date */}
                  <span style={{ color: '#8b8b9a', fontSize: '12px' }}>
                    {new Date(item.added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>

                  {/* Remove */}
                  <form action={removeAction}>
                    <button
                      type="submit"
                      className="wl-btn"
                      style={secondaryBtn}
                    >
                      Remove
                    </button>
                  </form>
                </div>
              )
            })}
          </div>
        )}

        <p style={{ marginTop: 'var(--space-5)', color: '#8b8b9a', fontSize: '12px', textAlign: 'center' }}>
          Status is compared against live data in our database. Click &ldquo;Refresh status&rdquo; to check for changes.
        </p>

        {/* ── Watched Trades ──────────────────────────────────────────────────────────────────────────────────────── */}
        <div style={{ marginTop: 'var(--space-10)' }}>
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 'var(--space-4)', marginBottom: 'var(--space-4)',
          }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-1)' }}>
                Watched Trades
              </h2>
              <p style={{ color: '#8b8b9a', fontSize: '13px' }}>
                {tradeRows.length} trade{tradeRows.length !== 1 ? 's' : ''} monitored
              </p>
            </div>
            {tradeRows.length > 0 && (
              <WatchedTradesRefreshButton />
            )}
          </div>

          {tradeRows.length === 0 ? (
            <div style={{
              backgroundColor: '#111113',
              border: '1px solid rgba(255,255,255,0.07)',
              borderTop: '1px solid rgba(255,255,255,0.09)',
              borderRadius: '10px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
              padding: 'var(--space-8)',
              textAlign: 'center',
            }}>
              <p style={{ color: '#8b8b9a', fontSize: '13px', lineHeight: '20px' }}>
                No trades watched yet. Run a <Link href="/trade" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>trade check</Link> and click &ldquo;Watch trade&rdquo; to monitor it.
              </p>
            </div>
          ) : (
            <div style={{
              backgroundColor: '#111113',
              border: '1px solid rgba(255,255,255,0.07)',
              borderTop: '1px solid rgba(255,255,255,0.09)',
              borderRadius: '10px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
              overflow: 'hidden',
            }}>
              {/* Column headers */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 90px 100px 80px 70px',
                padding: 'var(--space-3) var(--space-5)',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                backgroundColor: '#1e1e24',
              }}>
                {['Seller', 'Vessel', 'Risk', 'Flags', 'Saved', ''].map(h => (
                  <span key={h} style={{
                    color: '#55556a', fontSize: '11px',
                    fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>{h}</span>
                ))}
              </div>

              {tradeRows.map((t, idx) => {
                const isLast = idx === tradeRows.length - 1
                const alerts = parseInt(t.unread_alerts, 10)
                const TRADE_RISK_COLOR: Record<string, string> = {
                  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e',
                }
                const removeAction = removeWatchedTradeAction.bind(null, t.id)
                const tradeRiskColor = TRADE_RISK_COLOR[t.last_overall_risk] ?? '#55556a'
                return (
                  <div
                    key={t.id}
                    className="wl-row"
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 90px 100px 80px 70px',
                      padding: 'var(--space-4) var(--space-5)',
                      borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.07)',
                      alignItems: 'center',
                      transition: 'background 0.1s ease',
                      backgroundColor: alerts > 0 ? 'rgba(249,115,22,0.04)' : undefined,
                    }}
                  >
                    {/* Seller */}
                    <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.seller_name}
                      {alerts > 0 && (
                        <span style={{ marginLeft: '6px', fontSize: '10px', color: '#f97316', fontWeight: 700 }}>
                ⚠ {alerts}
                        </span>
                      )}
                    </span>
                    {/* Vessel */}
                    <span style={{ fontSize: '13px', color: '#8b8b9a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.vessel_name}
                      {t.vessel_imo && (
                        <span style={{ marginLeft: '6px', fontSize: '11px', color: '#55556a', fontFamily: 'monospace' }}>
                          {t.vessel_imo}
                        </span>
                      )}
                    </span>
                    {/* Risk — pill */}
                    <span style={{
                      fontSize: '11px', fontWeight: 600, letterSpacing: '0.04em',
                      textTransform: 'uppercase' as const,
                      color: tradeRiskColor,
                      backgroundColor: `${tradeRiskColor}18`,
                      border: `1px solid ${tradeRiskColor}44`,
                      borderRadius: '4px',
                      padding: '2px 7px',
                      display: 'inline-block',
                    }}>
                      {t.last_overall_risk.toUpperCase()}
                    </span>
                    {/* Flags */}
                    <span style={{ fontSize: '12px', color: '#8b8b9a' }}>
                      {t.last_flag_count} flag{t.last_flag_count !== 1 ? 's' : ''}
                    </span>
                    {/* Saved date */}
                    <span style={{ fontSize: '12px', color: '#8b8b9a' }}>
                      {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    {/* Remove */}
                    <form action={removeAction}>
                      <button
                        type="submit"
                        className="wl-btn"
                        style={secondaryBtn}
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                )
              })}
            </div>
          )}

          <p style={{ marginTop: 'var(--space-4)', color: '#8b8b9a', fontSize: '12px', textAlign: 'center' }}>
            Refresh checks sanctions and PSC detention status for each saved trade.
          </p>
        </div>
      </div>
    </>
  )
}




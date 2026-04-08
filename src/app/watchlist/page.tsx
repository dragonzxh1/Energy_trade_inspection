import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import RefreshButton from '@/components/watchlist/RefreshButton'
import WatchedTradesRefreshButton from '@/components/watchlist/WatchedTradesRefreshButton'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'
import { applyMigrations } from '@/lib/server/migrations'

export const metadata: Metadata = {
  title: 'Watchlist — Energy Trade Inspection',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WatchlistRow {
  id: string
  entity_id: string
  entity_type: 'company' | 'vessel' | 'terminal'
  entity_key: string
  entity_name: string
  sanction_status: string           // snapshot at add-time
  current_sanction_status: string   // latest confirmed status
  last_checked_at: string | null
  added_at: string
}

interface AlertRow {
  id: string
  entity_id: string
  entity_name: string
  entity_type: string
  entity_key: string
  alert_type: string
  old_value: string | null
  new_value: string | null
  created_at: string
}

interface WatchedTradeRow {
  id: string
  seller_name: string
  vessel_name: string
  vessel_imo: string | null
  loading_port: string | null
  last_overall_risk: string
  last_flag_count: number
  last_checked_at: string | null
  created_at: string
  unread_alerts: string  // aggregated count as string from postgres
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  listed:     'var(--status-listed)',
  not_listed: 'var(--status-clear)',
  unknown:    'var(--text-muted)',
}

const STATUS_LABEL: Record<string, string> = {
  listed:     'Listed',
  not_listed: 'Not Listed',
  unknown:    'Unknown',
}

// ── Server actions ────────────────────────────────────────────────────────────

async function removeFromWatchlist(id: string) {
  'use server'
  const session = await auth()
  if (!session?.user) return
  await db.query(
    `DELETE FROM watchlist WHERE id = $1 AND user_id = $2`,
    [id, session.user.id],
  )
}

async function dismissAlert(alertId: string) {
  'use server'
  const session = await auth()
  if (!session?.user) return
  await db.query(
    `UPDATE watchlist_alerts SET read_at = NOW() WHERE id = $1 AND user_id = $2`,
    [alertId, session.user.id],
  )
}

// ── Helper: entity URL ────────────────────────────────────────────────────────

function entityHref(type: string, key: string): string {
  if (type === 'company')  return `/company/${key}`
  if (type === 'terminal') return `/terminal/${key}`
  return `/vessel/${key}`
}

// ── Sub-components ────────────────────────────────────────────────────────────

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
        <span style={{ fontSize: '16px' }}>⚠</span>
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
                  {' '}— sanction status changed
                </span>
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                <span style={{ color: STATUS_COLOR[alert.old_value ?? ''] ?? 'var(--text-muted)' }}>
                  {STATUS_LABEL[alert.old_value ?? ''] ?? alert.old_value ?? '—'}
                </span>
                {' → '}
                <span
                  style={{
                    color: STATUS_COLOR[alert.new_value ?? ''] ?? 'var(--text-muted)',
                    fontWeight: 600,
                  }}
                >
                  {STATUS_LABEL[alert.new_value ?? ''] ?? alert.new_value ?? '—'}
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
                View ↗
              </Link>
              <form action={dismissAction}>
                <button
                  type="submit"
                  style={{
                    background: 'none', border: 'none',
                    color: 'var(--text-muted)', cursor: 'pointer',
                    fontSize: '12px', fontFamily: 'inherit',
                    padding: '2px 6px',
                  }}
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

// ── Page ──────────────────────────────────────────────────────────────────────

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
            <p style={{ fontSize: '32px', marginBottom: 'var(--space-5)' }}>👁</p>
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

  await applyMigrations()

  // Fetch watchlist items + entity alerts + watched trades in parallel
  const [{ rows }, { rows: alertRows }, { rows: tradeRows }] = await Promise.all([
    db.query<WatchlistRow>(
      `SELECT id, entity_id, entity_type, entity_key, entity_name,
              sanction_status, current_sanction_status, last_checked_at, added_at
       FROM watchlist
       WHERE user_id = $1
       ORDER BY added_at DESC`,
      [session.user.id],
    ),
    db.query<AlertRow>(
      `SELECT id, entity_id, entity_name, entity_type, entity_key,
              alert_type, old_value, new_value, created_at
       FROM watchlist_alerts
       WHERE user_id = $1 AND read_at IS NULL
       ORDER BY created_at DESC`,
      [session.user.id],
    ),
    db.query<WatchedTradeRow>(
      `SELECT wt.id, wt.seller_name, wt.vessel_name, wt.vessel_imo, wt.loading_port,
              wt.last_overall_risk, wt.last_flag_count, wt.last_checked_at, wt.created_at,
              COALESCE(a.alert_count, '0') AS unread_alerts
       FROM watched_trades wt
       LEFT JOIN (
         SELECT watched_trade_id, COUNT(*)::TEXT AS alert_count
         FROM watched_trade_alerts
         WHERE user_id = $1 AND read_at IS NULL
         GROUP BY watched_trade_id
       ) a ON a.watched_trade_id = wt.id
       WHERE wt.user_id = $1
       ORDER BY wt.created_at DESC`,
      [session.user.id],
    ).catch(() => ({ rows: [] as WatchedTradeRow[] })),
  ])

  // Most-recent last_checked_at across all rows
  const lastCheckedAt = rows.reduce<string | null>((latest, r) => {
    if (!r.last_checked_at) return latest
    if (!latest) return r.last_checked_at
    return r.last_checked_at > latest ? r.last_checked_at : latest
  }, null)

  return (
    <>
      <Header />

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
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: 'var(--space-12)',
            textAlign: 'center',
          }}>
            <p style={{ fontSize: '32px', marginBottom: 'var(--space-4)' }}>👁</p>
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
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            overflow: 'hidden',
          }}>
            {/* Column headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 80px 130px 80px 70px',
              padding: 'var(--space-3) var(--space-5)',
              borderBottom: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-elevated)',
            }}>
              {['Entity', 'Type', 'Status', 'Added', ''].map((h) => (
                <span key={h} style={{
                  color: 'var(--text-muted)', fontSize: '11px',
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

              return (
                <div
                  key={item.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 80px 130px 80px 70px',
                    padding: 'var(--space-4) var(--space-5)',
                    borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)',
                    alignItems: 'center',
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
                    color: 'var(--text-muted)', fontSize: '12px',
                    textTransform: 'capitalize',
                  }}>
                    {item.entity_type}
                  </span>

                  {/* Current sanction status (with change indicator) */}
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{
                      color: STATUS_COLOR[item.current_sanction_status] ?? 'var(--text-muted)',
                      fontSize: '12px', fontWeight: 500,
                    }}>
                      {STATUS_LABEL[item.current_sanction_status] ?? 'Unknown'}
                    </span>
                    {statusChanged && (
                      <span
                        title={`Changed from ${STATUS_LABEL[item.sanction_status] ?? item.sanction_status}`}
                        style={{ fontSize: '10px', color: '#f97316', fontWeight: 700 }}
                      >
                        ⚠
                      </span>
                    )}
                  </span>

                  {/* Added date */}
                  <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                    {new Date(item.added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>

                  {/* Remove */}
                  <form action={removeAction}>
                    <button
                      type="submit"
                      style={{
                        background: 'none', border: 'none',
                        color: 'var(--text-muted)', cursor: 'pointer',
                        fontSize: '12px', fontFamily: 'inherit',
                        padding: '2px 6px',
                      }}
                    >
                      Remove
                    </button>
                  </form>
                </div>
              )
            })}
          </div>
        )}

        <p style={{ marginTop: 'var(--space-5)', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
          Status is compared against live data in our database. Click &ldquo;Refresh status&rdquo; to check for changes.
        </p>

        {/* ── Watched Trades ──────────────────────────────────────────────── */}
        <div style={{ marginTop: 'var(--space-10)' }}>
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 'var(--space-4)', marginBottom: 'var(--space-4)',
          }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-1)' }}>
                Watched Trades
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                {tradeRows.length} trade{tradeRows.length !== 1 ? 's' : ''} monitored
              </p>
            </div>
            {tradeRows.length > 0 && (
              <WatchedTradesRefreshButton />
            )}
          </div>

          {tradeRows.length === 0 ? (
            <div style={{
              backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
              borderRadius: '12px', padding: 'var(--space-8)', textAlign: 'center',
            }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '20px' }}>
                No trades watched yet. Run a <Link href="/trade" style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}>trade check</Link> and click &ldquo;Watch trade&rdquo; to monitor it.
              </p>
            </div>
          ) : (
            <div style={{
              backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
              borderRadius: '12px', overflow: 'hidden',
            }}>
              {/* Column headers */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 90px 100px 80px 70px',
                padding: 'var(--space-3) var(--space-5)',
                borderBottom: '1px solid var(--border-subtle)',
                backgroundColor: 'var(--bg-elevated)',
              }}>
                {['Seller', 'Vessel', 'Risk', 'Flags', 'Saved', ''].map(h => (
                  <span key={h} style={{
                    color: 'var(--text-muted)', fontSize: '11px',
                    fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                  }}>{h}</span>
                ))}
              </div>

              {tradeRows.map((t, idx) => {
                const isLast = idx === tradeRows.length - 1
                const alerts = parseInt(t.unread_alerts, 10)
                const RISK_COLOR: Record<string, string> = {
                  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e',
                }
                const removeAction = async () => {
                  'use server'
                  const s = await auth()
                  if (!s?.user) return
                  await db.query(`DELETE FROM watched_trades WHERE id = $1 AND user_id = $2`, [t.id, s.user.id])
                }
                return (
                  <div
                    key={t.id}
                    style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 90px 100px 80px 70px',
                      padding: 'var(--space-4) var(--space-5)',
                      borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)',
                      alignItems: 'center',
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
                    <span style={{ fontSize: '13px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.vessel_name}
                      {t.vessel_imo && (
                        <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {t.vessel_imo}
                        </span>
                      )}
                    </span>
                    {/* Risk */}
                    <span style={{
                      fontSize: '11px', fontWeight: 700, letterSpacing: '0.05em',
                      color: RISK_COLOR[t.last_overall_risk] ?? 'var(--text-muted)',
                    }}>
                      {t.last_overall_risk.toUpperCase()}
                    </span>
                    {/* Flags */}
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {t.last_flag_count} flag{t.last_flag_count !== 1 ? 's' : ''}
                    </span>
                    {/* Saved date */}
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    {/* Remove */}
                    <form action={removeAction}>
                      <button
                        type="submit"
                        style={{
                          background: 'none', border: 'none',
                          color: 'var(--text-muted)', cursor: 'pointer',
                          fontSize: '12px', fontFamily: 'inherit', padding: '2px 6px',
                        }}
                      >
                        Remove
                      </button>
                    </form>
                  </div>
                )
              })}
            </div>
          )}

          <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
            Refresh checks sanctions and PSC detention status for each saved trade.
          </p>
        </div>
      </div>
    </>
  )
}

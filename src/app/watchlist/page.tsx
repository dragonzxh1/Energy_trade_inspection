import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'

export const metadata: Metadata = {
  title: 'Watchlist — Energy Trade Inspection',
}

interface WatchlistRow {
  id: string
  entity_id: string
  entity_type: 'company' | 'vessel'
  entity_key: string
  entity_name: string
  sanction_status: string
  added_at: string
}

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

async function removeFromWatchlist(id: string) {
  'use server'
  const session = await auth()
  if (!session?.user) return
  await db.query(
    `DELETE FROM watchlist WHERE id = $1 AND user_id = $2`,
    [id, session.user.id]
  )
}

export default async function WatchlistPage() {
  const session = await auth()
  if (!session?.user) redirect('/sign-in')

  const plan = session.user.plan ?? 'free'
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

  const { rows } = await db.query<WatchlistRow>(
    `SELECT id, entity_id, entity_type, entity_key, entity_name, sanction_status, added_at
     FROM watchlist WHERE user_id = $1 ORDER BY added_at DESC`,
    [session.user.id]
  )

  return (
    <>
      <Header />

      <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-10) var(--space-4)' }}>
        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-8)' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-1)' }}>
              Watchlist
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
              {rows.length} {rows.length === 1 ? 'entity' : 'entities'} monitored
            </p>
          </div>
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
              Open any company or vessel page and click &ldquo;Add to Watchlist&rdquo; to monitor it for sanction changes.
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
              gridTemplateColumns: '1fr 100px 120px 80px 80px',
              padding: 'var(--space-3) var(--space-5)',
              borderBottom: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-elevated)',
            }}>
              {['Entity', 'Type', 'Sanction status', 'Added', ''].map((h) => (
                <span key={h} style={{
                  color: 'var(--text-muted)', fontSize: '11px',
                  fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>
                  {h}
                </span>
              ))}
            </div>

            {rows.map((item, idx) => {
              const href = item.entity_type === 'company'
                ? `/company/${item.entity_key}`
                : `/vessel/${item.entity_key}`
              const isLast = idx === rows.length - 1
              const removeAction = removeFromWatchlist.bind(null, item.id)

              return (
                <div
                  key={item.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 100px 120px 80px 80px',
                    padding: 'var(--space-4) var(--space-5)',
                    borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)',
                    alignItems: 'center',
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

                  {/* Sanction status */}
                  <span style={{
                    color: STATUS_COLOR[item.sanction_status] ?? 'var(--text-muted)',
                    fontSize: '12px', fontWeight: 500,
                  }}>
                    {STATUS_LABEL[item.sanction_status] ?? 'Unknown'}
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
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontFamily: 'inherit',
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

        <p style={{ marginTop: 'var(--space-6)', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
          Sanction status shown at time of adding. Real-time change alerts coming in Phase 2.
        </p>
      </div>
    </>
  )
}

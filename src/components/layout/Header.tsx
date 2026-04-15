import Link from 'next/link'
import { auth, signOut } from '@/auth'
import type { SanctionStatus } from '@/lib/types'

interface HeaderProps {
  entityName?: string
  sanctionStatus?: SanctionStatus
}

const PLAN_LABEL: Record<string, string> = {
  free:         'Free',
  starter:      'Starter',
  professional: 'Pro',
  enterprise:   'Enterprise',
}

export default async function Header({ entityName, sanctionStatus }: HeaderProps) {
  const session = await auth()
  const user    = session?.user
  const plan    = user?.plan ?? 'free'
  const isSanctioned = sanctionStatus === 'listed'

  // Initials avatar fallback
  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <>
      {/* Sanction warning banner */}
      {isSanctioned && (
        <div
          role="alert"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.3)',
            padding: 'var(--space-2) var(--space-4)',
            textAlign: 'center',
          }}
        >
          <span style={{ color: 'var(--status-listed)', fontSize: '13px', fontWeight: 500 }}>
            ⚠ This entity appears on one or more sanction lists. Exercise due diligence before engaging.
          </span>
        </div>
      )}

      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          backgroundColor: 'rgba(15, 16, 17, 0.88)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            maxWidth: 'var(--max-width)',
            margin: '0 auto',
            padding: '0 var(--space-4)',
            height: '56px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-4)',
          }}
        >
          {/* Logo + breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
            <Link
              href="/"
              style={{
                color: 'var(--text-primary)',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: 600,
                letterSpacing: '-0.01em',
                flexShrink: 0,
              }}
            >
              ETI
            </Link>
            {entityName && (
              <>
                <span aria-hidden="true" style={{ color: 'var(--border-subtle)', fontSize: '16px' }}>/</span>
                <span
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={entityName}
                >
                  {entityName}
                </span>
              </>
            )}
          </div>

          {/* Nav */}
          <nav
            aria-label="Site navigation"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexShrink: 0 }}
          >
            <Link
              href="/pricing"
              className="nav-text-link"
              style={{ color: 'var(--text-muted)', fontSize: '13px', textDecoration: 'none' }}
            >
              Pricing
            </Link>

            {plan !== 'free' && (
              <Link
                href="/screen"
                className="nav-text-link"
                style={{ color: 'var(--text-muted)', fontSize: '13px', textDecoration: 'none' }}
              >
                Screen
              </Link>
            )}

            {plan !== 'free' && (
              <Link
                href="/trade"
                className="nav-text-link"
                style={{ color: 'var(--text-muted)', fontSize: '13px', textDecoration: 'none' }}
              >
                Trade
              </Link>
            )}

            {plan !== 'free' && (
              <Link
                href="/reports"
                className="nav-text-link"
                style={{ color: 'var(--text-muted)', fontSize: '13px', textDecoration: 'none' }}
              >
                Reports
              </Link>
            )}

            {(plan === 'professional' || plan === 'enterprise') && (
              <Link
                href="/watchlist"
                className="nav-text-link"
                style={{ color: 'var(--text-muted)', fontSize: '13px', textDecoration: 'none' }}
              >
                Watchlist
              </Link>
            )}

            {user ? (
              /* ── Logged-in state ── */
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                {/* Plan badge */}
                {plan !== 'free' && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--accent-primary)',
                      border: '1px solid var(--accent-primary)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                    }}
                  >
                    {PLAN_LABEL[plan] ?? plan}
                  </span>
                )}

                {/* Avatar — links to account */}
                <Link href="/account" style={{ textDecoration: 'none', flexShrink: 0, lineHeight: 0 }}>
                  {user.image ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={user.image}
                      alt={user.name ?? 'User avatar'}
                      width={28}
                      height={28}
                      style={{ borderRadius: '50%', display: 'block' }}
                    />
                  ) : (
                    <span
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--accent-primary)',
                        color: '#fff',
                        fontSize: '11px',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {initials}
                    </span>
                  )}
                </Link>

                {/* Sign out */}
                <form
                  action={async () => {
                    'use server'
                    await signOut({ redirectTo: '/' })
                  }}
                >
                  <button
                    type="submit"
                    style={{
                      background: 'none',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '4px',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontFamily: 'inherit',
                      padding: '4px 8px',
                    }}
                  >
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              /* ── Guest state ── */
              <Link
                href="/sign-in"
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 500,
                  textDecoration: 'none',
                  padding: '5px 12px',
                  borderRadius: '6px',
                }}
              >
                Sign in
              </Link>
            )}
          </nav>
        </div>
      </header>
    </>
  )
}

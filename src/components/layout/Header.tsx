import Link from 'next/link'
import { auth, signOut } from '@/auth'
import type { SanctionStatus } from '@/lib/types'
import UserAvatar from './UserAvatar'

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

const SHIELD_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
  </svg>
)

export default async function Header({ entityName, sanctionStatus }: HeaderProps) {
  const session = await auth()
  const user    = session?.user
  const plan    = user?.plan ?? 'free'
  const isSanctioned = sanctionStatus === 'listed'

  return (
    <>
      {/* Sanction warning banner */}
      {isSanctioned && (
        <div
          role="alert"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.12)',
            borderBottom: '1px solid rgba(239, 68, 68, 0.25)',
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
          backgroundColor: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border-default)',
        }}
      >
        <div
          style={{
            maxWidth: 'var(--max-width)',
            margin: '0 auto',
            padding: '0 var(--space-4)',
            height: '64px',
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
              className="header-logo"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                textDecoration: 'none',
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  background: 'linear-gradient(135deg, var(--brand-400) 0%, var(--brand-600) 100%)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                }}
              >
                {SHIELD_ICON}
              </div>
              <span
                className="header-logo-text"
                style={{
                  color: 'var(--text-primary)',
                  fontSize: '18px',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                }}
              >
                ETI <span style={{ color: 'var(--brand-400)' }}>Verify</span>
              </span>
            </Link>
            {entityName && (
              <>
                <span aria-hidden="true" style={{ color: 'var(--border-solid)', fontSize: '16px' }}>/</span>
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
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', flexShrink: 1, minWidth: 0 }}
          >
            {/* System status */}
            <div
              className="hidden sm:flex"
              style={{
                display: 'none',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: '3px 10px',
                borderRadius: '999px',
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.15)',
              }}
            >
              <span className="status-pulse" style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: 'var(--status-clear)',
                display: 'block',
              }} />
              <span className="mono" style={{ fontSize: '10px', color: 'var(--status-clear)', fontWeight: 500 }}>
                SYSTEM ONLINE
              </span>
            </div>

            <Link
              href="/search"
              className="nav-text-link hover-text-brand"
              style={{ color: 'var(--text-muted)', fontSize: '13px', textDecoration: 'none' }}
            >
              Database
            </Link>

            <Link
              href="/pricing"
              className="nav-text-link hover-text-brand"
              style={{ color: 'var(--text-muted)', fontSize: '13px', textDecoration: 'none' }}
            >
              Pricing
            </Link>

            {plan !== 'free' && (
              <Link
                href="/screen"
                className="nav-text-link hover-text-brand"
                style={{ color: 'var(--text-muted)', fontSize: '13px', textDecoration: 'none' }}
              >
                Screen
              </Link>
            )}

            {plan !== 'free' && (
              <Link
                href="/trade"
                className="nav-text-link hover-text-brand"
                style={{ color: 'var(--text-muted)', fontSize: '13px', textDecoration: 'none' }}
              >
                Trade
              </Link>
            )}

            {(plan === 'professional' || plan === 'enterprise') && (
              <Link
                href="/watchlist"
                className="nav-text-link hover-text-brand"
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
                      color: 'var(--brand-400)',
                      border: '1px solid var(--brand-400)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                    }}
                  >
                    {PLAN_LABEL[plan] ?? plan}
                  </span>
                )}

                {/* Avatar */}
                <Link href="/account" style={{ textDecoration: 'none', flexShrink: 0, lineHeight: 0 }}>
                  <UserAvatar src={user.image} name={user.name} />
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
                      borderRadius: '6px',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontFamily: 'inherit',
                      padding: '4px 10px',
                    }}
                    className="hover-border-brand"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            ) : (
              /* ── Guest state ── */
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <Link
                  href="/sign-up"
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '13px',
                    fontWeight: 500,
                    textDecoration: 'none',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                  }}
                  className="hover-border-brand"
                >
                  Sign up
                </Link>
                <Link
                  href="/sign-in"
                  className="btn-primary"
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    textDecoration: 'none',
                    padding: '6px 16px',
                    borderRadius: '8px',
                    display: 'inline-block',
                  }}
                >
                  Console Login
                </Link>
              </div>
            )}
          </nav>
        </div>
      </header>
    </>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { signOut } from 'next-auth/react'
import UserAvatar from './UserAvatar'

interface HeaderNavProps {
  user?: { name?: string | null; image?: string | null; plan?: string } | null
  plan: string
}

const PLAN_LABEL: Record<string, string> = {
  free: 'Free',
  starter: 'Starter',
  professional: 'Pro',
  enterprise: 'Enterprise',
}

export default function HeaderNav({ user, plan }: HeaderNavProps) {
  const [menuOpen, setMenuOpen] = useState(false)

  const navLinks = [
    { href: '/search', label: 'Database' },
    { href: '/pricing', label: 'Pricing' },
    ...(plan !== 'free' ? [{ href: '/screen', label: 'Screen' }] : []),
    ...(plan !== 'free' ? [{ href: '/trade', label: 'Trade' }] : []),
    ...((plan === 'professional' || plan === 'enterprise')
      ? [{ href: '/watchlist', label: 'Watchlist' }]
      : []),
  ]

  return (
    <nav aria-label="Site navigation" style={{ position: 'relative' }}>
      {/* Desktop nav */}
      <div
        className="hidden-mobile-nav"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-5)',
          flexShrink: 1,
          minWidth: 0,
        }}
      >
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
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
            <Link href="/account" style={{ textDecoration: 'none', flexShrink: 0, lineHeight: 0 }}>
              <UserAvatar src={user?.image ?? undefined} name={user?.name ?? undefined} />
            </Link>
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
      </div>

      {/* Mobile hamburger */}
      <div className="mobile-nav-trigger" style={{ display: 'none' }}>
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
          style={{
            background: 'none',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            padding: '6px 8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {menuOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <path d="M3 12h18M3 6h18M3 18h18" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setMenuOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              zIndex: 40,
            }}
          />
          {/* Dropdown panel */}
          <div
            className="mobile-nav-dropdown"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              minWidth: '200px',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: 'var(--space-2)',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
              zIndex: 45,
              boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
            }}
          >
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '14px',
                  fontWeight: 500,
                  textDecoration: 'none',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  transition: 'background 0.1s ease, color 0.1s ease',
                }}
                className="hover-border-brand"
              >
                {link.label}
              </Link>
            ))}
            {navLinks.length > 0 && (
              <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '4px 0' }} />
            )}
            {user ? (
              <>
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
                      alignSelf: 'flex-start',
                      margin: '4px 14px',
                    }}
                  >
                    {PLAN_LABEL[plan] ?? plan}
                  </span>
                )}
                <Link
                  href="/account"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: '14px',
                    fontWeight: 500,
                    textDecoration: 'none',
                    padding: '10px 14px',
                    borderRadius: '8px',
                  }}
                  className="hover-border-brand"
                >
                  Account
                </Link>
                <button
                  onClick={() => { setMenuOpen(false); signOut({ callbackUrl: '/' }) }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--risk-critical)',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                    fontWeight: 500,
                    padding: '10px 14px',
                    borderRadius: '8px',
                    width: '100%',
                    textAlign: 'left',
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/sign-up"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: '14px',
                    fontWeight: 500,
                    textDecoration: 'none',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    textAlign: 'center',
                  }}
                  className="hover-border-brand"
                >
                  Sign up
                </Link>
                <Link
                  href="/sign-in"
                  onClick={() => setMenuOpen(false)}
                  className="btn-primary"
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    textDecoration: 'none',
                    padding: '10px 14px',
                    borderRadius: '8px',
                    textAlign: 'center',
                    display: 'block',
                  }}
                >
                  Console Login
                </Link>
              </>
            )}
          </div>
        </>
      )}
    </nav>
  )
}

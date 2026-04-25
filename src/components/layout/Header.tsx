import Link from 'next/link'
import { auth, signOut } from '@/auth'
import type { SanctionStatus } from '@/lib/types'
import UserAvatar from './UserAvatar'
import HeaderNav from './HeaderNav'

interface HeaderProps {
  entityName?: string
  sanctionStatus?: SanctionStatus
}

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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                </svg>
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

          <HeaderNav user={user} plan={plan} />
        </div>
      </header>
    </>
  )
}

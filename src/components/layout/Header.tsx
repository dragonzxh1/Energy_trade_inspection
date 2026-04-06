import Link from 'next/link'
import type { SanctionStatus } from '@/lib/types'

interface HeaderProps {
  /** Entity name shown in breadcrumb on entity pages */
  entityName?: string
  /** Used to show a warning banner if entity is sanctioned */
  sanctionStatus?: SanctionStatus
}

export default function Header({ entityName, sanctionStatus }: HeaderProps) {
  const isSanctioned = sanctionStatus === 'listed'

  return (
    <>
      {/* Sanction warning banner — highest visual priority */}
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
            ⚠ This entity appears on one or more sanction lists. Exercise due diligence before
            engaging.
          </span>
        </div>
      )}

      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          backgroundColor: 'rgba(10, 15, 26, 0.92)',
          backdropFilter: 'blur(12px)',
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
          {/* Logo + optional breadcrumb */}
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
                <span
                  aria-hidden="true"
                  style={{ color: 'var(--border-subtle)', fontSize: '16px' }}
                >
                  /
                </span>
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

          {/* Nav actions */}
          <nav aria-label="Site navigation" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <Link
              href="/pricing"
              style={{
                color: 'var(--text-muted)',
                fontSize: '13px',
                textDecoration: 'none',
              }}
            >
              Pricing
            </Link>

            {/* Language toggle — EN/ZH placeholder */}
            <button
              aria-label="Switch language"
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
              中文
            </button>
          </nav>
        </div>
      </header>
    </>
  )
}

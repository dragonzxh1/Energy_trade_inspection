import Link from 'next/link'

interface ContentLockProps {
  children: React.ReactNode
  /** True = user has access, render normally */
  unlocked?: boolean
  /** 'guest' = not signed in | 'free' = signed in but free plan */
  reason?: 'guest' | 'free'
}

/**
 * F3 content gate — blurs content and overlays an upgrade CTA.
 * GEO-safe: locked content is aria-hidden so crawlers see the gate message.
 */
export default function ContentLock({
  children,
  unlocked = false,
  reason = 'guest',
}: ContentLockProps) {
  if (unlocked) return <>{children}</>

  const isGuest = reason === 'guest'

  return (
    <div style={{ position: 'relative', minHeight: '180px' }}>
      {/* Blurred preview — hidden from assistive tech */}
      <div
        aria-hidden="true"
        style={{
          filter: 'blur(5px)',
          userSelect: 'none',
          pointerEvents: 'none',
          opacity: 0.45,
          maxHeight: '200px',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>

      {/* Gradient overlay */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(to bottom, transparent 0%, var(--bg-surface) 60%)',
        }}
      />

      {/* Upgrade CTA */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: 'var(--space-5) var(--space-4)',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: '13px',
            marginBottom: 'var(--space-4)',
            maxWidth: '300px',
            lineHeight: '20px',
          }}
        >
          {isGuest
            ? 'Sign in to access directors, vessel associations, and full risk intelligence.'
            : 'Upgrade to Starter to unlock director records, associated vessels, and detailed risk flags.'}
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          {isGuest ? (
            <>
              <Link
                href="/sign-in"
                style={{
                  display: 'inline-block',
                  padding: 'var(--space-2) var(--space-5)',
                  backgroundColor: 'var(--accent-primary)',
                  color: '#fff',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: 500,
                  textDecoration: 'none',
                }}
              >
                Sign in free
              </Link>
              <Link
                href="/pricing"
                style={{
                  fontSize: '12px',
                  color: 'var(--text-muted)',
                  textDecoration: 'none',
                }}
              >
                View plans →
              </Link>
            </>
          ) : (
            <Link
              href="/pricing"
              style={{
                display: 'inline-block',
                padding: 'var(--space-2) var(--space-5)',
                backgroundColor: 'var(--accent-primary)',
                color: '#fff',
                borderRadius: '6px',
                fontSize: '13px',
                fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              Unlock Full Report
            </Link>
          )}
        </div>

        <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: 'var(--space-3)' }}>
          {isGuest ? 'Free — 5 queries/month included' : 'Instant access · Cancel anytime'}
        </p>
      </div>
    </div>
  )
}

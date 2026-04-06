interface ContentLockProps {
  children: React.ReactNode
  /** If true the content is accessible (user is subscribed). Default: false. */
  unlocked?: boolean
}

/**
 * F3 content gate — blurs content and overlays an upgrade CTA.
 * Compliant with GEO: aria-hidden on locked content so crawlers see the gate message.
 */
export default function ContentLock({ children, unlocked = false }: ContentLockProps) {
  if (unlocked) return <>{children}</>

  return (
    <div style={{ position: 'relative' }}>
      {/* Blurred content — hidden from assistive tech */}
      <div
        aria-hidden="true"
        style={{
          filter: 'blur(4px)',
          userSelect: 'none',
          pointerEvents: 'none',
          opacity: 0.5,
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
          background:
            'linear-gradient(to bottom, transparent 0%, var(--bg-primary) 100%)',
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
          padding: 'var(--space-6) var(--space-4)',
          textAlign: 'center',
        }}
      >
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: '14px',
            marginBottom: 'var(--space-4)',
            maxWidth: '320px',
          }}
        >
          Registration details, directors, and vessel associations are available to
          verified subscribers.
        </p>
        <a
          href="/pricing"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: 'var(--space-3) var(--space-6)',
            backgroundColor: 'var(--accent-primary)',
            color: '#fff',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          Unlock Full Report
        </a>
        <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: 'var(--space-3)' }}>
          Instant access · Cancel anytime
        </p>
      </div>
    </div>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Upgrade Successful — Energy Trade Inspection',
}

export default function UpgradeSuccessPage() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-primary)',
        padding: 'var(--space-4)',
      }}
    >
      <div style={{ maxWidth: '420px', width: '100%', textAlign: 'center' }}>
        <div
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            backgroundColor: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto var(--space-5)',
            fontSize: '24px',
          }}
        >
          ✓
        </div>

        <h1
          style={{
            color: 'var(--text-primary)',
            fontSize: '22px',
            fontWeight: 600,
            marginBottom: 'var(--space-3)',
          }}
        >
          You&apos;re all set
        </h1>

        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: '14px',
            lineHeight: '22px',
            marginBottom: 'var(--space-8)',
          }}
        >
          Your plan has been activated. Director records, vessel associations,
          risk flags, and PDF export are now unlocked.
        </p>

        <Link
          href="/"
          style={{
            display: 'inline-block',
            backgroundColor: 'var(--accent-primary)',
            color: '#fff',
            padding: 'var(--space-3) var(--space-6)',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          Start searching
        </Link>

        <p style={{ marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px' }}>
          A receipt has been sent to your email. Questions?{' '}
          <a href="mailto:support@energytradeinspection.com" style={{ color: 'var(--accent-primary)' }}>
            Contact support
          </a>
        </p>
      </div>
    </div>
  )
}


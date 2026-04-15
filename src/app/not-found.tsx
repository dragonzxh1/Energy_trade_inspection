import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Not Found',
  robots: { index: false, follow: false },
}

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: 'var(--bg-primary)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8) var(--space-4)',
        textAlign: 'center',
      }}
    >
      <p
        className="mono"
        style={{
          color: 'var(--text-muted)',
          marginBottom: 'var(--space-3)',
          fontSize: '13px',
        }}
      >
        404
      </p>
      <h1
        style={{
          color: 'var(--text-primary)',
          fontSize: '24px',
          marginBottom: 'var(--space-3)',
        }}
      >
        Entity not found
      </h1>
      <p
        style={{
          color: 'var(--text-secondary)',
          marginBottom: 'var(--space-6)',
          maxWidth: '420px',
        }}
      >
        This may be a newly incorporated entity, or registered under a different
        identifier. Try searching again.
      </p>
      <Link
        href="/"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-5)',
          backgroundColor: 'var(--accent-primary)',
          color: '#fff',
          borderRadius: '6px',
          fontSize: '14px',
          fontWeight: 500,
          textDecoration: 'none',
        }}
      >
        Search again
      </Link>
    </main>
  )
}


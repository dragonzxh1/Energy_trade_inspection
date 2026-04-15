'use client'

import { useEffect } from 'react'

interface ErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    console.error('[app error]', error)
  }, [error])

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8)',
        textAlign: 'center',
      }}
    >
      <p
        style={{
          color: 'var(--status-listed)',
          fontSize: '12px',
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginBottom: 'var(--space-3)',
        }}
      >
        Something went wrong
      </p>
      <h1
        style={{
          color: 'var(--text-primary)',
          fontSize: '24px',
          fontWeight: 600,
          marginBottom: 'var(--space-4)',
        }}
      >
        Unable to load this page
      </h1>
      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: '14px',
          marginBottom: 'var(--space-6)',
          maxWidth: '400px',
        }}
      >
        There was an error loading this page. This may be a temporary issue.
      </p>
      <button
        onClick={reset}
        style={{
          backgroundColor: 'var(--accent-primary)',
          border: 'none',
          borderRadius: '8px',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '14px',
          fontFamily: 'inherit',
          fontWeight: 500,
          padding: 'var(--space-3) var(--space-5)',
        }}
      >
        Try again
      </button>
    </div>
  )
}


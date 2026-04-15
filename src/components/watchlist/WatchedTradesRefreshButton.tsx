'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function WatchedTradesRefreshButton() {
  const [loading, setLoading]   = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const router = useRouter()

  async function handleRefresh() {
    setLoading(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/watchlist/trades/refresh', { method: 'POST' })
      if (res.ok) {
        const { alertsCreated } = await res.json() as { checked: number; alertsCreated: number }
        setFeedback(
          alertsCreated > 0
            ? `${alertsCreated} change${alertsCreated !== 1 ? 's' : ''} detected`
            : 'All up to date',
        )
        router.refresh()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
      {feedback && (
        <span style={{
          fontSize: '12px', fontWeight: 500,
          color: feedback.includes('change') ? '#f97316' : 'var(--status-clear)',
        }}>
          {feedback}
        </span>
      )}
      <button
        onClick={handleRefresh}
        disabled={loading}
        style={{
          padding: 'var(--space-2) var(--space-4)',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          color: 'var(--text-secondary)',
          fontSize: '12px', fontWeight: 500,
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.5 : 1,
          fontFamily: 'inherit',
          transition: 'opacity 0.15s ease',
        }}
      >
        {loading ? 'Checking…' : '↺ Refresh trades'}
      </button>
    </div>
  )
}

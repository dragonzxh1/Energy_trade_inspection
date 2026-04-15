'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  lastCheckedAt: string | null
  entityCount: number
}

export default function RefreshButton({ lastCheckedAt, entityCount }: Props) {
  const [loading, setLoading]   = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const router = useRouter()

  const lastCheckedLabel = lastCheckedAt
    ? `Last checked ${new Date(lastCheckedAt).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric',
      })}`
    : 'Never checked'

  async function handleRefresh() {
    setLoading(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/watchlist/refresh', { method: 'POST' })
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
        {lastCheckedLabel}
        {entityCount > 0 && ` · ${entityCount} ${entityCount === 1 ? 'entity' : 'entities'}`}
      </span>

      {feedback && (
        <span
          style={{
            fontSize: '12px',
            fontWeight: 500,
            color: feedback.includes('change') ? '#f97316' : 'var(--status-clear)',
          }}
        >
          {feedback}
        </span>
      )}

      <button
        onClick={handleRefresh}
        disabled={loading || entityCount === 0}
        style={{
          padding: 'var(--space-2) var(--space-4)',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          color: 'var(--text-secondary)',
          fontSize: '12px',
          fontWeight: 500,
          cursor: loading || entityCount === 0 ? 'not-allowed' : 'pointer',
          opacity: loading || entityCount === 0 ? 0.5 : 1,
          fontFamily: 'inherit',
          transition: 'opacity 0.15s ease',
        }}
      >
        {loading ? 'Checking…' : '↺ Refresh status'}
      </button>
    </div>
  )
}

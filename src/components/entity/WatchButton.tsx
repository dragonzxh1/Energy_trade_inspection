'use client'

import { useState } from 'react'

interface WatchButtonProps {
  entityId: string
  entityType: 'company' | 'vessel' | 'terminal'
  entityKey: string
  entityName: string
  sanctionStatus: string
  initialWatching: boolean
  plan: string
}

export default function WatchButton({
  entityId,
  entityType,
  entityKey,
  entityName,
  sanctionStatus,
  initialWatching,
  plan,
}: WatchButtonProps) {
  const [watching, setWatching] = useState(initialWatching)
  const [loading, setLoading] = useState(false)

  const canWatch = plan === 'professional' || plan === 'enterprise'

  if (!canWatch) {
    return (
      <p style={{
        marginTop: 'var(--space-3)',
        color: 'var(--text-muted)',
        fontSize: '11px',
        textAlign: 'center',
      }}>
        Watch alerts — Professional+
      </p>
    )
  }

  async function toggle() {
    setLoading(true)
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entityId, entityType, entityKey, entityName, sanctionStatus }),
      })
      if (res.status === 401) {
        window.location.href = '/sign-in'
        return
      }
      if (res.ok) {
        const data = await res.json()
        setWatching(data.watching)
      }
    } catch {
      // ignore network errors silently
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      style={{
        display: 'block',
        width: '100%',
        marginTop: 'var(--space-3)',
        padding: 'var(--space-2) var(--space-3)',
        backgroundColor: watching ? 'rgba(59,130,246,0.12)' : 'var(--bg-elevated)',
        border: `1px solid ${watching ? 'rgba(59,130,246,0.4)' : 'var(--border-subtle)'}`,
        borderRadius: '6px',
        color: watching ? '#60a5fa' : 'var(--text-muted)',
        fontSize: '12px',
        fontWeight: 500,
        fontFamily: 'inherit',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.6 : 1,
        textAlign: 'center',
        transition: 'all 0.15s ease',
      }}
    >
      {loading ? '…' : watching ? '● Watching' : '+ Add to Watchlist'}
    </button>
  )
}

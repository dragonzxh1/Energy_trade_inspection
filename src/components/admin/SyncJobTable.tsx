'use client'

import { useState } from 'react'
import type { AdminSyncLogRow } from '@/lib/server/repository'

interface SyncJobTableProps {
  initialLogs: AdminSyncLogRow[]
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC'
}

const statusColors: Record<string, string> = {
  success:  'var(--status-clear)',
  failed:   'var(--status-listed)',
  running:  'var(--risk-medium)',
}

const statusLabels: Record<string, string> = {
  success: 'SUCCESS',
  failed:  'FAILED',
  running: 'RUNNING',
}

export default function SyncJobTable({ initialLogs }: SyncJobTableProps) {
  const [logs, setLogs] = useState<AdminSyncLogRow[]>(initialLogs)
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    try {
      const res = await fetch('/api/admin/sync')
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.recent_logs)) {
          setLogs(data.recent_logs)
        }
      }
    } catch {
      // Silent failure — keep current logs
    } finally {
      setRefreshing(false)
    }
  }

  const headerCell: React.CSSProperties = {
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    backgroundColor: 'var(--bg-elevated)',
    padding: 'var(--space-3) var(--space-4)',
  }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>Sync History</h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            backgroundColor: 'transparent',
            color: 'var(--text-muted)',
            cursor: refreshing ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontFamily: 'inherit',
            padding: 'var(--space-2) var(--space-4)',
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? 'Refreshing...' : 'Refresh Sync Log'}
        </button>
      </div>

      {/* Table container */}
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-solid)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}>
        {logs.length === 0 ? (
          <p style={{
            color: 'var(--text-muted)',
            fontSize: '13px',
            textAlign: 'center',
            padding: 'var(--space-8)',
          }}>
            No sync job history found. Trigger a sync from the API to populate this log.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '1fr' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '90px' }} />
              <col style={{ width: '80px' }} />
              <col style={{ width: '200px' }} />
              <col style={{ width: '1fr' }} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" style={{ ...headerCell, textAlign: 'left' }}>Source</th>
                <th scope="col" style={{ ...headerCell, textAlign: 'left' }}>Status</th>
                <th scope="col" style={{ ...headerCell, textAlign: 'right' }}>Records</th>
                <th scope="col" style={{ ...headerCell, textAlign: 'right' }}>Duration</th>
                <th scope="col" style={{ ...headerCell, textAlign: 'left' }}>Time</th>
                <th scope="col" style={{ ...headerCell, textAlign: 'left' }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => {
                const isLast = i === logs.length - 1
                const statusKey = log.status?.toLowerCase() ?? 'unknown'
                const statusColor = statusColors[statusKey] ?? 'var(--text-muted)'
                const statusLabel = statusLabels[statusKey] ?? log.status?.toUpperCase() ?? '—'
                return (
                  <tr key={`${log.source}-${log.synced_at}`} style={{
                    borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                    borderBottom: isLast ? 'none' : undefined,
                  }}>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '13px', color: 'var(--text-primary)' }}>
                      {log.source}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <span
                        title={`Sync ${statusKey}`}
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          color: statusColor,
                          letterSpacing: '0.04em',
                        }}
                      >
                        {statusLabel}
                      </span>
                    </td>
                    <td style={{
                      padding: 'var(--space-3) var(--space-4)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-secondary)',
                      textAlign: 'right',
                    }}>
                      {log.record_count ?? '—'}
                    </td>
                    <td style={{
                      padding: 'var(--space-3) var(--space-4)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                      textAlign: 'right',
                    }}>
                      {formatDuration(log.duration_ms)}
                    </td>
                    <td style={{
                      padding: 'var(--space-3) var(--space-4)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                    }}>
                      {formatTimestamp(log.synced_at)}
                    </td>
                    <td style={{
                      padding: 'var(--space-3) var(--space-4)',
                      fontSize: '13px',
                      color: 'var(--text-muted)',
                      fontStyle: log.error_message ? 'italic' : 'normal',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={log.error_message ?? undefined}
                    >
                      {log.error_message ?? ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'

interface PageViewRow {
  id: number
  path: string
  ip: string | null
  country: string | null
  created_at: string
}

function formatTime(iso: string): string {
  const d = new Date(iso + 'Z')
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function RecentPageViews() {
  const [rows, setRows] = useState<PageViewRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/pageviews?limit=100')
      .then((r) => r.json())
      .then((data: PageViewRow[]) => setRows(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Loading...</p>
  }

  if (rows.length === 0) {
    return <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No page views recorded yet.</p>
  }

  return (
    <div>
      <p style={{
        fontSize: '13px',
        color: 'var(--text-muted)',
        marginBottom: 'var(--space-3)',
      }}>
        Showing {rows.length} recent visits
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '13px',
        }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={thStyle}>IP</th>
              <th style={thStyle}>归属地</th>
              <th style={thStyle}>Path</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{r.ip ?? '-'}</td>
                <td style={tdStyle}>{r.country ?? '-'}</td>
                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{r.path}</td>
                <td style={{ ...tdStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>{formatTime(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  textAlign: 'left',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
}

const tdStyle: React.CSSProperties = {
  padding: 'var(--space-2) var(--space-3)',
  color: 'var(--text-primary)',
}

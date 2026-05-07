import type { AdminStats } from '@/lib/server/repository'

interface StatCardsProps {
  stats: AdminStats
}

interface StatCardProps {
  label: string
  value: string | number
  subtext: string
}

function StatCard({ label, value, subtext }: StatCardProps) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-subtle)',
      borderRadius: '12px',
      padding: 'var(--space-4)',
    }}>
      <p style={{
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        marginBottom: 'var(--space-2)',
      }}>
        {label}
      </p>
      <p style={{
        fontSize: '28px',
        fontWeight: 590,
        lineHeight: '36px',
        color: 'var(--text-primary)',
        marginBottom: '4px',
      }}>
        {value}
      </p>
      <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
        {subtext}
      </p>
    </div>
  )
}

export default function StatCards({ stats }: StatCardsProps) {
  const { planDistribution, topEntityTypes } = stats
  const planSubtext = `${planDistribution.free} free · ${planDistribution.starter} starter · ${planDistribution.professional} pro · ${planDistribution.enterprise} enterprise`

  // Build entity breakdown inline text from topEntityTypes array
  const entityCounts = { company: 0, vessel: 0, terminal: 0 }
  for (const row of topEntityTypes) {
    if (row.type in entityCounts) {
      entityCounts[row.type] = row.count
    }
  }
  const entitySubtext = `Companies: ${entityCounts.company} · Vessels: ${entityCounts.vessel} · Terminals: ${entityCounts.terminal}`
  const totalScreened = entityCounts.company + entityCounts.vessel + entityCounts.terminal

  return (
    <div>
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>
        Platform Stats
      </h2>

      {/* 2x3 grid of core stat cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 'var(--space-4)',
        marginBottom: 'var(--space-4)',
      }}>
        <StatCard
          label="Total Users"
          value={stats.totalUsers}
          subtext="registered users"
        />
        <StatCard
          label="Plan Distribution"
          value={`${planDistribution.starter + planDistribution.professional + planDistribution.enterprise} paid`}
          subtext={planSubtext}
        />
        <StatCard
          label="New Today"
          value={stats.newToday}
          subtext="registrations in the last 24h"
        />
        <StatCard
          label="New (30 Days)"
          value={stats.new30Days}
          subtext="registrations in the past 30 days"
        />
        <StatCard
          label="Total Page Views"
          value={stats.totalPageViews.toLocaleString()}
          subtext="unique page views"
        />
        <StatCard
          label="Page Views Today"
          value={stats.pageViewsToday.toLocaleString()}
          subtext="views in the last 24h"
        />
      </div>

      {/* Entity Breakdown — full-width card below the 2x3 grid (per ADMIN-04 topEntityTypes) */}
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '12px',
        padding: 'var(--space-4)',
      }}>
        <p style={{
          fontSize: '11px',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          marginBottom: 'var(--space-2)',
        }}>
          Entity Breakdown
        </p>
        <p style={{
          fontSize: '28px',
          fontWeight: 590,
          lineHeight: '36px',
          color: 'var(--text-primary)',
          marginBottom: '4px',
        }}>
          {totalScreened.toLocaleString()}
        </p>
        <p style={{ fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {entitySubtext}
        </p>
      </div>

      {/* Top Pages */}
      {stats.topPages.length > 0 && (
        <div style={{
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px',
          padding: 'var(--space-4)',
          marginTop: 'var(--space-4)',
        }}>
          <p style={{
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
            marginBottom: 'var(--space-3)',
          }}>
            Top Pages
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {stats.topPages.map((p, i) => (
              <div key={p.path} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '13px',
              }}>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {p.path}
                </span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                  {p.count.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

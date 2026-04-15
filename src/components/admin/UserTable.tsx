'use client'

import { useState } from 'react'
import PlanSelector from '@/components/admin/PlanSelector'
import type { UserAdminRow } from '@/lib/server/repository'

const UNLIMITED_QUOTA = -1

function formatDate(ts: string | null): string {
  if (!ts) return 'Never'
  return new Date(ts).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

function formatQuota(used: number, limit: number): string {
  if (limit === UNLIMITED_QUOTA) return 'Unlimited'
  return `${used} / ${limit}`
}

function isNearLimit(used: number, limit: number): boolean {
  if (limit === UNLIMITED_QUOTA || limit === 0) return false
  return used / limit >= 0.8
}

interface UserTableProps {
  users: UserAdminRow[]
}

export default function UserTable({ users }: UserTableProps) {
  const [search, setSearch] = useState('')
  const [planMap, setPlanMap] = useState<Record<string, string>>({})

  const filtered = users.filter((u) =>
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  function handlePlanChanged(userId: string, newPlan: string) {
    setPlanMap((prev) => ({ ...prev, [userId]: newPlan }))
  }

  const headerCell: React.CSSProperties = {
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    backgroundColor: 'var(--bg-elevated)',
    padding: 'var(--space-3) var(--space-4)',
    textAlign: 'left',
  }

  return (
    <div>
      <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-4)' }}>
        Users
      </h2>

      {/* Search */}
      <input
        type="text"
        placeholder="Search users by email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '280px',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '6px',
          color: 'var(--text-primary)',
          fontSize: '13px',
          fontFamily: 'inherit',
          padding: 'var(--space-2) var(--space-3)',
          marginBottom: 'var(--space-4)',
          display: 'block',
        }}
      />

      <div style={{
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-solid)',
        borderRadius: '12px',
        overflow: 'hidden',
      }}>
        {users.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: 'var(--space-8)' }}>
            No users registered yet.
          </p>
        ) : filtered.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: 'var(--space-8)' }}>
            No users match your search.
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th scope="col" style={headerCell}>Email</th>
                <th scope="col" style={{ ...headerCell, width: '100px' }}>Plan</th>
                <th scope="col" style={{ ...headerCell, width: '110px' }}>Registered</th>
                <th scope="col" style={{ ...headerCell, width: '110px' }}>Last Active</th>
                <th scope="col" style={{ ...headerCell, width: '90px', textAlign: 'right' }}>Quota Used</th>
                <th scope="col" style={{ ...headerCell, width: '120px' }}>Change plan</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user, i) => {
                const effectivePlan = planMap[user.id] ?? user.plan
                const quotaNearLimit = isNearLimit(user.quota_used, user.quota_limit)
                const isPaid = effectivePlan !== 'free'
                return (
                  <tr key={user.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' }}>
                      {user.email}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      {isPaid ? (
                        <span style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          color: 'var(--accent-primary)',
                          border: '1px solid var(--accent-primary)',
                          borderRadius: '4px',
                          padding: '2px 6px',
                        }}>
                          {effectivePlan}
                        </span>
                      ) : (
                        <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Free</span>
                      )}
                    </td>
                    <td style={{
                      padding: 'var(--space-3) var(--space-4)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                    }}>
                      {formatDate(user.created_at)}
                    </td>
                    <td style={{
                      padding: 'var(--space-3) var(--space-4)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-muted)',
                    }}>
                      {formatDate(user.last_active_at)}
                    </td>
                    <td style={{
                      padding: 'var(--space-3) var(--space-4)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-mono)',
                      textAlign: 'right',
                      color: quotaNearLimit ? 'var(--risk-medium)' : 'var(--text-secondary)',
                    }}>
                      {formatQuota(user.quota_used, user.quota_limit)}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <PlanSelector
                        userId={user.id}
                        userEmail={user.email}
                        currentPlan={effectivePlan}
                        onPlanChanged={(newPlan) => handlePlanChanged(user.id, newPlan)}
                      />
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

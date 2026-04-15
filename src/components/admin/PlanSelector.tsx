'use client'

import { useState } from 'react'

interface PlanSelectorProps {
  userId: string
  userEmail: string
  currentPlan: string
  onPlanChanged: (newPlan: string) => void
}

const PLAN_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'starter', label: 'Starter' },
  { value: 'enterprise', label: 'Enterprise' },
] as const

export default function PlanSelector({ userId, userEmail, currentPlan, onPlanChanged }: PlanSelectorProps) {
  const [selected, setSelected] = useState(currentPlan)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newPlan = e.target.value
    const previousPlan = selected
    setSelected(newPlan)  // optimistic
    setError(null)

    try {
      const res = await fetch(`/api/admin/users/${userId}/plan`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: newPlan }),
      })

      if (!res.ok) {
        setSelected(previousPlan)  // revert
        setError('Failed. Try again.')
        setTimeout(() => setError(null), 4000)
        return
      }

      onPlanChanged(newPlan)
    } catch {
      setSelected(previousPlan)  // revert
      setError('Failed. Try again.')
      setTimeout(() => setError(null), 4000)
    }
  }

  return (
    <div>
      <select
        value={selected}
        onChange={handleChange}
        aria-label={`Change plan for ${userEmail}`}
        style={{
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '4px',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '13px',
          fontFamily: 'inherit',
          padding: 'var(--space-1) var(--space-2)',
          minHeight: '36px',
        }}
      >
        {PLAN_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p style={{ fontSize: '11px', color: 'var(--status-listed)', marginTop: '4px' }}>
          {error}
        </p>
      )}
    </div>
  )
}

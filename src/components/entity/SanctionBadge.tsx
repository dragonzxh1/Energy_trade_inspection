'use client'

import { useState, useId } from 'react'
import Badge from '@/components/ui/Badge'
import type { SanctionStatus } from '@/lib/types'

interface SanctionBadgeProps {
  status: SanctionStatus
  size?: 'sm' | 'md'
  /** Optional list of specific sanctions list names to show in tooltip.
   *  Only rendered when status === 'listed' and sources.length > 0.
   *  Example: ['OFAC SDN', 'EU FSF'] */
  sources?: string[]
}

const CONFIG: Record<SanctionStatus, { label: string; color: string; background: string }> = {
  not_listed: {
    label: 'Not Listed',
    color: 'var(--status-clear)',
    background: 'rgba(16, 185, 129, 0.12)',
  },
  listed: {
    label: 'Sanctioned',
    color: 'var(--status-listed)',
    background: 'rgba(239, 68, 68, 0.12)',
  },
  unknown: {
    label: 'Status Unknown',
    color: 'var(--status-unknown)',
    background: 'rgba(245, 158, 11, 0.12)',
  },
}

export default function SanctionBadge({ status, size = 'md', sources }: SanctionBadgeProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const { label, color, background } = CONFIG[status]
  const showTooltip = status === 'listed' && sources != null && sources.length > 0
  const tooltipId = useId()

  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => { if (showTooltip) setTooltipOpen(true) }}
      onMouseLeave={() => setTooltipOpen(false)}
      onClick={() => { if (showTooltip) setTooltipOpen(v => !v) }}
      aria-describedby={showTooltip && tooltipOpen ? tooltipId : undefined}
    >
      <Badge
        label={label}
        color={color}
        background={background}
        size={size}
        className={status === 'not_listed' ? 'badge-glow-clear' : status === 'listed' ? 'badge-glow-listed' : undefined}
      />
      {showTooltip && tooltipOpen && (
        <span
          id={tooltipId}
          role="tooltip"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 50,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: '6px',
            padding: '8px 12px',
            minWidth: '160px',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          <span style={{ display: 'block', fontSize: '12px', fontWeight: 590, color: 'var(--text-muted)', marginBottom: '4px' }}>
            Sanctioned:
          </span>
          {sources!.map((src, i) => (
            <span key={i} style={{ display: 'block', fontSize: '12px', color: 'var(--text-primary)' }}>
              {src}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

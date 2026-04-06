import Badge from '@/components/ui/Badge'
import type { SanctionStatus } from '@/lib/types'

interface SanctionBadgeProps {
  status: SanctionStatus
  size?: 'sm' | 'md'
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

export default function SanctionBadge({ status, size = 'md' }: SanctionBadgeProps) {
  const { label, color, background } = CONFIG[status]
  return (
    <Badge
      label={label}
      color={color}
      background={background}
      size={size}
      className={status === 'not_listed' ? 'badge-glow-clear' : undefined}
    />
  )
}

import Badge from '@/components/ui/Badge'
import type { RiskLevel } from '@/lib/types'

interface RiskBadgeProps {
  level: RiskLevel
  size?: 'sm' | 'md'
}

const CONFIG: Record<RiskLevel, { label: string; color: string; background: string }> = {
  low: {
    label: 'Low Risk',
    color: 'var(--risk-low)',
    background: 'rgba(16, 185, 129, 0.10)',
  },
  medium: {
    label: 'Medium Risk',
    color: 'var(--risk-medium)',
    background: 'rgba(245, 158, 11, 0.12)',
  },
  high: {
    label: 'High Risk',
    color: 'var(--risk-high)',
    background: 'rgba(249, 115, 22, 0.12)',
  },
  critical: {
    label: 'Critical Risk',
    color: '#fff',
    background: 'var(--risk-critical)',
  },
}

export default function RiskBadge({ level, size = 'md' }: RiskBadgeProps) {
  const { label, color, background } = CONFIG[level]
  return <Badge label={label} color={color} background={background} size={size} />
}

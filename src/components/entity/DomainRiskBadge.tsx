import Badge from '@/components/ui/Badge'

interface DomainRiskBadgeProps {
  ageDays: number | null
  size?: 'sm' | 'md'
}

/**
 * Shown when domain age < 180 days (6 months).
 * Uses orange color, no animation (per Phase 2 D-02 pattern: no glow/pulse on badges).
 * Severity label changes with age:
 *   < 30 days  → "New Domain · <30d"
 *   30–89 days → "New Domain · <3mo"
 *   90–179 days→ "New Domain · <6mo"
 */
export default function DomainRiskBadge({ ageDays, size = 'md' }: DomainRiskBadgeProps) {
  if (ageDays === null || ageDays >= 180) return null

  let ageLabel: string
  if (ageDays < 30) {
    ageLabel = `<30d`
  } else if (ageDays < 90) {
    ageLabel = `<3mo`
  } else {
    ageLabel = `<6mo`
  }

  const tooltip = `Domain registered ${ageDays} days ago — newly registered domain is a fraud risk signal`

  return (
    <span title={tooltip}>
      <Badge
        label={`New Domain \u00B7 ${ageLabel}`}
        color="#f97316"
        background="rgba(249, 115, 22, 0.12)"
        size={size}
        // No className — no glow/pulse animation per badge convention (D-02 pattern)
      />
    </span>
  )
}

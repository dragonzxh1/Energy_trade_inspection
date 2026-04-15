import Badge from '@/components/ui/Badge'

interface WarningBadgeProps {
  source: string         // 'fca' | 'finma' | 'sfc' | 'mas' | 'dfsa' | 'sca' | 'cma'
  sourceName: string     // 'FCA (UK)' | 'FINMA (Switzerland)' | etc.
  jurisdiction: string   // 'UK' | 'CH' | 'HK' | 'SG' | 'AE-DU' | 'AE' | 'OM'
  size?: 'sm' | 'md'
}

// Label map: source → display label (middle dot U+00B7)
const LABEL: Record<string, string> = {
  fca:   'FCA \u00B7 UK',
  finma: 'FINMA \u00B7 CH',
  sfc:   'SFC \u00B7 HK',
  mas:   'MAS \u00B7 SG',
  dfsa:  'DFSA \u00B7 Dubai',
  sca:   'SCA \u00B7 UAE',
  cma:   'CMA \u00B7 Oman',
}

export default function WarningBadge({ source, sourceName, jurisdiction: _jurisdiction, size = 'md' }: WarningBadgeProps) {
  const label = LABEL[source] ?? `${source.toUpperCase()} \u00B7 Warning`
  const tooltip = `${sourceName} \u2014 Regulatory Warning List`

  return (
    <span title={tooltip}>
      <Badge
        label={label}
        color="var(--accent-amber)"
        background="rgba(245, 158, 11, 0.12)"
        size={size}
        // No className — WarningBadge has NO glow/pulse animation (per D-02 and UI-SPEC)
      />
    </span>
  )
}

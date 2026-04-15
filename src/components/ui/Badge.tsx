interface BadgeProps {
  label: string
  color: string        // CSS custom property reference, e.g. 'var(--status-clear)'
  background: string   // CSS custom property reference
  size?: 'sm' | 'md'
  className?: string
}

export default function Badge({ label, color, background, size = 'md', className }: BadgeProps) {
  const fontSize = size === 'sm' ? '11px' : '12px'
  const padding = size === 'sm' ? '2px 6px' : '3px 8px'

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding,
        backgroundColor: background,
        color,
        borderRadius: '4px',
        fontSize,
        fontWeight: 600,
        letterSpacing: '0.02em',
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

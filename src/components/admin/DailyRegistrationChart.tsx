interface DailyRegistrationChartProps {
  data: Array<{ date: string; count: number }>
}

function formatChartDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default function DailyRegistrationChart({ data }: DailyRegistrationChartProps) {
  const maxCount = Math.max(...data.map((d) => d.count), 1)
  const allZero = data.every((d) => d.count === 0)

  // Show only first day of each week as X-axis label
  const labelDates = new Set<string>()
  data.forEach((d, i) => {
    const date = new Date(d.date)
    if (i === 0 || date.getDay() === 1) {
      labelDates.add(d.date)
    }
  })

  return (
    <div>
      <p style={{
        fontSize: '11px',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        marginBottom: 'var(--space-3)',
      }}>
        Daily Registrations — Past 30 Days
      </p>

      {data.length === 0 ? (
        <div style={{
          height: '80px',
          backgroundColor: 'var(--bg-elevated)',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>No registration data available</span>
        </div>
      ) : (
        <>
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '4px',
            height: '80px',
          }}>
            {data.map((d) => {
              const heightPercent = allZero ? 2 : Math.max(2, (d.count / maxCount) * 100)
              return (
                <div
                  key={d.date}
                  title={`${formatChartDate(d.date)}: ${d.count} registrations`}
                  style={{
                    flex: 1,
                    height: `${heightPercent}%`,
                    backgroundColor: 'var(--accent-primary)',
                    opacity: allZero ? 0.3 : 0.7,
                    borderRadius: '2px 2px 0 0',
                    minHeight: '2px',
                    cursor: 'default',
                    transition: 'opacity 0.15s ease',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = '1' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.opacity = allZero ? '0.3' : '0.7' }}
                />
              )
            })}
          </div>

          {/* X-axis labels */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '4px',
            marginTop: '4px',
            height: '16px',
          }}>
            {data.map((d) => (
              <div
                key={d.date}
                style={{
                  flex: 1,
                  fontSize: '11px',
                  color: 'var(--text-faint)',
                  overflow: 'hidden',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {labelDates.has(d.date) ? formatChartDate(d.date) : ''}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

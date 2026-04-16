import type { FraudAlertRow } from '@/lib/server/repository'

interface Props {
  alerts: FraudAlertRow[]
}

// Source key → display label map (UI-SPEC §1 Source badge)
const SOURCE_LABEL: Record<string, string> = {
  storagespoofing:     'Rotterdam Port',
  fuelscamalert:       'FuelScamAlert',
  ametheus:            'Ametheus',
  'glo-innovations':   'Glo-Innovations',
  capitalgaslogistics: 'Capital Gas',
}

// Fraud type → display label map (UI-SPEC Copywriting Contract)
const FRAUD_TYPE_LABEL: Record<string, string> = {
  'storage-spoofing': 'Storage Spoofing',
  'fuel-scam':        'Fuel Scam',
  impersonation:      'Impersonation',
}

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  borderRadius:    '10px',
  padding:         'var(--space-5)',
  border:          '1px solid var(--border-subtle)',
}

const sectionTitle: React.CSSProperties = {
  color:          'var(--text-muted)',
  fontSize:       '11px',
  fontWeight:     600,
  letterSpacing:  '0.08em',
  textTransform:  'uppercase',
  marginBottom:   'var(--space-4)',
}

export default function FraudAlertsPanel({ alerts }: Props) {
  if (alerts.length === 0) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Fraud Alerts</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', padding: 'var(--space-8) 0' }}>
          No fraud alerts on record for this entity.
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', marginTop: 'var(--space-2)' }}>
          Covers Rotterdam Port Blacklist, FuelScamAlert, Ametheus, and other industry sources.
        </p>
      </div>
    )
  }

  const blacklistCount = alerts.filter((a) => a.list_type === 'blacklist').length
  const titleText = blacklistCount > 0 ? `Fraud Alerts (${blacklistCount})` : 'Fraud Alerts'

  return (
    <div style={card}>
      <p style={sectionTitle}>{titleText}</p>
      {alerts.map((alert, idx) => {
        const isLast = idx === alerts.length - 1
        const sourceLabel = SOURCE_LABEL[alert.source] ?? alert.source.toUpperCase()
        const fraudTypeLabel = alert.fraud_type ? (FRAUD_TYPE_LABEL[alert.fraud_type] ?? null) : null
        const reportedDate = new Date(alert.synced_at).toLocaleDateString('en-US', {
          year:  'numeric',
          month: 'short',
          day:   'numeric',
        })
        const descriptionTruncated =
          alert.description && alert.description.length > 120
            ? alert.description.slice(0, 120) + '\u2026'
            : alert.description

        return (
          <div
            key={`${alert.source}::${alert.company_name}::${idx}`}
            className="data-row"
            style={{
              display:        'flex',
              justifyContent: 'space-between',
              alignItems:     'flex-start',
              padding:        'var(--space-3) 0',
              borderBottom:   isLast ? 'none' : '1px solid var(--border-subtle)',
            }}
          >
            {/* Left column */}
            <div style={{ flex: 1 }}>
              {/* Row 1: entity name + source badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 600 }}>
                  {alert.company_name}
                </span>
                <span
                  style={{
                    fontSize:        '10px',
                    fontWeight:      600,
                    textTransform:   'uppercase',
                    letterSpacing:   '0.06em',
                    color:           'var(--accent-amber)',
                    backgroundColor: 'rgba(245,158,11,0.1)',
                    border:          '1px solid rgba(245,158,11,0.15)',
                    padding:         '1px 6px',
                    borderRadius:    '4px',
                  }}
                >
                  {sourceLabel}
                </span>
              </div>

              {/* Row 2: fraud type + reported date */}
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
                {fraudTypeLabel ? `${fraudTypeLabel} \u00b7 ` : ''}Reported {reportedDate}
              </p>

              {/* Row 3 (conditional): description */}
              {descriptionTruncated && (
                <p style={{
                  color:      'var(--text-muted)',
                  fontSize:   '12px',
                  fontStyle:  'italic',
                  marginTop:  '4px',
                }}>
                  {descriptionTruncated}
                </p>
              )}

              {/* Row 4 (conditional): scam URL */}
              {alert.scam_url && (
                <p style={{ fontSize: '11px', marginTop: '4px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Fake site: </span>
                  <a
                    href={alert.scam_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}
                  >
                    {alert.scam_url}
                  </a>
                </p>
              )}
            </div>

            {/* Right column: list_type badge */}
            <div style={{ flexShrink: 0, marginLeft: 'var(--space-3)' }}>
              {alert.list_type === 'blacklist' ? (
                <span style={{
                  fontSize:        '11px',
                  fontWeight:      600,
                  textTransform:   'uppercase',
                  letterSpacing:   '0.06em',
                  color:           '#f59e0b',
                  backgroundColor: 'rgba(245,158,11,0.1)',
                  padding:         '2px 6px',
                  borderRadius:    '4px',
                }}>
                  BLACKLIST
                </span>
              ) : (
                <span style={{
                  fontSize:        '11px',
                  fontWeight:      600,
                  textTransform:   'uppercase',
                  letterSpacing:   '0.06em',
                  color:           '#10b981',
                  backgroundColor: 'rgba(16,185,129,0.1)',
                  padding:         '2px 6px',
                  borderRadius:    '4px',
                }}>
                  WHITELIST
                </span>
              )}
            </div>
          </div>
        )
      })}

      {/* Panel footnote */}
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '16px', marginTop: 'var(--space-4)' }}>
        Fraud alerts sourced from industry blacklists. Independent of government sanctions lists. Verify against primary sources before taking action.
      </p>
    </div>
  )
}

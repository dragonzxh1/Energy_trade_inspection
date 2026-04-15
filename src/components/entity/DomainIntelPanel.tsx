'use client'

import { useEffect, useState } from 'react'
import DomainRiskBadge from '@/components/entity/DomainRiskBadge'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WhoisData {
  ageDays: number | null
  durationDays: number | null
  privacyProtected: boolean
  registrantOrg: string | null
  registrantCountry: string | null
  riskScore: number
  riskSignals: string[]
}

interface EmailData {
  hasMx: boolean
  hasSpf: boolean
  hasDmarc: boolean
  dkimDetected: boolean
  dkimSelector: string | null
  riskSignals: string[]
  flagged: boolean
  error: string | null
}

interface SpoofingMatch {
  legitimateDomain: string
  legitimateCompany: string
  similarityScore: number
}

interface DomainIntelData {
  domain: string
  whois: WhoisData | null
  spoofingMatches: SpoofingMatch[]
  email: EmailData | null
}

// ── Styles (inline — no server/client mismatch) ──────────────────────────────

const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  borderRadius: '10px',
  padding: 'var(--space-5)',
  border: '1px solid var(--border-subtle)',
}

const sectionTitle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: 'var(--space-4)',
}

const emptyState: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  textAlign: 'center',
  padding: 'var(--space-8) 0',
}

const infoRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  padding: 'var(--space-3) 0',
  borderBottom: '1px solid var(--border-subtle)',
}

const rowLabel: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '13px',
  flexShrink: 0,
  marginRight: 'var(--space-4)',
  width: '160px',
}

const rowValue: React.CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: '13px',
  textAlign: 'right',
  wordBreak: 'break-word',
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Green check or red X indicator for boolean DNS status */
function DnsIndicator({ present, label }: { present: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          fontSize: '11px',
          fontWeight: 700,
          flexShrink: 0,
          backgroundColor: present ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.12)',
          color: present ? 'var(--risk-low)' : 'var(--status-listed)',
        }}
      >
        {present ? '\u2713' : '\u2717'}
      </span>
      <span
        style={{
          fontSize: '13px',
          color: present ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          marginLeft: 'auto',
          fontSize: '11px',
          fontWeight: 600,
          color: present ? 'var(--risk-low)' : 'var(--status-listed)',
        }}
      >
        {present ? 'Present' : 'Missing'}
      </span>
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {[100, 160, 130].map((w, i) => (
        <div key={i} style={card}>
          <div
            style={{
              height: '10px',
              width: `${w}px`,
              borderRadius: '4px',
              backgroundColor: 'var(--border-subtle)',
              marginBottom: 'var(--space-5)',
              opacity: 0.6,
            }}
          />
          {[1, 2, 3].map((j) => (
            <div
              key={j}
              style={{
                height: '12px',
                borderRadius: '4px',
                backgroundColor: 'var(--border-subtle)',
                marginBottom: 'var(--space-3)',
                opacity: 0.4,
                width: j === 3 ? '50%' : '100%',
              }}
            />
          ))}
        </div>
      ))}
      <p style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center' }}>
        Checking domain registration and email infrastructure\u2026
      </p>
    </div>
  )
}

function WhoisSection({ domain, whois }: { domain: string; whois: WhoisData | null }) {
  if (!whois) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Domain Registration (WHOIS / RDAP)</p>
        <p style={emptyState}>
          WHOIS lookup failed \u2014 domain may be newly registered, propagating, or RDAP server
          is unavailable. Try again in a few minutes.
        </p>
      </div>
    )
  }

  const ageText = whois.ageDays !== null
    ? whois.ageDays < 30
      ? `${whois.ageDays} days \u2014 extremely new`
      : whois.ageDays < 365
      ? `${whois.ageDays} days (${Math.floor(whois.ageDays / 30)} months)`
      : `${Math.floor(whois.ageDays / 365)} year${Math.floor(whois.ageDays / 365) !== 1 ? 's' : ''} (${whois.ageDays} days)`
    : 'Unknown'

  const durationText = whois.durationDays !== null
    ? `${Math.round(whois.durationDays / 30)} months`
    : 'Unknown'

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
        <p style={{ ...sectionTitle, marginBottom: 0 }}>Domain Registration (WHOIS / RDAP)</p>
        {whois.ageDays !== null && whois.ageDays < 180 && (
          <DomainRiskBadge ageDays={whois.ageDays} size="sm" />
        )}
      </div>

      <div style={infoRow}>
        <span style={rowLabel}>Domain</span>
        <span style={{ ...rowValue, fontFamily: 'var(--font-mono, monospace)' }}>{domain}</span>
      </div>
      <div style={infoRow}>
        <span style={rowLabel}>Registration age</span>
        <span
          style={{
            ...rowValue,
            color: (whois.ageDays ?? 999) < 180 ? '#f97316' : 'var(--text-primary)',
            fontWeight: (whois.ageDays ?? 999) < 180 ? 600 : 400,
          }}
        >
          {ageText}
        </span>
      </div>
      <div style={infoRow}>
        <span style={rowLabel}>Registered for</span>
        <span style={rowValue}>{durationText}</span>
      </div>
      <div style={infoRow}>
        <span style={rowLabel}>Registrant</span>
        <span style={rowValue}>
          {whois.privacyProtected
            ? <em style={{ color: '#f97316' }}>Privacy Protected \u2014 identity hidden</em>
            : whois.registrantOrg
            ? whois.registrantOrg
            : <em style={{ color: 'var(--text-muted)' }}>No organization on record</em>
          }
        </span>
      </div>
      {whois.registrantCountry && (
        <div style={infoRow}>
          <span style={rowLabel}>Registrant country</span>
          <span style={rowValue}>{whois.registrantCountry}</span>
        </div>
      )}
      <div style={{ ...infoRow, borderBottom: 'none' }}>
        <span style={rowLabel}>WHOIS risk score</span>
        <span style={{
          ...rowValue,
          color: whois.riskScore >= 6 ? 'var(--status-listed)' : whois.riskScore >= 3 ? '#f97316' : 'var(--risk-low)',
          fontWeight: 600,
        }}>
          {whois.riskScore}/10
        </span>
      </div>

      {whois.riskSignals.length > 0 && (
        <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', backgroundColor: 'var(--bg-elevated)', borderRadius: '6px' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Risk signals
          </p>
          {whois.riskSignals.map((s, i) => (
            <p key={i} style={{ color: '#f97316', fontSize: '12px', lineHeight: '18px' }}>
              {s}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function EmailDnsSection({ email }: { email: EmailData | null }) {
  if (!email) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Email DNS Hygiene (MX / SPF / DMARC)</p>
        <p style={emptyState}>
          DNS resolution failed \u2014 try again shortly. If the problem persists,
          your network may be blocking external DNS queries.
        </p>
      </div>
    )
  }

  const dkimLabel = email.dkimDetected
    ? `DKIM (selector: ${email.dkimSelector})`
    : 'DKIM (not detected via selector probing)'

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
        <p style={{ ...sectionTitle, marginBottom: 0 }}>Email DNS Hygiene</p>
        {email.flagged && (
          <span style={{
            fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--status-listed)', backgroundColor: 'rgba(239, 68, 68, 0.10)',
            padding: '2px 8px', borderRadius: '4px',
          }}>
            Mail hygiene risk
          </span>
        )}
      </div>

      <DnsIndicator present={email.hasMx}    label="MX Records (can receive email)" />
      <DnsIndicator present={email.hasSpf}   label="SPF Record (sender verification)" />
      <DnsIndicator present={email.hasDmarc} label="DMARC Record (anti-spoofing policy)" />
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0' }}>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '18px', height: '18px', borderRadius: '50%',
            fontSize: '11px', fontWeight: 700, flexShrink: 0,
            backgroundColor: email.dkimDetected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(156, 163, 175, 0.15)',
            color: email.dkimDetected ? 'var(--risk-low)' : 'var(--text-muted)',
          }}
        >
          {email.dkimDetected ? '\u2713' : '?'}
        </span>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{dkimLabel}</span>
        <span style={{
          marginLeft: 'auto', fontSize: '11px', fontWeight: 600,
          color: email.dkimDetected ? 'var(--risk-low)' : 'var(--text-muted)',
        }}>
          {email.dkimDetected ? 'Detected' : 'Not detectable'}
        </span>
      </div>

      {email.error && (
        <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: 'var(--space-3)', fontStyle: 'italic' }}>
          Note: some DNS lookups returned errors ({email.error}) \u2014 results may be incomplete.
        </p>
      )}
    </div>
  )
}

function SpoofingSection({ matches }: { matches: SpoofingMatch[] }) {
  if (matches.length === 0) return null

  return (
    <div style={card}>
      <p style={sectionTitle}>Domain Spoofing Alert ({matches.length} match{matches.length !== 1 ? 'es' : ''})</p>
      {matches.map((m, i) => (
        <div key={i} style={{ ...infoRow, flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <span style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '13px', color: 'var(--status-listed)' }}>
              {m.legitimateDomain}
            </span>
            <span style={{ fontSize: '11px', color: 'var(--status-listed)', fontWeight: 600 }}>
              {Math.round(m.similarityScore * 100)}% similar
            </span>
          </div>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{m.legitimateCompany}</span>
        </div>
      ))}
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '16px', marginTop: 'var(--space-3)' }}>
        This domain closely resembles a known legitimate company domain.
        This may indicate typosquatting or brand impersonation.
      </p>
    </div>
  )
}

function ManualDomainInput({ onSubmit }: { onSubmit: (domain: string) => void }) {
  const [value, setValue] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
    if (trimmed.length > 3) onSubmit(trimmed)
  }

  return (
    <div style={card}>
      <p style={sectionTitle}>Domain Intelligence</p>
      <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '20px', marginBottom: 'var(--space-4)' }}>
        No domain is stored for this entity. Enter the counterparty&rsquo;s domain or website
        to run a WHOIS registration check and email infrastructure analysis.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="example.com"
          style={{
            flex: 1,
            minWidth: '180px',
            padding: 'var(--space-2) var(--space-3)',
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            color: 'var(--text-primary)',
            fontSize: '13px',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        />
        <button
          type="submit"
          style={{
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor: 'var(--accent-primary)',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Check domain
        </button>
      </form>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  /** Domain string from entity metadata_json.website. null when no domain is stored. */
  domain: string | null
}

export default function DomainIntelPanel({ domain: initialDomain }: Props) {
  const [activeDomain, setActiveDomain] = useState<string | null>(initialDomain)
  const [data, setData]     = useState<DomainIntelData | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>(
    initialDomain ? 'loading' : 'idle'
  )

  useEffect(() => {
    if (!activeDomain) return

    let cancelled = false
    setStatus('loading')
    setData(null)

    fetch(`/api/intelligence/domain/${encodeURIComponent(activeDomain)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<DomainIntelData>
      })
      .then((d) => {
        if (!cancelled) { setData(d); setStatus('done') }
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })

    return () => { cancelled = true }
  }, [activeDomain])

  if (status === 'idle' || (!activeDomain && status !== 'loading')) {
    return <ManualDomainInput onSubmit={(d) => setActiveDomain(d)} />
  }

  if (status === 'loading') return <Skeleton />

  if (status === 'error' || !data) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Domain Intelligence</p>
        <p style={emptyState}>
          Domain intelligence unavailable. Check network connectivity or try again.
        </p>
        <div style={{ textAlign: 'center', marginTop: 'var(--space-3)' }}>
          <button
            onClick={() => setActiveDomain(null)}
            style={{
              background: 'none', border: 'none', color: 'var(--accent-primary)',
              cursor: 'pointer', fontSize: '12px', textDecoration: 'underline',
            }}
          >
            Try a different domain
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <WhoisSection domain={data.domain} whois={data.whois} />
      <EmailDnsSection email={data.email} />
      {data.spoofingMatches.length > 0 && (
        <SpoofingSection matches={data.spoofingMatches} />
      )}
      <div style={{ textAlign: 'right' }}>
        <button
          onClick={() => setActiveDomain(null)}
          style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', fontSize: '11px', textDecoration: 'underline',
          }}
        >
          Check a different domain
        </button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '16px' }}>
        WHOIS data sourced via RDAP (cached 48h). Email DNS data sourced from live DNS
        resolution (cached 48h). DKIM detection uses selector probing \u2014 absence does not
        confirm DKIM is unconfigured.
      </p>
    </div>
  )
}

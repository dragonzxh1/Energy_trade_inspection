import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import SearchBox from '@/components/search/SearchBox'
import Header from '@/components/layout/Header'
import type { SanctionStatus, RiskLevel } from '@/lib/types'
import { getFeaturedEntities, type FeaturedRow } from '@/lib/server/repository'

export const metadata: Metadata = {
  title: 'Energy Trade Inspection — Counterparty & Trade Risk',
  description:
    'Screen companies, vessels, and terminals against sanctions lists, AIS data, and registry records. Check domain fraud risk via WHOIS and spoofing detection. Trade-level risk in seconds.',
}

const TOOL_CARDS = [
  {
    icon: '⚡',
    title: 'Check a Trade',
    desc: 'Enter seller, vessel, and loading port. Get a trade-level risk judgment — sanctions, AIS dark periods, and port flags in one check.',
    href: '/trade',
    cta: 'Run trade check →',
  },
  {
    icon: '📄',
    title: 'Screen a Document',
    desc: 'Upload a contract or invoice. We extract parties automatically and screen them against sanctions lists and registry records.',
    href: '/screen',
    cta: 'Screen a document →',
  },
]

const TRUST_STATS = [
  { value: '3', label: 'Sanction lists screened', note: 'OFAC · EU FSF · UN' },
  { value: '190+', label: 'Flag states covered', note: 'Global vessel registry' },
  { value: 'Real-time', label: 'Screening response', note: 'No batch lag' },
]

const FEATURES = [
  {
    icon: '⚑',
    title: 'Sanction Screening',
    desc: 'Single query covers OFAC SDN, EU Financial Sanctions Framework, and UN consolidated lists — no guesswork on which list to check.',
  },
  {
    icon: '◉',
    title: 'Authenticity Score',
    desc: 'A 0–100 score built from entity existence, asset reality, trading history, document consistency, and community reputation signals.',
  },
  {
    icon: '⊞',
    title: 'Linked Entities',
    desc: 'Trace ownership from company to vessel and back. Director records, flag state, and operator history in one view.',
  },
]

const SANCTION_COLOR: Record<SanctionStatus, string> = {
  listed:     'var(--status-listed)',
  not_listed: 'var(--status-clear)',
  unknown:    'var(--text-muted)',
}

const SANCTION_LABEL: Record<SanctionStatus, string> = {
  listed:     'Sanctioned',
  not_listed: 'Clear',
  unknown:    'Unknown',
}

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: 'var(--status-listed)',
  high:     '#f97316',
  medium:   '#eab308',
  low:      'var(--status-clear)',
}

async function FeaturedEntities() {
  const entities = await getFeaturedEntities()
  if (entities.length === 0) return null

  const flagged = entities.filter(
    (e) => e.sanction_status === 'listed' || e.risk_level === 'critical'
  )
  const clean = entities.filter(
    (e) => e.sanction_status === 'not_listed' && e.risk_level === 'low'
  )

  return (
    <div
      className="animate-fade-in-up-delay-2"
      style={{
        maxWidth: '640px',
        width: '100%',
        marginTop: 'var(--space-10)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-4)',
        }}
      >
        <p
          style={{
            color: 'var(--text-muted)',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Database Snapshot
        </p>
        <Link
          href="/search"
          style={{ color: 'var(--accent-primary)', fontSize: '12px', textDecoration: 'none' }}
        >
          Browse all →
        </Link>
      </div>

      <div className="home-snapshot">
        {/* Sanctioned column */}
        <div>
          <p
            style={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--status-listed)',
              marginBottom: 'var(--space-2)',
              paddingLeft: 'var(--space-1)',
            }}
          >
            ⚠ High Risk
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {flagged.map((e) => {
              const href = e.entity_type === 'vessel' ? `/vessel/${e.imo}` : `/company/${e.slug}`
              return (
                <Link
                  key={e.id}
                  href={href}
                  className="home-tool-card"
                  style={{
                    display: 'block',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid rgba(239,68,68,0.2)',
                    borderRadius: '8px',
                    padding: 'var(--space-3) var(--space-3)',
                    textDecoration: 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                    <p
                      style={{
                        color: 'var(--text-primary)',
                        fontSize: '12px',
                        fontWeight: 500,
                        lineHeight: '16px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {e.name}
                    </p>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        color: SANCTION_COLOR[e.sanction_status],
                        flexShrink: 0,
                      }}
                    >
                      {SANCTION_LABEL[e.sanction_status]}
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
                    {e.jurisdiction_flag} {e.country} · Score {e.authenticity_score}
                  </p>
                </Link>
              )
            })}
          </div>
        </div>

        {/* Clean column */}
        <div>
          <p
            style={{
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--status-clear)',
              marginBottom: 'var(--space-2)',
              paddingLeft: 'var(--space-1)',
            }}
          >
            ✓ Verified Clean
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {clean.map((e) => {
              const href = e.entity_type === 'vessel' ? `/vessel/${e.imo}` : `/company/${e.slug}`
              return (
                <Link
                  key={e.id}
                  href={href}
                  className="home-tool-card"
                  style={{
                    display: 'block',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid rgba(34,197,94,0.15)',
                    borderRadius: '8px',
                    padding: 'var(--space-3) var(--space-3)',
                    textDecoration: 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                    <p
                      style={{
                        color: 'var(--text-primary)',
                        fontSize: '12px',
                        fontWeight: 500,
                        lineHeight: '16px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {e.name}
                    </p>
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        color: SANCTION_COLOR[e.sanction_status],
                        flexShrink: 0,
                      }}
                    >
                      {SANCTION_LABEL[e.sanction_status]}
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
                    {e.jurisdiction_flag} {e.country} · Score {e.authenticity_score}
                  </p>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function HomePage() {
  return (
    <>
      <Header />
      <main
        style={{
          minHeight: '100vh',
          backgroundColor: 'var(--bg-primary)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'var(--space-8) var(--space-4)',
        }}
      >
        {/* Hero */}
        <div
          className="animate-fade-in-up"
          style={{
            maxWidth: '640px',
            width: '100%',
            textAlign: 'left',
          }}
        >
          <p
            style={{
              color: 'var(--accent-primary)',
              fontSize: '12px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              marginBottom: 'var(--space-3)',
            }}
          >
            Energy Trade Intelligence
          </p>
          <h1
            style={{
              color: 'var(--text-primary)',
              marginBottom: 'var(--space-4)',
              fontSize: '40px',
              lineHeight: '48px',
            }}
          >
            Screen your counterparties in seconds
          </h1>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '16px',
              lineHeight: '26px',
              marginBottom: 'var(--space-6)',
            }}
          >
            Search companies, vessels, and terminals — or enter a domain or email
            address to check for fraud risk. Backed by OFAC, EU FSF, AIS, and registry data.
          </p>

          {/* Primary CTA — entity search */}
          <Suspense>
            <SearchBox />
          </Suspense>

          {/* Feature entry points */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-5)',
            }}
            className="home-tool-cards"
          >
            {TOOL_CARDS.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="home-tool-card"
                style={{
                  display: 'block',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '10px',
                  padding: 'var(--space-4)',
                  textDecoration: 'none',
                }}
              >
                <span
                  style={{ fontSize: '18px', display: 'block', marginBottom: 'var(--space-2)' }}
                  aria-hidden="true"
                >
                  {card.icon}
                </span>
                <p
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: '13px',
                    fontWeight: 600,
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  {card.title}
                </p>
                <p
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '12px',
                    lineHeight: '18px',
                    marginBottom: 'var(--space-3)',
                  }}
                >
                  {card.desc}
                </p>
                <span style={{ color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 500 }}>
                  {card.cta}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Trust strip */}
        <div
          className="animate-fade-in-up-delay-1 home-trust-strip"
          style={{
            maxWidth: '640px',
            width: '100%',
            marginTop: 'var(--space-12)',
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 'var(--space-8)',
          }}
        >
          {TRUST_STATS.map((s) => (
            <div key={s.label}>
              <p
                style={{
                  color: 'var(--text-primary)',
                  fontSize: '22px',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  marginBottom: '2px',
                }}
              >
                {s.value}
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '12px', fontWeight: 500 }}>
                {s.label}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
                {s.note}
              </p>
            </div>
          ))}
        </div>

        {/* Feature highlights */}
        <div
          className="animate-fade-in-up-delay-2 home-features"
          style={{
            maxWidth: '640px',
            width: '100%',
            marginTop: 'var(--space-10)',
          }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="home-tool-card"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '10px',
                padding: 'var(--space-4)',
              }}
            >
              <span
                style={{
                  fontSize: '18px',
                  display: 'block',
                  marginBottom: 'var(--space-2)',
                  color: 'var(--accent-primary)',
                }}
                aria-hidden="true"
              >
                {f.icon}
              </span>
              <p
                style={{
                  color: 'var(--text-primary)',
                  fontSize: '13px',
                  fontWeight: 600,
                  marginBottom: 'var(--space-2)',
                }}
              >
                {f.title}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px', lineHeight: '18px' }}>
                {f.desc}
              </p>
            </div>
          ))}
        </div>

        {/* Featured entities */}
        <Suspense fallback={null}>
          <FeaturedEntities />
        </Suspense>

        {/* Pricing CTA */}
        <div
          className="animate-fade-in-up-delay-2"
          style={{
            maxWidth: '640px',
            width: '100%',
            marginTop: 'var(--space-8)',
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '12px',
          }}
        >
          <Link href="/pricing" style={{ color: 'var(--accent-primary)' }}>View pricing</Link>
          {' '}·{' '}
          <Link href="/search" style={{ color: 'var(--accent-primary)' }}>Browse database</Link>
        </div>
      </main>
    </>
  )
}





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
  listed:     '#ef4444',
  not_listed: '#22c55e',
  unknown:    '#55556a',
}

const SANCTION_LABEL: Record<SanctionStatus, string> = {
  listed:     'Sanctioned',
  not_listed: 'Clear',
  unknown:    'Unknown',
}

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#fbbf24',
  low:      '#4ade80',
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
            color: '#55556a',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
          }}
        >
          Database Snapshot
        </p>
        <Link
          href="/search"
          style={{ color: '#6366f1', fontSize: '12px', textDecoration: 'none' }}
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
              color: '#ef4444',
              marginBottom: '8px',
              paddingLeft: '4px',
            }}
          >
            ⚠ High Risk
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {flagged.map((e) => {
              const href = e.entity_type === 'vessel' ? `/vessel/${e.imo}` : `/company/${e.slug}`
              return (
                <Link
                  key={e.id}
                  href={href}
                  className="home-tool-card"
                  style={{
                    display: 'block',
                    backgroundColor: '#111113',
                    border: '1px solid rgba(239,68,68,0.2)',
                    borderTop: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: '8px',
                    padding: '12px',
                    textDecoration: 'none',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
                    transition: 'border-top-color 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <p
                      style={{
                        color: '#f1f1f3',
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
                  <p style={{ color: '#8b8b9a', fontSize: '11px', marginTop: '2px' }}>
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
              color: '#22c55e',
              marginBottom: '8px',
              paddingLeft: '4px',
            }}
          >
            ✓ Verified Clean
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {clean.map((e) => {
              const href = e.entity_type === 'vessel' ? `/vessel/${e.imo}` : `/company/${e.slug}`
              return (
                <Link
                  key={e.id}
                  href={href}
                  className="home-tool-card"
                  style={{
                    display: 'block',
                    backgroundColor: '#111113',
                    border: '1px solid rgba(34,197,94,0.15)',
                    borderTop: '1px solid rgba(34,197,94,0.2)',
                    borderRadius: '8px',
                    padding: '12px',
                    textDecoration: 'none',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
                    transition: 'border-top-color 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <p
                      style={{
                        color: '#f1f1f3',
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
                  <p style={{ color: '#8b8b9a', fontSize: '11px', marginTop: '2px' }}>
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
      <style>{`
        .home-cta-btn:hover {
          background: linear-gradient(180deg, #818cf8 0%, #6366f1 100%) !important;
          box-shadow: 0 1px 0 rgba(255,255,255,0.12) inset, 0 4px 10px rgba(99,102,241,0.35) !important;
          transform: translateY(-1px);
        }
        .home-tool-card:hover {
          border-top-color: rgba(255,255,255,0.14) !important;
        }
      `}</style>
      <Header />
      <main
        style={{
          minHeight: '100vh',
          backgroundColor: '#0a0a0d',
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
              color: '#6366f1',
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
              color: '#f1f1f3',
              marginBottom: 'var(--space-4)',
              fontSize: '40px',
              lineHeight: '48px',
            }}
          >
            Screen your counterparties in seconds
          </h1>
          <p
            style={{
              color: '#8b8b9a',
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
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  backgroundColor: '#111113',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderTop: '1px solid rgba(255,255,255,0.09)',
                  borderRadius: '10px',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
                  padding: '24px',
                  textDecoration: 'none',
                  transition: 'border-top-color 0.15s ease',
                }}
              >
                <span
                  style={{ fontSize: '18px', display: 'block' }}
                  aria-hidden="true"
                >
                  {card.icon}
                </span>
                <p
                  style={{
                    color: '#f1f1f3',
                    fontSize: '13px',
                    fontWeight: 600,
                    margin: 0,
                  }}
                >
                  {card.title}
                </p>
                <p
                  style={{
                    color: '#8b8b9a',
                    fontSize: '12px',
                    lineHeight: '18px',
                    margin: 0,
                  }}
                >
                  {card.desc}
                </p>
                <span
                  className="home-cta-btn"
                  style={{
                    display: 'inline-block',
                    padding: '7px 14px',
                    background: 'linear-gradient(180deg, #7578f2 0%, #5558e8 100%)',
                    color: '#fff',
                    border: '1px solid rgba(99,102,241,0.45)',
                    boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)',
                    borderRadius: '7px',
                    fontSize: '12px',
                    fontWeight: 500,
                    transition: 'all 0.12s ease',
                    cursor: 'pointer',
                    alignSelf: 'flex-start',
                  }}
                >
                  {card.cta}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Section divider */}
        <div style={{ maxWidth: '640px', width: '100%', marginTop: 'var(--space-12)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.4))' }} />
          <span style={{ color: '#55556a', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0 }}>Coverage</span>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, rgba(99,102,241,0.4), transparent)' }} />
        </div>

        {/* Trust strip */}
        <div
          className="animate-fade-in-up-delay-1 home-trust-strip"
          style={{
            maxWidth: '640px',
            width: '100%',
            marginTop: 'var(--space-5)',
            backgroundColor: '#111113',
            border: '1px solid rgba(99,102,241,0.15)',
            borderRadius: '12px',
            padding: 'var(--space-6) var(--space-8)',
            boxShadow: '0 2px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
          }}
        >
          {TRUST_STATS.map((s) => (
            <div key={s.label}>
              <p
                style={{
                  color: '#6366f1',
                  fontSize: '22px',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  marginBottom: '2px',
                }}
              >
                {s.value}
              </p>
              <p style={{ color: '#8b8b9a', fontSize: '12px', fontWeight: 500 }}>
                {s.label}
              </p>
              <p style={{ color: '#55556a', fontSize: '11px', marginTop: '2px' }}>
                {s.note}
              </p>
            </div>
          ))}
        </div>

        {/* Section divider */}
        <div style={{ maxWidth: '640px', width: '100%', marginTop: 'var(--space-10)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, transparent, rgba(99,102,241,0.4))' }} />
          <span style={{ color: '#55556a', fontSize: '10px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0 }}>Features</span>
          <div style={{ flex: 1, height: '1px', background: 'linear-gradient(90deg, rgba(99,102,241,0.4), transparent)' }} />
        </div>

        {/* Feature highlights */}
        <div
          className="animate-fade-in-up-delay-2 home-features"
          style={{
            maxWidth: '640px',
            width: '100%',
            marginTop: 'var(--space-5)',
          }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="home-tool-card"
              style={{
                backgroundColor: '#111113',
                border: '1px solid rgba(255,255,255,0.07)',
                borderTop: '1px solid rgba(255,255,255,0.09)',
                borderRadius: '10px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
                padding: '20px',
                transition: 'border-top-color 0.15s ease',
              }}
            >
              <span
                style={{
                  fontSize: '18px',
                  display: 'block',
                  marginBottom: 'var(--space-2)',
                  color: '#6366f1',
                }}
                aria-hidden="true"
              >
                {f.icon}
              </span>
              <p
                style={{
                  color: '#f1f1f3',
                  fontSize: '13px',
                  fontWeight: 600,
                  marginBottom: 'var(--space-2)',
                }}
              >
                {f.title}
              </p>
              <p style={{ color: '#8b8b9a', fontSize: '12px', lineHeight: '18px' }}>
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
            color: '#55556a',
            fontSize: '12px',
          }}
        >
          <Link href="/pricing" style={{ color: '#6366f1' }}>View pricing</Link>
          {' '}·{' '}
          <Link href="/search" style={{ color: '#6366f1' }}>Browse database</Link>
        </div>
      </main>
    </>
  )
}





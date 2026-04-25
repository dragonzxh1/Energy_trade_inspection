import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import SearchBox from '@/components/search/SearchBox'
import Header from '@/components/layout/Header'
import type { SanctionStatus, RiskLevel } from '@/lib/types'
import { getFeaturedEntities, type FeaturedRow } from '@/lib/server/repository'

export const metadata: Metadata = {
  title: 'ETI Verify — Energy Trade Intelligence & Counterparty Screening',
  description:
    'Screen companies, vessels, and terminals against sanctions lists, AIS data, and registry records. Check domain fraud risk via WHOIS and spoofing detection. Trade-level risk in seconds.',
}

const TOOL_CARDS = [
  {
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    title: 'Check a Trade',
    desc: 'Enter seller, vessel, and loading port. Get a trade-level risk judgment — sanctions, AIS dark periods, and port flags in one check.',
    href: '/trade',
    cta: 'Run trade check →',
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
      </svg>
    ),
    title: 'Check Domain Risk',
    desc: 'Enter a domain name to check WHOIS records, spoofing risk, and email DNS configuration. Spot look-alike domains before you engage.',
    href: '/search',
    cta: 'Check domain →',
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    title: 'Verify Email',
    desc: 'Enter an email address or domain to verify deliverability, check MX records, and assess spoofing and fraud risk.',
    href: '/search',
    cta: 'Verify email →',
  },
]

const TRUST_STATS = [
  { value: '3', label: 'Sanctions Lists Synced', note: 'OFAC · EU FSF · UN' },
  { value: '190+', label: 'Flag States Covered', note: 'Global Vessel Registry' },
  { value: '\u003c2s', label: 'Avg. Response Time', note: 'No Batch Lag' },
  { value: '100%', label: 'Data Traceability', note: 'AIS + Registry Records' },
]

const FEATURES = [
  {
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    title: 'Sanctions Screening',
    desc: 'Single query covers OFAC SDN, EU Financial Sanctions Framework, and UN consolidated lists — no guesswork on which list to check.',
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    title: 'Authenticity Score',
    desc: 'A 0–100 score built from entity existence, asset reality, trading history, document consistency, and community reputation signals.',
  },
  {
    icon: (
      <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
    ),
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
  high:     'var(--risk-high)',
  medium:   'var(--accent-amber)',
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
      style={{ maxWidth: '960px', width: '100%', marginTop: 'var(--space-12)' }}
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
            fontSize: '13px',
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}
        >
          Screening Result
        </p>
        <span className="mono" style={{ color: 'var(--text-faint)', fontSize: '12px' }}>
          Database Snapshot
        </span>
      </div>

      <div className="home-snapshot">
        {/* Sanctioned column */}
        <div>
          <p
            style={{
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--status-listed)',
              marginBottom: 'var(--space-3)',
              paddingLeft: '4px',
            }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            High Risk
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {flagged.map((e) => {
              const href = e.entity_type === 'vessel' ? `/vessel/${e.imo}` : `/company/${e.slug}`
              return (
                <Link
                  key={e.id}
                  href={href}
                  className="entity-card"
                  style={{
                    display: 'block',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid rgba(239,68,68,0.2)',
                    borderRadius: '12px',
                    padding: '14px',
                    textDecoration: 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <p
                      style={{
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        fontWeight: 500,
                        lineHeight: '18px',
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
                        padding: '2px 8px',
                        borderRadius: '999px',
                        backgroundColor: `${SANCTION_COLOR[e.sanction_status]}15`,
                        border: `1px solid ${SANCTION_COLOR[e.sanction_status]}30`,
                      }}
                    >
                      {SANCTION_LABEL[e.sanction_status]}
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
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
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--status-clear)',
              marginBottom: 'var(--space-3)',
              paddingLeft: '4px',
            }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Verified Clean
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {clean.map((e) => {
              const href = e.entity_type === 'vessel' ? `/vessel/${e.imo}` : `/company/${e.slug}`
              return (
                <Link
                  key={e.id}
                  href={href}
                  className="entity-card"
                  style={{
                    display: 'block',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid rgba(34,197,94,0.15)',
                    borderRadius: '12px',
                    padding: '14px',
                    textDecoration: 'none',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                    <p
                      style={{
                        color: 'var(--text-primary)',
                        fontSize: '13px',
                        fontWeight: 500,
                        lineHeight: '18px',
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
                        padding: '2px 8px',
                        borderRadius: '999px',
                        backgroundColor: `${SANCTION_COLOR[e.sanction_status]}15`,
                        border: `1px solid ${SANCTION_COLOR[e.sanction_status]}30`,
                      }}
                    >
                      {SANCTION_LABEL[e.sanction_status]}
                    </span>
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '4px' }}>
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
      <main style={{ minHeight: '100vh' }}>
        {/* Hero / Search Section */}
        <section
          style={{
            paddingTop: '120px',
            paddingBottom: '64px',
            paddingLeft: 'var(--space-4)',
            paddingRight: 'var(--space-4)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Gradient overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(to bottom, rgba(12, 74, 110, 0.15), transparent)',
              pointerEvents: 'none',
            }}
          />

          <div
            style={{
              maxWidth: '900px',
              margin: '0 auto',
              position: 'relative',
              zIndex: 1,
            }}
          >
            {/* Live feed badge — centered */}
            <div
              className="animate-fade-in-up"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                padding: '8px 18px',
                borderRadius: '999px',
                backgroundColor: 'rgba(14, 165, 233, 0.08)',
                border: '1px solid rgba(14, 165, 233, 0.2)',
                marginBottom: 'var(--space-6)',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--brand-400)',
                  display: 'block',
                }}
              />
              <span style={{ fontSize: '13px', color: 'var(--brand-400)', fontWeight: 500 }}>
                Live Feed: OFAC · EU FSF · UN Databases
              </span>
            </div>

            {/* Heading — left-aligned */}
            <h1
              className="animate-fade-in-up"
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(36px, 6vw, 56px)',
                lineHeight: 1.15,
                fontWeight: 600,
                color: 'var(--text-on-accent)',
                marginBottom: 'var(--space-5)',
                letterSpacing: '-0.025em',
                textAlign: 'left',
              }}
            >
              Energy Trade
              <br />
              <span className="brand-text">Intelligence & Screening</span>
            </h1>

            <p
              className="animate-fade-in-up-delay-1"
              style={{
                fontSize: '17px',
                color: 'var(--text-secondary)',
                lineHeight: 1.7,
                marginBottom: 'var(--space-8)',
                maxWidth: '560px',
                textAlign: 'left',
              }}
            >
              Screen your counterparties in seconds. Search companies, vessels, and terminals — or enter a domain or email address to check for fraud risk. Backed by OFAC, EU FSF, AIS, and registry data.
            </p>

            {/* Dual entry points */}
            <div
              className="animate-fade-in-up-delay-1"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 'var(--space-4)',
                textAlign: 'left',
              }}
            >
              {/* Left: Search */}
              <div>
                <Suspense>
                  <SearchBox />
                </Suspense>
              </div>

              {/* Right: Document Screen */}
              <div
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '16px',
                  padding: 'var(--space-6)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-4)',
                  transition: 'border-color 0.15s ease, transform 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'rgba(56, 189, 248, 0.2)'
                  ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-subtle)'
                  ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
                }}
              >
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    backgroundColor: 'rgba(14, 165, 233, 0.1)',
                    border: '1px solid rgba(14, 165, 233, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--brand-400)',
                  }}
                >
                  <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <p
                    style={{
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      fontWeight: 600,
                      marginBottom: '4px',
                    }}
                  >
                    Screen a Document
                  </p>
                  <p
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '13px',
                      lineHeight: '18px',
                    }}
                  >
                    Upload a contract or invoice. We extract parties automatically.
                  </p>
                </div>
                <Link
                  href="/screen"
                  className="btn-primary"
                  style={{
                    display: 'inline-block',
                    padding: '10px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 500,
                    textDecoration: 'none',
                    alignSelf: 'flex-start',
                  }}
                >
                  Upload →
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Stats Bar */}
        <section
          style={{
            borderTop: '1px solid var(--border-solid)',
            borderBottom: '1px solid var(--border-solid)',
            backgroundColor: 'rgba(15, 23, 42, 0.4)',
          }}
        >
          <div
            style={{
              maxWidth: 'var(--max-width)',
              margin: '0 auto',
              padding: 'var(--space-8) var(--space-4)',
            }}
          >
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-4) var(--space-8)',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {TRUST_STATS.map((s) => (
              <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                <span style={{
                  fontSize: '16px',
                  fontWeight: 600,
                  color: s.value.includes('s') || s.value.includes('%')
                    ? 'var(--brand-400)'
                    : 'var(--text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {s.value}
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
          </div>
        </section>

        {/* Tool entry points */}
        <section
          style={{
            padding: 'var(--space-16) var(--space-4)',
            maxWidth: '800px',
            margin: '0 auto',
          }}
        >
          <div
            className="animate-fade-in-up-delay-1"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 'var(--space-4)',
            }}
          >
            {TOOL_CARDS.map((card) => (
              <Link
                key={card.href}
                href={card.href}
                className="entity-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-3)',
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '16px',
                  padding: 'var(--space-6)',
                  textDecoration: 'none',
                }}
              >
                <div
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    backgroundColor: 'rgba(14, 165, 233, 0.1)',
                    border: '1px solid rgba(14, 165, 233, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--brand-400)',
                  }}
                >
                  {card.icon}
                </div>
                <p
                  style={{
                    color: 'var(--text-primary)',
                    fontSize: '15px',
                    fontWeight: 600,
                    margin: 0,
                  }}
                >
                  {card.title}
                </p>
                <p
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: '13px',
                    lineHeight: '20px',
                    margin: 0,
                    flexGrow: 1,
                  }}
                >
                  {card.desc}
                </p>
                <span
                  className="btn-primary"
                  style={{
                    display: 'inline-block',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 500,
                    alignSelf: 'flex-start',
                  }}
                >
                  {card.cta}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Feature highlights */}
        <section
          style={{
            padding: '0 var(--space-4) var(--space-16)',
            maxWidth: 'var(--max-width)',
            margin: '0 auto',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              textAlign: 'center',
              fontSize: '28px',
              fontWeight: 600,
              color: 'var(--text-on-accent)',
              marginBottom: 'var(--space-10)',
              letterSpacing: '-0.02em',
            }}
          >
            Core Capabilities
          </h2>

          {/* Asymmetric: 1 featured + 2 stacked */}
          <div
            className="animate-fade-in-up-delay-2"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--space-5)',
              alignItems: 'start',
            }}
          >
            {/* Featured: Sanctions Screening — primary value prop, gets full left column */}
            <div
              className="entity-card"
              style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid rgba(14, 165, 233, 0.15)',
                borderRadius: '16px',
                padding: 'var(--space-8)',
                gridRow: '1',
              }}
            >
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(14, 165, 233, 0.12)',
                  border: '1px solid rgba(14, 165, 233, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--brand-400)',
                  marginBottom: 'var(--space-5)',
                }}
              >
                {FEATURES[0].icon}
              </div>
              <p
                style={{
                  color: 'var(--text-primary)',
                  fontSize: '18px',
                  fontWeight: 600,
                  marginBottom: 'var(--space-3)',
                }}
              >
                {FEATURES[0].title}
              </p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: '22px' }}>
                {FEATURES[0].desc}
              </p>
            </div>

            {/* Right column: 2 stacked cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              {FEATURES.slice(1).map((f) => (
                <div
                  key={f.title}
                  className="entity-card"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '16px',
                    padding: 'var(--space-5)',
                  }}
                >
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      backgroundColor: 'rgba(14, 165, 233, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--brand-400)',
                      marginBottom: 'var(--space-3)',
                    }}
                  >
                    {f.icon}
                  </div>
                  <p
                    style={{
                      color: 'var(--text-primary)',
                      fontSize: '14px',
                      fontWeight: 600,
                      marginBottom: '4px',
                    }}
                  >
                    {f.title}
                  </p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '20px' }}>
                    {f.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Featured entities */}
        <section
          style={{
            padding: '0 var(--space-4) var(--space-16)',
            maxWidth: '960px',
            margin: '0 auto',
          }}
        >
          <Suspense fallback={null}>
            <FeaturedEntities />
          </Suspense>
        </section>

        {/* CTA Section */}
        <section
          style={{
            padding: '0 var(--space-4) var(--space-16)',
            maxWidth: '640px',
            margin: '0 auto',
            textAlign: 'center',
          }}
        >
          <div
            className="glass-panel"
            style={{ borderRadius: '20px', padding: 'var(--space-10) var(--space-8)' }}
          >
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '28px',
                fontWeight: 600,
                color: 'var(--text-on-accent)',
                marginBottom: 'var(--space-4)',
                letterSpacing: '-0.02em',
              }}
            >
              Ready to secure your trades?
            </h2>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '15px',
                lineHeight: '24px',
                marginBottom: 'var(--space-8)',
                maxWidth: '480px',
                marginLeft: 'auto',
                marginRight: 'auto',
              }}
            >
              Join commodity traders, insurers, and compliance teams who screen every counterparty with ETI Verify.
            </p>
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                gap: 'var(--space-3)',
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}
            >
              <Link
                href="/pricing"
                className="btn-primary"
                style={{
                  padding: '12px 28px',
                  borderRadius: '12px',
                  fontSize: '14px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  display: 'inline-block',
                }}
              >
                Start Free Trial
              </Link>
              <Link
                href="/search"
                className="hover-border-brand"
                style={{
                  padding: '12px 28px',
                  borderRadius: '12px',
                  fontSize: '14px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  display: 'inline-block',
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-solid)',
                }}
              >
                Browse Database
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer
          style={{
            borderTop: '1px solid var(--border-solid)',
            backgroundColor: 'rgba(2, 6, 23, 0.8)',
            padding: 'var(--space-12) var(--space-4)',
          }}
        >
          <div
            style={{
              maxWidth: 'var(--max-width)',
              margin: '0 auto',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr',
                gap: 'var(--space-8)',
                marginBottom: 'var(--space-8)',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      background: 'linear-gradient(135deg, var(--brand-400) 0%, var(--brand-600) 100%)',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--text-on-accent)',
                    }}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <span style={{ fontWeight: 700, color: 'var(--text-on-accent)' }}>ETI Verify</span>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--text-muted)', lineHeight: '20px' }}>
                  Energy Trade Intelligence & Risk Screening Platform
                </p>
              </div>

              <div>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-on-accent)', marginBottom: 'var(--space-3)' }}>Product</h4>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {['Sanctions Screening', 'Entity Database', 'API Access'].map((item) => (
                    <li key={item}>
                      <Link
                        href="/search"
                        className="hover-text-brand"
                        style={{ fontSize: '13px', color: 'var(--text-muted)', textDecoration: 'none' }}
                      >
                        {item}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-on-accent)', marginBottom: 'var(--space-3)' }}>Resources</h4>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {['Documentation', 'Compliance Guide', 'Changelog'].map((item) => (
                    <li key={item}>
                      <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-on-accent)', marginBottom: 'var(--space-3)' }}>Contact</h4>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <li style={{ fontSize: '13px', color: 'var(--text-muted)' }}>support@etiverify.com</li>
                  <li style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Singapore · London · Houston</li>
                </ul>
              </div>
            </div>

            <div
              style={{
                borderTop: '1px solid var(--border-solid)',
                paddingTop: 'var(--space-6)',
                display: 'flex',
                flexDirection: 'row',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 'var(--space-4)',
                flexWrap: 'wrap',
              }}
            >
              <p style={{ fontSize: '12px', color: 'var(--text-faint)' }}>
                © 2026 ETI Verify. All rights reserved.
              </p>
              <div style={{ display: 'flex', gap: 'var(--space-5)' }}>
                {['Privacy Policy', 'Terms of Service', 'Data Compliance'].map((item) => (
                  <span
                    key={item}
                    className="hover-text-muted"
                    style={{ fontSize: '12px', color: 'var(--text-faint)', cursor: 'pointer' }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </footer>
      </main>
    </>
  )
}

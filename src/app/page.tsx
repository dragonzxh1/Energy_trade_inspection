import type { Metadata } from 'next'
import { Suspense } from 'react'
import SearchBox from '@/components/search/SearchBox'
import Header from '@/components/layout/Header'

export const metadata: Metadata = {
  title: 'Energy Trade Inspection — Counterparty Verification',
  description:
    'Verify energy trading counterparties. Sanction status, authenticity scores, and risk flags for companies and vessels.',
}

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
            Energy Trade Inspection
          </p>
          <h1
            style={{
              color: 'var(--text-primary)',
              marginBottom: 'var(--space-4)',
              fontSize: '40px',
              lineHeight: '48px',
            }}
          >
            Know who you&apos;re trading with.
          </h1>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '16px',
              lineHeight: '26px',
              marginBottom: 'var(--space-8)',
            }}
          >
            Cross-verify companies, vessels, and terminals against sanction lists,
            registries, and trading records — before you sign.
          </p>

          <Suspense>
            <SearchBox />
          </Suspense>

          <p
            style={{
              marginTop: 'var(--space-4)',
              color: 'var(--text-muted)',
              fontSize: '12px',
            }}
          >
            Search by company name, registration number, or IMO number
          </p>
        </div>

        {/* Trust strip */}
        <div
          className="animate-fade-in-up-delay-1"
          style={{
            maxWidth: '640px',
            width: '100%',
            marginTop: 'var(--space-12)',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--space-5)',
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
          className="animate-fade-in-up-delay-2"
          style={{
            maxWidth: '640px',
            width: '100%',
            marginTop: 'var(--space-10)',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--space-5)',
          }}
        >
          {FEATURES.map((f) => (
            <div
              key={f.title}
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

        {/* Demo CTA */}
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
          Try it:{' '}
          <a href="/company/demo-trading-co" style={{ color: 'var(--accent-primary)' }}>
            Demo Trading Co.
          </a>
          {' '}·{' '}
          <a href="/vessel/9999999" style={{ color: 'var(--accent-primary)' }}>
            MV Demo Tanker
          </a>
          {' '}·{' '}
          <a href="/pricing" style={{ color: 'var(--accent-primary)' }}>
            View pricing
          </a>
        </div>
      </main>
    </>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Pricing — Energy Trade Inspection',
  description: 'Transparent pricing for energy trade compliance. From free sanction checks to full enterprise screening.',
}

const check = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 8l3.5 3.5L13 4.5" stroke="var(--status-clear)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const dash = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 8h8" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
)

interface PlanProps {
  name: string
  price: string
  period?: string
  annualNote?: string
  description: string
  cta: string
  ctaHref: string
  highlighted?: boolean
  badge?: string
  features: Array<{ label: string; included: boolean }>
}

function PlanCard({ name, price, period, annualNote, description, cta, ctaHref, highlighted, badge, features }: PlanProps) {
  return (
    <div
      style={{
        backgroundColor: highlighted ? 'var(--bg-elevated)' : 'var(--bg-surface)',
        border: `1px solid ${highlighted ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
        borderRadius: '12px',
        padding: 'var(--space-6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-5)',
        position: 'relative',
      }}
    >
      {badge && (
        <div
          style={{
            position: 'absolute',
            top: '-12px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: 'var(--accent-primary)',
            color: '#fff',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            padding: '3px 10px',
            borderRadius: '999px',
            whiteSpace: 'nowrap',
          }}
        >
          {badge}
        </div>
      )}

      <div>
        <p style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>
          {name}
        </p>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
          <span style={{ color: 'var(--text-primary)', fontSize: '36px', fontWeight: 700, letterSpacing: '-0.02em' }}>
            {price}
          </span>
          {period && (
            <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>/{period}</span>
          )}
        </div>
        {annualNote && (
          <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{annualNote}</p>
        )}
        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginTop: 'var(--space-3)', lineHeight: '20px' }}>
          {description}
        </p>
      </div>

      <a
        href={ctaHref}
        style={{
          display: 'block',
          textAlign: 'center',
          padding: 'var(--space-3) var(--space-4)',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: 500,
          textDecoration: 'none',
          backgroundColor: highlighted ? 'var(--accent-primary)' : 'transparent',
          color: highlighted ? '#fff' : 'var(--accent-primary)',
          border: highlighted ? 'none' : '1px solid var(--accent-primary)',
          transition: 'opacity 0.15s ease',
        }}
      >
        {cta}
      </a>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {features.map((f) => (
          <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ flexShrink: 0 }}>{f.included ? check : dash}</span>
            <span style={{ color: f.included ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: '13px' }}>
              {f.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const ALL_FEATURES = [
  'Sanction status (Listed / Not Listed)',
  'Basic company & vessel profiles',
  'Authenticity score',
  'Risk flag feed',
  'Data source citations',
  'Director & officer records',
  'Associated vessel links',
  'PDF report export',
  'Unlimited queries',
  'AIS position & dark-voyage alerts',
  'Legal & enforcement records',
  'Vessel port history (Paris / Tokyo MOU)',
  'Contract analysis (20/month)',
  'API access',
  'Bulk screening',
  'Active monitoring (Watchlist)',
  'SSO & team management',
  'Private deployment',
]

const plans: PlanProps[] = [
  {
    name: 'Free',
    price: '$0',
    description: '5 sanction checks per month. No credit card required.',
    cta: 'Start for free',
    ctaHref: '/',
    features: ALL_FEATURES.map((label, i) => ({ label, included: i < 1 })),
  },
  {
    name: 'Starter',
    price: '$99',
    period: 'mo',
    annualNote: '$990/year — save 2 months',
    description: '100 queries/month. Full profiles for independent traders and small teams.',
    cta: 'Start free trial',
    ctaHref: '/',
    features: ALL_FEATURES.map((label, i) => ({ label, included: i < 8 })),
  },
  {
    name: 'Professional',
    price: '$299',
    period: 'mo',
    annualNote: '$2,988/year — save 2 months',
    description: 'Unlimited queries, AIS data, legal records, and contract analysis for compliance teams.',
    cta: 'Start free trial',
    ctaHref: '/',
    highlighted: true,
    badge: 'Most popular',
    features: ALL_FEATURES.map((label, i) => ({ label, included: i < 14 })),
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'Full platform with API, bulk screening, active monitoring, SSO, and private deployment.',
    cta: 'Contact sales',
    ctaHref: 'mailto:sales@energytradeinspection.com',
    features: ALL_FEATURES.map((label) => ({ label, included: true })),
  },
]

export default function PricingPage() {
  return (
    <>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          backgroundColor: 'rgba(10, 15, 26, 0.92)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            maxWidth: 'var(--max-width)',
            margin: '0 auto',
            padding: '0 var(--space-4)',
            height: '56px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Link href="/" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '14px', fontWeight: 600 }}>
            ETI
          </Link>
          <nav style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
            <Link href="/pricing" style={{ color: 'var(--text-primary)', fontSize: '13px', textDecoration: 'none' }}>
              Pricing
            </Link>
            <button
              aria-label="Switch language"
              style={{
                background: 'none',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '12px',
                fontFamily: 'inherit',
                padding: '4px 8px',
              }}
            >
              中文
            </button>
          </nav>
        </div>
      </header>

      <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-12) var(--space-4)' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-12)' }} className="animate-fade-in-up">
          <p style={{ color: 'var(--accent-primary)', fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 'var(--space-3)' }}>
            Pricing
          </p>
          <h1 style={{ marginBottom: 'var(--space-4)' }}>
            Compliance that fits your deal flow
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '16px', lineHeight: '26px', maxWidth: '520px', margin: '0 auto' }}>
            Start free. Upgrade as your screening volume grows. All plans include sanction screening across OFAC, EU FSF, and UN consolidated lists.
          </p>
        </div>

        {/* Plan grid */}
        <div
          className="animate-fade-in-up-delay-1"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 'var(--space-5)',
            marginBottom: 'var(--space-12)',
          }}
        >
          {plans.map((plan) => (
            <PlanCard key={plan.name} {...plan} />
          ))}
        </div>

        {/* FAQ / trust strip */}
        <div
          className="animate-fade-in-up-delay-2"
          style={{
            borderTop: '1px solid var(--border-subtle)',
            paddingTop: 'var(--space-10)',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--space-8)',
          }}
        >
          {[
            {
              q: 'What sanction lists do you screen against?',
              a: 'All plans screen against OFAC (SDN + non-SDN), EU Financial Sanctions Framework, and UN consolidated lists — in a single query via sanctions.network.',
            },
            {
              q: 'Is there a free trial?',
              a: 'Yes. Starter and Professional plans include a 14-day full-feature trial, no credit card required. Trial data is retained if you downgrade.',
            },
            {
              q: 'Can I export results?',
              a: 'PDF report export is included in Starter and above. Enterprise customers can access raw data via API for downstream integration.',
            },
          ].map(({ q, a }) => (
            <div key={q}>
              <p style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500, marginBottom: 'var(--space-2)' }}>{q}</p>
              <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '20px' }}>{a}</p>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

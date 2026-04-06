import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { auth } from '@/auth'
import { getQuotaStatus } from '@/lib/server/quota'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/server/db'

export const metadata: Metadata = {
  title: 'Account — Energy Trade Inspection',
}

const PLAN_LABEL: Record<string, string> = {
  free:         'Free',
  starter:      'Starter',
  professional: 'Professional',
  enterprise:   'Enterprise',
}

async function openBillingPortal() {
  'use server'
  const session = await auth()
  if (!session?.user) redirect('/sign-in')

  const { rows } = await db.query<{ stripe_customer_id: string }>(
    'SELECT stripe_customer_id FROM users WHERE id = $1',
    [session.user.id]
  )
  const customerId = rows[0]?.stripe_customer_id
  if (!customerId) redirect('/pricing')

  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/account`,
  })
  redirect(portal.url)
}

export default async function AccountPage() {
  const session = await auth()
  if (!session?.user) redirect('/sign-in')

  const user  = session.user
  const plan  = user.plan ?? 'free'
  const quota = await getQuotaStatus(user.id, plan)

  const usedPercent = isFinite(quota.limit)
    ? Math.min(100, Math.round((quota.used / quota.limit) * 100))
    : 0

  const initials = user.name
    ? user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  const isPaid      = plan !== 'free'
  const isUnlimited = !isFinite(quota.limit)
  const resetLabel  = new Date(quota.resetDate).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric',
  })

  const card: React.CSSProperties = {
    backgroundColor: 'var(--bg-surface)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '12px',
    padding: 'var(--space-6)',
  }

  const sectionLabel: React.CSSProperties = {
    color: 'var(--text-muted)',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: '4px',
  }

  return (
    <>
      <Header />

      <div style={{ maxWidth: '580px', margin: '0 auto', padding: 'var(--space-12) var(--space-4)' }}>
        <h1 style={{
          fontSize: '20px', fontWeight: 600,
          color: 'var(--text-primary)', marginBottom: 'var(--space-8)',
        }}>
          Account
        </h1>

        {/* ── Profile + plan ─────────────────────────────────────────────── */}
        <div style={{ ...card, marginBottom: 'var(--space-5)' }}>
          {/* Avatar row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt=""
                width={48}
                height={48}
                style={{ borderRadius: '50%', flexShrink: 0 }}
              />
            ) : (
              <div style={{
                width: '48px', height: '48px', borderRadius: '50%',
                backgroundColor: 'var(--accent-primary)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '16px', fontWeight: 600, flexShrink: 0,
              }}>
                {initials}
              </div>
            )}
            <div>
              <p style={{ color: 'var(--text-primary)', fontSize: '15px', fontWeight: 500 }}>
                {user.name ?? 'User'}
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '2px' }}>
                {user.email}
              </p>
            </div>
          </div>

          {/* Plan row */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border-subtle)',
          }}>
            <div>
              <p style={sectionLabel}>Plan</p>
              <p style={{ color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500 }}>
                {PLAN_LABEL[plan] ?? plan}
              </p>
            </div>

            {isPaid ? (
              <form action={openBillingPortal}>
                <button
                  type="submit"
                  style={{
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '6px',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontFamily: 'inherit',
                    padding: '6px 14px',
                  }}
                >
                  Manage billing
                </button>
              </form>
            ) : (
              <Link
                href="/pricing"
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 500,
                  textDecoration: 'none',
                  padding: '6px 14px',
                  borderRadius: '6px',
                }}
              >
                Upgrade plan
              </Link>
            )}
          </div>
        </div>

        {/* ── Quota ──────────────────────────────────────────────────────── */}
        <div style={card}>
          <p style={{ ...sectionLabel, marginBottom: 'var(--space-4)' }}>Usage this month</p>

          {isUnlimited ? (
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
              Unlimited sanction checks included in your {PLAN_LABEL[plan]} plan.
            </p>
          ) : (
            <>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginBottom: 'var(--space-2)',
              }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Sanction checks</span>
                <span style={{ color: 'var(--text-primary)', fontSize: '13px', fontWeight: 500 }}>
                  {quota.used} / {quota.limit}
                </span>
              </div>

              {/* Progress bar */}
              <div style={{
                height: '6px',
                backgroundColor: 'var(--bg-elevated)',
                borderRadius: '999px',
                marginBottom: 'var(--space-3)',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${usedPercent}%`,
                  backgroundColor: usedPercent >= 100 ? 'var(--status-listed)' : 'var(--accent-primary)',
                  borderRadius: '999px',
                  transition: 'width 0.3s ease',
                }} />
              </div>

              <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                Resets {resetLabel}
                {quota.remaining === 0 && (
                  <span style={{ color: 'var(--status-listed)', marginLeft: '8px' }}>· limit reached</span>
                )}
              </p>

              {quota.remaining === 0 && !isPaid && (
                <div style={{
                  marginTop: 'var(--space-4)',
                  padding: 'var(--space-3) var(--space-4)',
                  backgroundColor: 'rgba(239, 68, 68, 0.08)',
                  borderRadius: '8px',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                }}>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: '20px' }}>
                    All free checks used for this month.{' '}
                    <Link href="/pricing" style={{ color: 'var(--accent-primary)' }}>
                      Upgrade to Starter
                    </Link>{' '}
                    for 100 checks/month.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

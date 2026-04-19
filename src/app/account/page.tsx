import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { auth } from '@/auth'
import { getQuotaStatus, UNLIMITED_QUOTA } from '@/lib/server/quota'
import { stripe } from '@/lib/stripe'
import { getBillingCustomerId } from '@/lib/server/account'

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

  const customerId = await getBillingCustomerId(session.user.id)
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

  const isUnlimited = quota.limit === UNLIMITED_QUOTA

  const usedPercent = !isUnlimited
    ? Math.min(100, Math.round((quota.used / quota.limit) * 100))
    : 0

  const initials = user.name
    ? user.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  const isPaid      = plan !== 'free'
  const resetLabel  = new Date(quota.resetDate).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric',
  })

  const card: React.CSSProperties = {
    backgroundColor: '#111113',
    border: '1px solid rgba(255,255,255,0.07)',
    borderTop: '1px solid rgba(255,255,255,0.09)',
    borderRadius: '10px',
    padding: '24px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
  }

  const sectionLabel: React.CSSProperties = {
    color: '#55556a',
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    marginBottom: '4px',
  }

  return (
    <>
      <Header />

      <div style={{ maxWidth: '580px', margin: '0 auto', padding: 'var(--space-12) var(--space-4)' }}>
        <h1 style={{
          fontSize: '20px', fontWeight: 600,
          color: '#f1f1f3', marginBottom: 'var(--space-8)',
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
                backgroundColor: '#6366f1', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '16px', fontWeight: 600, flexShrink: 0,
              }}>
                {initials}
              </div>
            )}
            <div>
              <p style={{ color: '#f1f1f3', fontSize: '15px', fontWeight: 500 }}>
                {user.name ?? 'User'}
              </p>
              <p style={{ color: '#55556a', fontSize: '13px', marginTop: '2px' }}>
                {user.email}
              </p>
            </div>
          </div>

          {/* Plan row */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            paddingTop: 'var(--space-4)', borderTop: '1px solid rgba(255,255,255,0.07)',
          }}>
            <div>
              <p style={sectionLabel}>Plan</p>
              <span style={{
                fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em',
                textTransform: 'uppercase' as const,
                color: '#6366f1',
                backgroundColor: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: '4px',
                padding: '2px 8px',
                display: 'inline-block',
                marginTop: '4px',
              }}>
                {PLAN_LABEL[plan] ?? plan}
              </span>
            </div>

            {isPaid ? (
              <form action={openBillingPortal}>
                <button
                  type="submit"
                  style={{
                    padding: '8px 16px',
                    background: 'linear-gradient(180deg, #7578f2 0%, #5558e8 100%)',
                    color: '#fff',
                    border: '1px solid rgba(99,102,241,0.45)',
                    boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)',
                    borderRadius: '7px',
                    fontSize: '13px',
                    fontWeight: 500,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    transition: 'all 0.12s ease',
                  }}
                >
                  Manage billing
                </button>
              </form>
            ) : (
              <Link
                href="/pricing"
                style={{
                  display: 'inline-block',
                  padding: '8px 16px',
                  background: 'linear-gradient(180deg, #7578f2 0%, #5558e8 100%)',
                  color: '#fff',
                  border: '1px solid rgba(99,102,241,0.45)',
                  boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)',
                  borderRadius: '7px',
                  fontSize: '13px',
                  fontWeight: 500,
                  textDecoration: 'none',
                  transition: 'all 0.12s ease',
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
            <p style={{ color: '#8b8b9a', fontSize: '14px' }}>
              Unlimited sanction checks included in your {PLAN_LABEL[plan]} plan.
            </p>
          ) : (
            <>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
                marginBottom: 'var(--space-2)',
              }}>
                <span style={{ color: '#8b8b9a', fontSize: '13px' }}>Sanction checks</span>
                <span style={{ color: '#f1f1f3', fontSize: '13px', fontWeight: 500 }}>
                  {quota.used} / {quota.limit}
                </span>
              </div>

              {/* Progress bar */}
              <div style={{
                height: '4px',
                background: 'rgba(0,0,0,0.35)',
                borderRadius: '2px',
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)',
                overflow: 'hidden',
                marginBottom: 'var(--space-3)',
              }}>
                <div style={{
                  height: '100%',
                  width: `${usedPercent}%`,
                  background: usedPercent >= 100 ? '#ef4444' : '#6366f1',
                  borderRadius: '2px',
                  transition: 'width 0.3s ease',
                }} />
              </div>

              <p style={{ color: '#55556a', fontSize: '12px' }}>
                Resets {resetLabel}
                {quota.remaining === 0 && (
                  <span style={{ color: '#ef4444', marginLeft: '8px' }}>· limit reached</span>
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
                  <p style={{ color: '#8b8b9a', fontSize: '13px', lineHeight: '20px' }}>
                    All free checks used for this month.{' '}
                    <Link href="/pricing" style={{ color: '#6366f1' }}>
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


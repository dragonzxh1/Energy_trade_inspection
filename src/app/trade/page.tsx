/**
 * /trade — Trade risk check page.
 *
 * Server component: handles auth check and plan gating.
 * Delegates the actual UI to TradeClient (client component).
 */

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import Header from '@/components/layout/Header'
import TradeClient from './TradeClient'

export const metadata: Metadata = {
  title: 'Trade Risk Check — Energy Trade Inspection',
  description:
    'Verify an energy trade transaction: screen the seller, vessel, and loading port against sanctions lists, AIS data, and port risk databases.',
  robots: { index: false, follow: false },
}

export default async function TradePage() {
  const session = await auth()

  if (!session?.user) {
    redirect('/sign-in')
  }

  const plan = session.user.plan ?? 'free'

  return (
    <>
      <Header />
      <main
        style={{
          maxWidth: 'var(--max-width)',
          margin: '0 auto',
          padding: 'var(--space-8) var(--space-4)',
        }}
      >
        {plan === 'free' ? (
          <UpgradePrompt />
        ) : (
          <TradeClient />
        )}
      </main>
    </>
  )
}

function UpgradePrompt() {
  return (
    <div
      style={{
        maxWidth: '520px',
        margin: '0 auto',
        textAlign: 'center',
        padding: 'var(--space-12) var(--space-4)',
      }}
    >
      <div style={{ fontSize: '40px', marginBottom: 'var(--space-4)' }}>🔒</div>
      <h1
        style={{
          fontSize: '22px',
          fontWeight: 700,
          color: 'var(--text-primary)',
          marginBottom: 'var(--space-3)',
        }}
      >
        Trade Risk Check — Starter Feature
      </h1>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-muted)',
          lineHeight: '1.6',
          marginBottom: 'var(--space-6)',
        }}
      >
        Screen a trade transaction end-to-end: counterparty sanctions, vessel AIS
        tracking, port draft risk, and dark period detection. Available on Starter
        and higher plans.
      </p>
      <Link
        href="/pricing"
        style={{
          display: 'inline-block',
          fontSize: '14px',
          fontWeight: 600,
          color: '#fff',
          backgroundColor: 'var(--accent-primary)',
          borderRadius: '8px',
          padding: '10px 24px',
          textDecoration: 'none',
        }}
      >
        Upgrade to Starter →
      </Link>
    </div>
  )
}

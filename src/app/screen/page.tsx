/**
 * /screen — Document screening page.
 *
 * Server component: handles auth check and plan gating.
 * Delegates the actual UI to ScreenClient (client component).
 */

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import Header from '@/components/layout/Header'
import ScreenClient from './ScreenClient'

export const metadata: Metadata = {
  title: 'Document Screening — Energy Trade Inspection',
  description:
    'Upload a trade contract to automatically screen all counterparties, directors, and vessels against sanctions and ICIJ offshore leak data.',
  robots: { index: false, follow: false },
}

export default async function ScreenPage() {
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
          <ScreenClient />
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
              Document Screening — Starter Feature
      </h1>
      <p
        style={{
          fontSize: '14px',
          color: 'var(--text-muted)',
          lineHeight: '1.6',
          marginBottom: 'var(--space-6)',
        }}
      >
        Upload a trade contract and automatically screen all counterparties, directors, and
        vessels against sanctions lists and ICIJ offshore leak data in one step.
        Available on Starter and higher plans.
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


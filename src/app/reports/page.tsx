/**
 * /reports — Report history page.
 *
 * Shows the user's past trade checks and document screenings.
 * Renders initial 10 rows server-side; client component handles
 * load-more pagination and per-row deletion.
 *
 * Access: Starter+ plan users only.
 */

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/Header'
import { auth } from '@/auth'
import { getReportHistory } from '@/lib/server/report-history'
import ReportsClient from './ReportsClient'

export const metadata: Metadata = {
  title: 'Reports — Energy Trade Inspection',
  robots: { index: false, follow: false },
}

export default async function ReportsPage() {
  const session = await auth()
  if (!session?.user) redirect('/sign-in?callbackUrl=/reports')

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return (
      <>
        <Header />
        <main style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-8) var(--space-4)' }}>
          <UpgradePrompt />
        </main>
      </>
    )
  }

  const { tradeSessions, screeningSessions, tradeTotal, screeningTotal, pageSize } =
    await getReportHistory(session.user.id)

  return (
    <>
      <Header />
      <main
        style={{
          maxWidth: 'var(--max-width)',
          margin:   '0 auto',
          padding:  'var(--space-8) var(--space-4)',
        }}
      >
        <h1
          style={{
            fontSize:     '20px',
            fontWeight:   600,
            marginBottom: 'var(--space-6)',
            color:        'var(--text-primary)',
          }}
        >
          Reports
        </h1>

        <ReportsClient
          initialTrade={tradeSessions}
          initialScreening={screeningSessions}
          tradeTotal={tradeTotal}
          screeningTotal={screeningTotal}
          pageSize={pageSize}
        />
      </main>
    </>
  )
}

function UpgradePrompt() {
  return (
    <div
      style={{
        padding:      'var(--space-8)',
        textAlign:    'center',
        border:       '1px dashed var(--border-subtle)',
        borderRadius: '8px',
      }}
    >
      <p
        style={{
          color:        'var(--text-secondary)',
          marginBottom: 'var(--space-4)',
          fontSize:     '14px',
        }}
      >
        Report history is available on Starter and above.
      </p>
      <Link
        href="/pricing"
        style={{
          backgroundColor: 'var(--accent-primary)',
          color:           '#fff',
          textDecoration:  'none',
          padding:         '8px 20px',
          borderRadius:    '6px',
          fontSize:        '13px',
          fontWeight:      500,
        }}
      >
        Upgrade
      </Link>
    </div>
  )
}

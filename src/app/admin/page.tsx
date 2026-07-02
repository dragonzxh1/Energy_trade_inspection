import type { Metadata } from 'next'
import Header from '@/components/layout/Header'
import { auth } from '@/auth'
import TabNav from '@/components/entity/TabNav'
import SyncJobTable from '@/components/admin/SyncJobTable'
import UserTable from '@/components/admin/UserTable'
import StatCards from '@/components/admin/StatCards'
import DailyRegistrationChart from '@/components/admin/DailyRegistrationChart'
import RecentPageViews from '@/components/admin/RecentPageViews'
import ContentOpsPanel from '@/components/admin/ContentOpsPanel'
import { getAdminSyncLogs, getAdminUsers, getAdminStats } from '@/lib/server/repository'
import type { AdminSyncLogRow, UserAdminRow, AdminStats } from '@/lib/server/repository'
import { getAdminContentOpsSnapshot, type AdminContentOpsSnapshot } from '@/lib/server/seo-repository'

export const metadata: Metadata = {
  title: 'Admin — Energy Trade Inspection',
}

export default async function AdminPage() {
  const session = await auth()

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  const isAdmin = !!(session?.user?.email && adminEmails.includes(session.user.email))

  if (!isAdmin) {
    return (
      <>
        <Header />
        <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-12) var(--space-4)' }}>
          <div
            role="alert"
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: 'var(--space-12)',
              textAlign: 'center',
            }}
          >
            <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
              Access denied
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
              You do not have permission to access this page. Contact the platform administrator.
            </p>
          </div>
        </div>
      </>
    )
  }

  // Fetch all three data sources in parallel (server-side, no HTTP overhead)
  let syncLogs: AdminSyncLogRow[] = []
  let users: UserAdminRow[] = []
  let stats: AdminStats = {
    totalUsers: 0,
    planDistribution: { free: 0, starter: 0, enterprise: 0, professional: 0 },
    newToday: 0,
    new30Days: 0,
    dailyRegistrations: [],
    topEntityTypes: [],
    totalPageViews: 0,
    pageViewsToday: 0,
    dailyPageViews: [],
    topPages: [],
  }
  let contentOpsSnapshot: AdminContentOpsSnapshot = {
    ingestionQueue: [],
    parsedKnowledgeEntries: [],
    draftArticles: [],
    reviewQueue: [],
    stats: {
      totalPublished: 0,
      totalDrafts: 0,
      commodityCounts: [],
      subtypeCounts: [],
    },
  }

  try {
    ;[syncLogs, users, stats, contentOpsSnapshot] = await Promise.all([
      getAdminSyncLogs(),
      getAdminUsers(),
      getAdminStats(),
      getAdminContentOpsSnapshot(),
    ])
  } catch {
    // Partial failure — render with empty data; components handle empty state
  }

  return (
    <>
      <Header />
      <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-12) var(--space-4)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-8)' }}>
        <h1 style={{
          fontSize: '20px',
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}>
          Admin
        </h1>
        <a
          href="/admin/upload"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-4)',
            background: 'var(--brand-400)',
            color: 'white',
            borderRadius: '8px',
            textDecoration: 'none',
            fontSize: '14px',
            fontWeight: 600,
          }}
        >
          📤 Upload
        </a>
      </div>

        <TabNav
          tabs={[
            { id: 'sync', label: 'Sync History' },
            { id: 'content', label: 'Content Ops' },
            { id: 'users', label: 'Users' },
            { id: 'stats', label: 'Platform Stats' },
            { id: 'pageviews', label: 'Page Views' },
          ]}
          defaultTab="sync"
          panels={[
            <SyncJobTable key="sync" initialLogs={syncLogs} />,
            <ContentOpsPanel key="content" snapshot={contentOpsSnapshot} />,
            <UserTable key="users" users={users} />,
            <div key="stats" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
              <StatCards stats={stats} />
              <DailyRegistrationChart data={stats.dailyRegistrations} />
            </div>,
            <RecentPageViews key="pageviews" />,
          ]}
        />
      </div>
    </>
  )
}

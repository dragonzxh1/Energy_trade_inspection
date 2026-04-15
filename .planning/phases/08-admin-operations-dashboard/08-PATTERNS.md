# Phase 8: Admin Operations Dashboard — Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 6 new/modified files
**Analogs found:** 6 / 6

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `db/migrations/033_users_last_active.sql` | migration | — | `db/migrations/031_regulatory_warnings.sql` | exact |
| `src/app/admin/page.tsx` | page (server component) | request-response | `src/app/account/page.tsx` | role-match |
| `src/app/api/admin/users/route.ts` | API route | CRUD (read) | `src/app/api/admin/sync/route.ts` | exact |
| `src/app/api/admin/users/[id]/plan/route.ts` | API route | CRUD (write) | `src/app/api/watchlist/route.ts` + `src/app/api/stripe/webhook/route.ts` | role-match |
| `src/app/api/admin/stats/route.ts` | API route | CRUD (read, aggregate) | `src/app/api/admin/sync/route.ts` | exact |
| `src/lib/server/repository.ts` | repository | CRUD | `src/lib/server/repository.ts` (existing functions) | exact |

---

## Pattern Assignments

### `db/migrations/033_users_last_active.sql` (migration)

**Analog:** `db/migrations/031_regulatory_warnings.sql` and `db/migrations/032_domain_email_cache.sql`

**Migration file header pattern** (lines 1-4 of 031):
```sql
-- 031_regulatory_warnings.sql
-- Stores government regulatory warning list entries.
-- Separate from sanctions_entries (sanctions = trade restrictions)
```

**ADD COLUMN + CREATE INDEX pattern** — copy this exact pattern:
```sql
-- 033_users_last_active.sql
-- Adds last_active_at column to users table.
-- Updated by consumeQuota() each time a user makes a quota-consuming query.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at);
```

Note: `IF NOT EXISTS` on both `ADD COLUMN` and `CREATE INDEX` is the project standard for idempotent migrations (verified in `031_regulatory_warnings.sql` line 30, `032_domain_email_cache.sql` line 19-20).

---

### `src/app/admin/page.tsx` (server component, request-response)

**Analog:** `src/app/account/page.tsx`

**Imports pattern** (account/page.tsx lines 1-9):
```typescript
import type { Metadata } from 'next'
import Header from '@/components/layout/Header'
import { auth } from '@/auth'
// Admin page adds:
import { db } from '@/lib/server/db'
import TabNav from '@/components/entity/TabNav'
// Admin sub-components:
import SyncJobTable from '@/components/admin/SyncJobTable'
import UserTable from '@/components/admin/UserTable'
import StatCards from '@/components/admin/StatCards'
import DailyRegistrationChart from '@/components/admin/DailyRegistrationChart'
```

**Auth + admin gate pattern** — derived from `account/page.tsx` line 36-38 + `sync/route.ts` lines 38-51:
```typescript
export default async function AdminPage() {
  const session = await auth()

  // Admin gate: check email against ADMIN_EMAILS env var (same pattern as isAuthorized() in sync/route.ts)
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim()).filter(Boolean)
  const isAdmin = session?.user?.email && adminEmails.includes(session.user.email)

  if (!isAdmin) {
    // Render 403 panel — do NOT redirect() (UI-SPEC requirement)
    return (
      <>
        <Header />
        <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-12) var(--space-4)' }}>
          <div role="alert" style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: 'var(--space-12)',
            textAlign: 'center',
          }}>
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
  // ...parallel data fetch and TabNav render follow
}
```

**Page layout pattern** (account/page.tsx lines 76-85) — same maxWidth + padding convention:
```typescript
return (
  <>
    <Header />
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: 'var(--space-12) var(--space-4)' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'var(--space-8)' }}>
        Admin
      </h1>
      <TabNav
        tabs={[
          { id: 'sync',  label: 'Sync History' },
          { id: 'users', label: 'Users' },
          { id: 'stats', label: 'Platform Stats' },
        ]}
        defaultTab="sync"
        panels={[
          <SyncJobTable key="sync" logs={syncLogs} />,
          <UserTable key="users" users={users} />,
          <div key="stats">
            <StatCards stats={stats} />
            <DailyRegistrationChart data={stats.dailyRegistrations} />
          </div>,
        ]}
      />
    </div>
  </>
)
```

**Parallel data fetch pattern** — use `Promise.all` for the three data sources:
```typescript
// All three fetched server-side before rendering TabNav
const [syncLogs, users, stats] = await Promise.all([
  fetchAdminSyncLogs(),    // direct db.query() — not API call
  fetchAdminUsers(),       // direct db.query()
  fetchAdminStats(),       // direct db.query()
])
```

**Metadata export pattern** (account/page.tsx lines 10-12):
```typescript
export const metadata: Metadata = {
  title: 'Admin — Energy Trade Inspection',
}
```

---

### `src/app/api/admin/users/route.ts` (API route, CRUD read)

**Analog:** `src/app/api/admin/sync/route.ts`

**Full file structure** — copy this skeleton exactly:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'

// isAuthorized helper — copy verbatim from sync/route.ts lines 16-52
// (or extract to src/lib/server/admin-auth.ts shared helper — see Shared Patterns)
function isAuthorized(req: NextRequest, userEmail?: string | null): AuthResult { ... }

export async function GET(req: NextRequest) {
  const session = await auth()
  const authResult = isAuthorized(req, session?.user?.email)
  if (!authResult.authorized) {
    const status = authResult.reason === 'no_session' ? 401 : 403
    return NextResponse.json(
      { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
      { status }
    )
  }

  try {
    const { rows } = await db.query(`
      SELECT
        u.id,
        u.email,
        u.plan,
        u.created_at,
        u.last_active_at,
        COALESCE(uqu.query_count, 0) AS quota_used,
        COALESCE(uqu.quota_limit, 5) AS quota_limit
      FROM users u
      LEFT JOIN user_query_usage uqu
        ON uqu.user_id = u.id
        AND uqu.period_start = date_trunc('month', NOW())::date
      ORDER BY u.created_at DESC
    `)
    return NextResponse.json({ users: rows })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

**Auth check pattern** (sync/route.ts lines 54-63) — copy verbatim for all new admin routes:
```typescript
const session = await auth()
const authResult = isAuthorized(req, session?.user?.email)
if (!authResult.authorized) {
  const status = authResult.reason === 'no_session' ? 401 : 403
  return NextResponse.json(
    { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
    { status }
  )
}
```

**Error handling pattern** (sync/route.ts lines 84-87) — wrap all db.query() calls:
```typescript
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return NextResponse.json({ error: message }, { status: 500 })
}
```

**db.query() JOIN pattern** (verified from sync/route.ts line 66-76 + RESEARCH.md Pattern 3):
```typescript
const { rows } = await db.query(`
  SELECT
    u.id,
    u.email,
    u.plan,
    u.created_at,
    u.last_active_at,
    COALESCE(uqu.query_count, 0) AS quota_used,
    COALESCE(uqu.quota_limit, 5) AS quota_limit
  FROM users u
  LEFT JOIN user_query_usage uqu
    ON uqu.user_id = u.id
    AND uqu.period_start = date_trunc('month', NOW())::date
  ORDER BY u.created_at DESC
`)
```

---

### `src/app/api/admin/users/[id]/plan/route.ts` (API route, CRUD write)

**Analog:** `src/app/api/watchlist/route.ts` (PATCH pattern) + `src/app/api/stripe/webhook/route.ts` (UPDATE users SET plan pattern)

**PATCH handler pattern** — combines auth gate from sync/route.ts with UPDATE from webhook/route.ts:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'

const ALLOWED_PLANS = ['free', 'starter', 'enterprise'] as const
type AllowedPlan = typeof ALLOWED_PLANS[number]

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  const authResult = isAuthorized(req, session?.user?.email)
  if (!authResult.authorized) {
    const status = authResult.reason === 'no_session' ? 401 : 403
    return NextResponse.json(
      { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
      { status }
    )
  }

  const { id } = await params
  let plan: string
  try {
    const body = await req.json()
    plan = String(body.plan ?? '')
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!ALLOWED_PLANS.includes(plan as AllowedPlan)) {
    return NextResponse.json({ error: 'Invalid plan value.' }, { status: 400 })
  }

  try {
    // UPDATE pattern from stripe/webhook/route.ts line 82
    await db.query(
      'UPDATE users SET plan = $1 WHERE id = $2',
      [plan, id]
    )
    return NextResponse.json({ id, plan })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

**Route params pattern** — Next.js 15 App Router dynamic segment (params is a Promise):
```typescript
// Next.js 15: params is async — must await
{ params }: { params: Promise<{ id: string }> }
const { id } = await params
```

**UPDATE users SET plan pattern** (webhook/route.ts line 82):
```typescript
await db.query(
  'UPDATE users SET plan = $1, stripe_subscription_id = $2 WHERE id = $3',
  [plan, sub.id, userId]
)
// Simplified for admin route (no Stripe fields):
await db.query(
  'UPDATE users SET plan = $1 WHERE id = $2',
  [plan, id]
)
```

---

### `src/app/api/admin/stats/route.ts` (API route, CRUD read, aggregate)

**Analog:** `src/app/api/admin/sync/route.ts`

**Parallel query pattern** (sync/route.ts lines 66-76) — use Promise.all for independent queries:
```typescript
export async function GET(req: NextRequest) {
  const session = await auth()
  const authResult = isAuthorized(req, session?.user?.email)
  if (!authResult.authorized) {
    const status = authResult.reason === 'no_session' ? 401 : 403
    return NextResponse.json(
      { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
      { status }
    )
  }

  try {
    const [totalRow, planRows, todayRow, thirtyDayRow, dailyRows] = await Promise.all([
      db.query<{ total: string }>('SELECT COUNT(*)::text AS total FROM users'),
      db.query<{ plan: string; count: string }>('SELECT plan, COUNT(*)::text AS count FROM users GROUP BY plan'),
      db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users WHERE created_at >= NOW() - INTERVAL '1 day'`),
      db.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM users WHERE created_at >= NOW() - INTERVAL '30 days'`),
      db.query<{ day: string; count: number }>(`
        SELECT
          date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
          COUNT(*)::int AS count
        FROM users
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY 1
        ORDER BY 1
      `),
    ])

    const planDistribution = { free: 0, starter: 0, enterprise: 0, professional: 0 }
    for (const row of planRows.rows) {
      const key = row.plan as keyof typeof planDistribution
      if (key in planDistribution) planDistribution[key] = parseInt(row.count, 10)
    }

    return NextResponse.json({
      totalUsers: parseInt(totalRow.rows[0]?.total ?? '0', 10),
      planDistribution,
      newToday: parseInt(todayRow.rows[0]?.count ?? '0', 10),
      new30Days: parseInt(thirtyDayRow.rows[0]?.count ?? '0', 10),
      dailyRegistrations: dailyRows.rows.map(r => ({
        date: String(r.day),
        count: r.count,
      })),
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

**COUNT cast pattern** (sync/route.ts line 68) — always cast COUNT to text or int explicitly:
```typescript
// text cast (sync/route.ts pattern):
db.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM ...')
parseInt(rows[0]?.n ?? '0', 10)
// int cast (repository.ts pattern):
COUNT(*)::int AS count
```

---

### `src/lib/server/repository.ts` (repository — new admin query functions)

**Analog:** `src/lib/server/repository.ts` existing exported async functions

**Function signature pattern** (repository.ts lines 215-218) — exported async function with typed return:
```typescript
export async function getAdminUsers(): Promise<UserAdminRow[]> {
  const { rows } = await db.query<UserAdminRow>(`
    SELECT
      u.id,
      u.email,
      u.plan,
      u.created_at,
      u.last_active_at,
      COALESCE(uqu.query_count, 0) AS quota_used,
      COALESCE(uqu.quota_limit, 5) AS quota_limit
    FROM users u
    LEFT JOIN user_query_usage uqu
      ON uqu.user_id = u.id
      AND uqu.period_start = date_trunc('month', NOW())::date
    ORDER BY u.created_at DESC
  `)
  return rows
}
```

**Interface row type pattern** (repository.ts lines 36-52) — define typed interface before the function:
```typescript
export interface UserAdminRow {
  id: string
  email: string
  plan: string
  created_at: string
  last_active_at: string | null
  quota_used: number
  quota_limit: number
}

export interface AdminSyncLogRow {
  source: string
  status: string
  record_count: number | null
  duration_ms: number | null
  synced_at: string
  error_message: string | null
}

export interface AdminStats {
  totalUsers: number
  planDistribution: { free: number; starter: number; enterprise: number; professional: number }
  newToday: number
  new30Days: number
  dailyRegistrations: Array<{ date: string; count: number }>
}
```

**Union ALL query pattern** (RESEARCH.md Pattern 2 — derived from sync/route.ts line 69-75):
```typescript
export async function getAdminSyncLogs(): Promise<AdminSyncLogRow[]> {
  const { rows } = await db.query<AdminSyncLogRow>(`
    SELECT source, status, record_count, duration_ms, synced_at, error_message
    FROM sanctions_sync_log
    UNION ALL
    SELECT source, status, record_count, duration_ms, synced_at, error_message
    FROM fraud_sync_log
    ORDER BY synced_at DESC
    LIMIT 200
  `)
  return rows
}
```

**try/catch in repository function pattern** (repository.ts lines 219-270 — computeTradingTrackRecord):
```typescript
export async function computeTradingTrackRecord(entityId: string): Promise<{
  score: number
  evidence: string[]
}> {
  try {
    const { rows } = await db.query<{...}>(`SELECT ... FROM trade_events WHERE entity_id = $1`, [entityId])
    // ... process rows ...
    return { score, evidence }
  } catch {
    return { score: 0, evidence: ['Trading history analysis unavailable'] }
  }
}
// Admin repository functions may omit try/catch and let the API route handle errors.
```

---

## Shared Patterns

### Admin Authorization (`isAuthorized`)

**Source:** `src/app/api/admin/sync/route.ts` lines 16-52
**Apply to:** `src/app/api/admin/users/route.ts`, `src/app/api/admin/stats/route.ts`, `src/app/api/admin/users/[id]/plan/route.ts`

**Recommendation:** Extract to `src/lib/server/admin-auth.ts` to avoid copy-paste across three route files.

```typescript
// src/lib/server/admin-auth.ts (new shared helper)
import { NextRequest } from 'next/server'

export interface AuthResult {
  authorized: boolean
  reason: 'no_session' | 'bearer_valid' | 'admin_email' | 'not_admin'
}

export function isAdminAuthorized(req: NextRequest, userEmail?: string | null): AuthResult {
  const adminSecret = process.env.ADMIN_SECRET ?? process.env.SYNC_SECRET
  if (adminSecret) {
    const authHeader = req.headers.get('authorization') ?? ''
    if (authHeader === `Bearer ${adminSecret}`) {
      return { authorized: true, reason: 'bearer_valid' }
    }
  }
  if (!adminSecret) {
    const host = req.headers.get('host') ?? ''
    if (host.startsWith('localhost') || host.startsWith('127.')) {
      return { authorized: true, reason: 'bearer_valid' }
    }
  }
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map((email) => email.trim()).filter(Boolean)
  if (!userEmail) return { authorized: false, reason: 'no_session' }
  if (adminEmails.includes(userEmail)) return { authorized: true, reason: 'admin_email' }
  return { authorized: false, reason: 'not_admin' }
}
```

### Auth Check Response Pattern

**Source:** `src/app/api/admin/sync/route.ts` lines 57-63
**Apply to:** All three new API route files

```typescript
const session = await auth()
const authResult = isAdminAuthorized(req, session?.user?.email)
if (!authResult.authorized) {
  const status = authResult.reason === 'no_session' ? 401 : 403
  return NextResponse.json(
    { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
    { status }
  )
}
```

### Error Handling

**Source:** `src/app/api/admin/sync/route.ts` lines 84-87
**Apply to:** All new API route handlers

```typescript
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return NextResponse.json({ error: message }, { status: 500 })
}
```

### Inline Style (Card) Pattern

**Source:** `src/app/account/page.tsx` lines 59-64
**Apply to:** `src/app/admin/page.tsx` (403 panel, stat cards)

```typescript
const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '12px',
  padding: 'var(--space-6)',
}
```

### Table Header Pattern

**Source:** `src/app/account/page.tsx` lines 66-73 (`sectionLabel`)
**Apply to:** `SyncJobTable.tsx`, `UserTable.tsx` column headers

```typescript
// Column header cell style (uppercase, 11px, muted, tracked)
{
  color: 'var(--text-muted)',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  backgroundColor: 'var(--bg-elevated)',
}
```

### `runtime = 'nodejs'` Export

**Source:** `src/app/api/admin/sync/route.ts` line 8, `src/app/api/quota/route.ts` line 5
**Apply to:** All new API route files (required for db access — Edge Runtime cannot use `pg`)

```typescript
export const runtime = 'nodejs'
```

### TabNav Component Usage

**Source:** `src/components/entity/TabNav.tsx` lines 1-136
**Apply to:** `src/app/admin/page.tsx`

Full props interface (TabNav.tsx lines 4-15):
```typescript
interface Tab {
  id: string
  label: string
}
interface TabNavProps {
  tabs: Tab[]
  defaultTab: string
  panels?: React.ReactNode[]
  onChange?: (id: string) => void
}
```

Usage — panels array must be in same order as tabs array. TabNav is `'use client'` — pass only serializable data as props to any child components:
```typescript
<TabNav
  tabs={[
    { id: 'sync',  label: 'Sync History' },
    { id: 'users', label: 'Users' },
    { id: 'stats', label: 'Platform Stats' },
  ]}
  defaultTab="sync"
  panels={[panel0, panel1, panel2]}
/>
```

### Skeleton Loading Pattern

**Source:** `src/components/entity/IntelligencePanel.tsx` (referenced in RESEARCH.md)
**Apply to:** `SyncJobTable.tsx`, `UserTable.tsx`, `StatCards.tsx`, `DailyRegistrationChart.tsx`

```typescript
// Static shimmer — no animation (codebase convention)
<div style={{
  height: '12px',
  width: '100%',
  borderRadius: '4px',
  backgroundColor: 'var(--border-subtle)',
  opacity: 0.6,
  marginBottom: 'var(--space-3)',
}} />
```

---

## No Analog Found

All Phase 8 files have close analogs in the codebase. No files require falling back to RESEARCH.md patterns exclusively.

| File | Analog Gap | Resolution |
|------|-----------|------------|
| `src/components/admin/DailyRegistrationChart.tsx` | No CSS bar chart component exists in codebase | Use RESEARCH.md Pattern (CSS flex bars) — height proportional to max; `opacity: 0.7`, `border-radius: 2px 2px 0 0` |
| `src/components/admin/PlanSelector.tsx` | No inline `<select>` mutation component exists | Pattern derived from `watchlist/route.ts` PATCH + `account/page.tsx` button style |
| `src/lib/server/admin-auth.ts` | New shared helper — extracted from sync/route.ts | Copy `isAuthorized()` from `sync/route.ts` lines 16-52, rename to `isAdminAuthorized` |

---

## Key Codebase Facts for Planner

| Fact | Source | Impact |
|------|--------|--------|
| `users.plan` CHECK constraint: `IN ('free','starter','professional','enterprise')` | `db/migrations/005_auth_tables.sql` line 11 | PATCH handler must validate against `['free','starter','enterprise']` (exclude `professional` from UI) |
| `fraud_sync_log` has `id SERIAL PRIMARY KEY` but `sanctions_sync_log` has `PRIMARY KEY (source, synced_at)` — column shapes differ | `db/migrations/028_fraud_alerts.sql` line 36-44 | UNION ALL query must SELECT the same 6 columns from both tables explicitly |
| `sanctions_sync_log` has `version` column; `fraud_sync_log` does not | `sync/route.ts` line 71, `028_fraud_alerts.sql` | Omit `version` from the UNION ALL SELECT to keep schemas compatible |
| `user_query_usage.period_start` is a DATE (not TIMESTAMPTZ) | `RESEARCH.md` Pattern 3 | JOIN condition: `uqu.period_start = date_trunc('month', NOW())::date` |
| Next.js 15 App Router: dynamic route `params` is a Promise | Next.js 15 change | `const { id } = await params` — not `params.id` directly |
| `TabNav` is `'use client'` — cannot call `auth()` or `db.query()` inside it | `src/components/entity/TabNav.tsx` line 1 | All data fetched in server component, passed as serializable props |
| Middleware covers `/api/admin/*` for session presence but NOT admin role | `middleware.ts` line 49 (per RESEARCH.md) | Every route handler must run `isAdminAuthorized()` independently |

---

## Metadata

**Analog search scope:** `src/app/api/admin/`, `src/app/account/`, `src/app/api/watchlist/`, `src/app/api/quota/`, `src/app/api/stripe/webhook/`, `src/components/entity/`, `src/lib/server/repository.ts`, `db/migrations/`
**Files read:** 14
**Pattern extraction date:** 2026-04-15

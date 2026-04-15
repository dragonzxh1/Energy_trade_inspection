# Phase 8: Admin Operations Dashboard — Research

**Researched:** 2026-04-15
**Domain:** Next.js 15 App Router server components / raw PostgreSQL admin queries / client-side plan mutation
**Confidence:** HIGH

---

## Summary

Phase 8 adds a protected `/admin` page with three tabs: sync job history (ADMIN-01), user management with inline plan editing (ADMIN-02, ADMIN-03), and platform statistics with a CSS bar chart (ADMIN-04). All data required for this phase is already present in the existing database — the `sanctions_sync_log` and `fraud_sync_log` tables already store sync history, the `users` table already has `plan` and `created_at`, and the `user_query_usage` table tracks per-period quota consumption. The admin identity check pattern is already established in `src/app/api/admin/sync/route.ts` via `ADMIN_EMAILS` env var.

The main work is: (1) one DB migration adding `last_active_at` to `users`, (2) three new API routes (`/api/admin/users`, `/api/admin/stats`, `/api/admin/users/[id]/plan`), and (3) the `/admin` page with five UI components wired to a `TabNav`. The existing `TabNav` component (`src/components/entity/TabNav.tsx`) is fully compatible with the UI-SPEC requirements — it accepts `tabs`, `defaultTab`, and `panels` props.

**Primary recommendation:** Build all three API routes first (they are the authoritative data contract), then the page with five components in dependency order: skeleton pattern, SyncJobTable, StatCards + DailyRegistrationChart, UserTable + PlanSelector.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-01 | Admin dashboard displays data sync job history — each run shows source, status (success/failure), record count, duration, and error message if failed | `sanctions_sync_log` + `fraud_sync_log` tables exist with all required columns. GET `/api/admin/sync` already queries `sanctions_sync_log` (LIMIT 10). New `/api/admin/sync/history` or extended GET returns merged logs from both tables. |
| ADMIN-02 | Admin dashboard displays full user list with email, plan, registration date, last active date, and quota consumed — searchable and sortable | `users` table has `email`, `plan`, `created_at`. `user_query_usage` has `last_query_at` (usable as last active proxy). **Gap:** no dedicated `last_active_at` column on users — migration needed. |
| ADMIN-03 | Admin can manually change any user's plan (free / starter / enterprise) from the dashboard — change takes effect immediately without Stripe webhook | Single `UPDATE users SET plan = $1 WHERE id = $2` — same pattern as the Stripe webhook handler. |
| ADMIN-04 | Admin dashboard shows platform usage statistics: total users, plan distribution, daily new registrations for past 30 days, and top entity types screened | `users` table provides all user counts. `query_log` provides entity type distribution. All derivable via SQL aggregation — no new tables required. |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Admin identity check | API / Backend | Frontend Server (SSR) | Admin gate must be enforced server-side in both the API routes (403 on non-admin calls) and the page component (renders 403 panel instead of redirect) |
| Sync history display | API / Backend | Frontend Server (SSR) | Data fetched server-side on page load; client "Refresh" button re-fetches via the same API route |
| User list + quota | API / Backend | Frontend Server (SSR) | Initial render is SSR; client-side search is a JavaScript filter on pre-fetched data (no new API call on keystroke) |
| Plan mutation | API / Backend | Browser / Client | PATCH request from `PlanSelector` `<select>` onChange — optimistic update in client state |
| Stats + chart | API / Backend | Frontend Server (SSR) | All stats are a single SQL aggregation served SSR; chart renders as CSS bars from the data array |
| Auth session reading | Frontend Server (SSR) | — | `auth()` called in page component to identify admin; same pattern as `/account` page |

---

## Standard Stack

### Core (all already installed — zero new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | ^16.2.3 [VERIFIED: package.json] | App Router, server components, API routes | Project-wide — established |
| React | 19.0.0 [VERIFIED: package.json] | UI rendering | Project-wide |
| `pg` (node-postgres) | ^8.20.0 [VERIFIED: package.json] | Raw SQL via `db.query()` | Project-wide — no ORM policy |
| next-auth v5 | ^5.0.0-beta.30 [VERIFIED: package.json] | Session (`auth()`) for admin gate | Project-wide auth |
| TypeScript | ^5.7.0 [VERIFIED: package.json] | Strict types | Project-wide |

### No New Dependencies

The UI-SPEC explicitly prohibits external charting libraries. All visual work (bar chart, badges, tables) uses inline CSS on standard HTML elements — consistent with the codebase-wide zero-library-UI pattern.

**Installation:** none required.

---

## Architecture Patterns

### Data Flow

```
Browser (TabNav tab click — client state only)
          |
          v
/admin page (Server Component — runs auth() check)
   |   if not admin → render 403 panel
   |   if admin → fetch all three data sources in parallel
   |
   +── GET /api/admin/sync           → sanctions_sync_log + fraud_sync_log → SyncJobTable
   +── GET /api/admin/users          → users JOIN user_query_usage → UserTable
   +── GET /api/admin/stats          → users GROUP BY / query_log → StatCards + DailyRegistrationChart
          |
          v
TabNav (client) — panels[sync, users, stats] pre-fetched; visibility toggled in JS
          |
          v
PlanSelector onChange → PATCH /api/admin/users/[id]/plan → UPDATE users SET plan
                     ← 200 { plan: "starter" } → optimistic update confirmed / revert on error
```

### Recommended Project Structure

```
src/app/
├── admin/
│   └── page.tsx                   # New — admin dashboard page (Server Component)
src/app/api/admin/
├── sync/route.ts                  # Existing — GET extended, POST unchanged
├── users/
│   └── route.ts                   # New — GET /api/admin/users
├── users/[id]/
│   └── plan/route.ts              # New — PATCH /api/admin/users/[id]/plan
└── stats/
    └── route.ts                   # New — GET /api/admin/stats
src/components/admin/
├── SyncJobTable.tsx               # New — displays sanctions_sync_log + fraud_sync_log
├── UserTable.tsx                  # New — user list with client-side search
├── PlanSelector.tsx               # New — inline <select> for plan change
├── StatCards.tsx                  # New — 2x2 stat grid
└── DailyRegistrationChart.tsx     # New — CSS bar chart (no library)
db/migrations/
└── 033_users_last_active.sql      # New — ADD COLUMN last_active_at TIMESTAMPTZ
```

### Pattern 1: Admin Gate in Server Page

Consistent with `/account/page.tsx` — call `auth()` at the top, check email against `ADMIN_EMAILS`.

```typescript
// Source: [VERIFIED: src/app/account/page.tsx + src/app/api/admin/sync/route.ts pattern]
import { auth } from '@/auth'

export default async function AdminPage() {
  const session = await auth()
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',').map(e => e.trim()).filter(Boolean)
  const isAdmin = session?.user?.email && adminEmails.includes(session.user.email)

  if (!isAdmin) {
    return <AccessDeniedPanel />   // renders 403 message — no redirect
  }

  // Fetch all three data sources in parallel
  const [syncLogs, users, stats] = await Promise.all([
    fetchSyncLogs(),
    fetchUsers(),
    fetchStats(),
  ])
  // ...
}
```

### Pattern 2: Sync Log Query — Merging Two Tables

The existing GET handler in `route.ts` queries only `sanctions_sync_log` (LIMIT 10). For ADMIN-01 we need ALL runs from both `sanctions_sync_log` and `fraud_sync_log`, unified and sorted.

```typescript
// Source: [VERIFIED: src/app/api/admin/sync/route.ts lines 68-75]
// Extend to union both log tables:
const { rows } = await db.query(`
  SELECT source, status, record_count, duration_ms, synced_at, error_message
  FROM sanctions_sync_log
  UNION ALL
  SELECT source, status, record_count, duration_ms, synced_at, error_message
  FROM fraud_sync_log
  ORDER BY synced_at DESC
  LIMIT 200
`)
```

### Pattern 3: User List with Quota (JOIN)

```typescript
// Source: [VERIFIED: db/migrations/001_init.sql + db/migrations/005_auth_tables.sql]
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

### Pattern 4: Plan Mutation (PATCH API Route)

```typescript
// Source: [VERIFIED: src/app/api/stripe/webhook/route.ts line 80 — same UPDATE pattern]
await db.query(
  "UPDATE users SET plan = $1 WHERE id = $2",
  [newPlan, userId]
)
```

### Pattern 5: Daily Registration Stats

```typescript
// Source: [VERIFIED: db/migrations/005_auth_tables.sql — users.created_at column]
const { rows } = await db.query(`
  SELECT
    date_trunc('day', created_at AT TIME ZONE 'UTC')::date AS day,
    COUNT(*)::int AS count
  FROM users
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY 1
  ORDER BY 1
`)
```

### Pattern 6: TabNav Usage

```typescript
// Source: [VERIFIED: src/components/entity/TabNav.tsx]
// Props: tabs: Tab[], defaultTab: string, panels?: ReactNode[], onChange?: (id) => void
// Panels rendered in same order as tabs array.
// Client component — wraps in 'use client' boundary.
<TabNav
  tabs={[
    { id: 'sync',  label: 'Sync History' },
    { id: 'users', label: 'Users' },
    { id: 'stats', label: 'Platform Stats' },
  ]}
  defaultTab="sync"
  panels={[<SyncJobTable ... />, <UserTable ... />, <StatsPanel ... />]}
/>
```

### Anti-Patterns to Avoid

- **Querying quota in a loop per user:** Run a single LEFT JOIN against `user_query_usage` — not N+1 queries.
- **Putting admin gate only in middleware:** Middleware (`middleware.ts`) checks session presence, NOT admin role. The page component must do its own `ADMIN_EMAILS` check.
- **Using redirect() for 403:** UI-SPEC requires rendering a 403 panel in place of content, not a redirect. `redirect('/sign-in')` would be wrong.
- **Client-side search with server re-fetch:** The user list is small enough to filter in JS state — no debounced API call needed on keystroke.
- **Importing TabNav as a Server Component:** `TabNav` is `'use client'` — pass pre-fetched data as props, not via server data fetching inside the component.

---

## Database Schema — Key Findings

### Confirmed Existing Tables

| Table | Relevant Columns | Notes |
|-------|-----------------|-------|
| `users` | `id`, `email`, `plan`, `created_at`, `stripe_customer_id`, `stripe_subscription_id` | [VERIFIED: migration 005 + 007]. **Missing:** `last_active_at` |
| `user_query_usage` | `user_id`, `period_start`, `period_end`, `query_count`, `quota_limit`, `last_query_at` | [VERIFIED: migration 001]. `last_query_at` is per billing period, not absolute. |
| `query_log` | `user_id`, `entity_id`, `query_text`, `result_type`, `queried_at` | [VERIFIED: migration 001]. Source for "top entity types screened" stat. |
| `sanctions_sync_log` | `source`, `synced_at`, `record_count`, `status`, `error_message`, `duration_ms`, `version` | [VERIFIED: migrations 003 + 010]. PRIMARY KEY (source, synced_at). |
| `fraud_sync_log` | `id` SERIAL, `source`, `status`, `record_count`, `error_message`, `duration_ms`, `synced_at` | [VERIFIED: migration 028]. |

### Migration Required: `033_users_last_active.sql`

The `users` table has no `last_active_at` column. Two options:

1. **Add `last_active_at` column** and update it on each quota consumption (in `consumeQuota()` in `quota.ts`). Clean, explicit.
2. **Derive last active from `query_log`** via subquery: `MAX(queried_at) WHERE user_id = u.id`. Avoids migration but is slower.

**Recommendation:** Option 1 — add the column. The migration is trivial and keeps the query fast. `consumeQuota()` already upserts `user_query_usage`; add a companion `UPDATE users SET last_active_at = NOW() WHERE id = $1` there.

```sql
-- 033_users_last_active.sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at);
```

### `plan` Column CHECK Constraint

```sql
-- [VERIFIED: migration 005]
CHECK (plan IN ('free','starter','professional','enterprise'))
```

The PATCH plan endpoint must only accept `free`, `starter`, `enterprise` — (`professional` is a legacy value, safe to include in the constraint but not offered in the UI selector).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bar chart | Custom SVG or Canvas chart library | CSS flex bars (height proportional to max) | UI-SPEC mandates no external charting library; CSS bars are the specified implementation |
| Client-side search | Debounced API fetch | JavaScript Array.filter() on state | User list is small (hundreds max); no API overhead needed |
| Admin auth logic | Custom JWT or session table | `auth()` from next-auth + `ADMIN_EMAILS` env check | Pattern already established in sync route |
| Quota "used" display | Separate quota API call per user | JOIN `user_query_usage` in the users query | N+1 queries are unnecessary; single JOIN is sufficient |

**Key insight:** All required data already exists. This phase is about surfacing existing data through new routes and UI — not building new data collection logic.

---

## Admin Authorization Pattern — Detailed Analysis

The existing `isAuthorized()` in `route.ts` supports three mechanisms:
1. Bearer token (`ADMIN_SECRET` / `SYNC_SECRET` env var) — for cron/script callers
2. Localhost bypass when no `ADMIN_SECRET` set — dev convenience
3. Session email in `ADMIN_EMAILS` — for browser UI callers

**For the `/admin` page:** only mechanism (3) applies (browser session). The page checks `session?.user?.email` against the comma-separated `ADMIN_EMAILS` env var.

**For the new API routes** (`/api/admin/users`, `/api/admin/stats`, `/api/admin/users/[id]/plan`): same dual check — `isAuthorized()` must be copied/extracted to a shared helper, or each route must replicate the check. Recommended: extract to `src/lib/server/admin-auth.ts` shared helper.

**Middleware coverage:** `middleware.ts` already includes `/api/admin/*` in `isProtectedRoute()` [VERIFIED: line 49], so unauthenticated requests get 401 before reaching the route handler. The admin-role 403 check is a second layer inside each route.

---

## API Routes — Full Specification

### GET `/api/admin/sync` (modified)

Current behavior: returns `recent_logs` (10 rows from `sanctions_sync_log` only) + `sync_status`.

**Required change:** The dashboard needs the full history from both `sanctions_sync_log` AND `fraud_sync_log`, paginated or with a higher limit (200 rows). Either:
- Extend the existing GET response with a `full_log` field, OR
- The dashboard page fetches directly in a server action rather than calling this API.

**Recommendation:** The `/admin` page fetches sync logs via a direct `db.query()` server function (not via the API route), since it runs server-side with direct DB access. The existing GET route remains for the "Refresh Sync Log" button (client re-fetch).

### GET `/api/admin/users` (new)

Returns: `{ users: UserAdminRow[] }` where each row has `id, email, plan, created_at, last_active_at, quota_used, quota_limit`.

Admin-gated (403 if not admin email). No pagination required (list is small).

### PATCH `/api/admin/users/[id]/plan` (new)

Body: `{ plan: "starter" | "free" | "enterprise" }`
Response: `{ id, plan }` on success, `{ error: string }` on failure.
Validates plan value before UPDATE. Admin-gated.

### GET `/api/admin/stats` (new)

Returns:
```typescript
{
  totalUsers: number
  planDistribution: { free: number; starter: number; enterprise: number; professional: number }
  newToday: number
  new30Days: number
  dailyRegistrations: Array<{ date: string; count: number }>  // 30 items
}
```

---

## Common Pitfalls

### Pitfall 1: `sanctions_sync_log` PRIMARY KEY prevents duplicate logging

**What goes wrong:** `sanctions_sync_log` has `PRIMARY KEY (source, synced_at)`. If two sync runs happen within the same millisecond, the second INSERT fails.
**Why it happens:** The composite PK on (source, synced_at) is a uniqueness constraint.
**How to avoid:** Use `INSERT ... ON CONFLICT DO NOTHING` or rely on the fact that real sync runs are spaced far apart. Research shows the existing ofac.ts and regulatory-warnings.ts use plain INSERT — they rely on time uniqueness. Don't change the sync modules; just read from the table.
**Warning signs:** Duplicate log entries don't appear — this is a read-only concern for the dashboard.

### Pitfall 2: Missing `last_active_at` — deriving from `last_query_at` in `user_query_usage`

**What goes wrong:** `user_query_usage.last_query_at` is per billing period (monthly period rows). A user active in a previous period has `last_query_at = NULL` in the current period row.
**Why it happens:** `user_query_usage` is keyed by `(user_id, period_start)` — there's a new row each month.
**How to avoid:** The migration adds `users.last_active_at` and `consumeQuota()` updates it. Without the migration, using `MAX(last_query_at)` over all periods would require a subquery per user or a GROUP BY that increases query complexity.
**Warning signs:** "Last Active" column shows NULL for users who were active in a previous month.

### Pitfall 3: `TabNav` is a Client Component — page boundary

**What goes wrong:** `TabNav` uses `useState` and is marked `'use client'`. If the `/admin` page itself is a Server Component (which it must be, to call `auth()` and `db.query()`), passing `TabNav` as a direct child works — but only if data is passed as serializable props.
**Why it happens:** Next.js 15 App Router boundary: Server Components can render Client Components but cannot pass non-serializable objects (functions, class instances) as props.
**How to avoid:** The page fetches all three data arrays server-side and passes them as plain JSON-serializable objects to the Client Component wrappers. The `panels` prop to `TabNav` is an array of React elements (pre-rendered server markup) — this works because React elements are serialized via RSC protocol.
**Warning signs:** TypeScript error "Functions cannot be passed directly to Client Components."

### Pitfall 4: `plan` CHECK constraint mismatch on PATCH

**What goes wrong:** If the PATCH body contains `"professional"` (valid in DB) or an arbitrary string, the UPDATE succeeds but the UI-SPEC only shows three options.
**Why it happens:** The DB constraint allows `professional`; the admin UI should not.
**How to avoid:** Validate `plan` value server-side in the PATCH handler: `if (!['free', 'starter', 'enterprise'].includes(plan)) return 400`.
**Warning signs:** Admin accidentally sets a user to `professional` via direct API call.

### Pitfall 5: Middleware only checks session, NOT admin role

**What goes wrong:** Developer assumes `isProtectedRoute()` in `middleware.ts` provides admin protection. It only checks that a session exists — any logged-in user can call `/api/admin/users`.
**Why it happens:** The middleware comment says "Admin sync endpoint verifies admin role before executing" — but this is done inside the route handler, not the middleware.
**How to avoid:** Each new `/api/admin/*` route must run `isAuthorized()` (or the shared helper) at the start of every handler. This is the pattern in `sync/route.ts`.
**Warning signs:** A free-plan user can access `/api/admin/users` without a 403.

---

## Code Examples

### Skeleton Pattern (from IntelligencePanel.tsx)

```typescript
// Source: [VERIFIED: src/components/entity/IntelligencePanel.tsx]
// No animation — static opacity shimmer
<div style={{
  height: '12px',
  width: '100%',
  borderRadius: '4px',
  backgroundColor: 'var(--border-subtle)',
  opacity: 0.6,
  marginBottom: 'var(--space-3)',
}} />
```

### Quota Display: "42 / 100" vs "Unlimited"

```typescript
// Source: [VERIFIED: src/lib/server/quota.ts — UNLIMITED_QUOTA = -1]
const quotaDisplay = user.quota_limit === -1
  ? 'Unlimited'
  : `${user.quota_used} / ${user.quota_limit}`
```

### Date Format for Table Cells

```typescript
// Source: [ASSUMED — matches "12 Apr 2026" format in UI-SPEC]
// Use en-GB locale for "12 Apr 2026" format
new Date(user.created_at).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric',
})
```

### DailyRegistrationChart — CSS Bar Height

```typescript
// Source: [VERIFIED: 08-UI-SPEC.md component spec]
const maxCount = Math.max(...data.map(d => d.count), 1)  // avoid divide-by-zero
const heightPercent = (count / maxCount) * 100
// Apply as: height: `${Math.max(2, heightPercent)}%`  (min-height: 2px equivalent)
```

---

## Environment Availability

Step 2.6: All dependencies are already installed (Next.js, pg, next-auth). No external tools required for this phase.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL | All DB queries | Assumed available [ASSUMED] | 16 | — |
| `users` table | ADMIN-02, ADMIN-03, ADMIN-04 | Confirmed via migration 005 | — | — |
| `sanctions_sync_log` table | ADMIN-01 | Confirmed via migration 003 | — | — |
| `fraud_sync_log` table | ADMIN-01 | Confirmed via migration 028 | — | — |
| `user_query_usage` table | ADMIN-02 | Confirmed via migration 001 | — | — |
| `query_log` table | ADMIN-04 (top entity types) | Confirmed via migration 001 | — | — |

---

## Validation Architecture

### Test Framework

`nyquist_validation` is enabled (no explicit `false` in config.json).

| Property | Value |
|----------|-------|
| Framework | None detected — project has no test files [VERIFIED: no test/ or __tests__ directories, no jest.config, no vitest.config] |
| Config file | None — "Automated test suite: Not in scope for this milestone" (REQUIREMENTS.md Out of Scope) |
| Quick run command | `npm run type-check` (TypeScript strict check as proxy) |
| Full suite command | `npm run type-check && npm run lint` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ADMIN-01 | Sync log renders rows from both tables | manual-only | `npm run type-check` | N/A |
| ADMIN-02 | User list shows email, plan, dates, quota | manual-only | `npm run type-check` | N/A |
| ADMIN-03 | Plan PATCH updates DB without Stripe | manual-only | `npm run type-check` | N/A |
| ADMIN-04 | Stats page shows correct aggregations | manual-only | `npm run type-check` | N/A |

**Justification for manual-only:** The project explicitly lists "Automated test suite: Not in scope for this milestone" in REQUIREMENTS.md Out of Scope. TypeScript strict check (`npm run type-check`) is the automated quality gate.

### Sampling Rate

- **Per task commit:** `npm run type-check`
- **Per wave merge:** `npm run type-check && npm run lint`
- **Phase gate:** Both pass before `/gsd-verify-work`

### Wave 0 Gaps

None — no test infrastructure to create. TypeScript and ESLint are already configured.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `auth()` from next-auth v5 — existing session strategy |
| V3 Session Management | yes | Database-backed sessions via `@auth/pg-adapter` — no change needed |
| V4 Access Control | yes — critical | Admin role check via `ADMIN_EMAILS` env var in each route handler AND page component |
| V5 Input Validation | yes | Plan value validated server-side (`['free', 'starter', 'enterprise'].includes(plan)`) |
| V6 Cryptography | no | No new crypto operations |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Horizontal privilege escalation: authenticated non-admin calling `/api/admin/users` | Elevation of Privilege | `isAuthorized()` check in each route handler returning 403 |
| Mass assignment: PATCH body with arbitrary plan value | Tampering | Server-side allowlist validation before UPDATE |
| Information disclosure: user PII (email) in admin API | Information Disclosure | Admin-only endpoint — 403 for non-admins; no caching headers |
| CSRF on plan PATCH | Tampering | Same-origin Next.js App Router API routes + session cookie auth provides implicit CSRF protection |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PostgreSQL is running and accessible during execution | Environment Availability | Phase blocked — DB required for all features |
| A2 | "12 Apr 2026" date format uses en-GB locale | Code Examples | Minor — date renders in different format; can fix display without DB change |
| A3 | `consumeQuota()` is the only place quota is incremented, making it the correct hook to update `last_active_at` | DB Schema | If quota is incremented elsewhere, `last_active_at` may not update reliably |

---

## Open Questions

1. **GET `/api/admin/sync` modification vs. page-level server fetch** (RESOLVED)
   - What we know: The existing GET route is also used by the "Refresh Sync Log" client button.
   - What's unclear: Should the initial page load data come from the API route (adding latency) or a direct server-side DB call inside the page component?
   - Recommendation: Use direct DB call in page component for initial load (faster, no HTTP overhead in SSR). Keep the GET route for the client "Refresh" button — it's already authorized and works.
   - Resolution: Implemented as recommended — `getAdminSyncLogs()` repository function called directly in the Server Component; existing GET route retained for the Refresh button.

2. **How many sync log rows to display** (RESOLVED)
   - What we know: UI-SPEC doesn't specify a row limit for SyncJobTable. The existing GET route uses LIMIT 10.
   - What's unclear: Whether "all sync job runs" means unlimited or a practical cap.
   - Recommendation: LIMIT 200 (union of both tables) — large enough to show meaningful history, small enough to be fast.
   - Resolution: LIMIT 200 implemented in `getAdminSyncLogs()` via UNION ALL of both log tables.

3. **"Top entity types screened" stat (ADMIN-04)** (RESOLVED)
   - What we know: `query_log` has `entity_id` and `result_type` but not entity_type directly.
   - What's unclear: Whether to join `query_log` → `entities` to get `entity_type`, or whether to skip this specific sub-stat.
   - Recommendation: JOIN `query_log` to `entities` on `entity_id` — trivial query. If `entity_id` is null (text queries), exclude from count.
   - Resolution: Implemented as recommended — `getAdminStats()` runs a 6th parallel query: `SELECT e.entity_type AS type, COUNT(*)::int AS count FROM query_log ql JOIN entities e ON e.id = ql.entity_id WHERE ql.entity_id IS NOT NULL GROUP BY e.entity_type`. Result exposed as `AdminStats.topEntityTypes` and rendered in a fifth "Entity Breakdown" StatCard showing "Companies: N · Vessels: N · Terminals: N".

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/db/migrations/005_auth_tables.sql`] — `users` table schema (id, email, plan, created_at)
- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/db/migrations/007_stripe_fields.sql`] — Stripe columns on users
- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/db/migrations/001_init.sql`] — `user_query_usage`, `query_log` schema
- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/db/migrations/003_sanctions_cache.sql`] — `sanctions_sync_log` schema
- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/db/migrations/028_fraud_alerts.sql`] — `fraud_sync_log` schema
- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/src/app/api/admin/sync/route.ts`] — `isAuthorized()` pattern, existing GET/POST structure
- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/src/components/entity/TabNav.tsx`] — TabNav props interface (`tabs`, `defaultTab`, `panels`, `onChange`)
- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/middleware.ts`] — `/api/admin/*` is in `isProtectedRoute()` (line 49); admin-role check is NOT in middleware
- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/src/lib/server/quota.ts`] — `PLAN_LIMITS`, `UNLIMITED_QUOTA = -1`, `consumeQuota()` structure
- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/src/auth.ts`] — session carries `user.id` and `user.plan`
- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/src/app/api/stripe/webhook/route.ts`] — `UPDATE users SET plan = $1 WHERE id = $2` pattern
- [VERIFIED: `/home/hippo/projects/Energy_trade_inspection/.planning/phases/08-admin-operations-dashboard/08-UI-SPEC.md`] — all component specs, color, typography, interaction contracts

### Secondary (MEDIUM confidence)

- [VERIFIED: package.json] — Next.js ^16.2.3, React 19.0.0, pg ^8.20.0, next-auth ^5.0.0-beta.30, TypeScript ^5.7.0

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in package.json; no new dependencies
- Architecture: HIGH — all tables and patterns verified in migrations and existing route code
- Pitfalls: HIGH — verified by reading actual source files (middleware, auth, TabNav, migrations)
- Migration requirement: HIGH — confirmed absence of `last_active_at` column in migration files

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable tech stack; no fast-moving dependencies)

---
phase: 08-admin-operations-dashboard
plan: "03"
subsystem: ui
tags: [admin, ui, server-component, tab-nav, sync-log, users, stats]
dependency_graph:
  requires:
    - admin-auth.isAdminAuthorized
    - repository.getAdminSyncLogs
    - repository.getAdminUsers
    - repository.getAdminStats
    - api.GET /api/admin/users
    - api.GET /api/admin/stats
    - api.PATCH /api/admin/users/[id]/plan
  provides:
    - page./admin
    - component.SyncJobTable
    - component.UserTable
    - component.PlanSelector
    - component.StatCards
    - component.DailyRegistrationChart
  affects:
    - src/app/admin/page.tsx
    - src/components/admin/SyncJobTable.tsx
    - src/components/admin/UserTable.tsx
    - src/components/admin/PlanSelector.tsx
    - src/components/admin/StatCards.tsx
    - src/components/admin/DailyRegistrationChart.tsx
tech_stack:
  added: []
  patterns:
    - Server Component parallel data fetch via Promise.all
    - isAdmin gate computed from ADMIN_EMAILS env (server-side, no redirect)
    - Optimistic plan update with client-side revert on API failure
    - CSS flex bar chart (no charting library)
    - TabNav panels pattern (all panels fetched server-side, visibility managed client-side)
key_files:
  created:
    - src/app/admin/page.tsx
    - src/components/admin/SyncJobTable.tsx
    - src/components/admin/UserTable.tsx
    - src/components/admin/PlanSelector.tsx
    - src/components/admin/StatCards.tsx
    - src/components/admin/DailyRegistrationChart.tsx
  modified: []
decisions:
  - "Admin auth gate uses ADMIN_EMAILS env on server-side — no redirect, renders 403 panel in-place"
  - "Promise.all fetch wrapped in try/catch — partial failure renders empty data, not error page"
  - "PlanSelector optimistically updates select state, reverts to previousPlan on non-2xx or network error"
  - "SyncJobTable Refresh button calls /api/admin/sync and reads recent_logs (10 rows) not full 200-row repository data"
  - "DailyRegistrationChart uses CSS flex bars — no external charting library per UI-SPEC constraint"
  - "StatCards.topEntityTypes renders entity breakdown as fifth full-width card below 2x2 grid (per ADMIN-04)"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-15"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 0
---

# Phase 08 Plan 03: Admin Dashboard UI Summary

**One-liner:** Next.js Server Component admin page at /admin with parallel data fetch, TabNav (Sync History / Users / Platform Stats), isAdmin auth gate, and five client components — SyncJobTable with refresh, UserTable with client search and PlanSelector optimistic update, StatCards 2x2 grid with Entity Breakdown card, DailyRegistrationChart CSS bars.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Admin page (Server Component) + SyncJobTable + PlanSelector | bdfc08e | src/app/admin/page.tsx, src/components/admin/SyncJobTable.tsx, src/components/admin/PlanSelector.tsx |
| 2 | UserTable + StatCards + DailyRegistrationChart | f068e20 | src/components/admin/UserTable.tsx, src/components/admin/StatCards.tsx, src/components/admin/DailyRegistrationChart.tsx |

## What Was Built

### Admin Page (`src/app/admin/page.tsx`)
Server Component at `/admin`. Computes `isAdmin` from `ADMIN_EMAILS` env vs `session.user.email`. For non-admins: renders a centered `role="alert"` panel with "Access denied" heading and 403 message — no tabs visible. For admins: fetches all data in parallel via `Promise.all([getAdminSyncLogs(), getAdminUsers(), getAdminStats()])`, wrapped in try/catch to handle partial DB failures gracefully. Passes data to `TabNav` with three panels: SyncJobTable, UserTable, and the Stats panel (StatCards + DailyRegistrationChart stacked vertically).

### SyncJobTable (`src/components/admin/SyncJobTable.tsx`)
Client component. Displays sync log rows (source, status badge, records, duration, UTC timestamp, error). Status badges use `var(--status-clear)` / `var(--status-listed)` / `var(--risk-medium)`. "Refresh Sync Log" button re-fetches `/api/admin/sync` and replaces state with `data.recent_logs`. Button shows `aria-busy` and "Refreshing..." during fetch; disables to prevent double-submit.

### PlanSelector (`src/components/admin/PlanSelector.tsx`)
Client component. Renders a `<select>` with Free/Starter/Enterprise options. On change: optimistically updates `selected` state, sends `PATCH /api/admin/users/${userId}/plan`, calls `onPlanChanged` on success. On failure: reverts `selected` to `previousPlan`, shows "Failed. Try again." error for 4 seconds. `aria-label="Change plan for {email}"` for accessibility.

### UserTable (`src/components/admin/UserTable.tsx`)
Client component. Renders search input and filtered user list. Client-side filter on `user.email.toLowerCase()`. Tracks plan changes in local `planMap` state — `effectivePlan = planMap[user.id] ?? user.plan`. Plan badge: paid plans show accent-bordered uppercase chip; free plan shows plain muted text. Quota display: "N / N" or "Unlimited" when `quota_limit === -1`. Quota near-limit (≥80%) highlighted in `var(--risk-medium)`. Last Active shows "Never" for null `last_active_at`.

### StatCards (`src/components/admin/StatCards.tsx`)
Pure display component (no 'use client'). Four stat cards in 2x2 CSS grid: Total Users, Plan Distribution, New Today, New (30 Days). Fifth full-width "Entity Breakdown" card below the grid — iterates `topEntityTypes` array to build `entityCounts` for company/vessel/terminal, renders as "Companies: N · Vessels: N · Terminals: N" in mono font.

### DailyRegistrationChart (`src/components/admin/DailyRegistrationChart.tsx`)
Pure display component. CSS flex bars, height proportional to `count / maxCount`. Empty data shows placeholder div. All-zero data renders bars at 2px height with 0.3 opacity. X-axis labels shown only on first day of each week (Monday). Bars have `title="{date}: {count} registrations"` for native browser tooltip. Hover changes opacity from 0.7 to 1.

## Checkpoint Status

Plan 03 has a `type="checkpoint:human-verify"` task (Task 3) that requires manual verification of the admin dashboard UI. The two auto tasks were completed and committed. The checkpoint requires the user to:

1. Start dev server and visit `/admin` as a non-admin user — verify "Access denied" panel
2. Set `ADMIN_EMAILS=your@email.com` in `.env.local`, restart, visit `/admin` as admin
3. Verify three tabs render correctly (Sync History default)
4. Verify Refresh Sync Log button works
5. Verify Users tab with search and plan selector
6. Verify Platform Stats tab with stat cards, Entity Breakdown, and bar chart
7. Run `npm run type-check && npm run lint`

## Deviations from Plan

None — plan executed exactly as written. All six files match the plan's code specifications.

## Known Stubs

None — all data flows from real repository functions (`getAdminSyncLogs`, `getAdminUsers`, `getAdminStats`) through the Server Component to the client components. No placeholder data or hardcoded values.

## Threat Surface Scan

No new network endpoints introduced beyond what was planned. The `/admin` page is a Server Component with server-side auth gate. No client-side exposure of admin data to non-admins — the auth check happens before any data fetch. Threat model mitigations T-08-03-01 through T-08-03-04 are all implemented as designed.

## Self-Check: PASSED

- [x] `src/app/admin/page.tsx` exists with `isAdmin`, `getAdminSyncLogs`, `Promise.all`, `defaultTab="sync"`, `role="alert"`, `topEntityTypes: []`
- [x] `src/components/admin/SyncJobTable.tsx` exists with `Refresh Sync Log`, `aria-busy`, `handleRefresh`
- [x] `src/components/admin/PlanSelector.tsx` exists with `aria-label.*Change plan`, `previousPlan`, `Failed. Try again`
- [x] `src/components/admin/UserTable.tsx` exists with `Search users by email`, `No users match your search`, `Unlimited`, `Never`
- [x] `src/components/admin/StatCards.tsx` exists with `Entity Breakdown`, `topEntityTypes`, `entitySubtext`
- [x] `src/components/admin/DailyRegistrationChart.tsx` exists with `Daily Registrations`, `accent-primary`, `onMouseEnter`, `registrations`
- [x] Task 1 commit `bdfc08e` exists
- [x] Task 2 commit `f068e20` exists
- [x] `npm run type-check` exits 0

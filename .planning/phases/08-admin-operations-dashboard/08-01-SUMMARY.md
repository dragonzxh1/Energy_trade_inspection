---
phase: 08-admin-operations-dashboard
plan: "01"
subsystem: data-layer
tags: [admin, repository, migration, quota, auth]
dependency_graph:
  requires: []
  provides:
    - admin-auth.isAdminAuthorized
    - repository.getAdminSyncLogs
    - repository.getAdminUsers
    - repository.getAdminStats
    - users.last_active_at
  affects:
    - src/lib/server/quota.ts
    - src/lib/server/repository.ts
tech_stack:
  added: []
  patterns:
    - UNION ALL across two log tables (sanctions_sync_log + fraud_sync_log)
    - Promise.all for parallel DB queries in getAdminStats
    - Non-blocking last_active_at update with .catch(() => {})
key_files:
  created:
    - db/migrations/033_users_last_active.sql
    - src/lib/server/admin-auth.ts
  modified:
    - src/lib/server/repository.ts
    - src/lib/server/quota.ts
decisions:
  - "isAdminAuthorized returns AuthResult struct (not boolean) to let callers log the authorization pathway"
  - "last_active_at UPDATE in consumeQuota uses .catch(() => {}) — quota must not fail if users table update fails"
  - "getAdminUsers quota_limit defaults to 5 via COALESCE when user_query_usage row absent"
  - "topEntityTypes computed via query_log JOIN entities (entity_type on entities table, not query_log)"
metrics:
  duration_minutes: 8
  completed_date: "2026-04-15"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 08 Plan 01: Admin Data Layer Summary

**One-liner:** PostgreSQL migration + shared admin auth helper + four repository query functions + quota last-active tracking for the admin operations dashboard data layer.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DB migration + admin-auth shared helper | 7a15045 | db/migrations/033_users_last_active.sql, src/lib/server/admin-auth.ts |
| 2 | Repository admin query functions + consumeQuota last_active_at update | fc5e143 | src/lib/server/repository.ts, src/lib/server/quota.ts |

## What Was Built

### Migration 033 (`db/migrations/033_users_last_active.sql`)
Idempotent `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ` with `CREATE INDEX IF NOT EXISTS idx_users_last_active`. Runs automatically on server startup via the migration runner.

### Admin Auth Helper (`src/lib/server/admin-auth.ts`)
Exports `AuthResult` interface and `isAdminAuthorized(req, userEmail)` function implementing three-tier auth check:
1. Bearer token (`ADMIN_SECRET` / `SYNC_SECRET` env var)
2. Localhost bypass (dev-only, when no secret is set)
3. `ADMIN_EMAILS` whitelist check

Returns structured `AuthResult` with `authorized` boolean and `reason` field for logging.

### Repository Admin Functions (`src/lib/server/repository.ts`)
Three new exported async functions appended to end of file:

- **`getAdminSyncLogs()`** — UNION ALL of `sanctions_sync_log` and `fraud_sync_log`, sorted by `synced_at DESC`, limited to 200 rows
- **`getAdminUsers()`** — All users LEFT JOINed with `user_query_usage` for current billing period; returns quota_used and quota_limit per user
- **`getAdminStats()`** — Six parallel queries via `Promise.all` returning: totalUsers, planDistribution (free/starter/professional/enterprise), newToday, new30Days, dailyRegistrations (30-day chart data), topEntityTypes (query_log JOIN entities grouped by entity_type)

Three new exported interfaces: `UserAdminRow`, `AdminSyncLogRow`, `AdminStats`.

### Quota Last-Active Tracking (`src/lib/server/quota.ts`)
`consumeQuota()` now fires `UPDATE users SET last_active_at = NOW() WHERE id = $1` immediately after the upsert, using `.catch(() => {})` to prevent quota failures if the update fails. Only fires on the limited-plan path — unlimited plans (`professional`, `enterprise`) are excluded.

## Deviations from Plan

None — plan executed exactly as written.

The pre-existing `src/lib/stripe.ts` TypeScript error (`'"2025-03-31.basil"'` not assignable to `'"2026-03-25.dahlia"'`) was present before this plan and is unrelated to the changes here. No new TypeScript errors were introduced.

## Known Stubs

None — this plan is pure data layer (no UI rendering).

## Threat Surface Scan

No new network endpoints introduced. Functions are server-side only. The `isAdminAuthorized()` function is a library — callers must invoke it before exposing admin data (enforced in Wave 2 API routes). No new trust boundaries introduced.

## Self-Check: PASSED

- [x] `db/migrations/033_users_last_active.sql` exists
- [x] `src/lib/server/admin-auth.ts` exists with `export function isAdminAuthorized` and `export interface AuthResult`
- [x] `src/lib/server/repository.ts` exports `getAdminSyncLogs`, `getAdminUsers`, `getAdminStats`, `UserAdminRow`, `AdminSyncLogRow`, `AdminStats`
- [x] `topEntityTypes` appears in repository.ts (interface field + query comment + return statement = 3 matches)
- [x] `UNION ALL` present in repository.ts (sync log query)
- [x] `JOIN entities` present in repository.ts (entity type aggregation)
- [x] `last_active_at = NOW` present in quota.ts
- [x] Task 1 commit `7a15045` exists
- [x] Task 2 commit `fc5e143` exists
- [x] No new TypeScript errors introduced (only pre-existing stripe.ts error)

---
phase: 01-architecture-hardening
plan: "01"
subsystem: auth-middleware
tags: [security, middleware, auth, nextauth, api]
dependency_graph:
  requires: []
  provides: [centralized-auth-guard, admin-403-fix]
  affects: [all-protected-api-routes]
tech_stack:
  added: []
  patterns: [nextauth-v5-middleware, nodejs-runtime-middleware, non-null-assertion-pattern]
key_files:
  created: []
  modified:
    - middleware.ts
    - src/app/api/screen/route.ts
    - src/app/api/trade/route.ts
    - src/app/api/intelligence/company/[slug]/route.ts
    - src/app/api/intelligence/terminal/[id]/route.ts
    - src/app/api/intelligence/vessel/[imo]/route.ts
    - src/app/api/ais/vessel/[imo]/route.ts
    - src/app/api/ais/vessel/[imo]/draft-check/route.ts
    - src/app/api/quota/route.ts
    - src/app/api/watchlist/route.ts
    - src/app/api/watchlist/refresh/route.ts
    - src/app/api/watchlist/trades/route.ts
    - src/app/api/watchlist/trades/refresh/route.ts
    - src/app/api/watchlist/trades/[id]/route.ts
    - src/app/api/admin/sync/route.ts
decisions:
  - "(await auth())! non-null assertion used in routes that keep auth() for business logic — safe because middleware guarantees session exists before handler runs"
  - "AIS routes (vessel, draft-check) had auth() used only for the 401 guard — import and call fully removed"
  - "report routes (screen/report, trade/[id]/report) not in plan scope — left with existing per-route guards (redundant but harmless)"
metrics:
  duration: "~12 minutes"
  completed: "2026-04-13"
  tasks_completed: 2
  files_modified: 15
---

# Phase 01 Plan 01: Centralized Auth Middleware Summary

**One-liner:** Centralized NextAuth session enforcement in middleware.ts with nodejs runtime, removing 13 per-route auth() guards and fixing admin endpoint to return typed 401/403 based on auth failure reason.

## What Was Built

### Task 1: Middleware auth guard (commit `50f8b11`)

Updated `middleware.ts` to:
- Add `export const runtime = 'nodejs'` — required because `@auth/pg-adapter` uses Node.js `pg` driver which is not Edge-compatible
- Import `auth` from `./src/auth` (root-relative path, not `@/auth` alias)
- Add `isProtectedRoute()` function covering 8 path groups: `/api/screen`, `/api/trade`, `/api/intelligence/`, `/api/ais/`, `/api/watchlist`, `/api/quota`, `/api/report/`, `/api/admin/`
- Changed `export function middleware` to `export async function middleware`
- Auth check runs before rate limiting — unauthenticated requests to protected routes return 401 immediately without consuming rate limit quota
- Rate limiting fully preserved for all API routes including public ones

Public/special-auth routes correctly excluded: `/api/search`, `/api/entity/**`, `/api/flags`, `/api/stripe/**`, `/api/auth/**`, `/api/cron/**`

### Task 2: Remove per-route 401 guards + admin 401/403 fix (commit `eff49a2`)

**12 non-admin protected routes:** Removed `if (!session?.user) return 401` guards. Routes that use session data (user.id, user.plan) keep the `auth()` call with `(await auth())!` non-null assertion. AIS routes (vessel, draft-check) had auth() used only for the guard — both import and call fully removed.

**admin/sync/route.ts refactored:**
- `isAuthorized()` now returns typed `AuthResult: { authorized: boolean; reason: 'no_session' | 'bearer_valid' | 'admin_email' | 'not_admin' }`
- GET and POST both return 401 when `reason === 'no_session'`, 403 when `reason === 'not_admin'`
- Production startup warning logged when `ADMIN_SECRET` and `SYNC_SECRET` are both absent

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written.

### Notes

**report routes not cleaned:** `src/app/api/screen/report/route.tsx` and `src/app/api/trade/[id]/report/route.tsx` still contain per-route `if (!session?.user)` guards. These were not in the plan's list of 13 routes to modify. They are protected by middleware now (both fall under `/api/screen` and `/api/report/` prefixes), so their guards are redundant but not harmful. Flagged for cleanup in a future plan.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. This plan only adds enforcement to existing paths.

## Known Stubs

None.

## Self-Check

### Files exist:
- middleware.ts: exists
- src/app/api/admin/sync/route.ts: exists
- All 13 route files: exist

### Commits exist:
- 50f8b11: Task 1 — middleware auth guard
- eff49a2: Task 2 — per-route guard removal + admin fix

## Self-Check: PASSED

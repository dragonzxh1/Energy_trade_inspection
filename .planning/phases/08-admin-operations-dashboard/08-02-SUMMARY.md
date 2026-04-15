---
phase: 08-admin-operations-dashboard
plan: "02"
subsystem: api-routes
tags: [admin, api-routes, auth-gate, plan-mutation]
dependency_graph:
  requires:
    - admin-auth.isAdminAuthorized
    - repository.getAdminUsers
    - repository.getAdminStats
  provides:
    - api.GET /api/admin/users
    - api.GET /api/admin/stats
    - api.PATCH /api/admin/users/[id]/plan
  affects:
    - src/app/api/admin/users/route.ts
    - src/app/api/admin/stats/route.ts
    - src/app/api/admin/users/[id]/plan/route.ts
tech_stack:
  added: []
  patterns:
    - isAdminAuthorized() shared helper for consistent 401/403 response
    - Next.js 15 async params (await params) for dynamic route segments
    - ALLOWED_PLANS const allowlist for plan mutation validation
    - parameterized SQL UPDATE to prevent SQL injection
    - Cache-Control no-store on PII-bearing GET responses
key_files:
  created:
    - src/app/api/admin/users/route.ts
    - src/app/api/admin/stats/route.ts
    - src/app/api/admin/users/[id]/plan/route.ts
  modified: []
decisions:
  - "ALLOWED_PLANS excludes 'professional' — intentional per UI-SPEC, admin can only set free/starter/enterprise"
  - "Cache-Control: no-store on /users and /stats — prevents CDN caching of PII (emails, user counts)"
  - "Parameterized query $1/$2 in PATCH route — eliminates SQL injection via URL path param"
metrics:
  duration_minutes: 1
  completed_date: "2026-04-15"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 0
---

# Phase 08 Plan 02: Admin API Routes Summary

**One-liner:** Three admin-gated API routes (GET users, GET stats, PATCH plan) with shared isAdminAuthorized() auth helper, parameterized SQL, and no-store cache headers for PII protection.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | GET /api/admin/users and GET /api/admin/stats routes | e425860 | src/app/api/admin/users/route.ts, src/app/api/admin/stats/route.ts |
| 2 | PATCH /api/admin/users/[id]/plan route | 4bc39fb | src/app/api/admin/users/[id]/plan/route.ts |

## What Was Built

### GET /api/admin/users (`src/app/api/admin/users/route.ts`)
Admin-gated endpoint returning all users with their quota usage. Uses `getAdminUsers()` from repository. Returns `Cache-Control: no-store` to prevent CDN caching of user PII (emails, quotas). Returns 401 for unauthenticated requests, 403 for non-admin authenticated users.

### GET /api/admin/stats (`src/app/api/admin/stats/route.ts`)
Admin-gated endpoint returning platform statistics via `getAdminStats()` from repository. Includes totalUsers, planDistribution, newToday, new30Days, dailyRegistrations, topEntityTypes. Returns `Cache-Control: no-store`.

### PATCH /api/admin/users/[id]/plan (`src/app/api/admin/users/[id]/plan/route.ts`)
Admin-gated plan mutation endpoint. Validates plan against `ALLOWED_PLANS = ['free', 'starter', 'enterprise']` — deliberately excludes 'professional'. Uses Next.js 15 async params pattern (`await params`). Uses parameterized SQL (`UPDATE users SET plan = $1 WHERE id = $2`) to prevent SQL injection via URL path parameter. Returns 400 for invalid or disallowed plan values.

## Threat Model Coverage

All five threats from the plan's threat register were mitigated:

| Threat | Status |
|--------|--------|
| T-08-02-01: EoP — GET /api/admin/users | MITIGATED: isAdminAuthorized() returns 403 for non-admin sessions |
| T-08-02-02: Tampering — PATCH plan body | MITIGATED: ALLOWED_PLANS server-side allowlist, rejects 'professional' with 400 |
| T-08-02-03: Tampering — PATCH id path param | MITIGATED: Parameterized query $1/$2, no string interpolation |
| T-08-02-04: Info Disclosure — /users response | MITIGATED: Admin-only gate + Cache-Control: no-store |
| T-08-02-05: Info Disclosure — /stats response | MITIGATED: Admin-only gate + Cache-Control: no-store |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan is pure API routes (no UI rendering, no placeholder data).

## Threat Surface Scan

Three new network endpoints introduced, all covered in the plan's threat model. No additional threat surface outside plan scope.

## Self-Check: PASSED

- [x] `src/app/api/admin/users/route.ts` exists with `export const runtime = 'nodejs'`, `isAdminAuthorized`, `getAdminUsers`, `Cache-Control: no-store`
- [x] `src/app/api/admin/stats/route.ts` exists with `export const runtime = 'nodejs'`, `isAdminAuthorized`, `getAdminStats`, `Cache-Control: no-store`
- [x] `src/app/api/admin/users/[id]/plan/route.ts` exists with `export const runtime = 'nodejs'`, `isAdminAuthorized`, `ALLOWED_PLANS`, `await params`, `UPDATE users SET plan`
- [x] `professional` does NOT appear in PATCH route ALLOWED_PLANS
- [x] Task 1 commit `e425860` exists
- [x] Task 2 commit `4bc39fb` exists
- [x] `npm run type-check` exits 0 (no TypeScript errors)
- [x] `grep -rn "isAdminAuthorized" src/app/api/admin/` returns 3 matches (one per route)

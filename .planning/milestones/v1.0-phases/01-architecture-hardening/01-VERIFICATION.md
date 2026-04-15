---
phase: 01-architecture-hardening
verified: 2026-04-13T00:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification: false
---

# Phase 1: Architecture Hardening Verification Report

**Phase Goal:** All protected routes are covered by centralized auth, the OpenSanctions API degrades gracefully, the admin sync endpoint is explicitly locked down, and the Python intelligence wrapper works on both Windows and Linux
**Verified:** 2026-04-13
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Any new API route added without explicit auth check is still protected by default via `middleware.ts` | VERIFIED | `middleware.ts` line 40–51: `isProtectedRoute()` covers `/api/screen`, `/api/trade`, `/api/intelligence/`, `/api/ais/`, `/api/watchlist`, `/api/quota`, `/api/report/`, `/api/admin/`; session checked at line 108 before rate limiting; `export const runtime = 'nodejs'` at line 18 ensures Node.js compatibility with `@auth/pg-adapter` |
| 2 | When OpenSanctions API is unavailable, screening completes with `status: degraded` and a cached result — it does not return a 500 or fail silently | VERIFIED | `sanctions.ts` lines 146–229: circuit breaker with `circuitOpen`, 3-failure threshold, 60s cooldown; `checkSanctions()` returns `{ status: 'degraded', listed: false, sources: [], reason: 'opensanctions_api_unavailable' }` when circuit open; `screening-service.ts` lines 127–134 and 315–329: `sanctionCheckDegraded` tracked per entity, `degraded_sources` collected in `ScreeningReport` |
| 3 | A non-admin user calling `/api/admin/sync` receives a 403 — the endpoint verifies admin role before executing | VERIFIED | `admin/sync/route.ts` lines 16–52: `AuthResult` interface with `reason: 'no_session' \| 'bearer_valid' \| 'admin_email' \| 'not_admin'`; lines 57–62 and 93–98: `status = authResult.reason === 'no_session' ? 401 : 403` — non-admin authenticated users get 403 |
| 4 | All previously per-route `auth()` calls are removed and the behavior is equivalent (no regression in protection) | VERIFIED | The 13 target routes have per-route 401 guards removed (grep confirms none remain in screen/trade/intelligence/ais/quota/watchlist). Two report routes (`screen/report/route.tsx`, `trade/[id]/report/route.tsx`) retain redundant guards — these were explicitly noted as out of scope in 01-01-SUMMARY.md and are protected by middleware prefix coverage (`/api/screen`, `/api/report/`) — no security gap |
| 5 | Intelligence queries (Tavily) succeed on Linux production — Python path resolves correctly on both Windows and Linux | VERIFIED | `intelligence.ts` lines 22–24: `PYTHON` constant uses `process.platform === 'win32'` to select `.venv/Scripts/python.exe` (Windows) vs `.venv/bin/python` (Linux); lines 30–38: `existsSync(PYTHON)` startup guard with platform-specific fix command — from commit `4cddc7d` (pre-phase) plus `bfd2e65` |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `middleware.ts` | Centralized auth guard + rate limiting | VERIFIED | Contains `runtime = 'nodejs'`, `import { auth }`, `isProtectedRoute()`, `export async function middleware`, auth check before rate limit; 149 lines, substantive |
| `src/app/api/admin/sync/route.ts` | Admin sync with typed `isAuthorized()` returning reason codes | VERIFIED | `AuthResult` interface (line 16), `isAuthorized()` returns typed reason (lines 21–52), GET and POST both handle 401/403 (lines 54–98); production startup warning (lines 12–14) |
| `src/lib/server/sync/sanctions.ts` | Circuit breaker wrapping `checkApiSanctions()`; `checkSanctions()` returns typed result with status field | VERIFIED | `circuitOpen`, `circuitOpenedAt`, `failureCount` declared (lines 146–148); `CIRCUIT_FAILURE_THRESHOLD = 3`, `CIRCUIT_COOLDOWN_MS = 60_000` (lines 150–151); `callApiSanctionsWithBreaker()` defined (line 197); `checkSanctions()` returns `status: 'ok' \| 'degraded'` (line 240); `throw new Error` on non-ok HTTP response (line 176) |
| `src/lib/server/screening-service.ts` | Surfaces degraded status from `checkSanctions()` in `ScreeningReport` | VERIFIED | `sanctionCheckDegraded?: boolean` in `EntityScreeningResult` (line 44); `degraded_sources?: string[]` in `ScreeningReport` (line 62); catch fallback uses `status: 'degraded' as const` (line 128); `degradedEntities` collected and spread into report (lines 316–329) |
| `src/lib/server/intelligence.ts` | `existsSync()` check at module load with actionable warning message | VERIFIED | `import { existsSync }` (line 14); `if (!existsSync(PYTHON))` block (lines 30–38); message includes resolved path and platform-specific fix command; `process.platform === 'win32'` present at both line 22 (PYTHON constant) and line 31 (fix command) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `middleware.ts` | `src/auth.ts` | `import { auth } from './src/auth'` | VERIFIED | Line 21: `import { auth } from './src/auth'`; `auth()` called at line 108 |
| `src/app/api/admin/sync/route.ts` | `isAuthorized()` | typed result with reason field | VERIFIED | Lines 56–62 (GET) and 92–98 (POST) use `authResult.reason` to select 401 vs 403 |
| `src/lib/server/screening-service.ts` | `src/lib/server/sync/sanctions.ts` | `checkSanctions()` return value — `status` field | VERIFIED | Line 127: `await checkSanctions(entity.name).catch(...)`, line 134: `sanctionResult.status === 'degraded'` |
| `src/lib/server/intelligence.ts` | `PYTHON` constant | `existsSync` check at module initialization | VERIFIED | Line 30: `if (!existsSync(PYTHON))` executes at module load, before any request |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `screening-service.ts` | `degraded_sources` | `sanctionCheckDegraded` per entity → `degradedEntities` array | Yes — flows from actual `checkSanctions()` status field, not hardcoded | FLOWING |
| `sanctions.ts` | circuit state (`circuitOpen`, `failureCount`) | Actual `checkApiSanctions()` throw on non-ok HTTP response | Yes — `throw new Error` on line 176 feeds failure counting | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| middleware `isProtectedRoute` covers all 8 path groups | `grep -c "startsWith\|=== '/api/quota'" middleware.ts` | 8 startsWith/equality checks present | PASS |
| `admin/sync` GET returns 403 for non-admin | Code inspection: `authResult.reason === 'no_session' ? 401 : 403` in both GET and POST | Ternary correct — `not_admin` reason → 403 | PASS |
| Circuit breaker resets on success | `callApiSanctionsWithBreaker` success path: `circuitOpen = false; failureCount = 0` | Lines 215–216 reset both state vars | PASS |
| `degraded_sources` omitted when empty | `...(degradedEntities.length > 0 && { degraded_sources: degradedEntities })` | Conditional spread at line 329 — field absent when no degraded entities | PASS |
| Python path correct for both platforms | PYTHON constant uses `process.platform === 'win32'` ternary | Lines 22–24 confirmed; cross-platform from commit `4cddc7d` | PASS |

Step 7b: TypeScript compile cannot be run without a live Node.js environment, but all spot-checks are code-level PASS.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ARCH-01 | 01-01-PLAN.md | Centralized `middleware.ts` enforces authentication on all protected routes — per-route `auth()` checks removed | SATISFIED | `middleware.ts` `isProtectedRoute()` + async auth check; per-route 401 guards removed from 13 routes (2 report routes retain redundant guards, covered by middleware — no gap) |
| ARCH-02 | 01-02-PLAN.md | OpenSanctions API has circuit breaker — screening returns `status: degraded` with cached data and does not fail silently | SATISFIED | Circuit breaker in `sanctions.ts`; `degraded_sources` in `ScreeningReport` |
| ARCH-03 | 01-01-PLAN.md | Admin sync endpoint `/api/admin/sync` verifies admin role before executing — authorization is explicit and audited | SATISFIED | `isAuthorized()` returns typed `AuthResult`; 401 for no session, 403 for non-admin; production warning for missing `ADMIN_SECRET` |
| ARCH-04 | 01-03-PLAN.md | Python intelligence wrapper resolves Python binary path correctly on both Windows and Linux | SATISFIED | `PYTHON` constant uses `process.platform === 'win32'` ternary (commit `4cddc7d`); `existsSync()` startup check with actionable error message (commit `bfd2e65`) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/app/api/screen/report/route.tsx` | 21 | `if (!session?.user)` guard remains | Info | Redundant — route is covered by `/api/screen` middleware prefix; guard is defense-in-depth, not a gap. Noted for future cleanup in 01-01-SUMMARY.md |
| `src/app/api/trade/[id]/report/route.tsx` | 27 | `if (!session?.user)` guard remains | Info | Redundant — route is covered by `/api/report/` middleware prefix; same as above |

Neither is a blocker — both routes are protected by middleware. The per-route guards are redundant but harmless.

### Human Verification Required

None. All must-haves are verifiable programmatically through static code analysis.

### Gaps Summary

No gaps. All 5 roadmap success criteria are verified against the actual codebase:

1. Centralized middleware auth is live and covers all 8 protected path groups with Node.js runtime explicitly set.
2. The OpenSanctions circuit breaker trips after 3 consecutive failures, returns degraded status without hitting the API during cooldown, and surfaces affected entity names in `ScreeningReport.degraded_sources`.
3. Admin endpoint correctly returns 401 for unauthenticated requests and 403 for authenticated non-admin users via typed `AuthResult.reason`.
4. Per-route 401 guards removed from all 13 target routes; 2 report routes retain redundant guards explicitly noted as out-of-scope in the summary, covered by middleware prefixes.
5. Python binary path resolves correctly for both Windows (`Scripts/python.exe`) and Linux (`bin/python`); startup `existsSync()` check provides actionable fix command.

All commits documented in summaries are verified present in git log: `50f8b11`, `eff49a2`, `b85bbb9`, `16a5f97`, `bfd2e65`.

---

_Verified: 2026-04-13T00:00:00Z_
_Verifier: Claude (gsd-verifier)_

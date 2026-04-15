---
phase: 01-architecture-hardening
plan: 02
subsystem: sanctions-circuit-breaker
tags: [circuit-breaker, sanctions, resilience, degraded-mode]
dependency_graph:
  requires: []
  provides: [sanctions-circuit-breaker, degraded-sanctions-surface]
  affects: [src/lib/server/sync/sanctions.ts, src/lib/server/screening-service.ts]
tech_stack:
  added: []
  patterns: [in-memory-circuit-breaker, status-tagged-return-type]
key_files:
  created: []
  modified:
    - src/lib/server/sync/sanctions.ts
    - src/lib/server/screening-service.ts
decisions:
  - "Circuit breaker uses module-level variables (no library) — matches established codebase pattern of module-level constants"
  - "checkApiSanctions() now throws on non-ok HTTP response so circuit breaker can count failures"
  - "checkSanctions() return type extended with status field; backward-compatible via optional reason field"
  - "degraded_sources in ScreeningReport uses spread conditional to omit field when empty"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-13"
  tasks_completed: 2
  files_modified: 2
---

# Phase 1 Plan 2: OpenSanctions Circuit Breaker Summary

**One-liner:** In-memory circuit breaker wrapping `checkApiSanctions()` with 3-failure threshold and 60s cooldown; `checkSanctions()` returns status-tagged result; `ScreeningReport` surfaces `degraded_sources` to prevent silent false-negatives.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add circuit breaker to sanctions.ts, update checkSanctions() return type | b85bbb9 | src/lib/server/sync/sanctions.ts |
| 2 | Update screening-service.ts to surface degraded sanctions status | 16a5f97 | src/lib/server/screening-service.ts |

## What Was Built

### Task 1 — Circuit Breaker in sanctions.ts

Added three module-level state variables (`circuitOpen`, `circuitOpenedAt`, `failureCount`) and two constants (`CIRCUIT_FAILURE_THRESHOLD = 3`, `CIRCUIT_COOLDOWN_MS = 60_000`).

Created `callApiSanctionsWithBreaker()` which wraps `checkApiSanctions()`:
- If circuit is open and still in cooldown: returns `{ degraded: true }` immediately without hitting the API
- If circuit is open but cooldown elapsed (half-open): allows one attempt
- On success: resets `circuitOpen = false`, `failureCount = 0`
- On failure: increments `failureCount`; trips circuit at threshold; extends cooldown on half-open failure

`checkApiSanctions()` now throws on non-ok HTTP response (`throw new Error(...)`) instead of silently returning `{ listed: false, sources: [] }` — this enables the circuit breaker to count failures correctly.

`checkSanctions()` return type updated to `{ status: 'ok' | 'degraded'; listed: boolean; sources: string[]; reason?: string }`. Local DB path returns `status: 'ok'`. Degraded path returns `reason: 'opensanctions_api_unavailable'`.

### Task 2 — Degraded Status Surface in screening-service.ts

`EntityScreeningResult` interface: added `sanctionCheckDegraded?: boolean`.

`ScreeningReport` interface: added `degraded_sources?: string[]`.

`screenEntity()`: catch fallback now provides the full status-tagged shape `{ status: 'degraded' as const, ... }` instead of bare `{ listed: false, sources: [] }`. Derives `sanctionCheckDegraded` from `sanctionResult.status === 'degraded'`.

`runDocumentScreening()`: collects entity names where `sanctionCheckDegraded` is true and includes them in the report as `degraded_sources` (omitted entirely when empty via conditional spread).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all logic is wired. The `degraded_sources` field flows from circuit breaker state through `checkSanctions()` return value to `ScreeningReport`.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. Circuit breaker state is module-level in-memory only (explicitly accepted as T-02-04 in the plan's threat model).

## Self-Check

### Files exist:
- src/lib/server/sync/sanctions.ts — modified (contains circuitOpen, callApiSanctionsWithBreaker, status: 'ok'/'degraded')
- src/lib/server/screening-service.ts — modified (contains sanctionCheckDegraded, degraded_sources)

### Commits exist:
- b85bbb9 — feat(01-02): add circuit breaker to sanctions.ts
- 16a5f97 — feat(01-02): surface degraded sanctions status in ScreeningReport

## Self-Check: PASSED

---
phase: 06-trade-service-integration-hardening
plan: 01
subsystem: trade-service
tags: [circuit-breaker, sanctions, degradation, ui, compliance]
dependency_graph:
  requires: []
  provides: [TradeCheckResult.sanctionDegraded, amber-warning-box]
  affects: [src/lib/server/trade-service.ts, src/app/trade/TradeClient.tsx]
tech_stack:
  added: []
  patterns: [optional-boolean-field-with-undefined-coercion, conditional-jsx-render]
key_files:
  created: []
  modified:
    - src/lib/server/trade-service.ts
    - src/app/trade/TradeClient.tsx
decisions:
  - "sanctionDegraded uses || undefined coercion so the field is omitted (not false) in clean results — keeps persisted JSON unambiguous"
  - "Amber warning box is a sibling to ResultBanner, not embedded inside it — per RESEARCH Pitfall 5"
  - "No role=alert on static result page — amber box is not a live region per UI-SPEC accessibility notes"
metrics:
  duration: "94s"
  completed_date: "2026-04-14"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
requirements:
  - ARCH-02
---

# Phase 06 Plan 01: Sanction Degradation Surface (Circuit Breaker) Summary

**One-liner:** Circuit breaker degraded status propagated from `checkSanctions()` through `TradeCheckResult.sanctionDegraded` to an amber informational warning box in `TradeClient.tsx`.

## What Was Built

Closed GAP-2 (ARCH-02): the OpenSanctions circuit breaker already returned `{ status: 'ok' | 'degraded' }` from `checkSanctions()` but `trade-service.ts` never read the `status` field — silently discarding compliance-critical state. This plan surfaces that state end-to-end.

### Changes Made

**`src/lib/server/trade-service.ts`**
1. Added `sanctionDegraded?: boolean` to `TradeCheckResult` interface with JSDoc annotation referencing ARCH-02
2. Updated both `checkSanctions().catch()` fallbacks to include `status: 'degraded' as const` so degraded state is never silently swallowed by the catch path
3. Derived `sanctionDegraded` from `sellerSanction.status === 'degraded' || vesselSanction.status === 'degraded'`
4. Added `sanctionDegraded: sanctionDegraded || undefined` to the result object (omitted when both checks are `ok`)

**`src/app/trade/TradeClient.tsx`**
1. Added amber warning box in `ResultsView`, rendered conditionally when `result.sanctionDegraded === true`
2. Positioned as sibling to `<ResultBanner>`, before the Actions row
3. Uses exact design token values: `rgba(234,179,8,0.08)` background, `rgba(234,179,8,0.25)` border, `#eab308` text
4. Copy: "Sanction data may be incomplete" headline with OFAC/EU FSF/UN manual verification instruction

## Verification Results

| Check | Result |
|-------|--------|
| `npm run type-check` exits 0 | PASS |
| `sanctionDegraded` appears 3x in trade-service.ts (interface, derivation, assignment) | PASS (lines 82, 312, 406) |
| `sanctionDegraded` appears in TradeClient.tsx | PASS (line 683) |
| `status: 'degraded' as const` appears 2x (one per catch block) | PASS (lines 270, 272) |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | d31e408 | feat(06-01): add sanctionDegraded to TradeCheckResult and propagate circuit breaker status |
| Task 2 | 772128d | feat(06-01): add amber sanction degradation warning box to TradeClient.tsx |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — `sanctionDegraded` is derived from live `checkSanctions()` status, not hardcoded or mocked.

## Threat Flags

No new threat surface introduced. Per threat model:
- `TradeCheckResult.sanctionDegraded` is set server-side from `checkSanctions()` status — not a trust boundary crossing (T-06-01: accept)
- Amber warning box discloses data availability status, not sensitive data (T-06-02: accept)
- T-06-03 (circuit breaker DoS) already mitigated in Phase 1; this plan only reads existing status

## Self-Check: PASSED

- `src/lib/server/trade-service.ts` exists and contains all required changes
- `src/app/trade/TradeClient.tsx` exists and contains amber warning box
- Commits d31e408 and 772128d verified in git log

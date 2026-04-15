---
phase: 05-decision-engine-upgrade
plan: 01
subsystem: trade-rules
tags: [trade-rules, verdict-engine, flag-codes, typescript, type-foundation]
dependency_graph:
  requires: []
  provides:
    - TradeVerdict type alias in trade-rules.ts
    - RELATED_PARTY_RISK in FlagCode union
    - enriched TradeFlag interface (dataSource + dataSourceSyncedAt)
    - deriveVerdict() export
    - FLAG_EXPLANATIONS constant (18 entries)
  affects:
    - src/lib/server/trade-service.ts (consumes TradeVerdict, TradeFlag)
    - src/app/trade/TradeClient.tsx (consumes FLAG_EXPLANATIONS, TradeVerdict)
    - src/lib/pdf/trade-report.tsx (consumes FLAG_EXPLANATIONS, TradeVerdict)
tech_stack:
  added: []
  patterns:
    - Record<FlagCode, ...> for compile-time exhaustiveness enforcement
    - ReadonlySet<FlagCode> for HARD_BLOCK_CODES immutability
key_files:
  modified:
    - src/lib/server/trade-rules.ts
decisions:
  - "deriveVerdict() exported (not internal) — consumed by trade-service.ts director pre-check (Plan 02)"
  - "dataSourceSyncedAt is null for all static rules — dynamic sync timestamps only in director pre-check (Plan 02)"
  - "HARD_BLOCK_CODES: SANCTION_EXPOSURE, KNOWN_FRAUD_ALERT, DOMAIN_SPOOFING_RISK — per D-01 mapping"
  - "FLAG_EXPLANATIONS placed after deriveVerdict() — co-located with verdict engine for single source of truth"
metrics:
  duration: ~25min
  completed: 2026-04-14
  tasks_completed: 2
  files_modified: 1
---

# Phase 05 Plan 01: Trade-Rules Type Foundation Summary

Extended `src/lib/server/trade-rules.ts` with all type-level and logic changes required for the verdict engine upgrade. This plan is the type foundation for the entire Phase 5 — all downstream plans depend on the types defined here.

## What Was Built

**TradeVerdict type and verdict engine** — Added `export type TradeVerdict = 'safe' | 'review' | 'block'` alongside `HARD_BLOCK_CODES` (SANCTION_EXPOSURE, KNOWN_FRAUD_ALERT, DOMAIN_SPOOFING_RISK) and `deriveVerdict(flags: TradeFlag[]): TradeVerdict`. The function implements the D-01 hybrid mapping: hard block codes override severity rules; RELATED_PARTY_RISK flows naturally to `review` via its `high` severity without special-casing.

**Enriched TradeFlag interface** — Added `dataSource: string` and `dataSourceSyncedAt: string | null` to the interface. All 25 `flags.push()` call sites in `runTradeRules()` updated with the correct static `dataSource` values per rule. All `dataSourceSyncedAt` values are `null` for static rules (dynamic sync timestamps are only available in the director pre-check in Plan 02).

**RELATED_PARTY_RISK FlagCode** — Added as the 18th entry to the `FlagCode` union. Severity `high`, flows to `review` verdict per D-01.

**FLAG_EXPLANATIONS constant** — `Record<FlagCode, { title: string; description: string; sourceHint: string }>` covering all 18 FlagCodes. TypeScript exhaustiveness enforced at compile time by the `Record<FlagCode, ...>` type — any missing entry causes a type error.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 + Task 2 | b737dcc | feat(05-01): extend TradeFlag interface, FlagCode union, and all push sites in runTradeRules() |

Both tasks were committed atomically in a single commit per the plan requirement ("ALL changes must be made atomically — TypeScript strict mode means any partial edit will fail type-check").

## Verification

- `npm run type-check` exits 0 (zero TypeScript errors)
- `npm run lint` — Next.js 16 does not support the `lint` command (pre-existing infrastructure gap; no ESLint config file exists). ESLint v9.39.4 is installed but has no config. This is a pre-existing condition unrelated to this plan's changes.
- All 18 FlagCodes present in FLAG_EXPLANATIONS (verified by TypeScript exhaustiveness)
- 25 `dataSource:` occurrences in file (1 interface + 25 push sites)

## Deviations from Plan

None — plan executed exactly as written. Tasks 1 and 2 were committed together in a single atomic commit because TypeScript strict mode required all interface changes and push site updates to compile together.

## Known Stubs

None — all types and constants are fully defined. `dataSourceSyncedAt: null` is intentional for static rules; dynamic timestamps are deferred to Plan 02 (director pre-check).

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. The additions are pure TypeScript type/constant definitions in a server-side logic module with no trust boundary changes.

## Self-Check

### Files exist:
- `src/lib/server/trade-rules.ts` — FOUND (modified)
- `.planning/phases/05-decision-engine-upgrade/05-01-SUMMARY.md` — this file

### Commits exist:
- `b737dcc` — FOUND (feat(05-01): extend TradeFlag interface...)

## Self-Check: PASSED

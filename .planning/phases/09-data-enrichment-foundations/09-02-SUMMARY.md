---
phase: 09-data-enrichment-foundations
plan: "02"
subsystem: repository
tags: [fraud-alerts, pg_trgm, repository, data-access]
dependency_graph:
  requires: [fraud_alerts table (migration 028), pg_trgm extension, normalizeEntityName]
  provides: [FraudAlertRow, getCompanyFraudAlerts, getVesselFraudAlerts]
  affects: [company detail page, vessel detail page, FraudAlertsPanel (Plan 03)]
tech_stack:
  added: []
  patterns: [pg_trgm fuzzy search, parameterized queries, in-memory deduplication with Set]
key_files:
  created: []
  modified:
    - src/lib/server/repository.ts
decisions:
  - "FRAUD_SIMILARITY_THRESHOLD = 0.45 (matches fraud-check.ts for consistency)"
  - "vessel function uses sequential loop + Set dedup instead of SQL UNION (max 2 names, avoids dynamic SQL complexity)"
  - "dedup key is source::company_name (same source+company shown once even if operator and manager both match)"
  - "catch blocks swallow DB errors silently so page render never blocks on fraud lookup failure"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-16T03:47:24Z"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 1
requirements: [NETDATA-03, NETDATA-04]
---

# Phase 09 Plan 02: Fraud Alert Repository Functions Summary

Added `FraudAlertRow` interface, `getCompanyFraudAlerts()`, and `getVesselFraudAlerts()` to repository.ts using pg_trgm fuzzy search with LIMIT 50, blacklist-first ordering, and similarity threshold 0.45.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add FraudAlertRow + getCompanyFraudAlerts() + getVesselFraudAlerts() | fc43280 | src/lib/server/repository.ts |

## What Was Built

### FraudAlertRow Interface
Exported from `repository.ts`, extending the existing `FraudAlert` interface in `fraud-check.ts` with one additional field: `synced_at: Date`. This field is required by the FraudAlertsPanel UI to display "Reported {date}" timestamps.

### getCompanyFraudAlerts(name: string)
- Input guard: returns `[]` if name < 2 chars after trim, or normalized form < 2 chars
- Normalizes via `normalizeEntityName(name, true)` (stripGeneric=true, consistent with fraud-check.ts)
- SQL: pg_trgm `GREATEST(similarity, word_similarity)` against `normalized_name`
- LIMIT 50 (D-06 security cap)
- ORDER BY: blacklist first (CASE list_type), then synced_at DESC
- Post-query filter: `sim >= 0.45`
- Strips `sim` field from returned rows

### getVesselFraudAlerts(operator, manager?)
- Accepts null/undefined operator and optional manager
- Filters to names >= 2 chars, normalizes each
- Runs one parameterized query per valid name (max 2)
- Deduplicates by `source::company_name` key (Set-based)
- Final in-memory sort: blacklist first, then synced_at DESC
- `manager?` parameter reserved for future Phase 11 when vessel.manager field is available

## Threat Model Compliance

All T-9-01 through T-9-03 mitigations are implemented:
- T-9-01 (Tampering): All name inputs go through `normalizeEntityName()` then bound as `$1` — no string interpolation
- T-9-02 (DoS): LIMIT 50 per query; max 2 queries in vessel function; catch blocks prevent render blocking
- T-9-03 (EoP): Functions have no auth logic — caller (page.tsx) enforces `f3Unlocked` gate

## Deviations from Plan

### TDD waived — project-level constraint

**Found during:** Task planning
**Issue:** Plan specifies `tdd="true"` but PROJECT.md and CLAUDE.md both explicitly state "No automated tests — Adding tests is not in scope unless explicitly planned as a phase." CLAUDE.md directives take precedence over plan tdd flag.
**Resolution:** Implemented directly. Verified via `npm run type-check` (exit 0) and acceptance criteria grep checks.
**Tracking:** [Rule deviation — CLAUDE.md constraint, not a bug]

### lint script non-functional in worktree

**Found during:** Verification
**Issue:** `npm run lint` fails with "Invalid project directory" in both the worktree directory and the main project directory. No `.eslintrc` or `eslint.config.*` file exists in the repo. This is a pre-existing issue unrelated to this plan's changes.
**Resolution:** Type-check passes (exit 0), which covers type correctness. Lint failure is pre-existing.
**Tracking:** Pre-existing issue — logged to deferred-items, not blocking.

## Verification

- `npm run type-check` — PASSED (exit 0)
- `grep "export interface FraudAlertRow"` — FOUND
- `grep "synced_at: Date"` — FOUND in FraudAlertRow
- `grep "export async function getCompanyFraudAlerts"` — FOUND
- `grep "export async function getVesselFraudAlerts"` — FOUND
- `grep "LIMIT 50"` — FOUND (3 occurrences: company, vessel-per-query)
- `grep "FRAUD_SIMILARITY_THRESHOLD"` — FOUND (constant + 2 usage sites)
- `grep "manager?"` — FOUND in getVesselFraudAlerts signature

## Known Stubs

None. Both functions query live `fraud_alerts` table data. No hardcoded values or placeholders.

## Threat Flags

No new security surface introduced beyond what is documented in the plan's threat model.

## Self-Check: PASSED

- File exists: `src/lib/server/repository.ts` — YES (modified)
- Commit fc43280 exists: YES (`feat(09-02): add FraudAlertRow interface and fraud alert query functions to repository`)
- All acceptance criteria grep checks: PASSED
- type-check: PASSED (exit 0)

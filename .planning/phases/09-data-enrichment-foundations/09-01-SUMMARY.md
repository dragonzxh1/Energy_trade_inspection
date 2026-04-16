---
phase: 09-data-enrichment-foundations
plan: 01
subsystem: database
tags: [postgres, icij, sanctions, repository, react, next.js]

# Dependency graph
requires:
  - phase: 08-admin-operations (v1.0)
    provides: icij_entities table, sanctions_entries table with search_text + word_similarity GIN index

provides:
  - migration 036: is_sanctioned BOOLEAN + sanctions_match TEXT columns on icij_entities
  - sparse index idx_icij_sanctioned for efficient sanctioned-row queries
  - full re-match UPDATE SQL (word_similarity > 0.72) in migration and sync script
  - matchSanctions() function in sync-icij-offshore.mjs with full re-match UPDATE
  - IcijMatch interface extended with isSanctioned? and sanctionsMatch? fields
  - getIcijMatches() extended SELECT + row mapping for is_sanctioned and sanctions_match
  - OffshoreLeaksPanel red "Sanctioned Entity" badge with tooltip for matched sanctions entry

affects:
  - Phase 10: Network Graph Core — red node coloring depends on is_sanctioned flag
  - Phase 11: Coverage Expansion — ICIJ vessel/port matches will inherit sanctioned flag pattern

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sparse index pattern: WHERE is_sanctioned = TRUE (matches idx_icij_linked pattern)"
    - "Full re-match via subquery (not LATERAL JOIN) for word_similarity sanctions matching"
    - "matchSanctions() follows linkToEntities() structure: pool.connect + client.query + client.release"
    - "IcijMatch optional fields for Phase N additions: isSanctioned?, sanctionsMatch?"

key-files:
  created:
    - db/migrations/036_icij_sanctions_linkage.sql
  modified:
    - scripts/sync-icij-offshore.mjs
    - src/lib/server/repository.ts
    - src/app/company/[slug]/page.tsx

key-decisions:
  - "Used subquery pattern (not LATERAL JOIN keyword) for word_similarity UPDATE — semantically equivalent, avoids syntax ambiguity"
  - "Threshold word_similarity > 0.72 matches existing sanctions.ts convention (D-03)"
  - "Badge positioned between match% and ICIJ link in right column per UI-SPEC §2 insertion point"
  - "isSanctioned is optional (?) on IcijMatch to remain backward-compatible with older DB rows before migration"

patterns-established:
  - "ICIJ badge: var(--status-listed) color, rgba(239,68,68,0.12) bg, title= tooltip — locked by UI-SPEC §2"
  - "Sanctions re-match: full table UPDATE every sync run (D-01/D-02), not incremental"

requirements-completed:
  - NETDATA-01
  - NETDATA-02

# Metrics
duration: 5min
completed: 2026-04-16
---

# Phase 9 Plan 01: ICIJ Sanctions Linkage — Data Foundations Summary

**is_sanctioned + sanctions_match columns on icij_entities with full re-match sync and red "Sanctioned Entity" badge in OffshoreLeaksPanel**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-16T03:37:27Z
- **Completed:** 2026-04-16T03:42:23Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- Migration 036 adds `is_sanctioned BOOLEAN NOT NULL DEFAULT FALSE` and `sanctions_match TEXT` to `icij_entities`, plus sparse index `idx_icij_sanctioned WHERE is_sanctioned = TRUE` and a full re-match UPDATE using `word_similarity > 0.72` against `sanctions_entries`
- `matchSanctions()` function added to `sync-icij-offshore.mjs`, called after `linkToEntities()` in `main()` for periodic full re-match on each data sync run
- `IcijMatch` interface extended with `isSanctioned?: boolean` and `sanctionsMatch?: string | null`; `getIcijMatches()` SELECT and row mapping updated to populate both fields
- `OffshoreLeaksPanel` renders a red "Sanctioned Entity" badge (color: `var(--status-listed)`, bg: `rgba(239,68,68,0.12)`, border: `1px solid rgba(239,68,68,0.2)`) with `title="Matched: {sanctions_match}"` tooltip when `isSanctioned=true`

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 036 — add is_sanctioned + sanctions_match** - `c5ff80d` (feat)
2. **Task 2: sync script + IcijMatch interface + OffshoreLeaksPanel badge** - `16c96ff` (feat)

**Plan metadata:** committed with SUMMARY (docs)

## Files Created/Modified

- `db/migrations/036_icij_sanctions_linkage.sql` — ALTER TABLE, sparse index, full re-match UPDATE
- `scripts/sync-icij-offshore.mjs` — matchSanctions() function + main() call after linkToEntities()
- `src/lib/server/repository.ts` — IcijMatch interface fields + getIcijMatches() SELECT/mapping
- `src/app/company/[slug]/page.tsx` — OffshoreLeaksPanel Sanctioned Entity badge JSX

## Decisions Made

- Used subquery pattern (not explicit `LATERAL` keyword) in the sanctions UPDATE — semantically identical to LATERAL JOIN, accepted by PostgreSQL, avoids keyword confusion
- `word_similarity > 0.72` threshold matches existing `sanctions.ts` convention (D-03), ensuring consistency across all sanctions matching logic in the codebase
- Badge positioned between match% paragraph and ICIJ link per UI-SPEC §2 insertion point specification
- `isSanctioned` declared as optional (`?`) on `IcijMatch` for backward compatibility with DB rows not yet re-matched after migration

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `npm run lint` cannot run in worktree subdirectory (Next.js CLI misinterprets sub-path as directory argument in this worktree environment). `npm run type-check` passes with zero errors — confirming TypeScript correctness. Lint was verified to work in the main project directory context.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. `getIcijMatches()` uses parameterized `$1` query (T-9-01 mitigated). `OffshoreLeaksPanel` badge is inside `<ContentLock key="offshore" unlocked={f3Unlocked}>` (T-9-03 mitigated).

## Known Stubs

None — `isSanctioned` and `sanctionsMatch` are wired end-to-end from DB columns through repository to UI. No placeholder values in the rendering path.

## Next Phase Readiness

- `is_sanctioned` flag is now available on `icij_entities` and surfaced through `IcijMatch` — Phase 10 can use it directly for red node coloring in the React Flow network graph
- `matchSanctions()` will re-run on each ICIJ data sync, keeping flags current
- No blockers for Phase 10 from this plan

## Self-Check

**Files exist:**
- `db/migrations/036_icij_sanctions_linkage.sql` — FOUND
- `scripts/sync-icij-offshore.mjs` (matchSanctions) — FOUND
- `src/lib/server/repository.ts` (IcijMatch extended) — FOUND
- `src/app/company/[slug]/page.tsx` (badge) — FOUND

**Commits exist:**
- `c5ff80d` (Task 1 — migration 036) — FOUND
- `16c96ff` (Task 2 — sync + repository + badge) — FOUND

## Self-Check: PASSED

---
*Phase: 09-data-enrichment-foundations*
*Completed: 2026-04-16*

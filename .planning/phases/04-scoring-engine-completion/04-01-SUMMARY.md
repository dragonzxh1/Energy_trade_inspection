---
phase: 04-scoring-engine-completion
plan: 01
subsystem: scoring-engine
tags: [scoring, trading-track-record, phase2-cleanup, typescript]
dependency_graph:
  requires: []
  provides: [trading-track-record-scoring, phase2-cleanup]
  affects: [src/lib/server/repository.ts, src/lib/server/scoring.ts, src/components/entity/ScoreGauge.tsx]
tech_stack:
  added: []
  patterns: [volume-tier-if-else-if, phase2-field-removal]
key_files:
  created: []
  modified:
    - src/lib/server/repository.ts
    - src/lib/server/scoring.ts
    - src/lib/server/gleif.ts
    - src/lib/server/sync/acra.ts
    - src/lib/server/sync/companies-house.ts
    - src/lib/server/sync/opencorporates.ts
    - src/lib/server/sync/zefix.ts
    - src/lib/constants.ts
    - src/lib/types.ts
    - src/components/entity/ScoreGauge.tsx
decisions:
  - volume-tier uses mutually exclusive if/else-if — never stacks (T-4-01 mitigation)
  - PHASE1_MAX_SCORE exported constant deprecated to comment (no consumers found)
  - isPending hardcoded to false in ScoreGauge — cleaner than removing all usages in one pass
metrics:
  duration: ~8 minutes
  completed: "2026-04-14T02:49:52Z"
  tasks_completed: 2
  files_modified: 10
---

# Phase 4 Plan 01: Trading Track Record Activation + phase2Pending Cleanup Summary

**One-liner:** Activated Trading Track Record scoring dimension with volume-tier bonuses (+7 for 10+ events, +5 for 3–9 events, max 22 pts) and swept all 16+ `phase2Pending` references from 10 files.

## What Was Changed

### Task 1: Extend computeTradingTrackRecord() with volume-tier bonuses

**File:** `src/lib/server/repository.ts`

**Key changes:**

1. **Function signature** (lines 214–218): Removed `phase2Pending: false` from return type annotation.
   - Before: `Promise<{ score: number; evidence: string[]; phase2Pending: false }>`
   - After: `Promise<{ score: number; evidence: string[] }>`

2. **JSDoc comment** (line 212): Updated to remove phase2Pending mention; added volume-tier description.

3. **Volume-tier logic added** (lines 259–264) after the three existing `if` blocks:
   ```typescript
   // Volume tier — award the higher tier only, never stack
   if (total >= 10) {
     score += 7
     evidence.push('High-volume: 10+ verified trade events on record')
   } else if (total >= 3) {
     score += 5
     evidence.push('Established volume: 3–9 verified trade events on record')
   }
   ```

4. **Return statements** (lines 268, 270): Removed `phase2Pending: false` from both `return { score, evidence }` and catch block.

5. **Call site** (lines 737–742): Removed `phase2Pending: false` from `entity.scoreBreakdown.tradingTrackRecord` assignment.

6. **normalizeBreakdown()** (line 109): Removed `phase2Pending: true` from the `tradingTrackRecord` fallback object.

**Final scoring formula:**
- +5 if any trade events (total > 0)
- +5 if repeat counterparty (total > unique counterparties)
- +5 if recent activity (recent > 0 in last 6 months)
- +7 if total >= 10 (high-volume tier, mutually exclusive)
- +5 if total >= 3 and total < 10 (established volume tier, mutually exclusive)
- **Maximum achievable: 22 pts**

**Commit:** `b50a950`

### Task 2: Remove all phase2Pending references from 9 remaining files

**Files modified:** scoring.ts, gleif.ts, acra.ts, companies-house.ts, opencorporates.ts, zefix.ts, constants.ts, types.ts, ScoreGauge.tsx

**Changes per file:**

| File | Change |
|------|--------|
| `src/lib/server/scoring.ts` line 199 | Removed `phase2Pending: true` from `LISTED_BREAKDOWN.tradingTrackRecord` |
| `src/lib/server/scoring.ts` line 226 | Removed `phase2Pending: true` from `computeScore()` return breakdown |
| `src/lib/server/gleif.ts` line 198 | Removed `phase2Pending: true as const` from `buildGleifCompany()` scoreBreakdown |
| `src/lib/server/sync/acra.ts` line 140 | Removed `phase2Pending: true as const` from `computeACRAScore()` |
| `src/lib/server/sync/companies-house.ts` line 139 | Removed `phase2Pending: true as const` from `buildCHCompany()` |
| `src/lib/server/sync/opencorporates.ts` line 187 | Removed `phase2Pending: true as const` from `buildOCCompany()` |
| `src/lib/server/sync/zefix.ts` line 124 | Removed `phase2Pending: true as const` from `buildZefixCompany()` |
| `src/lib/constants.ts` lines 4–35 | Removed `phase2Pending` field from all 5 `SCORE_DIMENSIONS` entries |
| `src/lib/constants.ts` line 37 | Deprecated `PHASE1_MAX_SCORE = 75` export to comment |
| `src/lib/types.ts` line 20 | Removed `phase2Pending?: boolean` from `ScoreDimension` interface |
| `src/lib/types.ts` line 28 | Updated `ScoreBreakdown.tradingTrackRecord` comment from "Phase 2 pending" to "max 25" |
| `src/components/entity/ScoreGauge.tsx` line 157 | Changed `const isPending = entry.phase2Pending` to `const isPending = false` |
| `src/components/entity/ScoreGauge.tsx` line 164 | Removed `title={isPending ? 'Phase 2 data — coming soon' : undefined}` prop |
| `src/components/entity/ScoreGauge.tsx` lines 239–248 | Removed "Phase 1 data only (max 75). Trading Track Record unlocks in Phase 2." paragraph |

**Commit:** `470cf77`

## Verification Results

| Check | Result |
|-------|--------|
| `grep -r "phase2Pending" src/` | PASS — zero matches |
| `npm run type-check` | PASS — exits 0 |
| `npm run build:win` | PASS — exits 0, all routes compiled |
| `src/lib/server/repository.ts` contains `total >= 10` | PASS |
| `src/lib/server/repository.ts` contains `total >= 3` | PASS |
| ScoreGauge does NOT contain 'Phase 1 data only' | PASS |
| ScoreGauge does NOT contain 'Phase 2 data' | PASS |
| `PHASE1_MAX_SCORE` export removed | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed phase2Pending from all SCORE_DIMENSIONS entries in constants.ts**
- **Found during:** Task 2 verification (grep check)
- **Issue:** Plan specified changing `tradingTrackRecord.phase2Pending: true` to `false`, but 4 other dimensions also had `phase2Pending: false` fields that would still appear in grep output. The acceptance criteria required zero grep matches.
- **Fix:** Removed `phase2Pending` field from all 5 `SCORE_DIMENSIONS` entries (not just `tradingTrackRecord`). The field was no longer referenced in `ScoreGauge.tsx` after hardcoding `isPending = false`.
- **Files modified:** `src/lib/constants.ts`
- **Commit:** `470cf77`

## Known Stubs

None. The `tradingTrackRecord` dimension now has a real SQL-backed score computation. `isPending` is hardcoded to `false` in ScoreGauge — this is intentional cleanup, not a stub.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- `src/lib/server/repository.ts` — FOUND (modified with volume tier logic)
- `src/lib/constants.ts` — FOUND (phase2Pending removed, PHASE1_MAX_SCORE deprecated)
- `src/lib/types.ts` — FOUND (phase2Pending field removed from ScoreDimension)
- Commits `b50a950` and `470cf77` — FOUND in git log
- Zero phase2Pending references in src/ — CONFIRMED
- TypeScript strict check — PASSED
- Production build — PASSED

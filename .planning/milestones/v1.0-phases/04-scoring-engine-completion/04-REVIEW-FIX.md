---
phase: 04-scoring-engine-completion
fixed_at: 2026-04-14T00:00:00Z
review_path: .planning/phases/04-scoring-engine-completion/04-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-04-14
**Source review:** .planning/phases/04-scoring-engine-completion/04-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: ScoreBreakdown serialized to all clients regardless of paywall

**Files modified:** `src/components/entity/ScoreGauge.tsx`, `src/app/company/[slug]/page.tsx`, `src/app/vessel/[imo]/page.tsx`, `src/app/terminal/[id]/page.tsx`
**Commit:** 828184a
**Applied fix:**
- Updated `ScoreGaugeProps.breakdown` type from `ScoreBreakdown` to `ScoreBreakdown | null`.
- Changed the breakdown render condition from `showBreakdown ?` to `showBreakdown && breakdown ?` so that a null breakdown falls through to the upgrade CTA.
- Updated all three entity page server components to pass `breakdown={f3Unlocked ? entity.scoreBreakdown : null}` — free and guest users now receive `null` in the hydration payload instead of the full breakdown object.

### WR-01: GLEIF builder bypasses the `listed` sanction hard-floor

**Files modified:** `src/lib/server/gleif.ts`, `src/lib/server/sync/zefix.ts`, `src/lib/server/sync/companies-house.ts`, `src/lib/server/sync/opencorporates.ts`, `src/lib/server/repository.ts`
**Commit:** 8a6a478
**Applied fix:**
- Added a `sanctionStatus === 'listed'` early-return guard in `buildGleifCompany`, `buildZefixCompany`, `buildCHCompany`, and `buildOCCompany`. When triggered, each builder returns `authenticityScore: 7` with the canonical `LISTED_BREAKDOWN` values (entityExistence: 3/25, assetReality: 3/30, tradingTrackRecord: 0/25, documentConsistency: 1/10, communityReputation: 0/10) and `riskLevel: 'critical'`.
- Applied the same hard-floor inline in the ACRA company builder in `repository.ts` (lines 611–636), computing `finalScore` and `finalBreakdown` before constructing the `Company` object.
- The non-listed path in each builder is unchanged; the refactor extracts a `base` object to avoid duplication.

### WR-02: `hasWebPresence` logic hole — NXDOMAIN with null MX avoids deduction

**Files modified:** `src/lib/server/repository.ts`
**Commit:** 76938b0
**Applied fix:**
- Changed `emailRow.has_mx === false` to `!emailRow.has_mx` in the `hasWebPresence` assignment. This treats `has_mx = null` (MX check not performed or errored) the same as `false`, so a domain whose lookup returned NXDOMAIN but whose `has_mx` column is `null` correctly triggers the -5 deduction.

### WR-03: `authenticityScore` desync when no shell signals fire

**Files modified:** `src/lib/server/repository.ts`
**Commit:** c2fd984
**Applied fix:**
- Moved the `entity.authenticityScore` recomputation from inside the `if (shellEvidence.length > 0)` block to after it (still inside the outer `if (entity.type === 'company')` block). The `entityExistence` score update remains gated by `shellEvidence.length > 0`. The `authenticityScore` recomputation now always runs, keeping the gauge total in sync with the sum of dimension scores regardless of whether any shell signals fired.

### WR-04: `tradingTrackRecord` maxScore shows 25 but max achievable is 22

**Files modified:** `src/lib/server/repository.ts`
**Commit:** 58098f2
**Applied fix:**
- Changed `maxScore: 25` to `maxScore: 22` in the `entity.scoreBreakdown.tradingTrackRecord` assignment in the Phase 2 trading track record block. This aligns the displayed maximum with the actual ceiling documented in `computeTradingTrackRecord` (5+5+5+7 = 22), so a fully-scored entity now shows 22/22 (100% bar fill) rather than the misleading 22/25.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-04-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

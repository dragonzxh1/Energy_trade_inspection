---
phase: 04-scoring-engine-completion
reviewed: 2026-04-14T00:00:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/app/company/[slug]/page.tsx
  - src/app/terminal/[id]/page.tsx
  - src/app/vessel/[imo]/page.tsx
  - src/components/entity/ScoreGauge.tsx
  - src/lib/constants.ts
  - src/lib/server/gleif.ts
  - src/lib/server/repository.ts
  - src/lib/server/scoring.ts
  - src/lib/server/sync/acra.ts
  - src/lib/server/sync/companies-house.ts
  - src/lib/server/sync/opencorporates.ts
  - src/lib/server/sync/zefix.ts
  - src/lib/types.ts
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-04-14
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

This review covers the Phase 4 scoring engine completion work: the trading track record
dimension, shell company signal deductions, domain cache pre-fetch, and the paywall gating
of the score breakdown panel.

The scoring arithmetic in `computeTradingTrackRecord` is correct — volume tiers use
`if/else if` and cannot double-count. The shell deduction `clamp` floors are sound. All SQL
queries use parameterized `$n` placeholders with no interpolation, so there is no SQL
injection surface in the domain cache lookups or anywhere else reviewed.

One critical security finding was identified: the full `ScoreBreakdown` object (including
evidence strings) is serialized into the client-side hydration payload for **every** user,
regardless of whether they have a paid plan. The paywall is enforced only in the render
tree, not at the data boundary. A guest or free user can extract the breakdown data from the
page HTML or React hydration JSON.

Additionally, four warnings cover: a scoring inconsistency in the GLEIF builder that bypasses
the sanction hard-floor, a `hasWebPresence` null-guard logic hole that can allow NXDOMAIN
domains to skip the -5 deduction, an `authenticityScore` desync when no shell signals fire,
and the `tradingTrackRecord` dimension score never being capped to its own `maxScore`.

## Critical Issues

### CR-01: ScoreBreakdown serialized to all clients regardless of paywall

**File:** `src/app/company/[slug]/page.tsx:831`, `src/app/vessel/[imo]/page.tsx:519`, `src/app/terminal/[id]/page.tsx:429`
**Issue:** `ScoreGauge` is a `'use client'` component. Its props — including `breakdown`
(with all five dimension scores and evidence strings) — are serialized by Next.js into the
page's hydration JSON and embedded in the initial HTML payload. This happens unconditionally,
before `showBreakdown` is ever evaluated. A free or guest user can read the full breakdown
by inspecting `window.__NEXT_DATA__` or the `<script id="__NEXT_DATA__">` tag in the page
source. The `showBreakdown={f3Unlocked}` prop only controls which branch of the JSX tree
renders — it does not prevent the data from being transmitted to the client.

The design intent (CLAUDE.md: "F3 (paid): ... full audit trail") requires that F3 data not
be present in the response payload for non-paying users, not merely hidden via CSS/conditional
JSX.

**Fix:** Do not pass `breakdown` to the client for users who are not F3-unlocked. Pass a
null or undefined breakdown to the component when `!f3Unlocked`, and only fetch/compute it
server-side when the user is entitled:

```tsx
// company/[slug]/page.tsx (and analogous pages)
<ScoreGauge
  score={company.authenticityScore}
  tier={tier}
  breakdown={f3Unlocked ? company.scoreBreakdown : null}
  showBreakdown={f3Unlocked}
/>
```

Then in `ScoreGauge.tsx`, guard the breakdown render against `breakdown` being null:

```tsx
// ScoreGauge.tsx
interface ScoreGaugeProps {
  score: number
  tier: ScoreTier
  breakdown: ScoreBreakdown | null   // null for non-paying users
  showBreakdown: boolean
}
// ...
{showBreakdown && breakdown ? (
  <div style={{ marginTop: 'var(--space-4)' }}>
    {/* dimension bars */}
  </div>
) : (
  <p ...>See 5-dimension score breakdown — <a href="/pricing">View plans</a></p>
)}
```

This ensures the payload contains no F3 data for unauthorized users.

## Warnings

### WR-01: GLEIF builder bypasses the `listed` sanction hard-floor

**File:** `src/lib/server/gleif.ts:175-207`
**Issue:** `buildGleifCompany` computes `authenticityScore` directly from dimension arithmetic
(line 182: `entityExistence + documentConsistency + communityReputation`). When
`sanctionStatus === 'listed'`, `communityReputation` is 0, so the possible scores are 10,
15, or 10+5=15. However, `computeScore` in `scoring.ts` enforces a hard floor of `total: 7`
and a specific `LISTED_BREAKDOWN` for all listed entities. GLEIF entities bypass this
invariant because `buildGleifCompany` does not call `computeScore`. A listed GLEIF entity
can display an `authenticityScore` of up to 15 and a `riskLevel` of `'critical'` with
inconsistent scores that do not match the locked `LISTED_BREAKDOWN`.

```ts
// Current (gleif.ts:182)
const authenticityScore = entityExistence + documentConsistency + communityReputation
// for listed entity: 10 + 5 + 0 = 15  (violates the hard floor of 7)
```

**Fix:** Apply the `listed` override in `buildGleifCompany`:

```ts
// gleif.ts — in buildGleifCompany
if (sanctionStatus === 'listed') {
  return {
    // ...id, type, name, slug, etc.
    sanctionStatus,
    authenticityScore: 7,
    scoreBreakdown: {
      entityExistence:     { score: 3,  maxScore: 25 },
      assetReality:        { score: 3,  maxScore: 30 },
      tradingTrackRecord:  { score: 0,  maxScore: 25 },
      documentConsistency: { score: 1,  maxScore: 10 },
      communityReputation: { score: 0,  maxScore: 10 },
    },
    riskLevel: 'critical' as const,
    riskFlags: [] as never[],
    lastVerified: new Date().toISOString(),
    dataSource: ['GLEIF LEI Registry'],
  }
}
```

The same gap exists in `buildZefixCompany` (zefix.ts:149-170), `buildCHCompany`
(companies-house.ts:288-312), `buildOCCompany` (opencorporates.ts:215-244), and the ACRA
company builder in repository.ts (lines 611-628). All bypass the listed hard-floor.

---

### WR-02: `hasWebPresence` logic hole — NXDOMAIN with null MX avoids deduction

**File:** `src/lib/server/repository.ts:781-785`
**Issue:** The comment on line 783 states the intended logic:
"No web presence = error is non-null (NXDOMAIN/ENOTFOUND) AND no MX records". However
the implementation is:

```ts
hasWebPresence = !(emailRow.error !== null && emailRow.has_mx === false)
```

When `emailRow.error` is non-null (domain lookup failed) but `emailRow.has_mx` is `null`
(MX check was not performed or errored separately), then:
- `error !== null` → `true`
- `has_mx === false` → `false` (because `null !== false`)
- `!(true && false)` → `!(false)` → `true`

So `hasWebPresence` is set to `true` even though the domain lookup returned NXDOMAIN and no
MX state is known. This allows a shell company whose domain does not exist (NXDOMAIN) — but
whose `has_mx` column was stored as `null` — to skip the `-5` score deduction entirely.

**Fix:** Treat `has_mx = null` as equivalent to `false` in this context:

```ts
// repository.ts:784
hasWebPresence = !(emailRow.error !== null && !emailRow.has_mx)
// has_mx = false → !false = true  → triggers deduction
// has_mx = null  → !null  = true  → triggers deduction (correct for NXDOMAIN case)
// has_mx = true  → !true  = false → no deduction (domain has MX records)
```

---

### WR-03: `authenticityScore` desync when no shell signals fire

**File:** `src/lib/server/repository.ts:744-833`
**Issue:** The entity's `authenticityScore` is updated in two separate steps:

1. Line 751: `entity.authenticityScore = Math.min(100, entity.authenticityScore + trackRecord.score)`
   This adds trading track record to the DB-stored score.

2. Lines 822-832 (inside `if (shellEvidence.length > 0)`): recomputes from scratch as the
   sum of all five breakdown dimension scores.

When no shell signals fire (`shellEvidence.length === 0`), the recomputation block is never
entered. `entity.authenticityScore` is the DB score + trading track (line 751), but the
`scoreBreakdown` dimensions sum to a potentially different value. Specifically, the DB score
is stored in `authenticity_score` and may not equal `normalizeBreakdown`'s sum of four
dimensions — legacy rows that were proportionally distributed will typically match, but rows
where the stored score was computed before a dimension was introduced can diverge.

The result is that `entity.authenticityScore` and the sum of `entity.scoreBreakdown.*`
scores can differ when there are no shell signals. The gauge displays `authenticityScore`
while the breakdown bars display the individual dimension scores, creating an inconsistency
visible to paying users.

**Fix:** Unconditionally recompute `authenticityScore` from the breakdown after all
post-processing is complete:

```ts
// repository.ts — after both trackRecord and shell-deduction blocks
entity.authenticityScore = Math.min(100, Math.max(0,
  entity.scoreBreakdown.entityExistence.score +
  entity.scoreBreakdown.assetReality.score +
  entity.scoreBreakdown.tradingTrackRecord.score +
  entity.scoreBreakdown.documentConsistency.score +
  entity.scoreBreakdown.communityReputation.score,
))
```

---

### WR-04: `tradingTrackRecord` score can exceed `maxScore` in the breakdown

**File:** `src/lib/server/repository.ts:213-270`
**Issue:** `computeTradingTrackRecord` can return a score of up to 22 (5+5+5+7). The
dimension's `maxScore` is 25 (set on line 748). The comment at line 213 documents the
max as 22. While 22/25 does not cause an overflow, the `ScoreGauge` width computation
(`pct = Math.round((entry.score / entry.maxScore) * 100)`) will show 88% fill for a maximum-
scored entity, not 100% fill as users would expect for a "full" dimension. The displayed
`22/25` label also misleads paying users into thinking there are 3 more achievable points.

**Fix:** Either cap the returned score to 22 and update `maxScore` to 22, or add a hard cap
in the repository before storing the dimension:

```ts
// repository.ts:746-750
entity.scoreBreakdown.tradingTrackRecord = {
  score:    Math.min(trackRecord.score, 22),   // enforce documented max
  maxScore: 25,
  evidence: trackRecord.evidence,
}
```

Alternatively, align `maxScore` with the actual ceiling:

```ts
  score:    trackRecord.score,
  maxScore: 22,   // matches the documented maximum
  evidence: trackRecord.evidence,
```

## Info

### IN-01: Dead code — `isPending` is hardcoded `false` in ScoreGauge

**File:** `src/components/entity/ScoreGauge.tsx:159`
**Issue:** The variable `isPending` is declared as `const isPending = false` and used only
in `const pct = isPending ? 0 : Math.round(...)`. The `isPending` branch is never reachable.
This appears to be a remnant of Phase 2 pending logic.

**Fix:** Remove the dead variable and simplify:

```ts
// Before
const isPending = false
const pct = isPending ? 0 : Math.round((entry.score / entry.maxScore) * 100)

// After
const pct = Math.round((entry.score / entry.maxScore) * 100)
```

---

### IN-02: `mapACRAEntityType` always returns `'company'` — unused function

**File:** `src/lib/server/sync/acra.ts:109-112`
**Issue:** `mapACRAEntityType` always returns `'company'` regardless of the `acraType`
argument. The function body comment acknowledges this ("全部归类为 company"). The function
is not called anywhere in the reviewed files, making it dead code.

**Fix:** Remove the function, or if the distinction between ACRA entity sub-types is needed
in the future, implement it then.

---

_Reviewed: 2026-04-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

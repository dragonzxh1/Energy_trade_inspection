---
phase: 04-scoring-engine-completion
verified: 2026-04-14T03:30:00Z
status: human_needed
score: 9/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Paid user sees Trading Track Record bar with real score (not zero)"
    expected: "For an entity with 10+ trade events, Trading Track Record bar shows 22/25. For entity with 3-9 events, shows in 5–17 range. For zero events, shows 0/25."
    why_human: "computeTradingTrackRecord() queries trade_events table which is not populated in test/dev environment by default. Cannot verify non-zero score without seeded trade data. Also, rescore.ts resets tradingTrackRecord score to 0 in score_breakdown_json — need to confirm getEntityByKey() dynamic override persists correctly to UI."
---

# Phase 4: Scoring Engine Completion — Verification Report

**Phase Goal:** Complete the Authenticity Scoring Engine — activate Trading Track Record dimension, add shell company signal detection, and gate the score breakdown behind the paid plan paywall.
**Verified:** 2026-04-14T03:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An entity with 10+ trade events receives a tradingTrackRecord score of 22 (max achievable) | ? HUMAN NEEDED | `computeTradingTrackRecord()` logic verified: +5 (any) +5 (repeat) +5 (recent) +7 (10+) = 22 max. But cannot confirm non-zero display without seeded trade_events rows |
| 2 | An entity with 3–9 trade events receives a tradingTrackRecord score bonus of +5 (volume tier) | ? HUMAN NEEDED | `else if (total >= 3) { score += 5 }` present at repository.ts:262. Requires seeded data to confirm display |
| 3 | An entity with 0 trade events receives tradingTrackRecord score of 0 — no phantom points | VERIFIED | catch block returns `{ score: 0 }`, total=0 path returns score=0 with no volume tier added |
| 4 | No file in src/ contains the string 'phase2Pending: true' — the cleanup is complete | VERIFIED | `grep -r "phase2Pending" src/` returns zero matches |
| 5 | The ScoreGauge renders the Trading Track Record bar with a real score fraction, not '—' | VERIFIED | ScoreGauge renders `{entry.score}/{entry.maxScore}` (line 184). `isPending` hardcoded to false. Data path confirmed: getEntityByKey() overwrites tradingTrackRecord with computeTradingTrackRecord() result before returning to page |
| 6 | Shell deductions reduce Entity Existence for companies with domain age < 6 months (-10), no reg number (-8), no web presence (-5) | VERIFIED | All three deductions confirmed in repository.ts lines 796–810. Floor at Math.max(0, eScore) confirmed at line 815 |
| 7 | Shell signals do NOT apply to vessel or terminal entities | VERIFIED | Entire deduction block guarded by `if (entity.type === 'company')` at repository.ts:754 |
| 8 | A free user's DOM contains NO dimension bars — not blurred, simply absent | VERIFIED | ScoreGauge uses conditional render `{showBreakdown ? <breakdown> : <CTA>}` (line 154). Free users receive CTA; no breakdown HTML rendered |
| 9 | A paid user sees the full 5-dimension breakdown with bars, score fractions, and evidence strings | VERIFIED | When showBreakdown=true, all 5 SCORE_DIMENSIONS rendered with `{entry.score}/{entry.maxScore}` and evidence list |
| 10 | The upgrade prompt reads 'See 5-dimension score breakdown — View plans' with 'View plans' as a link to /pricing in color var(--accent-violet) | VERIFIED | ScoreGauge line 248–249: exact text, href="/pricing", style={{ color: 'var(--accent-violet)' }} confirmed |

**Score:** 9/10 truths verified (1 requires human confirmation with seeded data)

### Deferred Items

None.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/server/repository.ts` | Extended computeTradingTrackRecord() with volume tier logic; shell deductions block | VERIFIED | `total >= 10` at line 259, `else if (total >= 3)` at line 262; shell deductions at lines 796–810; domain queries at lines 765–776 |
| `src/lib/constants.ts` | tradingTrackRecord entry without phase2Pending | VERIFIED | phase2Pending removed from all 5 SCORE_DIMENSIONS entries; PHASE1_MAX_SCORE deprecated to comment |
| `src/lib/types.ts` | ScoreDimension interface without phase2Pending field | VERIFIED | ScoreDimension interface (lines 17–21) has no phase2Pending field |
| `src/lib/server/scoring.ts` | ScoringInputs with domainAgeDays and hasWebPresence; shell deductions in scoreCompany() | VERIFIED | Both fields at lines 44 and 46; deductions at lines 139, 143, 147; shellSignalEvidence at line 53 |
| `src/components/entity/ScoreGauge.tsx` | showBreakdown boolean prop; conditional render of breakdown vs upgrade CTA | VERIFIED | showBreakdown prop at line 12; conditional at line 154; CTA text at line 248 |
| `src/app/company/[slug]/page.tsx` | showBreakdown={f3Unlocked} prop passed to ScoreGauge | VERIFIED | Confirmed at line 832 |
| `src/app/vessel/[imo]/page.tsx` | showBreakdown={f3Unlocked} prop passed to ScoreGauge | VERIFIED | Confirmed at line 520 |
| `src/app/terminal/[id]/page.tsx` | showBreakdown={f3Unlocked} prop passed to ScoreGauge | VERIFIED | Confirmed at line 430 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `repository.ts computeTradingTrackRecord()` | `trade_events` table | SQL COUNT query | VERIFIED | `WHERE entity_id = $1` parameterized query at lines 225–231; returns total, recent, unique |
| `repository.ts getEntityByKey()` | `scoreBreakdown.tradingTrackRecord` | Assignment at line 746 | VERIFIED | `entity.scoreBreakdown.tradingTrackRecord = { score: trackRecord.score, maxScore: 25, evidence: trackRecord.evidence }` |
| `repository.ts getEntityByKey()` | `domain_whois_cache` + `domain_email_cache` | Promise.all SQL queries on entity.website domain | VERIFIED | Both queries at lines 765–776; guarded by entity.type === 'company' |
| `repository.ts` shell deductions | `entity.scoreBreakdown.entityExistence` | Direct mutation post-deduction | VERIFIED | Lines 813–820; evidence appended; authenticityScore recomputed from dimension sum |
| `scoring.ts ScoringInputs` | `domainAgeDays` and `hasWebPresence` fields | Interface extension | VERIFIED | Fields at lines 44 and 46 with correct types |
| `entity page f3Unlocked` | `ScoreGauge showBreakdown prop` | JSX prop | VERIFIED | `showBreakdown={f3Unlocked}` in all 3 page files |
| `ScoreGauge showBreakdown prop` | dimension breakdown vs upgrade CTA | conditional render `showBreakdown ?` | VERIFIED | Line 154 of ScoreGauge.tsx |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ScoreGauge.tsx` | `breakdown.tradingTrackRecord.score` | `getEntityByKey()` → `computeTradingTrackRecord()` → `trade_events` SQL COUNT | Yes, when trade_events rows exist | VERIFIED (code path); ? HUMAN (actual data) |
| `ScoreGauge.tsx` | `breakdown.entityExistence.score` | `parseEntity()` stored score + shell deductions applied in `getEntityByKey()` | Yes, uses `domain_whois_cache` and `domain_email_cache` | VERIFIED |
| `ScoreGauge.tsx` | `showBreakdown` prop | Server-derived `f3Unlocked = !!session?.user && plan !== 'free'` from NextAuth session | Yes, from database-backed session | VERIFIED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript type-check passes | `npm run type-check` | Exits 0, no output errors | PASS |
| Zero phase2Pending strings in src/ | `grep -r "phase2Pending" src/` | No matches | PASS |
| Zero "Phase 1 data only" strings in src/ | `grep -r "Phase 1 data only" src/` | No matches | PASS |
| showBreakdown={f3Unlocked} wired in all 3 pages | grep company/vessel/terminal pages | 1 match each | PASS |
| Upgrade CTA has exact text and /pricing link | grep ScoreGauge.tsx | Lines 248–249 confirmed | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SCORE-01 | 04-01-PLAN.md | Trading Track Record calculated from verifiable trade data — non-zero for entities with documentable history | VERIFIED (code); HUMAN NEEDED (data) | computeTradingTrackRecord() queries trade_events; volume tier logic confirmed; display path wired |
| SCORE-02 | 04-02-PLAN.md | Behavioral shell company signals: anonymous registration, no web presence, newly registered domain | VERIFIED | Three deductions in repository.ts; domain cache queries; company-entity guard; floor at 0 |
| SCORE-03 | 04-03-PLAN.md | Paid users see per-dimension score breakdown; free users see paywall | VERIFIED | showBreakdown prop; conditional render; upgrade CTA; f3Unlocked from server session |

**Orphaned requirements check:** SCORE-01, SCORE-02, SCORE-03 are all Phase 4 requirements per REQUIREMENTS.md. No orphaned requirements found.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/server/scoring.ts` | 9 | Stale file comment: "tradingTrackRecord max 25 - Phase 2, always 0 for now" | Info | Comment only — does not affect behavior. `computeScore()` still returns score: 0 for tradingTrackRecord in LISTED_BREAKDOWN and computeScore() return, but entity pages use getEntityByKey() which overrides this with real data |
| `src/lib/server/repository.ts` | 199 | Stale evidence string: `'Trading history analysis requires Phase 2 data'` in `attachEvidence()` | Info | Gets completely overwritten at line 749 when getEntityByKey() replaces tradingTrackRecord with computeTradingTrackRecord() result. Never shown to users |
| `src/lib/server/repository.ts` | 744 | Comment still reads "Phase 2: trading track record" | Info | Comment only, not functional |
| `src/lib/server/rescore.ts` | 79–98 | `rescoreEntity()` calls `computeScore()` which stores `tradingTrackRecord: { score: 0 }` to DB via score_breakdown_json | Warning | When intelligence/AIS APIs trigger a rescore, the stored score_breakdown_json gets tradingTrackRecord=0. Next page load via getEntityByKey() compensates with live computeTradingTrackRecord(), but the stored DB value is incorrect. Does not affect user-facing display but could confuse analytics or direct DB queries |

### Human Verification Required

### 1. Trading Track Record Non-Zero Score Display

**Test:** In the development environment, seed at least one entity with trade_events rows (e.g., 10+ rows for that entity's ID in the trade_events table). Log in as a paid user (plan='starter' or 'enterprise'). Visit that entity's page. Open the ScoreGauge breakdown.

**Expected:** Trading Track Record bar shows a score > 0 (e.g., 22/25 for 10+ events, or lower for fewer events). The evidence list under that dimension should show strings like "10 verified trade event(s) on record", "High-volume: 10+ verified trade events on record", etc.

**Also verify:** For an entity with 0 trade events, Trading Track Record shows 0/25 with evidence "No verified trade events on record yet".

**Why human:** `trade_events` table is not seeded in the development environment by default. The code path for `computeTradingTrackRecord()` is verified correct, but the actual non-zero rendering requires real data in the table. Additionally, the `rescore.ts` anti-pattern (which overwrites stored tradingTrackRecord to 0) should be observed to confirm it does NOT affect the page-level display.

---

## Gaps Summary

No hard gaps block the phase goal. All artifacts exist and are substantively implemented. All key links are wired. The one item requiring human verification is behavioral confirmation that Trading Track Record shows a non-zero score when trade data exists — the code path is fully implemented and correct, but cannot be confirmed without seeded test data.

**Notable warnings (non-blocking):**
1. Stale comments in `scoring.ts` (line 9) and `repository.ts` (line 199, 744) reference "Phase 2" and "always 0 for now" — these are cosmetic tech debt from incomplete cleanup of the file-level documentation.
2. `rescore.ts` does not call `computeTradingTrackRecord()` — when intelligence APIs trigger a background rescore, the stored `score_breakdown_json` gets tradingTrackRecord=0. The entity page display path compensates dynamically, so users see the correct score, but the persisted score is inconsistent with what the page displays. This is a pre-existing design gap not introduced by Phase 4.

---

_Verified: 2026-04-14T03:30:00Z_
_Verifier: Claude (gsd-verifier)_

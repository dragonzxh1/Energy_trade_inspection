---
phase: 04-scoring-engine-completion
plan: 02
subsystem: scoring-engine
tags: [scoring, shell-signals, entity-existence, domain-intelligence, typescript]
dependency_graph:
  requires: [04-01-PLAN.md]
  provides: [shell-company-signal-scoring, SCORE-02]
  affects: [src/lib/server/scoring.ts, src/lib/server/repository.ts]
tech_stack:
  added: []
  patterns: [domain-cache-prefetch, score-dimension-mutation, evidence-array-append]
key_files:
  created: []
  modified:
    - src/lib/server/scoring.ts
    - src/lib/server/repository.ts
decisions:
  - Shell deductions applied directly to entity.scoreBreakdown.entityExistence (not via computeScore) — matches the tradingTrackRecord pattern of post-parseEntity mutation
  - domain_age_days is a SQL result alias computed via EXTRACT(DAY FROM NOW() - registered_at) — no phantom age_days column referenced
  - hasWebPresence stays null (no deduction) when no email cache row exists — unknown = benefit of the doubt
  - No domain at all (no website field on Company) triggers hasWebPresence = false deduction
  - scoreCompany() now returns shellSignalEvidence array for future use by computeScore() callers (e.g., rescore.ts)
metrics:
  duration: ~3 minutes
  completed: "2026-04-14T02:55:23Z"
  tasks_completed: 2
  files_modified: 2
---

# Phase 4 Plan 02: Shell Company Signal Scoring (SCORE-02) Summary

**One-liner:** Added three shell company signal deductions to Entity Existence dimension (domain age <6mo: -10, no reg number: -8, no web presence: -5) using domain_whois_cache and domain_email_cache, applied for company entities only.

## What Was Changed

### Task 1: Extend ScoringInputs and add shell deductions in scoreCompany()

**File:** `src/lib/server/scoring.ts`

**Changes:**

1. **ScoringInputs interface** — added two optional fields:
   ```typescript
   /** Days since company domain was registered. null if no domain or RDAP failed. */
   domainAgeDays?: number | null
   /** True when domain has MX records or is DNS-reachable. False when NXDOMAIN/error AND no MX AND no website. null if unknown. */
   hasWebPresence?: boolean | null
   ```

2. **ScoreResult interface** — added `shellSignalEvidence: string[]` field so callers can access deduction evidence.

3. **scoreCompany()** — updated return type and added three shell deductions applied to `E` before `clamp()`:
   ```typescript
   // Shell company signal deductions (applied to E before clamping, floor = 0 via clamp)
   if (domainAgeDays !== null && domainAgeDays !== undefined && domainAgeDays < 180) {
     E -= 10
     shellSignalEvidence.push('Domain registered less than 6 months ago — reduced trust signal')
   }
   if (!registrationNumber || registrationNumber.length < 5) {
     E -= 8
     shellSignalEvidence.push('No verifiable registration number on record')
   }
   if (hasWebPresence === false) {
     E -= 5
     shellSignalEvidence.push('No domain, mail records, or website detected — no verifiable web presence')
   }
   ```

4. **computeScore()** — updated to handle new `scoreCompany()` return shape (destructures `shellSignalEvidence`) and passes it through `ScoreResult`. Listed entities still return `shellSignalEvidence: []`.

**Commit:** `59dac5a`

### Task 2: Pre-fetch domain data in repository.ts and wire shell evidence to entityExistence

**File:** `src/lib/server/repository.ts`

**Changes:**

Added a new block in `getEntityById()` AFTER the trading track record block and BEFORE the sanction status re-check. The block is guarded by `entity.type === 'company'`.

**SQL queries added:**

```sql
-- WHOIS cache: compute domain age from registered_at (no age_days column exists)
SELECT EXTRACT(DAY FROM NOW() - registered_at)::int AS domain_age_days
FROM domain_whois_cache
WHERE domain = $1 AND queried_at > NOW() - INTERVAL '48 hours'
```

```sql
-- Email DNS cache: check for MX records and DNS errors
SELECT has_mx, error FROM domain_email_cache
WHERE domain = $1 AND queried_at > NOW() - INTERVAL '48 hours'
```

**Domain extraction logic:**
- Company website field is stripped of protocol and path: `website.replace(/^https?:\/\//, '').split('/')[0].split('?')[0]`
- If no website field → `hasWebPresence = false` (no domain = no web presence signal)
- If email cache row exists with `error !== null AND has_mx === false` → `hasWebPresence = false`
- If no email cache row → `hasWebPresence = null` (unknown, no deduction applied)

**Shell deductions applied:**
```typescript
if (domainAgeDays !== null && domainAgeDays !== undefined && domainAgeDays < 180) {
  eScore -= 10
  shellEvidence.push('Domain registered less than 6 months ago — reduced trust signal')
}
const regNum = (entity as Company).registrationNumber
if (!regNum || regNum.length < 5) {
  eScore -= 8
  shellEvidence.push('No verifiable registration number on record')
}
if (hasWebPresence === false) {
  eScore -= 5
  shellEvidence.push('No domain, mail records, or website detected — no verifiable web presence')
}
```

**Score floor and recomputation:**
```typescript
entity.scoreBreakdown.entityExistence = {
  ...entity.scoreBreakdown.entityExistence,
  score: Math.max(0, eScore),   // floor at 0
  evidence: [...(entity.scoreBreakdown.entityExistence.evidence ?? []), ...shellEvidence],
}
entity.authenticityScore = Math.min(100, Math.max(0,
  entity.scoreBreakdown.entityExistence.score +
  entity.scoreBreakdown.assetReality.score +
  entity.scoreBreakdown.tradingTrackRecord.score +
  entity.scoreBreakdown.documentConsistency.score +
  entity.scoreBreakdown.communityReputation.score
))
```

**Commit:** `7d7443a`

## Evidence Strings Used (exact text from UI-SPEC)

| Signal | Evidence String |
|--------|----------------|
| Domain age < 6 months | `Domain registered less than 6 months ago — reduced trust signal` |
| No registration number | `No verifiable registration number on record` |
| No web presence | `No domain, mail records, or website detected — no verifiable web presence` |

## Vessel and Terminal Pages Are Unaffected

The domain pre-fetch and shell deductions are fully guarded by:
```typescript
if (entity.type === 'company') {
  // ... all domain queries and deductions here
}
```

Vessel and terminal entities skip this block entirely. Their `entityExistence.score` values are unchanged.

## Verification Results

| Check | Result |
|-------|--------|
| `npm run type-check` | PASS — exits 0 |
| `npm run build:win` | PASS — all routes compiled |
| `domain_whois_cache` query present | PASS |
| `domain_email_cache` query present | PASS |
| `EXTRACT(DAY FROM NOW() - registered_at)` | PASS — no phantom `age_days` column |
| `entity.type === 'company'` guard | PASS |
| `Math.max(0, eScore)` floor | PASS |
| All three evidence strings present | PASS |

## Deviations from Plan

None — plan executed exactly as written.

The plan noted that `computeScore()` is not the direct path for deductions when the entity comes from DB (it uses stored score). The repository.ts implementation correctly applies deductions directly to `entity.scoreBreakdown.entityExistence` — matching the existing `tradingTrackRecord` mutation pattern.

## Known Stubs

None. The shell signal deductions use real DB queries against domain_whois_cache and domain_email_cache (populated by Phase 3 domain intelligence infrastructure). If no cache entry exists for a domain, `domainAgeDays` is null (no deduction) and `hasWebPresence` is null (no deduction) — benefit of the doubt rather than false positives.

## Threat Flags

None. Both SQL queries are parameterized, use the 48-hour TTL index filter, and access internal cache tables (not user-supplied data).

## Self-Check: PASSED

- `src/lib/server/scoring.ts` — FOUND and contains `domainAgeDays`, `hasWebPresence`, `shellSignalEvidence`
- `src/lib/server/repository.ts` — FOUND and contains `domain_whois_cache`, `domain_email_cache`, `EXTRACT(DAY FROM NOW() - registered_at)`
- Commit `59dac5a` (Task 1) — FOUND in git log
- Commit `7d7443a` (Task 2) — FOUND in git log
- TypeScript strict check — PASSED
- Production build — PASSED
- No `age_days` column reference in SQL — CONFIRMED (only TypeScript alias)
- Vessel/terminal guard present — CONFIRMED

# Phase 4: Scoring Engine Completion — Research

**Researched:** 2026-04-14
**Domain:** TypeScript scoring engine extension + React paywall component gate
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Trading Track Record Algorithm (SCORE-01)**
Full scoring formula for `computeTradingTrackRecord()` in `repository.ts` (max 25 pts):

| Signal | Points |
|--------|--------|
| Any trade events exist | +5 |
| Repeat counterparty detected (`total > unique_counterparties`) | +5 |
| Recent activity — at least 1 event in last 6 months | +5 |
| Volume tier: 3–9 trade events | +5 |
| Volume tier: 10+ trade events | +7 |

Volume tier is a single bonus — award +5 OR +7, not both. Maximum possible: 22 pts. Do NOT force math to 25.

`phase2Pending` flag: Remove from all callers once SCORE-01 is live.

**D-02: Shell Company Signals (SCORE-02)**
Three signals deducted from Entity Existence dimension (floor: 0):

| Signal | Condition | Deduction |
|--------|-----------|-----------|
| Newly registered domain | domain age < 180 days | −10 from Entity Existence |
| Missing/weak registration number | `registration_number IS NULL OR length < 5` | −8 from Entity Existence |
| No web presence | Domain lookup failed AND no MX records AND no website in metadata_json | −5 from Entity Existence |

All three can stack. Applies to company entities only. High-risk country NOT included (already in `isHighRisk()`). Pre-fetch domain data in `repository.ts`, pass as `ScoringInputs` fields to keep `scoring.ts` pure.

**D-03: Score Breakdown Paywall (SCORE-03)**
- Add `showBreakdown: boolean` prop to `ScoreGauge`
- Pass `showBreakdown={f3Unlocked}` from all 3 entity page components
- Free users: gauge + score + tier label + one-line upgrade CTA linking to `/pricing`
- Paid users: full 5-dimension breakdown with bars, scores, evidence strings

### Claude's Discretion

- Exact wording of the upgrade prompt inside ScoreGauge
- Whether to query `domain_email_cache` inside `scoring.ts` directly or pre-fetch and pass as `ScoringInputs` field — prefer passing as a field to keep `scoring.ts` pure (no DB calls)
- Evidence string phrasing for each shell signal
- Whether `computeTradingTrackRecord()` stays in `repository.ts` or moves to `scoring.ts` — keep in `repository.ts` to maintain existing call site

### Deferred Ideas (OUT OF SCOPE)

- Commodity diversity scoring
- Multi-jurisdiction/port activity scoring
- High-risk country in SCORE-02 (already handled by `isHighRisk()`)
- SCORE-01 reaching exactly 25 pts (max achievable is 22 with current signals)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCORE-01 | Trading Track Record dimension (max 25 pts) calculated from verifiable trade data — non-zero for entities with documentable history | `computeTradingTrackRecord()` in `repository.ts` lines 214–262 exists with 15-pt logic; extend with volume tier (+5/+7); already called at line 736 |
| SCORE-02 | Behavioral pattern scoring detects shell company signals: anonymous registration, no verifiable web presence, newly registered (< 6 months) | Shell deductions applied in `scoreCompany()` in `scoring.ts`; domain age from `domain_whois_cache.registered_at`; web presence from `domain_email_cache.has_mx + error`; registration from `entities.registration_number` |
| SCORE-03 | Paid users can view per-dimension score breakdown with contributing factors; free users see total only | `ScoreGauge.tsx` modified with `showBreakdown` prop; `f3Unlocked` already computed in all 3 page components |
</phase_requirements>

---

## Summary

Phase 4 completes the Authenticity Score so all 100 points are live. The work is entirely internal to the scoring engine and the `ScoreGauge` UI component — no new data sources, no schema changes, no new API routes.

The three requirements map to three distinct implementation tracks: (1) extending the existing `computeTradingTrackRecord()` function in `repository.ts` with volume-tier logic; (2) adding shell company signal deductions inside `scoreCompany()` in `scoring.ts` using domain/registration data pre-fetched in `repository.ts`; and (3) gating the `ScoreGauge` breakdown section behind a `showBreakdown` prop wired to the existing `f3Unlocked` flag.

A fourth cross-cutting concern is the `phase2Pending` cleanup sweep: 9 files across the codebase still emit `phase2Pending: true`, and the `ScoreGauge` still has two "Phase 1 / Phase 2 pending" text strings — all must be removed once SCORE-01 is live.

**Primary recommendation:** Implement in wave order — SCORE-01 first (extends existing function), then SCORE-02 (new ScoringInputs fields + scoreCompany deductions), then SCORE-03 (UI prop gate), then phase2Pending cleanup sweep.

---

## Standard Stack

### Core (No New Dependencies)

This phase requires zero new npm packages. All functionality is implemented using existing project infrastructure.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` (node-postgres) | project dependency | Raw SQL queries against PostgreSQL | Established pattern — no ORM allowed per CLAUDE.md |
| React 19 | project dependency | `ScoreGauge` component modification | Existing component framework |
| TypeScript (strict) | project dependency | Type safety for new `ScoringInputs` fields | Required by CLAUDE.md |

[VERIFIED: codebase grep — no new packages needed]

**Installation:** None required.

---

## Architecture Patterns

### Recommended Project Structure (No Changes)

The phase touches existing files only. No new directories or modules.

```
src/lib/server/
├── repository.ts        # computeTradingTrackRecord() volume tier extension
│                        # + domain/email cache pre-fetch for shell signals
├── scoring.ts           # scoreCompany() shell deductions + ScoringInputs fields
│                        # + LISTED_BREAKDOWN phase2Pending removal
src/lib/
├── types.ts             # ScoreDimension.phase2Pending field removal (optional)
├── constants.ts         # SCORE_DIMENSIONS.tradingTrackRecord.phase2Pending = false
src/components/entity/
└── ScoreGauge.tsx       # showBreakdown prop + conditional render + upgrade CTA
src/app/company/[slug]/page.tsx    # pass showBreakdown={f3Unlocked}
src/app/vessel/[imo]/page.tsx      # pass showBreakdown={f3Unlocked}
src/app/terminal/[id]/page.tsx     # pass showBreakdown={f3Unlocked}
src/lib/server/gleif.ts            # remove phase2Pending: true as const
src/lib/server/sync/acra.ts        # remove phase2Pending: true as const
src/lib/server/sync/companies-house.ts  # remove phase2Pending: true as const
src/lib/server/sync/opencorporates.ts   # remove phase2Pending: true as const
src/lib/server/sync/zefix.ts       # remove phase2Pending: true as const
```

---

### Pattern 1: Volume Tier Extension in `computeTradingTrackRecord()`

**What:** Extend the existing function in `repository.ts` (lines 214–262) to add volume-tier scoring. The existing SQL query already returns `total_events` — use it directly.

**When to use:** Mutually exclusive tier — +5 if 3–9 events, +7 if 10+ events.

**Existing state (lines 237–258):**

```typescript
// Source: src/lib/server/repository.ts lines 237-258 [VERIFIED: file read]
let score = 0
const evidence: string[] = []

if (total > 0) {
  score += 5
  evidence.push(`${total} verified trade event(s) on record`)
} else {
  evidence.push('No verified trade events on record yet')
}

if (total > unique) {
  score += 5
  evidence.push('Established relationship: repeat counterparty detected')
}

if (recent > 0) {
  score += 5
  evidence.push(`Active: ${recent} event(s) in the last 6 months`)
}

return { score, evidence, phase2Pending: false }
```

**Extension pattern (add AFTER the three existing blocks):**

```typescript
// Volume tier — award higher tier only, never stack
if (total >= 10) {
  score += 7
  evidence.push('High-volume: 10+ verified trade events on record')
} else if (total >= 3) {
  score += 5
  evidence.push('Established volume: 3–9 verified trade events on record')
}
```

**Key constraint:** Remove `phase2Pending: false` from the return type and return value. The return type annotation declares `phase2Pending: false` — after cleanup it should simply be omitted from the return object (the field is no longer meaningful).

---

### Pattern 2: Shell Company Deductions in `scoreCompany()`

**What:** Apply three deductions to entity existence score `E` before `clamp(E, 25)` in `scoreCompany()`.

**Data flow (pre-fetch approach):**

```
repository.ts getEntityById()
  → query domain_whois_cache for entity's metadata_json.website domain
  → query domain_email_cache for same domain
  → add domainAgeDays, hasWebPresence to ScoringInputs
  → scoreCompany(inputs) applies deductions to E
```

**New `ScoringInputs` fields (add to `scoring.ts`):**

```typescript
// Source: CONTEXT.md D-02 [VERIFIED: aligns with existing ScoringInputs pattern]
export interface ScoringInputs {
  // ... existing fields ...
  /** Days since company domain was registered. null if no domain or RDAP failed. */
  domainAgeDays?: number | null
  /** True when domain has MX records or website metadata present and DNS didn't NXDOMAIN. */
  hasWebPresence?: boolean | null
}
```

**Deduction logic (in `scoreCompany()`, BEFORE `clamp(E, 25)`):**

```typescript
// Apply shell company signal deductions to Entity Existence score
// Evidence strings appended so paid users see the reason
// Source: CONTEXT.md D-02 [VERIFIED: floor=0 enforced by clamp()]

if (inputs.domainAgeDays !== null && inputs.domainAgeDays !== undefined
    && inputs.domainAgeDays < 180) {
  E -= 10
  // evidence pushed to existenceEvidence — see evidence pattern below
}

if (!registrationNumber || registrationNumber.length < 5) {
  E -= 8
  // evidence pushed
}

if (inputs.hasWebPresence === false) {
  E -= 5
  // evidence pushed
}

// Then clamp (existing call)
return { E: clamp(E, 25), A: clamp(A, 30), D: clamp(D, 10), C: clamp(C, 10) }
```

**Evidence strings (from UI-SPEC.md Copywriting Contract):**

```typescript
// Source: .planning/phases/04-scoring-engine-completion/04-UI-SPEC.md [VERIFIED: file read]
'Domain registered less than 6 months ago — reduced trust signal'
'No verifiable registration number on record'
'No domain, mail records, or website detected — no verifiable web presence'
```

**Critical data source clarification:** `domain_email_cache` does NOT have an `age_days` column. Domain age is in `domain_whois_cache.registered_at` (a DATE column). Age in days must be computed as:

```sql
-- Source: src/lib/server/domain-check.ts scoreWhois() [VERIFIED: file read]
EXTRACT(DAY FROM NOW() - registered_at)::int AS domain_age_days
```

Web presence absence condition: domain lookup `error` field in `domain_email_cache` is non-null (NXDOMAIN/ENOTFOUND) AND `has_mx = false` AND entity `metadata_json->>'website'` is null/empty.

---

### Pattern 3: `showBreakdown` Prop in `ScoreGauge`

**What:** Add a boolean prop; conditionally render breakdown or upgrade CTA. The dimension list currently renders unconditionally — wrap in `{showBreakdown ? <dimensions> : <upgradeCTA>}`.

**Component signature change:**

```typescript
// Source: src/components/entity/ScoreGauge.tsx [VERIFIED: file read]
// Current:
interface ScoreGaugeProps {
  score: number
  tier: ScoreTier
  breakdown: ScoreBreakdown
}

// New:
interface ScoreGaugeProps {
  score: number
  tier: ScoreTier
  breakdown: ScoreBreakdown
  showBreakdown: boolean
}
```

**Conditional render pattern:**

```typescript
// Replace the current always-rendered dimension section and footer note
{showBreakdown ? (
  <div style={{ marginTop: 'var(--space-4)' }}>
    {/* existing dimension map — unchanged rendering logic */}
  </div>
) : (
  <p style={{ marginTop: 'var(--space-4)', fontSize: '12px',
               color: 'var(--text-muted)', lineHeight: '16px' }}>
    See 5-dimension score breakdown —{' '}
    <a href="/pricing" style={{ color: 'var(--accent-violet)' }}>View plans</a>
  </p>
)}
{/* DELETE the existing "Phase 1 data only" paragraph entirely */}
```

**Call site updates (all 3 page components):**

```typescript
// Source: all 3 page components — f3Unlocked already computed [VERIFIED: file read]
<ScoreGauge
  score={entity.authenticityScore}
  tier={tier}
  breakdown={entity.scoreBreakdown}
  showBreakdown={f3Unlocked}   // ADD THIS PROP
/>
```

---

### Pattern 4: Pre-fetching Domain Data in `repository.ts`

**Where:** In `getEntityById()`, after `parseEntity(rows[0])` (line 714) and before calling `computeTradingTrackRecord()` (line 736). Only for company entities to avoid unnecessary queries for vessels/terminals.

**Query pattern:**

```typescript
// Source: pattern from src/lib/server/domain-check.ts [VERIFIED: file read]
// Only query if entity is a company with a website
let domainAgeDays: number | null = null
let hasWebPresence: boolean | null = null

if (entity.type === 'company' && entity.website) {
  const domain = entity.website.replace(/^https?:\/\//, '').split('/')[0]

  const [whoisRow, emailRow] = await Promise.all([
    db.query<{ domain_age_days: number | null }>(
      `SELECT EXTRACT(DAY FROM NOW() - registered_at)::int AS domain_age_days
       FROM domain_whois_cache WHERE domain = $1
       AND queried_at > NOW() - INTERVAL '48 hours'`,
      [domain]
    ),
    db.query<{ has_mx: boolean | null; error: string | null }>(
      `SELECT has_mx, error FROM domain_email_cache WHERE domain = $1
       AND queried_at > NOW() - INTERVAL '48 hours'`,
      [domain]
    ),
  ])

  domainAgeDays = whoisRow.rows[0]?.domain_age_days ?? null
  const emailData = emailRow.rows[0]
  if (emailData) {
    hasWebPresence = !(emailData.error !== null && emailData.has_mx === false)
  } else if (!entity.website) {
    hasWebPresence = false
  }
}
```

**Then apply to scoreCompany() via ScoringInputs — pass the fetched values alongside existing inputs.**

---

### Anti-Patterns to Avoid

- **Querying the database from `scoring.ts`:** The scoring module is pure computation — it must receive all inputs from outside. DB calls must stay in `repository.ts`. [VERIFIED: CONTEXT.md Claude's Discretion]
- **Stacking volume tiers:** Do not award +5 AND +7 for 10+ events. The logic is exclusive — `else if`. [VERIFIED: CONTEXT.md D-01]
- **Using `domain_email_cache.age_days`:** This column does NOT exist. Age is in `domain_whois_cache.registered_at`. [VERIFIED: db/migrations/032_domain_email_cache.sql — no age_days column]
- **Applying shell signals to vessels/terminals:** The domain/registration signals only apply to company entities. Vessels and terminals pass through `scoreVessel()` / `scoreTerminal()` which do not receive `domainAgeDays`. [VERIFIED: CONTEXT.md D-02]
- **Double-penalizing high-risk countries:** `isHighRisk()` is already called in `scoreCompany()` for Entity Existence and Asset Reality. Do not add high-risk country to SCORE-02. [VERIFIED: CONTEXT.md D-02 deduction rules]
- **Arithmetic that produces negative E:** After subtracting shell signals, `clamp(E, 25)` floors at 0 naturally. No special floor guard needed. [VERIFIED: scoring.ts clamp() implementation]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Domain age computation | Custom RDAP fetch in scoring | Query existing `domain_whois_cache.registered_at` | Cache already populated by Phase 3 domain checks; RDAP fetch adds latency |
| Email presence check | Custom DNS lookup in scoring | Query existing `domain_email_cache.has_mx + error` | Cache populated by Phase 3 email checks |
| Score floor enforcement | Custom `Math.max(0, ...)` guards | Existing `clamp(n, max)` helper in `scoring.ts` | Already handles both floor (0) and ceiling (max) |
| Paywall CSS blur | Blur/opacity overlay | Conditional render (`showBreakdown ? X : Y`) | UI-SPEC explicitly requires no DOM leakage — hide via conditional render, not CSS |

**Key insight:** Phase 3 already wrote domain and email data to cache tables. Phase 4 reads that cached data at no additional infrastructure cost — the expensive DNS/RDAP work is already done.

---

## Runtime State Inventory

This is a pure code/logic phase — no renames, no data migrations, no service registrations.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `trade_events` table — data already present for entities that completed trade checks | None — read-only query extension |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | None — no new env vars required | None |
| Build artifacts | None — no new compiled outputs | None |

**Score stored in DB:** `entities.authenticity_score` column stores the score. After SCORE-01 goes live, scores will be higher for entities with trade events. Existing stored scores are not automatically updated — they are recomputed on next `getEntityById()` call (live path). [ASSUMED — no explicit score cache invalidation mechanism seen; existing pattern updates score in memory only, does not write back to DB]

---

## Common Pitfalls

### Pitfall 1: `domain_email_cache` Has No `age_days` Column

**What goes wrong:** CONTEXT.md says "domain_email_cache.age_days < 180" but the actual table schema has no `age_days` column. Querying it will throw a SQL error.

**Why it happens:** The CONTEXT was written using conceptual names, not the literal schema columns.

**How to avoid:** Domain age comes from `domain_whois_cache.registered_at` (DATE column). Compute as `EXTRACT(DAY FROM NOW() - registered_at)::int`. Web presence absence (no MX, NXDOMAIN) comes from `domain_email_cache.has_mx` and `domain_email_cache.error`.

**Warning signs:** SQL error "column age_days does not exist" at runtime.

[VERIFIED: db/migrations/030_domain_whois_cache.sql, db/migrations/032_domain_email_cache.sql — confirmed column names]

---

### Pitfall 2: `normalizeBreakdown()` Also Has `phase2Pending: true`

**What goes wrong:** The CONTEXT.md lists 7 cleanup sites for `phase2Pending`. But `repository.ts` `normalizeBreakdown()` at line 109 also emits `phase2Pending: true` in the legacy-row fallback path. If missed, legacy entities will still show the "Phase 2 coming soon" UI.

**How to avoid:** The grep audit (see Phase 2Pending Sweep below) confirms 9 total occurrences — include `normalizeBreakdown()` in the cleanup wave.

[VERIFIED: grep of `phase2Pending` across src/ — found at repository.ts line 109]

---

### Pitfall 3: `SCORE_DIMENSIONS.tradingTrackRecord.phase2Pending` Used in ScoreGauge Rendering

**What goes wrong:** `ScoreGauge.tsx` reads `entry.phase2Pending` from the breakdown object AND reads from `SCORE_DIMENSIONS[key].phase2Pending` indirectly. `constants.ts` line 21 still has `phase2Pending: true` for `tradingTrackRecord`. If this is not cleared, the bar will render as "—" even when the score is live.

**How to avoid:** Update `constants.ts` `SCORE_DIMENSIONS.tradingTrackRecord.phase2Pending` to `false` as part of the cleanup sweep.

[VERIFIED: src/lib/constants.ts line 21, src/components/entity/ScoreGauge.tsx line 157]

---

### Pitfall 4: Shell Signals Apply Only to Company Entities

**What goes wrong:** `scoreVessel()` and `scoreTerminal()` do not receive `domainAgeDays` / `hasWebPresence` in `ScoringInputs`. If the pre-fetch runs for all entity types or the deduction logic is placed in `computeScore()` instead of `scoreCompany()`, vessels and terminals will be incorrectly penalized.

**How to avoid:** Pre-fetch domain data only when `entity.type === 'company'`. Apply deductions only inside `scoreCompany()`. [VERIFIED: CONTEXT.md D-02 "Applies to company entities only"]

---

### Pitfall 5: Score Arithmetic After `tradingTrackRecord` Activation

**What goes wrong:** The existing code at `repository.ts` line 743 does `Math.min(100, entity.authenticityScore + trackRecord.score)`. This was fine when `trackRecord.score` was always 0. Now it adds real points on top of an already-stored score. The stored `authenticity_score` in `entities` table was computed without trading track record. Double-adding could inflate scores.

**How to avoid:** The existing code retrieves the stored score (which already excludes trading track record at score time) and adds the live track record result. This is correct because `computeTradingTrackRecord()` operates on `trade_events`, not the stored breakdown. The stored breakdown's `tradingTrackRecord.score` was always 0, so the addition is clean. Verify the score cap `Math.min(100, ...)` is enforced. [VERIFIED: repository.ts line 743]

---

### Pitfall 6: Entity Pages Still Receive `breakdown` but Not `showBreakdown`

**What goes wrong:** TypeScript strict mode will error at the `ScoreGauge` call site if `showBreakdown` is added as a required prop but not passed. Build will fail.

**How to avoid:** Update all 3 call sites (`company/page.tsx`, `vessel/page.tsx`, `terminal/page.tsx`) in the same task as the `ScoreGauge` prop addition. Do not merge the prop change without the call site updates.

[VERIFIED: company page line 828-831, vessel page line 516-519, terminal page line 426-429]

---

## Code Examples

### Complete `phase2Pending` Sweep (All 9 Locations)

[VERIFIED: grep of src/ directory]

```
src/lib/server/scoring.ts           line 199  — LISTED_BREAKDOWN constant
src/lib/server/scoring.ts           line 226  — computeScore() return
src/lib/server/repository.ts        line 109  — normalizeBreakdown() fallback
src/lib/server/repository.ts        line 212  — computeTradingTrackRecord() JSDoc
src/lib/server/repository.ts        line 217  — return type annotation
src/lib/server/repository.ts        line 258  — return value
src/lib/server/repository.ts        line 740  — inline assignment after call
src/lib/server/gleif.ts             line 198  — buildGleifCompany()
src/lib/server/sync/acra.ts         line 140  — computeACRAScore()
src/lib/server/sync/companies-house.ts line 139 — buildCHCompany()
src/lib/server/sync/opencorporates.ts  line 187 — buildOCCompany()
src/lib/server/sync/zefix.ts        line 124  — buildZefixCompany()
src/lib/constants.ts                line 21   — SCORE_DIMENSIONS
src/components/entity/ScoreGauge.tsx line 157  — isPending render logic
src/components/entity/ScoreGauge.tsx line 164  — title= tooltip text
src/components/entity/ScoreGauge.tsx line 247  — "Phase 1 data only" paragraph
src/lib/types.ts                    line 20   — ScoreDimension interface (optional cleanup)
```

Note: The `phase2Pending` field on `ScoreDimension` in `types.ts` is marked optional (`?`). Removing it from `types.ts` is a safe cleanup but is not strictly required for the phase to function correctly — all callers will simply stop emitting it.

---

### Domain Data Pre-fetch SQL (SCORE-02)

```typescript
// Source: db/migrations/030_domain_whois_cache.sql, 032_domain_email_cache.sql [VERIFIED]
// Query pattern for shell signal data fetch in repository.ts

// Age from whois cache — compute days server-side
const whoisResult = await db.query<{ domain_age_days: number | null }>(
  `SELECT EXTRACT(DAY FROM NOW() - registered_at)::int AS domain_age_days
   FROM domain_whois_cache
   WHERE domain = $1 AND queried_at > NOW() - INTERVAL '48 hours'`,
  [domain]
)

// Web presence from email cache — absence = NXDOMAIN error + no MX
const emailResult = await db.query<{ has_mx: boolean | null; error: string | null }>(
  `SELECT has_mx, error FROM domain_email_cache
   WHERE domain = $1 AND queried_at > NOW() - INTERVAL '48 hours'`,
  [domain]
)
```

---

### ScoreGauge Upgrade CTA (SCORE-03)

```typescript
// Source: 04-UI-SPEC.md Copywriting Contract + Color section [VERIFIED: file read]
// Upgrade prompt for free users — replaces dimension breakdown section

<p style={{
  marginTop: 'var(--space-4)',
  fontSize: '12px',
  color: 'var(--text-muted)',
  lineHeight: '16px',
}}>
  See 5-dimension score breakdown —{' '}
  <a href="/pricing" style={{ color: 'var(--accent-violet)' }}>View plans</a>
</p>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tradingTrackRecord.phase2Pending = true`, score always 0 | Live calculation from `trade_events`, score 0–22 | Phase 4 | Total possible score goes from 75 to max ~97 (100 capped) |
| ScoreGauge shows breakdown to all users | Breakdown gated by `showBreakdown` prop | Phase 4 | Free users cannot extract per-dimension data |
| No shell company deductions | Entity Existence reduced by up to 23 pts for shell signals | Phase 4 | Shell companies score measurably lower |

**Constants to update:**

- `src/lib/constants.ts` `PHASE1_MAX_SCORE = 75` — this constant becomes misleading after Phase 4. Either delete it or rename to `DEPRECATED_PHASE1_MAX_SCORE`. `TOTAL_MAX_SCORE = 100` remains accurate. [ASSUMED — no reference found to `PHASE1_MAX_SCORE` being used anywhere in rendering logic; safe to remove or leave as dead constant]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Stored `authenticity_score` in `entities` table does not include any pre-computed `tradingTrackRecord` value — the live addition in `repository.ts` line 743 is non-duplicating | Pitfall 5 | Score inflation for entities with existing trade events — cap at 100 would mask it |
| A2 | `PHASE1_MAX_SCORE` constant in `constants.ts` is not rendered anywhere in UI (only informational) — safe to leave or remove without UI breakage | State of the Art | If rendered somewhere, free users would see misleading "max 75" display after Phase 4 activates trading track record |
| A3 | Entities loaded via the GLEIF/ACRA/Companies House/Zefix live-fetch paths (not stored in `entities` table) do NOT go through `computeTradingTrackRecord()` — those entities will always show tradingTrackRecord = 0 with no evidence | Phase 2Pending sweep | Non-DB entities will appear to have no trade history even if they do — acceptable for Phase 4 scope |

---

## Open Questions

1. **Should `phase2Pending` field be removed from `ScoreDimension` interface in `types.ts`?**
   - What we know: The field is optional (`phase2Pending?: boolean`). Removing it is a safe TypeScript cleanup.
   - What's unclear: Whether any external API consumers (report generation, screening sessions) deserialize `ScoreBreakdown` from storage and would be affected by schema drift.
   - Recommendation: Remove the field from `types.ts` as part of the cleanup wave — it will be omitted from all return values anyway, and TypeScript will flag any remaining usages.

2. **What happens to `PHASE1_MAX_SCORE = 75` constant?**
   - What we know: The constant exists in `constants.ts` line 38. No rendering usage found via grep.
   - What's unclear: Whether it appears in documentation strings or test fixtures.
   - Recommendation: Delete it in the cleanup sweep or leave as dead constant; do not spend a task on this unless grep confirms it is used.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code/logic changes. No external dependencies beyond the existing PostgreSQL database (already running) and Node.js (v24.11.1, confirmed available).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL 16 | trade_events, domain caches | Assumed running (project prerequisite) | 16 | — |
| Node.js | npm run dev / build | Yes | 24.11.1 | — |

[VERIFIED: node --version = v24.11.1]

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None — explicit technical debt per REQUIREMENTS.md "Out of Scope" |
| Config file | Not present |
| Quick run command | `npm run type-check` (TypeScript strict check) |
| Full suite command | `npm run build` (full Next.js build validates all types + compilation) |

**Note:** Automated test suite is explicitly out of scope for this milestone (REQUIREMENTS.md). Validation is via TypeScript compile check and manual browser verification.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| SCORE-01 | Entity with trade events has non-zero tradingTrackRecord score | manual | `npm run type-check` | Verify via company page with known trade events |
| SCORE-02 | Shell company entity scores lower than transparent entity | manual | `npm run type-check` | Verify with seed entity that has null registration_number |
| SCORE-03 | Free user sees upgrade CTA, paid user sees breakdown | manual | `npm run type-check` | Toggle plan in session to verify render gate |

### Sampling Rate

- **Per task commit:** `npm run type-check`
- **Per wave merge:** `npm run build`
- **Phase gate:** Full build green + manual browser spot-check before `/gsd-verify-work`

### Wave 0 Gaps

None — existing TypeScript infrastructure covers all compilation checks. No test files to create.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not touched in Phase 4 |
| V3 Session Management | No | Session read-only (`f3Unlocked` from existing session) |
| V4 Access Control | Yes | `showBreakdown` prop gating — critical: conditional render (not CSS blur) prevents DOM leakage of paid data |
| V5 Input Validation | No | No new user inputs |
| V6 Cryptography | No | Not touched |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Score breakdown data leakage to free users | Information Disclosure | Conditional render (`showBreakdown`) — NOT CSS blur/hidden. Free users receive no dimension data in DOM. [VERIFIED: UI-SPEC.md Interaction Contracts] |
| Negative score arithmetic | Tampering (corrupted output) | `clamp(n, max)` floors at 0 — no negative scores possible |
| Shell signal false positives for valid entities | Spoofing (wrong verdict) | Signals are additive deductions only; a valid entity with a known registration number and web presence takes zero deduction |

---

## Sources

### Primary (HIGH confidence)

- `src/lib/server/scoring.ts` — full scoring engine, `ScoringInputs`, `scoreCompany()`, `clamp()`, `LISTED_BREAKDOWN` [VERIFIED: file read]
- `src/lib/server/repository.ts` lines 88–262 — `normalizeBreakdown()`, `computeTradingTrackRecord()`, entity fetch pipeline [VERIFIED: file read]
- `db/migrations/022_trade_events.sql` — `trade_events` table schema [VERIFIED: file read]
- `db/migrations/030_domain_whois_cache.sql` — `domain_whois_cache` schema, `registered_at` DATE column [VERIFIED: file read]
- `db/migrations/032_domain_email_cache.sql` — `domain_email_cache` schema, `has_mx`, `error` columns — no `age_days` column [VERIFIED: file read]
- `src/components/entity/ScoreGauge.tsx` — existing prop interface, conditional rendering, animation code [VERIFIED: file read]
- `src/lib/types.ts` — `ScoreDimension`, `ScoreBreakdown`, `phase2Pending` field [VERIFIED: file read]
- `src/lib/constants.ts` — `SCORE_DIMENSIONS`, `PHASE1_MAX_SCORE` [VERIFIED: file read]
- `.planning/phases/04-scoring-engine-completion/04-UI-SPEC.md` — approved UI design contract [VERIFIED: file read]
- `.planning/phases/04-scoring-engine-completion/04-CONTEXT.md` — locked decisions [VERIFIED: file read]

### Secondary (MEDIUM confidence)

- `src/lib/server/domain-check.ts` scoreWhois() — confirms `ageDays` computation pattern from `registered_at` [VERIFIED: file read]
- grep of `phase2Pending` across src/ — confirmed all 9+ locations [VERIFIED: grep output]
- grep of `f3Unlocked` in company page — confirmed computation and existing usage [VERIFIED: grep output]

### Tertiary (LOW confidence)

- A1–A3 in Assumptions Log — based on code read, not runtime verification

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — no new dependencies; all patterns exist in codebase
- Architecture: HIGH — all integration points verified via file reads and grep
- Pitfalls: HIGH — confirmed by direct schema inspection (critical `age_days` finding), grep audit, and code tracing
- UI pattern: HIGH — UI-SPEC.md approved and read verbatim

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable codebase, no external API dependencies)

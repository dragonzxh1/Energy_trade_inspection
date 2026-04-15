# Phase 4: Scoring Engine Completion - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete the Authenticity Score so all 100 points are live:

1. **SCORE-01** — Trading Track Record (max 25 pts) calculated from `trade_events` table, replacing the current always-zero placeholder
2. **SCORE-02** — Behavioral shell company signals reduce scores through targeted deductions on the Entity Existence dimension
3. **SCORE-03** — Per-dimension score breakdown visible only to paid users (starter/enterprise); free users see total score + tier label only

No new data sources, no schema changes to entities table. All signals come from data already in the database.

</domain>

<decisions>
## Implementation Decisions

### D-01: Trading Track Record Algorithm (SCORE-01)

**Full scoring formula for `computeTradingTrackRecord()` in `repository.ts` (max 25 pts):**

| Signal | Points |
|--------|--------|
| Any trade events exist | +5 |
| Repeat counterparty detected (`total > unique_counterparties`) | +5 |
| Recent activity — at least 1 event in last 6 months | +5 |
| Volume tier: 3–9 trade events | +5 |
| Volume tier: 10+ trade events | +7 |

**Note:** Volume tier is a single bonus — award +5 OR +7, not both. Maximum possible: 5 + 5 + 5 + 7 = 22. The additional 3 points to reach 25 are structurally not yet achievable; the cap is 22 for now. Do NOT force the math to reach exactly 25 — correctness over convenience.

**Rationale:** Commodity diversity and multi-port activity do not confirm authenticity; volume does. The existing 15-pt base logic (+5 any, +5 repeat, +5 recent) is correct and kept. Volume tier replaces no existing logic — it is additive.

**`phase2Pending` flag:** Remove it from all callers once this dimension is live. Specifically update:
- `src/lib/server/scoring.ts` LISTED_BREAKDOWN constant
- `src/lib/server/scoring.ts` `computeScore()` return
- `src/lib/server/gleif.ts`, `sync/acra.ts`, `sync/companies-house.ts`, `sync/opencorporates.ts`, `sync/zefix.ts`
- `src/components/entity/ScoreGauge.tsx` — remove "Phase 2 pending" text

### D-02: Shell Company Signals (SCORE-02)

**Three signals, all deducted from Entity Existence dimension (floor: 0):**

| Signal | Condition | Deduction |
|--------|-----------|-----------|
| Newly registered domain | `domain_email_cache.age_days < 180` (< 6 months) | −10 from Entity Existence |
| Missing/weak registration number | `entities.registration_number IS NULL OR length < 5` | −8 from Entity Existence |
| No web presence | Domain lookup failed (NXDOMAIN/error) AND no MX records AND no website in metadata_json | −5 from Entity Existence |

**Deduction rules:**
- All three can stack — minimum Entity Existence score is 0 (never negative)
- Signal check happens BEFORE clamping Entity Existence to its max
- Applies to company entities only (vessels and terminals have no domain/registration signals in this context)
- High-risk country registration is NOT included in SCORE-02 — it is already penalized in `scoreCompany()` via `isHighRisk()` (avoids double-penalizing)

**Data sources:**
- `domain_email_cache` table — join on entity's `metadata_json.website` domain (same pattern as Phase 3 DomainIntelPanel)
- `entities.registration_number` — already available in ScoringInputs

**Where to implement:** In `scoreCompany()` in `scoring.ts`, after computing E/A/D/C, apply shell deductions to E before clamping. Pass a new `shellSignals` sub-object in ScoringInputs (or compute inline from existing fields).

**Evidence strings:** Each triggered signal must appear in `entityExistence.evidence[]` so paid users can see why the score is what it is.

### D-03: Score Breakdown Paywall (SCORE-03)

**Free users (`plan === 'free'`):**
- See: circular gauge arc + numeric total + tier label (e.g., "Partially Verified")
- Do NOT see: any dimension bars, dimension labels, evidence strings, or "/ maxScore" values
- See: one line of small text at the bottom of ScoreGauge: "Paid users see 5-dimension score breakdown → View plans"

**Paid users (`plan === 'starter'` or `'enterprise'`):**
- See everything — full dimension breakdown with bars, scores, and evidence strings

**Implementation:**
- Add `showBreakdown: boolean` prop to `ScoreGauge` component
- Pass `showBreakdown={f3Unlocked}` from company/vessel/terminal page components
- `f3Unlocked` is already computed as `plan !== 'free'` in all three page components (line ~736 in company page)
- The upgrade CTA text inside ScoreGauge links to `/pricing` (same target as other ContentLock CTAs)

### Claude's Discretion

- Exact wording of the upgrade prompt inside ScoreGauge
- Whether to query `domain_email_cache` inside `scoring.ts` directly or pre-fetch and pass as a `ScoringInputs` field — prefer passing as a field to keep scoring.ts pure (no DB calls)
- Evidence string phrasing for each shell signal
- Whether `computeTradingTrackRecord()` stays in `repository.ts` or moves to `scoring.ts` — keep in repository.ts to maintain existing call site

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scoring Engine
- `src/lib/server/scoring.ts` — `computeScore()`, `scoreCompany()`, `scoreVessel()`, `scoreTerminal()`, `ScoringInputs` type, `LISTED_BREAKDOWN` constant, `phase2Pending` references to remove
- `src/lib/server/repository.ts` lines 211–260 — `computeTradingTrackRecord()` (existing partial implementation), line ~737 where it's called and applied to entity
- `src/lib/types.ts` — `ScoreBreakdown`, `ScoreDimension`, `phase2Pending` field to remove

### UI
- `src/components/entity/ScoreGauge.tsx` — Add `showBreakdown` prop, conditional rendering, upgrade CTA, remove "Phase 1 data only" text
- `src/app/company/[slug]/page.tsx` line ~829 — `<ScoreGauge>` call site, `f3Unlocked` already available
- `src/app/vessel/[imo]/page.tsx` line ~519 — vessel ScoreGauge call site
- `src/app/terminal/[id]/page.tsx` line ~429 — terminal ScoreGauge call site

### Shell Company Data Sources
- `db/migrations/032_domain_email_cache.sql` — `domain_email_cache` table schema (age_days, has_mx, has_spf, error)
- `db/migrations/022_trade_events.sql` — `trade_events` table schema

### Phase 2Pending Cleanup Sites
- `src/lib/server/gleif.ts` line ~198
- `src/lib/server/sync/acra.ts` line ~140
- `src/lib/server/sync/companies-house.ts` line ~139
- `src/lib/server/sync/opencorporates.ts` line ~187
- `src/lib/server/sync/zefix.ts` line ~124

### Requirements
- `.planning/REQUIREMENTS.md` — SCORE-01, SCORE-02, SCORE-03 acceptance criteria
- `.planning/ROADMAP.md` §Phase 4 — Success criteria (4 items)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `computeTradingTrackRecord(entityId)` — already exists in `repository.ts`, gives up to 15 pts. Extend it with volume tier logic.
- `isHighRisk(country)` in `scoring.ts` — reuse for context; do NOT add to SCORE-02 (already penalizes via dimension scoring)
- `clamp(n, max)` helper in `scoring.ts` — use for shell signal deductions to floor at 0
- `f3Unlocked` flag in all three entity pages — already computes `plan !== 'free'`; pass directly as `showBreakdown` prop

### Established Patterns
- `ScoringInputs` interface in `scoring.ts` — add optional fields for domain data (e.g., `domainAgeDays?: number | null`, `hasWebPresence?: boolean`)
- Evidence strings pattern already in `ScoreDimension.evidence?: string[]` — populate for each triggered shell signal
- `phase2Pending: true` pattern — remove from all sites listed in canonical_refs once SCORE-01 is live

### Integration Points
- `repository.ts` fetches entity then calls `computeTradingTrackRecord()` at line ~737 — also fetch domain_email_cache here and pass to scoring as inputs
- `ScoreGauge` is called from 3 page components — update all 3 with `showBreakdown` prop
- `SCORE_DIMENSIONS` constant in `src/lib/constants.ts` line ~17 — update `tradingTrackRecord` label (remove "Phase 2 pending" annotation if present)

</code_context>

<specifics>
## Specific Ideas

- The "Phase 2 data — coming soon" tooltip text in ScoreGauge.tsx line 164 should be removed when `phase2Pending` is eliminated
- The footer note "Phase 1 data only (max 75). Trading Track Record unlocks in Phase 2." in ScoreGauge.tsx line 247 should be replaced with a conditional: either the breakdown upgrade prompt (free users) or removed entirely (paid users)
- Volume tier: award the HIGHER tier only — do not stack +5 and +7 for 10+ events

</specifics>

<deferred>
## Deferred Ideas

- **Commodity diversity scoring** — User confirmed this does not prove trade authenticity; deferred to future roadmap if trade data schema expands
- **Multi-jurisdiction/port activity scoring** — Same rationale; deferred
- **High-risk country in SCORE-02** — Excluded from this phase; already handled by `isHighRisk()` in existing dimension scoring
- **SCORE-01 reaching exactly 25 pts** — Max achievable is 22 with current data. Reaching 25 would require a future signal (e.g., verified external trade data source). Deferred.

</deferred>

---

*Phase: 04-scoring-engine-completion*
*Context gathered: 2026-04-14*

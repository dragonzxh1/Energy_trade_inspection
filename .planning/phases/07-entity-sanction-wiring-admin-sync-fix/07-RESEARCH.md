# Phase 7: Entity Sanction Wiring & Admin Sync Fix — Research

**Researched:** 2026-04-15
**Domain:** TypeScript type wiring, React component props, Next.js App Router server components, admin API routing
**Confidence:** HIGH

## Summary

Phase 7 closes two dead-code gaps left over from Phase 5. The first gap: `SanctionBadge` was upgraded in Phase 5 (05-03-PLAN.md) to accept a `sources?: string[]` prop and render a tooltip listing specific sanctions lists, but the three entity detail pages (company, vessel, terminal) were never wired to pass `sanctionSources` down — the prop was always `undefined`, so the tooltip never appeared. The second gap: `/api/admin/sync` accepted `{ source: "fraud" }` and `{ source: "fraud:X" }` as targeted sync triggers, but `{ source: "warninglists" }` fell through to the legacy branch which mapped unknown sources to `'all'`, running every data source instead of just `syncRegulatoryWarnings()`.

All five changes that fix these gaps are already written and sitting as unstaged working-tree modifications. The implementation is complete and correct: the type is extended, the data flows from `checkSanctions()` through `getEntityByKey()` to the entity object, the pages pass the prop, the component renders it, and the admin route handles the new source before the legacy fallback. The only pre-existing TypeScript error (`src/lib/stripe.ts` Stripe API version mismatch) is unrelated to Phase 7 and was present before these changes.

**Primary recommendation:** The implementation is complete. The PLAN.md should document the two sub-goals as two discrete plans, one per concern (SanctionBadge tooltip wiring / Admin sync isolation), and treat the work as already-done verification rather than net-new implementation.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Sanction source lookup | API / Backend (`repository.ts`) | — | Data query happens server-side in `getEntityByKey()`; result attached to entity object |
| Sanction sources propagation | Frontend Server (SSR page component) | — | Server component passes `entity.sanctionSources` as prop to `SanctionBadge` |
| Tooltip rendering | Browser / Client (`SanctionBadge.tsx`) | — | `'use client'` component; tooltip toggled via `useState` on hover/click |
| Warning list sync isolation | API / Backend (`/api/admin/sync`) | — | Route handler dispatches to `runSync('warninglists')` before legacy branch |

## Standard Stack

No new libraries introduced in Phase 7. All changes use existing project stack.

### Core (existing, no version change)

| File/Module | Role in Phase 7 |
|-------------|-----------------|
| `src/lib/types.ts` | `BaseEntity.sanctionSources?: string[]` added |
| `src/lib/server/sanctions.ts` | `checkSanctions()` already returns `{ listed, sources }` — source of truth |
| `src/lib/server/repository.ts` | `getEntityByKey()` calls `checkSanctions()` when `sanctionStatus === 'listed'` and attaches `sanctionSources` |
| `src/components/entity/SanctionBadge.tsx` | Already accepts `sources?: string[]` (added Phase 5); tooltip render was always ready |
| `src/app/api/admin/sync/route.ts` | New `warninglists` branch dispatches to `runSync('warninglists')` |
| `src/lib/server/sync/index.ts` | `SyncSource` already includes `'warninglists'`; `runSync('warninglists')` already invokes `syncRegulatoryWarnings()` |

## Architecture Patterns

### Data Flow: SanctionBadge Tooltip

```
GET /company/[slug]
        |
        v
getEntityByKey(slug)                      [repository.ts — server]
        |
        |-- DB query: entities table -> entity row (sanction_status = 'listed')
        |
        |-- if entity.sanctionStatus === 'listed':
        |       checkSanctions(entity.name)  [sanctions.ts]
        |           |
        |           |-- local DB: sanctions_entries word_similarity query
        |           |   -> { listed: true, sources: ['OFAC SDN', 'EU FSF', ...] }
        |           |
        |           '-- entity.sanctionSources = result.sources
        |
        v
CompanyPage (Server Component)            [page.tsx — SSR]
        |
        '-- <SanctionBadge
               status={company.sanctionStatus}
               sources={company.sanctionSources}  />
                    |
                    v (client component)
            hover/click -> tooltip with sources list rendered
```

### Data Flow: Admin Sync Isolation

```
POST /api/admin/sync  { source: 'warninglists' }
        |
        v
route.ts POST handler
        |
        |-- source === 'opensanctions' ?  NO
        |-- source === 'fraud' ?          NO
        |-- source.startsWith('fraud:') ? NO
        |-- source === 'warninglists' ?   YES
        |       runSync('warninglists')
        |           -> syncRegulatoryWarnings() only
        |           -> returns SyncResult[] with warn:* source keys
        |       return 200 (or 207 if any error)
        |
        '-- (legacy branch never reached)
```

### Recommended Project Structure

No structural changes. Phase 7 modifies only existing files.

### Pattern: Conditional Prop Attachment in Server Components

**What:** A server component fetches an entity; downstream business logic conditionally enriches the entity object with optional fields only when warranted (e.g., `sanctionSources` only when `sanctionStatus === 'listed'`). The optional field flows as a prop to a client component.

**Why correct here:** `sanctionSources` is `optional` (`?`) in `BaseEntity`, so it can be absent on `not_listed` or `unknown` entities without TypeScript complaints. The client component guards on `status === 'listed' && sources != null && sources.length > 0` before rendering the tooltip — correct defensive check.

**Example (verified from working tree):**
```typescript
// repository.ts — lines 861-866 [VERIFIED: git diff]
if (entity.sanctionStatus === 'listed') {
  const result = await checkSanctions(entity.name).catch(() => ({ listed: true, sources: [] as string[] }))
  if (result.sources.length > 0) {
    entity.sanctionSources = result.sources
  }
}
```

### Pattern: Source-Specific Dispatch Before Legacy Fallback

**What:** The admin sync route handles each named source as an explicit early-return branch. Unknown sources fall through to a legacy branch that maps them to `'all'`. New sources must be added before the legacy branch to avoid accidental full-sync.

**Example (verified from working tree):**
```typescript
// route.ts — warninglists branch [VERIFIED: git diff]
if (source === 'warninglists') {
  try {
    const results = await runSync('warninglists')
    const hasError = results.some((r) => !r.success)
    return NextResponse.json({ results }, { status: hasError ? 207 : 200 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

const legacySource = (['ofac', 'all'] as SyncSource[]).includes(source as SyncSource)
  ? (source as SyncSource)
  : 'all'
```

### Anti-Patterns to Avoid

- **Calling `checkSanctions()` for non-listed entities in `getEntityByKey()`:** Would add a redundant API/DB call for every entity fetch. The guard `if (entity.sanctionStatus === 'listed')` is intentional — only listed entities get the sources fetch.
- **Placing the `warninglists` branch after the legacy branch:** Would cause `warninglists` to be absorbed into the `'all'` sync, defeating the isolation goal. Ordering is load-bearing.
- **Skipping the `.catch()` fallback in repository.ts:** The `checkSanctions()` call is best-effort; a failure must not block the entity response. The `.catch(() => ({ listed: true, sources: [] as string[] }))` fallback is correct and preserves the `listed` status while gracefully dropping sources.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sanction list name resolution | Custom dataset label map | `checkSanctions().sources` from sanctions.ts | Already parses dataset strings from `sanctions_entries`; deduplicates; caps at 3 per row |
| Admin auth for sync routes | New auth middleware | Existing `isAuthorized()` in route.ts | Already handles Bearer token + admin email + localhost dev bypass |

## Common Pitfalls

### Pitfall 1: Double `checkSanctions()` Call for Listed Entities

**What goes wrong:** `getEntityByKey()` already has a branch at line ~848 that calls `screenSanctions()` when `sanctionStatus === 'unknown'`. The new block at line 861 calls `checkSanctions()` when `sanctionStatus === 'listed'`. If someone moves or inverts the guard, a listed entity could trigger both calls — two DB queries for sanction data on a single page load.

**Why it happens:** Two separate concerns (status update vs. source fetch) are adjacent in the same function.

**How to avoid:** Keep the guards mutually exclusive. `screenSanctions()` fires only on `unknown`. `checkSanctions()` fires only on `listed`. This is the current implementation; do not merge them.

**Warning signs:** Entity detail pages taking 2x longer for listed entities; duplicate DB query logs for `word_similarity` on `sanctions_entries`.

### Pitfall 2: `sources` Prop Not Typed in `SanctionBadgeProps`

**What goes wrong:** If `SanctionBadgeProps` did not include `sources?: string[]`, TypeScript would reject the prop at all three page call sites.

**Why it matters:** Phase 5 (05-03-PLAN.md) added the prop to the component interface. Phase 7 depends on this already being done. It is confirmed done — `SanctionBadgeProps` at line 7–14 of `SanctionBadge.tsx` includes `sources?: string[]` with JSDoc.

**Verification status:** [VERIFIED: Read tool, SanctionBadge.tsx lines 1-85] — prop is present and typed correctly.

### Pitfall 3: `SyncSource` Type Not Including `'warninglists'`

**What goes wrong:** If `SyncSource` in `sync/index.ts` did not include `'warninglists'`, calling `runSync('warninglists')` would produce a TypeScript error.

**Verification status:** [VERIFIED: Read tool, sync/index.ts line 11] — `export type SyncSource = 'ofac' | 'fraud' | 'legitdomains' | 'warninglists' | 'all'` — `warninglists` is already a valid value.

### Pitfall 4: Pre-existing Stripe Type Error Blocks `type-check`

**What goes wrong:** `npm run type-check` reports one error in `src/lib/stripe.ts`: `Type '"2025-03-31.basil"' is not assignable to type '"2026-03-25.dahlia"'`. This is a pre-existing Stripe SDK API version mismatch, not introduced by Phase 7.

**Impact:** `npm run type-check` currently exits non-zero. Phase 7's success criterion #3 requires `type-check` to exit 0, but this pre-existing error makes that impossible without fixing the Stripe version string as well.

**Recommendation:** The PLAN.md should note this pre-existing error and decide whether to fix it in Phase 7 or explicitly exclude it from the success criterion. The Phase 7 changes themselves introduce zero new type errors.

### Pitfall 5: `sanctionSources` Not Set on Externally-Fetched Entities

**What goes wrong:** The new `sanctionSources` enrichment block in `getEntityByKey()` only runs after `parseEntity(rows[0])` — i.e., for entities already in the local `entities` DB table. Entities fetched from external registries (ACRA, Companies House, Zefix, OpenCorporates, GLEIF) return early before reaching this block (lines 598–729 of repository.ts).

**Impact:** A company fetched live from ACRA that happens to be sanctioned will show a red SanctionBadge but no tooltip (no `sanctionSources`). This is acceptable behavior given the architecture — `screenSanctions()` runs for those code paths but only returns a boolean status, not sources. Closing this gap would require refactoring the external-registry paths, which is out of Phase 7 scope.

**How to avoid:** Document this as a known limitation in the PLAN.md. Do not attempt to fix it in Phase 7.

## Code Examples

### SanctionBadge Component — Full Verified Interface

```typescript
// Source: src/components/entity/SanctionBadge.tsx [VERIFIED: Read tool]
interface SanctionBadgeProps {
  status: SanctionStatus
  size?: 'sm' | 'md'
  /** Optional list of specific sanctions list names to show in tooltip.
   *  Only rendered when status === 'listed' and sources.length > 0.
   *  Example: ['OFAC SDN', 'EU FSF'] */
  sources?: string[]
}

// Tooltip guard — correct
const showTooltip = status === 'listed' && sources != null && sources.length > 0
```

### checkSanctions() Return Type — Confirmed

```typescript
// Source: src/lib/server/sync/sanctions.ts [VERIFIED: Read tool, lines 238-270]
export async function checkSanctions(
  name: string
): Promise<{ status: 'ok' | 'degraded'; listed: boolean; sources: string[]; reason?: string }>
```

Sources are populated from `sanctions_entries.dataset` field, split on semicolons, deduplicated, capped at 3 per matching row, only for rows that pass the `TRADE_SANCTION_DATASET_KEYWORDS` or `TRADE_SANCTION_KEYWORDS` filters.

### runSync('warninglists') — Already Wired in sync/index.ts

```typescript
// Source: src/lib/server/sync/index.ts [VERIFIED: Read tool, lines 77-88]
if (source === 'warninglists' || source === 'all') {
  const warnResults = await syncRegulatoryWarnings()
  for (const r of warnResults) {
    results.push({
      source: `warn:${r.source}`,
      success: !r.error,
      count: r.count,
      error: r.error,
      durationMs: r.durationMs,
    })
  }
}
```

This confirms: `runSync('warninglists')` calls only `syncRegulatoryWarnings()`. No other sync functions are invoked.

## Implementation Completeness Assessment

| Success Criterion | Status | Evidence |
|------------------|--------|---------|
| SC-1: SanctionBadge tooltip shows source names on company page | COMPLETE | `sources={company.sanctionSources}` in company page; `sanctionSources` set in `getEntityByKey()` when listed |
| SC-1: SanctionBadge tooltip shows source names on vessel page | COMPLETE | `sources={vessel.sanctionSources}` in vessel page |
| SC-1: SanctionBadge tooltip shows source names on terminal page | COMPLETE | `sources={terminal.sanctionSources}` in terminal page |
| SC-2: `{ source: "warninglists" }` POST runs only `syncRegulatoryWarnings()` | COMPLETE | Explicit branch before legacy fallback in route.ts; `runSync('warninglists')` confirmed to invoke only `syncRegulatoryWarnings()` |
| SC-3: `npm run type-check` exits 0 | PARTIAL | Phase 7 changes introduce no new type errors; pre-existing Stripe version error in `stripe.ts` causes non-zero exit — this is a pre-existing issue, not a Phase 7 regression |

## Known Gaps and Limitations

1. **Stripe type-check error (pre-existing):** `src/lib/stripe.ts` has a Stripe API version string mismatch that predates Phase 7. The PLAN.md must decide: fix it here (one-line change) or update the success criterion to specify "no NEW type errors introduced by Phase 7."

2. **External-registry entities lack `sanctionSources`:** Entities fetched live from ACRA/Companies House/Zefix/OC/GLEIF return early in `getEntityByKey()` before the `sanctionSources` enrichment. These are a known limitation of the current architecture. Out of Phase 7 scope.

3. **`'unknown'` path re-screening does not attach sources:** When an entity with `sanctionStatus === 'unknown'` gets re-screened and found to be listed, the new status is set but `sanctionSources` is not attached in that code path (lines 848-858 of repository.ts). The entity would need a second page load for sources to appear (since the DB is updated, the next load will hit the `'listed'` branch). This is a minor edge case; Phase 7 does not address it.

## State of the Art

| Old Behavior | New Behavior | Changed In |
|--------------|-------------|-----------|
| `SanctionBadge` on entity pages passed no `sources` prop — tooltip never rendered | `sources={entity.sanctionSources}` passed from server component; tooltip shows list names on hover | Phase 7 |
| `POST /api/admin/sync { source: "warninglists" }` silently ran all sources | Runs only `syncRegulatoryWarnings()` | Phase 7 |
| `SanctionBadge` component supported `sources` prop (Phase 5) but no caller passed it at entity pages | All three entity pages now pass it | Phase 7 |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Stripe type error in `stripe.ts` predates Phase 7 and is not introduced by these changes | Common Pitfalls #4 | Low — confirmed by type-check output showing only one error in an unrelated file |

**All other claims verified via Read tool or git diff.**

## Open Questions

1. **Should Phase 7 also fix the Stripe `type-check` error?**
   - What we know: The error is `Type '"2025-03-31.basil"' is not assignable to type '"2026-03-25.dahlia"'` in `src/lib/stripe.ts`. A one-line fix (update the API version string) would make `type-check` exit 0.
   - What's unclear: Whether this falls within Phase 7's intended scope or should be a standalone fix.
   - Recommendation: Fix it in Plan 1 of Phase 7 as a housekeeping task; it is trivial and unblocks the SC-3 success criterion.

2. **Should `'unknown'` → `'listed'` re-screening path also attach `sanctionSources`?**
   - What we know: Lines 848-858 update `sanctionStatus` but do not call `checkSanctions()` for sources — they use `screenSanctions()` which drops the `sources` return value.
   - Recommendation: Out of scope for Phase 7. Flag as a future improvement.

## Environment Availability

Step 2.6: SKIPPED — Phase 7 is purely code changes within the existing project stack. No external tools, new runtimes, or services required.

## Validation Architecture

### Test Framework

No automated test infrastructure detected in this repository. `npm run type-check` serves as the primary automated gate.

| Property | Value |
|----------|-------|
| Framework | None (no Jest/Vitest/pytest detected) |
| Config file | None |
| Quick run command | `npm run type-check` |
| Full suite command | `npm run type-check && npm run lint` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | Notes |
|--------|----------|-----------|-------------------|-------|
| DECISION-01 | SanctionBadge tooltip shows source names | Manual | — | Requires browser with a listed entity loaded |
| DECISION-01 | `{ source: "warninglists" }` POST hits only warning lists sync | Manual/curl | `curl -X POST /api/admin/sync -d '{"source":"warninglists"}'` | Inspect response `results[].source` — all entries should start with `warn:` |
| SC-3 | No new TypeScript errors | Automated | `npm run type-check` | Pre-existing Stripe error may need fixing first |

### Wave 0 Gaps

None — no new test files needed. Phase 7 has no automated test infrastructure to create.

## Security Domain

Phase 7 changes are scope-limited: they add a read-only data enrichment call in a server-side function and add an early-return branch in an already-authenticated admin route. No new auth surfaces, no new input validation requirements, no new data written by these changes.

The `checkSanctions()` call added to `getEntityByKey()` uses the entity name already in the database — no user-supplied input is passed through. The admin route's existing `isAuthorized()` check covers the new `warninglists` branch identically to the existing `fraud` branch.

ASVS categories: Not applicable for Phase 7's scope (no new auth, no new user input paths, no cryptographic operations).

## Sources

### Primary (HIGH confidence)

- `src/components/entity/SanctionBadge.tsx` — component interface verified via Read tool
- `src/lib/server/sync/sanctions.ts` — `checkSanctions()` return type verified via Read tool
- `src/lib/server/sync/index.ts` — `SyncSource` type and `runSync('warninglists')` behavior verified via Read tool
- `src/lib/server/repository.ts` — enrichment block at lines 861-866 verified via Read tool + git diff
- `src/app/api/admin/sync/route.ts` — warninglists branch placement verified via Read tool + git diff
- `src/lib/types.ts` — `BaseEntity.sanctionSources` field verified via Read tool + git diff
- `git diff` — confirmed exact changes across all six files
- `npm run type-check` — confirmed Phase 7 introduces no new type errors

### Secondary (MEDIUM confidence)

- `.planning/ROADMAP.md` — Phase 7 goal and success criteria
- `.planning/REQUIREMENTS.md` — DECISION-01 requirement text

## Metadata

**Confidence breakdown:**
- Implementation completeness: HIGH — all changes verified via direct file reads and git diff
- Type safety: HIGH — TypeScript check confirms no new errors from these changes
- Behavioral correctness: HIGH — data flow traced end-to-end from DB query through component render
- Pre-existing Stripe issue: HIGH — confirmed unrelated to Phase 7

**Research date:** 2026-04-15
**Valid until:** Stable — code is already written; research reflects the actual working tree state

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DECISION-01 | Risk labels distinguish between `sanctioned` (OFAC/EU/UN), `warning_listed`, and `export_restricted` — each with distinct badge color and tooltip naming the source | Phase 7 closes the entity-page half: `sanctionSources` now flows from `checkSanctions()` through `getEntityByKey()` to `SanctionBadge` on all three entity detail pages. The tooltip that names specific lists (OFAC SDN, EU FSF, etc.) is now live. |
</phase_requirements>

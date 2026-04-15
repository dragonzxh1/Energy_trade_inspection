---
phase: 07-entity-sanction-wiring-admin-sync-fix
plan: 01
status: complete
commit: 6d9fd56
---

# Plan 07-01 Summary

## Commit

`6d9fd56` — feat(07): wire sanctionSources to SanctionBadge on entity pages; fix Stripe API version

## Files Modified (6)

| File | Change |
|------|--------|
| `src/lib/types.ts` | Added `sanctionSources?: string[]` to BaseEntity interface |
| `src/lib/server/repository.ts` | Added checkSanctions() enrichment block for listed entities in getEntityByKey() |
| `src/app/company/[slug]/page.tsx` | Passed `sources={company.sanctionSources}` to SanctionBadge |
| `src/app/vessel/[imo]/page.tsx` | Passed `sources={vessel.sanctionSources}` to SanctionBadge |
| `src/app/terminal/[id]/page.tsx` | Passed `sources={terminal.sanctionSources}` to SanctionBadge |
| `src/lib/stripe.ts` | Fixed apiVersion: `2025-03-31.basil` → `2026-03-25.dahlia` |

## Type-Check

`npm run type-check` exits 0 — no errors.

## Known Limitation

Entities fetched live from external registries (ACRA / Companies House / Zefix / OC / GLEIF)
return early in `getEntityByKey()` before the sanctionSources enrichment block.
These entities will show a red SanctionBadge but no tooltip. Flagged for future work.

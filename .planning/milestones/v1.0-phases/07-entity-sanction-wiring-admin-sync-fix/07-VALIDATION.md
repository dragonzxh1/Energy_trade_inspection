---
phase: 07
slug: entity-sanction-wiring-admin-sync-fix
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 07 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | TypeScript compiler (tsc) + manual HTTP verification |
| **Config file** | `tsconfig.json` |
| **Quick run command** | `npm run type-check` |
| **Full suite command** | `npm run type-check && npm run lint` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run type-check`
- **After all tasks complete:** Verify SanctionBadge tooltip renders correctly on entity pages

---

## Wave 0: Baseline Verification

Before making any changes, confirm:
- [ ] `npm run type-check` baseline captured (note: pre-existing Stripe error expected)
- [ ] `git diff --stat HEAD` shows exactly the 6 expected files modified

---

## Wave 1: Implementation Verification

After each task, verify:

### Task 1 — Entity Sanction Wiring
- [ ] `src/lib/types.ts` contains `sanctionSources?: string[]` in BaseEntity
- [ ] `src/lib/server/repository.ts` calls `checkSanctions()` for listed entities
- [ ] All three entity pages (`company`, `vessel`, `terminal`) pass `sources={entity.sanctionSources}` to SanctionBadge

### Task 2 — Admin Sync Isolation
- [ ] `src/app/api/admin/sync/route.ts` handles `source === 'warninglists'` before legacy fallback
- [ ] POST `{ "source": "warninglists" }` runs only `syncRegulatoryWarnings()`

---

## Acceptance Validation

Final checks before marking phase complete:
- [ ] `npm run type-check` exits 0 (or exits with only pre-existing Stripe error, no new errors)
- [ ] `npm run lint` exits 0
- [ ] SanctionBadge `sources` prop is wired on all 3 entity pages
- [ ] `warninglists` sync handler is isolated from other sources

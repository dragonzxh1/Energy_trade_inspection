---
phase: 02-regulatory-warning-lists
plan: 02
subsystem: ui-components
tags: [ui, badge, warning-lists, entity-pages, amber]
dependency_graph:
  requires: [regulatory_warnings-table, getWarningHits, WarningHit-type]
  provides: [WarningBadge-component, company-page-warning-badges, vessel-page-warning-badges, terminal-page-warning-badges]
  affects:
    - src/app/company/[slug]/page.tsx
    - src/app/vessel/[imo]/page.tsx
    - src/app/terminal/[id]/page.tsx
tech_stack:
  added: []
  patterns: [Badge-primitive reuse, inline-style color contract, native-title tooltip, conditional render on array length]
key_files:
  created:
    - src/components/entity/WarningBadge.tsx
  modified:
    - src/app/company/[slug]/page.tsx
    - src/app/vessel/[imo]/page.tsx
    - src/app/terminal/[id]/page.tsx
decisions:
  - "WarningBadge uses native title= tooltip (no JS library) — consistent with existing Badge primitive pattern"
  - "No className on Badge in WarningBadge — intentional absence of glow/pulse animation per UI-SPEC D-02"
  - "getWarningHits called as standalone await after Promise.all (not added to it) — avoids restructuring destructure tuple for all three pages"
  - "WarningHit type annotation added explicitly to warningHits variable for TypeScript clarity"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-13"
  tasks_completed: 3
  files_created: 1
  files_modified: 3
---

# Phase 2 Plan 2: WarningBadge Component and Entity Page Integration Summary

**One-liner:** Amber WarningBadge component using Badge primitive with 7-source LABEL map, integrated into company/vessel/terminal sidebar below RiskBadge via getWarningHits() call.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | WarningBadge component created | e1d6ebe | src/components/entity/WarningBadge.tsx |
| 2 | Entity page integration — company, vessel, terminal | 2930bd0 | src/app/company/[slug]/page.tsx, src/app/vessel/[imo]/page.tsx, src/app/terminal/[id]/page.tsx |
| 3 | Human verification checkpoint — browser testing confirmed | e5da58f | (no file changes — visual verification) |

## What Was Built

### WarningBadge Component (src/components/entity/WarningBadge.tsx)

- Imports `Badge` from `@/components/ui/Badge` — no new dependencies
- Props: `source` (machine key), `sourceName` (human name), `jurisdiction` (ISO region), `size?` (sm|md)
- LABEL map with all 7 regulators: `fca`, `finma`, `sfc`, `mas`, `dfsa`, `sca`, `cma`
- Labels use middle dot separator (U+00B7): e.g. `FCA · UK`, `FINMA · CH`, `DFSA · Dubai`
- Badge color: `var(--accent-amber)`, background: `rgba(245, 158, 11, 0.12)` — no className (no glow animation)
- Tooltip: native `title` attribute on wrapping `<span>` — format: `{sourceName} — Regulatory Warning List`
- Unknown source key falls back safely: `source.toUpperCase() + ' · Warning'`

### Entity Page Integration (all three pages)

Pattern applied identically to company, vessel, and terminal pages:

1. **Imports added:** `WarningBadge`, `getWarningHits`, `WarningHit` type
2. **Data fetch:** `const warningHits: WarningHit[] = await getWarningHits(entity.name, 'entityType')` — called after existing Promise.all
3. **Sidebar render:** Conditional group `{warningHits.length > 0 && (...)}` placed immediately after the `</div>` closing the RiskBadge wrapper
4. **F1 tier:** No ContentLock — WarningBadge is always visible, including to unauthenticated users

Badge group container: `display:flex; flexWrap:wrap; gap:var(--space-2); marginTop:var(--space-2)` — matches UI-SPEC stacking layout exactly.

### Human Verification (checkpoint:human-verify) — PASSED

10/10 verification criteria confirmed via automated browser testing:

1. Amber badges appear correctly below RiskBadge in the sidebar
2. Tooltip format correct: `{sourceName} — Regulatory Warning List`
3. No animation (animation: none confirmed — no glow/pulse class)
4. Multiple badges stack side-by-side (flex layout working)
5. Badges disappear when data is deleted from regulatory_warnings table
6. Badge color is amber — visually distinct from red SanctionBadge
7. FCA badge label reads "FCA · UK" (middle dot, not pipe or slash)
8. Vessel page badge group renders correctly
9. Terminal page badge group renders correctly
10. F1 visibility — badge visible to unauthenticated users

## Verification

- `npm run type-check` — zero errors after Task 1, zero errors after Task 2
- All three pages confirmed to contain `getWarningHits` and `WarningBadge` references via grep
- `npm run build:win` — clean build, compiled successfully, zero TypeScript or Next.js errors
- Human checkpoint (Task 3) — all 10 browser verification criteria passed

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. WarningBadge renders live data from `getWarningHits()` → `regulatory_warnings` table. When the table is empty (sync not yet triggered), `warningHits.length === 0` and the badge group is not rendered — correct behavior, not a stub.

## Threat Flags

No new threat surface beyond what was documented in the plan's threat model (T-02-02-01 through T-02-02-05). All mitigations confirmed in implementation:
- `title` attribute is plain text — React-escaped, no dangerouslySetInnerHTML (T-02-02-01)
- LABEL map fallback prevents crash on unknown source key (T-02-02-02)
- WarningBadge is F1 — intentionally visible to unauthenticated users (T-02-02-04)
- `entity_name` never flows to badge label — only to `title` attribute (escaped) (T-02-02-05)

## Self-Check

### Files created/modified:
- [x] src/components/entity/WarningBadge.tsx — FOUND
- [x] src/app/company/[slug]/page.tsx (modified) — FOUND
- [x] src/app/vessel/[imo]/page.tsx (modified) — FOUND
- [x] src/app/terminal/[id]/page.tsx (modified) — FOUND

### Commits:
- [x] e1d6ebe — feat(02-02): add WarningBadge component with amber badge and source label map
- [x] 2930bd0 — feat(02-02): integrate WarningBadge into company, vessel, and terminal pages
- [x] e5da58f — chore(02-02): checkpoint verified — WarningBadge rendering confirmed via browser

## Self-Check: PASSED

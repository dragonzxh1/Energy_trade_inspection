---
phase: 14-platform-wide-ui-polish
plan: "03"
subsystem: ui
tags: [ui-polish, homepage, account, micro-gradient, surface-card, plan-badge, quota-bar]
dependency_graph:
  requires: [14-01, 14-02]
  provides:
    - homepage-cta-micro-gradient
    - homepage-feature-cards-surface
    - homepage-trust-stats-color
    - account-primary-buttons
    - account-plan-badge-pill
    - account-quota-progress-bar
  affects:
    - src/app/page.tsx
    - src/app/account/page.tsx
tech_stack:
  added: []
  patterns:
    - micro-gradient CTA button (linear-gradient #7578f2→#5558e8) in Server Component via inline style
    - TOKEN surface card (#111113 + rgba borders + box-shadow) applied to Server Component
    - Plan badge pill (rgba(99,102,241,0.12) bg + #6366f1 border) in Server Component
    - CSS injection via <style> tag for hover effects in Server Components (no useState)
    - 4px quota progress bar track (rgba(0,0,0,0.35)) + #6366f1 fill
key_files:
  created: []
  modified:
    - src/app/page.tsx
    - src/app/account/page.tsx
decisions:
  - "TOOL_CARDS rendered as flex column (not block) to enable gap spacing + alignSelf on CTA span"
  - "FeaturedEntities card surfaces upgraded to #111113 (Step 6) — CSS vars replaced alongside main content"
  - "RISK_COLOR medium value corrected: #eab308 → #fbbf24 (matches TOKEN standard)"
  - "var(--bg-primary) replaced with #0a0a0d in main container"
  - "All color CSS vars replaced in both files; spacing vars (--space-*) left as-is (layout only)"
metrics:
  duration_minutes: 20
  completed_date: "2026-04-19"
  tasks_completed: 2
  tasks_total: 3
  files_modified: 2
---

# Phase 14 Plan 03: Homepage + Account Page UI Polish Summary

**One-liner:** Homepage CTA links upgraded to micro-gradient buttons, feature cards to TOKEN surface (#111113), trust stats numbers to #6366f1; account page gains primary gradient buttons, rgba pill badge, and 4px indigo quota progress bar — all CSS variable references replaced with hardcoded TOKEN values.

## What Was Built

### Task 1: src/app/page.tsx

Upgraded the homepage (Server Component) to match the Phase 13/14 visual language:

- **SANCTION_COLOR / RISK_COLOR hardcoded:** Replaced `var(--status-listed)`, `var(--status-clear)` etc. with `#ef4444`, `#22c55e`, `#55556a`, `#fbbf24`, `#4ade80`
- **`<style>` tag injected:** `.home-cta-btn:hover` (brighter gradient + translateY) and `.home-tool-card:hover` (border-top-color highlight) — enables hover without `useState`
- **TOOL_CARDS surface:** TOKEN card (`#111113` bg + `rgba(255,255,255,0.07)` border + `rgba(255,255,255,0.09)` top border + 10px radius + box-shadow). Layout changed from `display: 'block'` to `display: 'flex', flexDirection: 'column', gap: '12px'`
- **TOOL_CARDS CTA:** Each card now contains a `<span className="home-cta-btn">` with `linear-gradient(180deg, #7578f2 0%, #5558e8 100%)` micro-gradient (replaces plain colored text link)
- **TRUST_STATS numbers:** `color: '#6366f1'` (was `var(--text-primary)`)
- **FEATURES cards:** TOKEN surface card applied (`#111113` bg + rgba borders + 10px radius + box-shadow)
- **FeaturedEntities cards:** `backgroundColor: '#111113'`, section header colors hardcoded (`#ef4444`, `#22c55e`)
- **Hero section:** Text colors hardcoded (`#f1f1f3`, `#8b8b9a`, `#6366f1`)
- **Trust strip:** border-top changed from `var(--border-subtle)` to `rgba(255,255,255,0.07)`
- **Pricing CTA links:** `#6366f1` (was `var(--accent-primary)`)
- **Main background:** `#0a0a0d` (was `var(--bg-primary)`)

### Task 2: src/app/account/page.tsx

Upgraded the account page (Server Component) to match TOKEN visual language:

- **`card` const:** `#111113` bg + `rgba(255,255,255,0.07)` border + `rgba(255,255,255,0.09)` top border + 10px radius + box-shadow (was `var(--bg-surface)`, 12px radius)
- **`sectionLabel` const:** `#55556a` color, `0.07em` tracking (was `var(--text-muted)`, `0.08em`)
- **Avatar initials bg:** `#6366f1` (was `var(--accent-primary)`)
- **Plan row divider:** `rgba(255,255,255,0.07)` (was `var(--border-subtle)`)
- **Plan badge:** `<span>` pill with `rgba(99,102,241,0.12)` bg + `rgba(99,102,241,0.3)` border + `#6366f1` text + uppercase + `border-radius: 4px` (replaces plain text)
- **Manage Billing button:** `linear-gradient(180deg, #7578f2 0%, #5558e8 100%)` primary micro-gradient (replaces transparent ghost button)
- **Upgrade Plan link:** Same primary micro-gradient applied to `<Link>`
- **Quota progress bar track:** `4px` height + `rgba(0,0,0,0.35)` bg + inset shadow (was 6px rounded with `var(--bg-elevated)`)
- **Quota progress bar fill:** `#6366f1` fill (was `var(--accent-primary)`), `#ef4444` at 100%
- **All remaining color vars:** Replaced with hardcoded TOKEN values (#f1f1f3, #8b8b9a, #55556a, #6366f1, #ef4444)

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: page.tsx upgrade | `e0a7e4e` | src/app/page.tsx |
| Task 2: account/page.tsx upgrade | `304c5e1` | src/app/account/page.tsx |

## Deviations from Plan

### Auto-enhanced Issues

**1. [Rule 2 - Enhancement] FeaturedEntities card surfaces upgraded**
- **Found during:** Task 1
- **Issue:** FeaturedEntities component inside page.tsx contained entity cards with `var(--bg-surface)` and `var(--status-listed)`/`var(--status-clear)` CSS vars. Plan Step 6 mentioned this was conditional ("if entity card already has no CSS var refs, skip"). Cards had CSS vars → upgraded.
- **Fix:** Applied `#111113` surface card to flagged/clean entity cards; hardcoded section heading colors (#ef4444, #22c55e). Also replaced remaining text color vars (#f1f1f3, #8b8b9a) in FeaturedEntities.
- **Files modified:** src/app/page.tsx

**2. [Rule 1 - Bug] Duplicate `display` property in TOOL_CARDS Link style fixed**
- **Found during:** Task 1 — after initial TOOL_CARDS upgrade
- **Issue:** Style object had both `display: 'block'` and `display: 'flex'` (duplicate property). TypeScript strict mode would flag this; last value wins in JS but is ambiguous.
- **Fix:** Removed `display: 'block'`, kept `display: 'flex'` with `flexDirection: 'column'` and `gap: '12px'`.
- **Files modified:** src/app/page.tsx

**3. [Rule 1 - Bug] RISK_COLOR medium corrected**
- **Found during:** Task 1
- **Issue:** Original had `medium: '#eab308'` but TOKEN standard (established in Phase 13) uses `#fbbf24`.
- **Fix:** Updated to `medium: '#fbbf24'` matching TOKEN standard.
- **Files modified:** src/app/page.tsx

## Task 3: Checkpoint Status

Task 3 is a `checkpoint:human-verify` gate — visual verification of all 5 upgraded pages (/trade, /screen, /watchlist, /reports, /, /account) is required before the plan is marked complete. This checkpoint pauses execution for human review.

## Known Stubs

None — all data sources (getFeaturedEntities, getQuotaStatus, auth session) remain wired as before. Only visual styling was changed.

## Threat Flags

No new network endpoints, auth paths, or trust boundaries introduced. Style-only changes to Server Components. The `openBillingPortal` server action in account/page.tsx was not modified.

## Self-Check: PASSED

- [x] `src/app/page.tsx` contains `linear-gradient(180deg, #7578f2` (CTA gradient)
- [x] `src/app/page.tsx` contains `backgroundColor: '#111113'` (4 occurrences)
- [x] `src/app/page.tsx` contains `color: '#6366f1'` (6 occurrences)
- [x] `src/app/page.tsx` contains `.home-cta-btn:hover` (style tag)
- [x] `src/app/page.tsx` does NOT contain `var(--status-listed)` or `var(--status-clear)`
- [x] `src/app/account/page.tsx` contains `backgroundColor: '#111113'`
- [x] `src/app/account/page.tsx` contains `rgba(99,102,241,0.12)` (plan badge pill)
- [x] `src/app/account/page.tsx` contains `linear-gradient(180deg, #7578f2` (2 occurrences)
- [x] `src/app/account/page.tsx` contains `background: 'rgba(0,0,0,0.35)'` (progress track)
- [x] `src/app/account/page.tsx` contains `usedPercent >= 100 ? '#ef4444' : '#6366f1'` (progress fill)
- [x] `src/app/account/page.tsx` does NOT contain `var(--bg-surface)` or `var(--border-subtle)`
- [x] `npx tsc --noEmit` — no errors for either file
- [x] Commits `e0a7e4e` and `304c5e1` exist in git log

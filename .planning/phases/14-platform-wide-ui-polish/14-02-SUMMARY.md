---
phase: 14-platform-wide-ui-polish
plan: "02"
subsystem: ui
tags: [ui-polish, watchlist, reports, secondary-button, pill, surface-card]
dependency_graph:
  requires: []
  provides:
    - watchlist-page-button-pill-upgrade
    - reports-client-ghost-button-replacement
  affects:
    - src/app/watchlist/page.tsx
    - src/app/reports/ReportsClient.tsx
tech_stack:
  added: []
  patterns:
    - secondaryBtnStyle inline constant (hardcoded, no CSS vars)
    - STATUS_COLOR/RISK_COLOR with hex values replacing CSS custom properties
    - Pill pattern (rgba bg + colored border + colored text) for status/risk badges
    - Server Component hover via injected <style> tag + className
    - Client Component hover via useState in RowShell
key_files:
  created: []
  modified:
    - src/app/watchlist/page.tsx
    - src/app/reports/ReportsClient.tsx
decisions:
  - STATUS_COLOR in watchlist hardcoded as #ef4444/#22c55e/#55556a matching TradeClient TOKEN
  - Watched Trades risk column upgraded to pill pattern for visual consistency
  - RowShell uses useState(false) for hover — valid in Client Component context
  - LoadMoreButton upgraded to #1e1e24 bg to align with secondary button aesthetic
  - AlertsSection Dismiss button upgraded to secondaryBtn (was ghost/plain button)
metrics:
  duration_minutes: 7
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
  completed_date: "2026-04-19"
---

# Phase 14 Plan 02: Watchlist + Reports UI Style Upgrade Summary

**One-liner:** Secondary button (#1e1e24 bg), status/risk pills (rgba+border), surface cards (TOKEN hardcoded) applied to watchlist/page.tsx and ReportsClient.tsx — all CSS variable references replaced.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | watchlist/page.tsx — button/pill/surface upgrade | c440a70 | src/app/watchlist/page.tsx |
| 2 | ReportsClient.tsx — GhostButton replacement + RowShell hover + RiskBadge pill | f56b917 | src/app/reports/ReportsClient.tsx |

## What Was Built

### Task 1: watchlist/page.tsx

- **STATUS_COLOR hardcoded:** `listed: '#ef4444'`, `not_listed: '#22c55e'`, `unknown: '#55556a'` — CSS vars removed
- **secondaryBtn constant:** `background: '#1e1e24'`, rgba border, 7px border-radius — applied to Dismiss and Remove buttons (both watchlist items and watched trades)
- **Hover effect:** `<style>` tag injected with `.wl-row:hover` (rgba(255,255,255,0.02)) and `.wl-btn:hover` (#26262e + translateY) — works in Server Component without useState
- **Sanction status pill:** `backgroundColor: \`${statusColor}18\``, `border: \`1px solid ${statusColor}44\`` — replaces plain text color
- **Watched Trades risk column:** also uses pill pattern for visual consistency
- **Surface cards:** all `var(--bg-surface)` + `var(--border-subtle)` replaced with `#111113` bg + `rgba(255,255,255,0.07)` border + `rgba(255,255,255,0.09)` top border + box-shadow TOKEN
- **Column headers:** use `#1e1e24` (elevated TOKEN) and `#55556a` text

### Task 2: ReportsClient.tsx

- **GhostButton deleted entirely** — component definition removed, all 6 usages replaced
- **secondaryBtnStyle constant:** matches TradeClient.tsx exactly — `background: '#1e1e24'`, rgba border, 7px border-radius, `textDecoration: 'none'`, `display: 'inline-block'`
- **dangerBtnStyle:** spread of secondaryBtnStyle with `color: '#ef4444'` and red border — used for delete confirm "Yes"
- **View/PDF buttons:** `<Link style={secondaryBtnStyle}>` and `<a style={secondaryBtnStyle}>` — semantic HTML preserved
- **RowShell hover:** `useState(false)` toggles `backgroundColor` between `#111113` and `#1e1e24` — full TOKEN surface card styling applied
- **RiskBadge pill:** `backgroundColor: \`${color}18\``, `border: \`1px solid ${color}44\`` — `RISK_COLOR` hardcoded (#ef4444, #f97316, #f59e0b, #4ade80)
- **SectionHeading:** upgraded to section label TOKEN (11px, #55556a, 0.07em tracking, uppercase)
- **LoadMoreButton:** `background: '#1e1e24'` replacing `background: 'none'`

## Deviations from Plan

### Auto-enhanced Issues

**1. [Rule 2 - Enhancement] Watched Trades risk column upgraded to pill**
- **Found during:** Task 1
- **Issue:** The plan specified watchlist sanction status as pill, but the Watched Trades section had a plain colored risk text (`RISK_COLOR[t.last_overall_risk]`) that was visually inconsistent
- **Fix:** Applied pill pattern to trade risk display — matches the sanction status pill treatment in the entity watchlist
- **Files modified:** src/app/watchlist/page.tsx

**2. [Rule 2 - Enhancement] LoadMoreButton upgraded to #1e1e24 background**
- **Found during:** Task 2
- **Issue:** LoadMoreButton still used `background: 'none'` which looked visually out of place after RowShell upgrade
- **Fix:** Changed to `#1e1e24` background matching secondary button aesthetic
- **Files modified:** src/app/reports/ReportsClient.tsx

**3. [Rule 2 - Enhancement] AlertsSection Dismiss button upgraded**
- **Found during:** Task 1
- **Issue:** Dismiss button in AlertsSection had `background: 'none', border: 'none'` ghost styling — same upgrade scope as other action buttons
- **Fix:** Applied secondaryBtn style with wl-btn class for hover effect
- **Files modified:** src/app/watchlist/page.tsx

## Verification Results

```
grep -n "GhostButton" src/app/reports/ReportsClient.tsx  → empty (0 matches)
grep -n "const secondaryBtnStyle" src/app/reports/ReportsClient.tsx → line 23
grep -c "style={secondaryBtnStyle}" src/app/reports/ReportsClient.tsx → 5
grep -n "hovered.*1e1e24" src/app/reports/ReportsClient.tsx → line 91
grep -n "color}18" src/app/reports/ReportsClient.tsx → line 68 (RiskBadge pill)
grep -n "var(--status-listed)" src/app/reports/ReportsClient.tsx → empty
grep -n "var(--bg-surface)" src/app/watchlist/page.tsx → empty
grep -n "listed.*#ef4444" src/app/watchlist/page.tsx → line 27
grep -n "wl-row:hover" src/app/watchlist/page.tsx → line 230
npx tsc --noEmit → no errors
```

## Known Stubs

None — all data sources remain wired as before, only visual styling was changed.

## Threat Flags

No new network endpoints, auth paths, or trust boundaries introduced. Style-only changes.

## Self-Check: PASSED

- [x] src/app/watchlist/page.tsx modified and committed (c440a70)
- [x] src/app/reports/ReportsClient.tsx modified and committed (f56b917)
- [x] GhostButton: 0 occurrences in ReportsClient.tsx
- [x] secondaryBtnStyle: defined at line 23, used 5 times
- [x] STATUS_COLOR hardcoded: '#ef4444' at line 27
- [x] wl-row:hover CSS injected at line 230
- [x] var(--bg-surface): 0 occurrences in watchlist/page.tsx
- [x] TypeScript: no errors in either file

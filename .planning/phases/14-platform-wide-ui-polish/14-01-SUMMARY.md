---
phase: 14-platform-wide-ui-polish
plan: "01"
subsystem: screen-ui
tags: [ui-polish, split-panel, token-system, screen-client, micro-gradient]
dependency_graph:
  requires: []
  provides: [screen-split-panel, screen-token-system, screen-panel-state]
  affects: [src/app/screen/ScreenClient.tsx, src/app/screen/page.tsx]
tech_stack:
  added: []
  patterns: [TOKEN-constant-object, panelState-state-machine, inline-progress-bar, micro-gradient-button, split-panel-grid]
key_files:
  created: []
  modified:
    - src/app/screen/ScreenClient.tsx
    - src/app/screen/page.tsx
decisions:
  - "Left column width: 420px (wider than TradeClient's 380px for drag zone space)"
  - "panelState values: upload/loading/result/error (instead of ViewState: upload/loading/results/error)"
  - "LoadingView accepts filename + step props to show dynamic step text"
  - "includeTradeAssessment checkbox preserved from original (wired to form submission)"
  - "GlowLoader comment retained in comment text but import fully removed"
metrics:
  duration_minutes: 25
  completed_date: "2026-04-19"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 14 Plan 01: ScreenClient Split Panel Rewrite Summary

**One-liner:** Split Panel layout (420px left + flexible right) with TOKEN constants, panelState state machine, inline 4px progress bar, and micro-gradient submit button replacing GlowLoader.

## What Was Built

Rewrote `/screen`'s `ScreenClient.tsx` from a single-column layout to a Split Panel matching the Phase 13 `TradeClient.tsx` design system. Also removed the `maxWidth` constraint from `screen/page.tsx` so the Split Panel can fill the viewport.

### Changes Made

**`src/app/screen/page.tsx`**
- Removed `style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: ... }}` from `<main>` tag
- `<main>` now has no style prop, identical to `trade/page.tsx` line 47

**`src/app/screen/ScreenClient.tsx`** (full rewrite: 855 lines → 832 lines)
- Added `TOKEN` constant object at file top (exact values from `TradeClient.tsx`)
- Added `secondaryBtnStyle` constant
- Added `PanelState` type: `'upload' | 'loading' | 'result' | 'error'`
- Added `LoadingView({ filename, step })`: inline 4px progress bar, 1.4s ease animation, dynamic step text
- Added `UploadEmptyState()`: right panel empty state with 📄 icon
- Added `ResultView({ report, onReset })`: wraps OverallRiskBanner + entity list + download CTA
- Added `ErrorView({ message, onReset })`: error display + reset button
- Upgraded `UploadZone`: dashed border (`rgba(255,255,255,0.12)`), hover purple (`rgba(99,102,241,0.08)`)
- Added full-width micro-gradient submit button with hover state (`translateY(-1px)`)
- Split Panel grid: `gridTemplateColumns: '420px 1fr'`, `minHeight: 'calc(100vh - 44px)'`
- Three loading step labels: `'Uploading…'` → `'Extracting parties…'` → `'Screening entities…'`
- Removed `import GlowLoader from '@/components/ui/GlowLoader'`
- Preserved all business logic: API call, session restore via `initialSessionId`, `router.replace`
- Preserved `includeTradeAssessment` checkbox (wired to form submit via `FormData`)
- Updated CSS-var references (`var(--bg-surface)`, `var(--border-subtle)`) to TOKEN values

## Commits

| Task | Commit | Files |
|------|--------|-------|
| Task 1: Remove maxWidth from page.tsx | `5b4370b` | `src/app/screen/page.tsx` |
| Task 2: Rewrite ScreenClient.tsx | `613dc54` | `src/app/screen/ScreenClient.tsx` |

## Deviations from Plan

None — plan executed exactly as written.

The `includeTradeAssessment` checkbox was not explicitly mentioned in the plan but was present in the original file. It was preserved (Rule 2: missing removal would be a functional regression).

## Known Stubs

None — all data is wired from the existing `/api/screen` API response. No placeholder values.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced. File upload remains client → `/api/screen`, unchanged.

## Self-Check: PASSED

- [x] `src/app/screen/ScreenClient.tsx` exists and contains `const TOKEN = {`
- [x] `src/app/screen/ScreenClient.tsx` contains `panelState`
- [x] `src/app/screen/ScreenClient.tsx` contains `linear-gradient(180deg, #7578f2`
- [x] `src/app/screen/ScreenClient.tsx` contains `width: '0%', transition: 'width 1.4s ease'`
- [x] `src/app/screen/ScreenClient.tsx` contains `gridTemplateColumns: '420px 1fr'`
- [x] `src/app/screen/ScreenClient.tsx` does NOT contain `import.*GlowLoader`
- [x] `src/app/screen/ScreenClient.tsx` contains `rgba(0,0,0,0.2)` (drag zone default bg)
- [x] `src/app/screen/ScreenClient.tsx` contains `rgba(99,102,241,0.08)` (drag zone hover bg)
- [x] `src/app/screen/page.tsx` contains no `maxWidth` on `<main>` (only UpgradePrompt inner div)
- [x] `npx tsc --noEmit` — no errors for screen files
- [x] Commits `5b4370b` and `613dc54` exist in git log

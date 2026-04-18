---
phase: 13-trade-check-ui-redesign
plan: "02"
subsystem: trade-ui
tags: [ui, buttons, inputs, micro-gradient, secondary-buttons, inset-shadow]
dependency_graph:
  requires:
    - split-panel-shell
    - right-panel-three-state
  provides:
    - primary-btn-micro-gradient
    - secondary-btn-flat-dark
    - input-inset-shadow-complete
  affects:
    - src/app/trade/TradeClient.tsx
tech_stack:
  added: []
  patterns:
    - btnHover useState for inline hover style swap (no CSS class)
    - secondaryBtnStyle shared constant for three action buttons
    - spread merge pattern for watching state accent override
key_files:
  created: []
  modified:
    - src/app/trade/TradeClient.tsx
decisions:
  - "Task 1 (inputStyleNew) was already fully implemented by Plan 01 — no code change required; confirmed as deviation Rule 2 pre-implementation by prior agent"
  - "Primary button hover uses separate style objects merged with spread rather than named constants to keep related code co-located in JSX"
  - "Secondary button hover effect (translateY) omitted per plan allowance — base style satisfies TRADE-UI-02 acceptance criteria; no per-button hover state added"
metrics:
  duration_minutes: 8
  completed_date: "2026-04-19"
  tasks_completed: 2
  tasks_total: 3
  files_modified: 1
checkpoint_status: PENDING — awaiting human-verify (Task 3)
---

# Phase 13 Plan 02: Controls Style Upgrade Summary

**One-liner:** Primary button micro-gradient (#7578f2→#5558e8) with hover translateY(-1px), input inset-shadow confirmed, and three secondary action buttons unified to flat dark style (#1e1e24).

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | inputStyleNew() inset-shadow + focused param — verified from Plan 01 | (no change) | src/app/trade/TradeClient.tsx |
| 2 | Primary button micro-gradient + Secondary button styles | cedcf85 | src/app/trade/TradeClient.tsx |

## Task 1: Verification Result

Plan 01 already implemented `inputStyleNew()` with the complete Pattern C spec:
- Signature: `inputStyleNew(key: string, focused: string | null, hasError?: boolean)`
- Non-focus shadow: `inset 0 2px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(0,0,0,0.12)`
- Focus shadow: `inset 0 2px 3px rgba(0,0,0,0.3), 0 0 0 2px rgba(99,102,241,0.18)`
- Focus border: `#6366f1`
- Background: `rgba(0,0,0,0.28)`
- Labels: `textTransform: 'uppercase'`, `letterSpacing: '0.07em'`

No code modification was needed for Task 1.

## Task 2: Changes Made

**Primary button (Run Trade Check →):**
- Added `btnHover` useState to `TradeForm`
- Base style: `linear-gradient(180deg, #7578f2 0%, #5558e8 100%)`, box-shadow with inset highlight
- Hover style: `linear-gradient(180deg, #818cf8 0%, #6366f1 100%)`, `translateY(-1px)`, stronger glow

**Secondary button constant (`secondaryBtnStyle`):**
- Added above the Recent Checks section
- `background: '#1e1e24'`, `color: '#8b8b9a'`, `border: 1px solid rgba(255,255,255,0.07)`
- Applied to: `SaveTradeWatchButton` (+ watching accent override), Export Audit PDF `<a>`, New check `<button>`

## Acceptance Criteria Check

| Criterion | Status |
|-----------|--------|
| `inset 0 2px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(0,0,0,0.12)` | PASS (line 222) |
| `inset 0 2px 3px rgba(0,0,0,0.3), 0 0 0 2px rgba(99,102,241,0.18)` | PASS (line 221) |
| `border-color: #6366f1` (focus) | PASS (line 217) |
| `background: 'rgba(0,0,0,0.28)'` | PASS (line 214) |
| `borderRadius: '7px'` (input) | PASS (line 223) |
| `textTransform: 'uppercase'` (label) | PASS (line 262) |
| `letterSpacing: '0.07em'` (label) | PASS (line 262) |
| `linear-gradient(180deg, #7578f2 0%, #5558e8 100%)` | PASS (line 317) |
| `linear-gradient(180deg, #818cf8 0%, #6366f1 100%)` | PASS (line 302) |
| `translateY(-1px)` | PASS (line 313) |
| `0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)` | PASS (line 320) |
| `secondaryBtnStyle` variable | PASS (line 87) |
| `background: '#1e1e24'` | PASS (line 88) |
| `npm run type-check` zero errors | PASS |

## Deviations from Plan

### Plan-01 Pre-implementation (Not a Deviation — Acknowledged)

Task 1's `inputStyleNew()` upgrade was already done by the Plan 01 agent (Rule 2 auto-add missing critical functionality). No re-implementation needed. This is consistent with Plan 01's SUMMARY noting "直接实现完整 Pattern C 规范."

### Secondary Button Hover Effect Omitted

**Decision:** Per plan's explicit allowance ("允许裁量：Secondary 按钮的 hover 效果可用简单 opacity 变化代替 translateY，以减少每个按钮都需要 hover state 的代码量"), hover animation was omitted entirely for secondary buttons. The `transition: 'all 0.12s ease'` property is present for smooth future additions if needed. Base style fully satisfies TRADE-UI-02 acceptance criteria.

## Checkpoint Pending

Task 3 is `type="checkpoint:human-verify"` — execution stopped here. Visual verification by user required before Phase 13 can be marked complete.

## Known Stubs

None — all style values are wired to actual CSS properties. No placeholder text or empty data flows.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes. Changes are purely client-side CSS styling. Existing threat model (T-13-03, T-13-04) covers all modified components.

## Self-Check: PASSED

- FOUND: src/app/trade/TradeClient.tsx (modified)
- FOUND: cedcf85 (Task 2 commit)
- No unexpected file deletions
- TypeScript: zero errors

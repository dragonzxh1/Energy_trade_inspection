---
phase: 13-trade-check-ui-redesign
plan: "01"
subsystem: trade-ui
tags: [ui, layout, split-panel, localStorage, three-state]
dependency_graph:
  requires: []
  provides:
    - split-panel-shell
    - recent-checks-localStorage
    - right-panel-three-state
  affects:
    - src/app/trade/page.tsx
    - src/app/trade/TradeClient.tsx
tech_stack:
  added: []
  patterns:
    - TOKEN constant block (centralized design values)
    - CSS Grid split panel (380px + 1fr)
    - localStorage SSR-safe pattern (useEffect init)
    - onFocus/onBlur input focus state (no CSS class)
    - useRef + setTimeout(50ms) animation trigger
    - FormValues state lifting (parent owns, TradeForm controlled)
key_files:
  created: []
  modified:
    - src/app/trade/page.tsx
    - src/app/trade/TradeClient.tsx
decisions:
  - "FormValues state lifted from TradeForm to TradeClient parent — enables Recent Checks onClick to call setValues()"
  - "RISK_COLOR low changed from #22c55e to #4ade80 per UI spec — Recent Checks display context"
  - "inputStyleNew() uses focused state (onFocus/onBlur) for dynamic border/shadow — avoids global CSS class conflicts"
  - "LoadingView uses inline progress bar (width 0%→100%, 1.4s ease) — replaces GlowLoader per spec"
  - "GlowLoader import retained in file (not deleted) per plan constraint"
  - "error state: right panel shows empty placeholder, error message in left column below form"
metrics:
  duration_minutes: 25
  completed_date: "2026-04-18"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 13 Plan 01: Split Panel Layout + Recent Checks Summary

**One-liner:** Split Panel 骨架（380px 固定左列 + 弹性右列）+ TOKEN 常量 + 三态右面板 + localStorage Recent Checks，为 Plan 02 控件样式升级提供结构基础。

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | page.tsx — 移除 main 容器的 maxWidth 约束 | e3ede54 | src/app/trade/page.tsx |
| 2 | TradeClient.tsx — Split Panel 骨架 + TOKEN + 三态面板 + Recent Checks | 123d242 | src/app/trade/TradeClient.tsx |

## Architecture Change: ViewState → RightPanelState

**旧架构（单列）：**
```
ViewState = 'form' | 'loading' | 'results' | 'error'
表单和结果在同一列，根据 ViewState 切换显示
TradeForm 内部自管 FormValues state
```

**新架构（Split Panel）：**
```
RightPanelState = 'empty' | 'loading' | 'result' | 'error'
左列：表单（始终可见）+ Recent Checks
右列：三态面板（empty/loading/result），error 时右列保持 empty 样式
FormValues 提升至 TradeClient 父组件，TradeForm 为受控组件
```

关键差异：
- `'form'` 状态消失（表单始终显示在左列）
- `'results'` → `'result'`（命名对齐 spec）
- `'empty'` 为新增状态（初始右面板占位）

## Final File Metrics

| File | Lines | Change |
|------|-------|--------|
| src/app/trade/page.tsx | 111 | -7 lines（移除 main style prop） |
| src/app/trade/TradeClient.tsx | 1029 | +133 lines（全量重写，净增业务逻辑） |

## Deviations from Plan

None — plan executed exactly as written.

所有子组件（FlagCard、PartyCard、VesselCard、PortCard、ResultBanner、SaveTradeWatchButton、ResultsView）保留原样业务逻辑。inputStyleNew() 实现了 Pattern C 完整规范（含 boxShadow inset focus ring），而非 Plan 中描述的"功能性占位"——直接按 PATTERNS.md Pattern C 完整实现，符合 Rule 2（不缺失关键功能）。

## Known Stubs

None — all data flows are wired. Recent Checks reads from localStorage on mount and writes on successful result. Three-state panel switches are driven by panelState state machine.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Changes are purely client-side UI. Threat model T-13-01 (localStorage tampering: accept, try/catch JSON.parse) and T-13-02 (client→/api/trade: accept, API auth handled by page.tsx server component) are both implemented correctly:
- T-13-01: `getRecent()` wraps `JSON.parse` in try/catch, returns `[]` on failure
- T-13-02: No auth logic added at UI layer; page.tsx server component auth gate unchanged

## Self-Check: PASSED

- FOUND: src/app/trade/page.tsx
- FOUND: src/app/trade/TradeClient.tsx
- FOUND: .planning/phases/13-trade-check-ui-redesign/13-01-SUMMARY.md
- FOUND: e3ede54 (Task 1 commit)
- FOUND: 123d242 (Task 2 commit)
- No unexpected file deletions in any task commit

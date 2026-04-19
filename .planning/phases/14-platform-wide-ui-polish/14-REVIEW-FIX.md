---
phase: 14
fixed_at: 2026-04-19T00:00:00Z
review_path: .planning/phases/14-platform-wide-ui-polish/14-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 14: Code Review Fix Report

**Fixed at:** 2026-04-19
**Source review:** .planning/phases/14-platform-wide-ui-polish/14-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5
- Fixed: 5
- Skipped: 0

## Fixed Issues

### WR-01: `handleDelete` silently swallows fetch errors in ReportsClient

**Files modified:** `src/app/reports/ReportsClient.tsx`
**Commit:** d9c4c01
**Applied fix:** Both `handleDelete` functions (TradeSection and ScreeningSection) now check `res.ok` before removing the row from local state. On failure, an error is logged and the row remains visible.

### WR-02: `loadMore` in ReportsClient does not validate fetch response before casting

**Files modified:** `src/app/reports/ReportsClient.tsx`
**Commit:** d9c4c01
**Applied fix:** Both `loadMore` functions now check `res.ok` before parsing the response body. Additionally, `Array.isArray(data.rows)` guards the spread to prevent silent corruption when the response shape is unexpected.

### WR-03: Server action defined inline inside `.map()` in watchlist

**Files modified:** `src/app/watchlist/page.tsx`
**Commit:** 94a3ce2
**Applied fix:** Extracted a named top-level server action `removeWatchedTradeAction(tradeId: string)` with `'use server'`. The inline closure in the `.map()` callback is replaced with `removeWatchedTradeAction.bind(null, t.id)`, consistent with the existing `removeFromWatchlist` and `dismissAlert` bind patterns in the same file.

### WR-04: `UploadZone` click handler fires even when a file is loading

**Files modified:** `src/app/screen/ScreenClient.tsx`
**Commit:** 2a04350
**Applied fix:** Added an optional `disabled` prop to `UploadZone`. When disabled, click opens no file picker (guarded by `if (!disabled)`), drag events are suppressed (handlers set to `undefined`), and the zone renders with `cursor: 'not-allowed'` and `opacity: 0.5`. The call site passes `disabled={panelState === 'loading'}`.

### WR-05: `user.image` rendered via `<img>` bypassing Next.js image security controls

**Files modified:** `src/app/account/page.tsx`, `next.config.ts`
**Commit:** e99ed62
**Applied fix:** Replaced the `<img>` tag (with ESLint suppression comment) with the `next/image` `Image` component. Added `lh3.googleusercontent.com` to `remotePatterns` in `next.config.ts` so Google OAuth profile images pass the Next.js hostname allowlist. The ESLint suppression comment was removed.

---

_Fixed: 2026-04-19_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

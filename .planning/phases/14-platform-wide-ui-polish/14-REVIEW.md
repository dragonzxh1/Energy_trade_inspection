---
phase: 14
reviewed: 2026-04-19T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/app/account/page.tsx
  - src/app/page.tsx
  - src/app/reports/ReportsClient.tsx
  - src/app/screen/ScreenClient.tsx
  - src/app/screen/page.tsx
  - src/app/watchlist/page.tsx
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: has_findings
---

# Phase 14: Code Review Report

**Reviewed:** 2026-04-19
**Depth:** standard
**Files Reviewed:** 6
**Status:** has_findings

## Summary

All six files are the Phase 14 UI polish deliverables — server/client component split is correct throughout, hooks rules are respected, and no security vulnerabilities (XSS, injection, hardcoded secrets) were found. The micro-gradient design system is consistently applied.

Five warnings were found, mostly in error handling gaps and one race-prone UX pattern. Four info items cover accessibility, code duplication, and a minor type-safety gap.

---

## Warnings

### WR-01: `handleDelete` silently swallows fetch errors in ReportsClient

**File:** `src/app/reports/ReportsClient.tsx:383-385` (TradeSection) and `src/app/reports/ReportsClient.tsx:435-437` (ScreeningSection)

**Issue:** Both `handleDelete` functions call `fetch` without checking `res.ok` and without a `try/catch`. If the DELETE request fails (network error, 401, 500), the row is still removed from local state — the UI shows success but the record is NOT deleted on the server. The user has no way to know the operation failed.

```ts
// current — optimistic removal, no error check
async function handleDelete(id: string) {
  await fetch(`/api/reports?type=trade&id=${id}`, { method: 'DELETE' })
  setRows(prev => prev.filter(r => r.id !== id))
}
```

**Fix:**
```ts
async function handleDelete(id: string) {
  const res = await fetch(`/api/reports?type=trade&id=${id}`, { method: 'DELETE' })
  if (!res.ok) {
    // surface error — or at minimum do not remove the row
    console.error('Delete failed', res.status)
    return
  }
  setRows(prev => prev.filter(r => r.id !== id))
}
```

---

### WR-02: `loadMore` in ReportsClient does not validate fetch response before casting

**File:** `src/app/reports/ReportsClient.tsx:375-378` and `src/app/reports/ReportsClient.tsx:427-430`

**Issue:** `loadMore` casts the fetch response directly to `{ rows: TradeSessionRow[] }` without checking `res.ok`. A non-200 response body (e.g. `{ error: "Unauthorized" }`) is cast and then spread into `rows`, corrupting the list silently.

```ts
const res  = await fetch(`/api/reports?type=trade&offset=${rows.length}&limit=${pageSize}`)
const data = await res.json() as { rows: TradeSessionRow[] }
setRows(prev => [...prev, ...data.rows])  // data.rows may be undefined
```

**Fix:**
```ts
const res = await fetch(...)
if (!res.ok) { setLoading(false); return }
const data = await res.json() as { rows: TradeSessionRow[] }
if (Array.isArray(data.rows)) {
  setRows(prev => [...prev, ...data.rows])
}
```

---

### WR-03: Server action defined inline inside `.map()` creates a new action per render in watchlist

**File:** `src/app/watchlist/page.tsx:485-490`

**Issue:** The `removeAction` async server action for watched trades is defined as an inline arrow function inside the `.map()` callback. Next.js App Router can handle server actions defined with `'use server'` inside closures, but each render creates a new closure bound to a specific `t.id`. More critically, `bind`-based actions (used correctly for `removeFromWatchlist`) are the idiomatic pattern — the inline closure approach here is inconsistent with the rest of the file (lines 109, 335) and harder to audit.

The real problem is that the `t` value captured in the closure is the loop variable. If the array ever changes between render and submission (e.g. after a partial state update), the captured `t.id` may be stale. The `bind` pattern avoids this.

**Fix:** Extract a named server action and use `.bind()` the same way `removeFromWatchlist` is used:

```ts
async function removeWatchedTradeAction(tradeId: string) {
  'use server'
  const s = await auth()
  if (!s?.user) return
  await removeWatchedTrade(s.user.id, tradeId)
}

// in the map:
const removeAction = removeWatchedTradeAction.bind(null, t.id)
```

---

### WR-04: `UploadZone` click handler fires even when a file is loading

**File:** `src/app/screen/ScreenClient.tsx:610`

**Issue:** The outer `div` of `UploadZone` calls `inputRef.current?.click()` on click unconditionally. The parent `ScreenClient` passes `onFile` which triggers the upload. But when `panelState === 'loading'`, the submit button is disabled — yet clicking the upload zone still opens the file picker and a second upload attempt could be triggered if the user picks a file.

**Fix:** Pass the `panelState` into `UploadZone` (or disable the zone) when loading is in progress:

```tsx
onClick={() => {
  if (panelState !== 'loading') inputRef.current?.click()
}}
```

Or accept a `disabled` prop in `UploadZone` and apply `pointerEvents: 'none'` + `opacity: 0.5` when disabled.

---

### WR-05: `user.image` rendered via `<img>` without a Content-Security-Policy guard — external origin not constrained

**File:** `src/app/account/page.tsx:95-101`

**Issue:** `user.image` comes from the OAuth provider (Google). It is rendered directly in an `<img src={user.image}>` with an ESLint suppression for the `next/image` rule. While the value originates from the server session (not user input), any future auth provider added whose profile images are served from an attacker-controlled URL would allow loading arbitrary images. More immediately, using `<img>` instead of `next/image` bypasses Next.js's image hostname allowlist (`remotePatterns` in `next.config`), which is a defence-in-depth control.

**Fix:** Either switch to `next/image` (requires adding `accounts.google.com` to `remotePatterns`) or, if the raw `<img>` tag is intentional, ensure `next.config` CSP headers restrict `img-src` to known OAuth domains. The ESLint suppression comment suggests the bypass is known — the omission is the missing compensating control.

---

## Info

### IN-01: `EntityCard` uses index as React key in result list

**File:** `src/app/screen/ScreenClient.tsx:534-536`

**Issue:** `report.entities.map((result, i) => <EntityCard key={i} result={result} />)` uses array index as key. If the list is ever reordered or filtered, React will reconcile incorrectly. Entities have an `extracted.name` field that is unique enough per document screening.

**Fix:**
```tsx
{report.entities.map((result) => (
  <EntityCard key={result.extracted.name} result={result} />
))}
```

---

### IN-02: Flag items in `TradeAssessmentCard` use index as React key

**File:** `src/app/screen/ScreenClient.tsx:378`

**Issue:** `flags.map((flag, i) => <div key={i} ...>)` — same index-as-key issue. Each flag has a `flag.code` that serves as a stable, unique identifier within a single assessment.

**Fix:**
```tsx
{flags.map((flag) => (
  <div key={flag.code} ...>
))}
```

---

### IN-03: Column header array uses empty string `''` as React key — duplicate if more than one empty header

**File:** `src/app/watchlist/page.tsx:322-329` and `src/app/watchlist/page.tsx:471-475`

**Issue:** Both watchlist table headers map over an array containing `''` as the last element (the action column). This results in `key=""` which is valid but fragile — if two empty-string entries appear in future, React will warn about duplicate keys.

**Fix:** Use the column index or a more stable identifier:
```tsx
{['Entity', 'Type', 'Status', 'Added', 'Action'].map((h) => (
  <span key={h} ...>{h}</span>
))}
```

Or use index: `{cols.map((h, i) => <span key={i}>...`

---

### IN-04: `secondaryBtnStyle` is duplicated verbatim across three files

**File:** `src/app/reports/ReportsClient.tsx:23-37`, `src/app/screen/ScreenClient.tsx:23-36`, `src/app/watchlist/page.tsx:38-49`

**Issue:** The same `secondaryBtnStyle` object (8–10 CSS properties) is copy-pasted into all three files with minor variations. This is not a bug, but when the design system evolves, all three must be updated in sync.

**Fix:** Extract to a shared module, e.g. `src/lib/styles/buttons.ts`:
```ts
export const secondaryBtnStyle: React.CSSProperties = { ... }
```

---

_Reviewed: 2026-04-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

# Phase 14: Platform-Wide UI Polish — Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 6 (5 target files + 1 container fix)
**Analogs found:** 6 / 6

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/app/screen/ScreenClient.tsx` | Client Component | file-I/O + request-response | `src/app/trade/TradeClient.tsx` | exact |
| `src/app/screen/page.tsx` | Server Component | request-response | `src/app/trade/page.tsx` | exact |
| `src/app/watchlist/page.tsx` | Server Component + server actions | CRUD | `src/app/trade/TradeClient.tsx` (TOKEN + secondaryBtnStyle) | role-match |
| `src/app/reports/ReportsClient.tsx` | Client Component | CRUD + pagination | `src/app/trade/TradeClient.tsx` (secondaryBtnStyle) | role-match |
| `src/app/page.tsx` | Server Component | request-response | `src/app/trade/TradeClient.tsx` (TOKEN + primaryBtn) | partial |
| `src/app/account/page.tsx` | Server Component + server action | request-response | `src/app/trade/TradeClient.tsx` (TOKEN + progress bar) | partial |

---

## Pattern Assignments

### `src/app/screen/ScreenClient.tsx` (Client Component, file-I/O)

**Analog:** `src/app/trade/TradeClient.tsx`
**Change scope:** Full rewrite — single-column → Split Panel, GlowLoader → inline progress bar, `ViewState` → `panelState` state machine.

**TOKEN block to copy verbatim** (TradeClient.tsx lines 13–24):
```typescript
const TOKEN = {
  surface:      '#111113',
  elevated:     '#1e1e24',
  elevated2:    '#26262e',
  border:       'rgba(255,255,255,0.07)',
  borderHover:  'rgba(255,255,255,0.14)',
  primary:      '#6366f1',
  text:         '#f1f1f3',
  textMuted:    '#8b8b9a',
  textSubtle:   '#55556a',
} as const
```

**panelState type to adopt** (TradeClient.tsx line 838):
```typescript
type RightPanelState = 'empty' | 'loading' | 'result' | 'error'
// ScreenClient equivalent:
type PanelState = 'upload' | 'loading' | 'result' | 'error'
```

**Split Panel shell** (TradeClient.tsx lines 922–928) — use 420px left column (wider than Trade's 380px for drag zone):
```typescript
<div style={{
  display: 'grid',
  gridTemplateColumns: '420px 1fr',
  minHeight: 'calc(100vh - 44px)',
}}>
  {/* LEFT: upload zone + options */}
  <div style={{
    borderRight: `1px solid ${TOKEN.border}`,
    padding: '32px 24px',
    overflowY: 'auto',
    background: TOKEN.surface,
  }}>...</div>
  {/* RIGHT: empty / loading / result */}
  <div style={{ padding: '32px', overflowY: 'auto' }}>...</div>
</div>
```

**Inline LoadingView with progress bar** (TradeClient.tsx lines 339–374) — adapt message to screen steps:
```typescript
function LoadingView({ filename, step }: { filename: string; step: string }) {
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (barRef.current) barRef.current.style.width = '100%'
    }, 50)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      minHeight: '400px', gap: '16px',
    }}>
      <p style={{ fontSize: '14px', color: TOKEN.textMuted, margin: 0 }}>{step}</p>
      <div style={{
        width: '200px', height: '4px',
        background: 'rgba(0,0,0,0.35)',
        borderRadius: '2px', overflow: 'hidden',
      }}>
        <div ref={barRef} style={{
          height: '100%', background: TOKEN.primary,
          width: '0%', transition: 'width 1.4s ease',
        }} />
      </div>
      <p style={{ fontSize: '12px', color: TOKEN.textSubtle, margin: 0 }}>{filename}</p>
    </div>
  )
}
```
Loading step sequence: `'Uploading…'` → `'Extracting parties…'` → `'Screening entities…'`

**Empty state panel** (TradeClient.tsx lines 1009–1020):
```typescript
<div style={{
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  minHeight: '400px', textAlign: 'center',
}}>
  <div style={{ fontSize: '28px', color: TOKEN.textSubtle, marginBottom: '12px' }}>📄</div>
  <p style={{ fontSize: '14px', color: TOKEN.textSubtle, margin: 0 }}>
    Upload a document to see screening results
  </p>
</div>
```

**Primary submit button — full-width** (TradeClient.tsx lines 295–332):
```typescript
// Normal state:
{
  width: '100%', padding: '11px 0',
  background: 'linear-gradient(180deg, #7578f2 0%, #5558e8 100%)',
  color: '#fff',
  border: '1px solid rgba(99,102,241,0.45)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)',
  borderRadius: '7px', fontSize: '13px', fontWeight: 500,
  fontFamily: 'inherit', cursor: 'pointer', transition: 'all 0.12s ease',
}
// Hover state:
{
  background: 'linear-gradient(180deg, #818cf8 0%, #6366f1 100%)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.12) inset, 0 4px 10px rgba(99,102,241,0.35)',
  transform: 'translateY(-1px)',
}
```

**Drag & drop upload zone TOKEN upgrade** — replace current CSS-var colors:
```typescript
// Current ScreenClient line 551–558 uses CSS vars. Replace with:
border: `2px dashed ${isDragging ? TOKEN.primary : TOKEN.border}`,
backgroundColor: isDragging ? 'rgba(99,102,241,0.12)' : TOKEN.surface,
// Height: 160–200px minimum
```

**Secondary button constant** (TradeClient.tsx lines 87–100):
```typescript
const secondaryBtnStyle: React.CSSProperties = {
  background: '#1e1e24',
  color: '#8b8b9a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: '7px',
  padding: '6px 14px',
  fontSize: '13px',
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
  transition: 'all 0.12s ease',
  textDecoration: 'none',
  display: 'inline-block',
}
```

**Remove GlowLoader:** Delete `import GlowLoader from '@/components/ui/GlowLoader'` (ScreenClient.tsx line 8). Do not delete the GlowLoader file itself.

---

### `src/app/screen/page.tsx` (Server Component, container fix)

**Analog:** `src/app/trade/page.tsx`
**Change:** Remove `maxWidth` from `<main>` so Split Panel fills viewport.

**Current** (screen/page.tsx lines 39–45):
```typescript
<main style={{
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: 'var(--space-8) var(--space-4)',
}}>
```

**Target** (trade/page.tsx line 47):
```typescript
<main>
```
Remove the entire `style` prop from `<main>`. ScreenClient owns its own layout via Split Panel grid.

---

### `src/app/watchlist/page.tsx` (Server Component, button/pill upgrade)

**Analog:** `src/app/trade/TradeClient.tsx` (TOKEN constants + secondaryBtnStyle)
**Change scope:** Style-only upgrade — no structural changes. Server Component mode preserved.

**Token values to inline** (hardcoded, no TOKEN object needed — Server Components cannot share client constants):
```typescript
// Secondary button — apply to Refresh, Remove, Dismiss buttons
const secondaryBtn: React.CSSProperties = {
  background: '#1e1e24',
  color: '#8b8b9a',
  border: '1px solid rgba(255,255,255,0.07)',
  borderRadius: '7px',
  padding: '6px 14px',
  fontSize: '13px',
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
  transition: 'all 0.12s ease',
}
```

**Status pill — replace current plain-text status** (watchlist/page.tsx lines 356–370):
```typescript
// Replace color-only text with pill:
<span style={{
  fontSize: '11px', fontWeight: 600, letterSpacing: '0.04em',
  color: STATUS_COLOR[item.current_sanction_status],
  backgroundColor: `${STATUS_COLOR[item.current_sanction_status]}18`,
  border: `1px solid ${STATUS_COLOR[item.current_sanction_status]}44`,
  borderRadius: '4px',
  padding: '2px 7px',
}}>
  {STATUS_LABEL[item.current_sanction_status] ?? 'Unknown'}
</span>
```

**STATUS_COLOR hardcoded replacements** (watchlist/page.tsx lines 26–30 — replace CSS vars):
```typescript
const STATUS_COLOR: Record<string, string> = {
  listed:     '#ef4444',
  not_listed: '#22c55e',
  unknown:    '#55556a',
}
```

**Table row hover** — add `onMouseEnter`/`onMouseLeave` or convert rows to Client Component if needed. If staying Server Component, use CSS class `.watchlist-row:hover { background: rgba(255,255,255,0.02); }` added inline via `<style>` tag.

**Surface card upgrade** — replace `var(--bg-surface)` + `var(--border-subtle)` with hardcoded TOKEN values:
```typescript
backgroundColor: '#111113',
border: '1px solid rgba(255,255,255,0.07)',
borderTopColor: 'rgba(255,255,255,0.09)',
borderRadius: '10px',
boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
```

---

### `src/app/reports/ReportsClient.tsx` (Client Component, GhostButton replacement)

**Analog:** `src/app/trade/TradeClient.tsx` (secondaryBtnStyle)
**Change scope:** Replace `GhostButton` component with `secondaryBtnStyle` inline. No structural changes.

**Current GhostButton** (ReportsClient.tsx lines 57–84) — delete this component entirely.

**Replacement: copy secondaryBtnStyle constant** from TradeClient.tsx lines 87–100 (see above).

**Apply to all GhostButton usages:**
- `<GhostButton href={...}>View</GhostButton>` → `<Link href={...} style={secondaryBtnStyle}>View</Link>`
- `<GhostButton href={...}>PDF</GhostButton>` → `<a href={...} style={secondaryBtnStyle}>PDF</a>`
- `<GhostButton onClick={...} danger>Yes</GhostButton>` → danger variant uses `color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)'` override

**RowShell surface upgrade** (ReportsClient.tsx lines 86–102):
```typescript
// Replace var(--surface-card) + var(--border-subtle):
backgroundColor: '#111113',
border: '1px solid rgba(255,255,255,0.07)',
borderTopColor: 'rgba(255,255,255,0.09)',
borderRadius: '10px',
boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
```

**Row hover** — add `onMouseEnter`/`onMouseLeave` to RowShell:
```typescript
onMouseEnter={e => (e.currentTarget.style.background = '#1e1e24')}
onMouseLeave={e => (e.currentTarget.style.background = '#111113')}
```

**Section label** (TradeClient.tsx lines 969–972 pattern):
```typescript
// Replace SectionHeading style to match TOKEN:
fontSize: '11px', color: '#55556a',
textTransform: 'uppercase', letterSpacing: '0.07em',
```

---

### `src/app/page.tsx` (Server Component, CTA + feature cards upgrade)

**Analog:** `src/app/trade/TradeClient.tsx` (primaryBtn pattern)
**Change scope:** Style-only. Server Component — cannot use useState for hover; use CSS class or `<style>` injection.

**Tool card CTA links — upgrade to primary micro-gradient** (page.tsx lines 333–377):
```typescript
// Replace plain <Link> with styled CTA span inside card:
// The card Link wrapper stays; add a styled CTA button inside:
<span style={{
  display: 'inline-block',
  padding: '7px 14px',
  background: 'linear-gradient(180deg, #7578f2 0%, #5558e8 100%)',
  color: '#fff',
  border: '1px solid rgba(99,102,241,0.45)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)',
  borderRadius: '7px',
  fontSize: '12px', fontWeight: 500,
}}>
  {card.cta}
</span>
```

**Feature card surface upgrade** (page.tsx lines 424–460) — replace CSS vars:
```typescript
// Replace:
backgroundColor: 'var(--bg-surface)',
border: '1px solid var(--border-subtle)',
borderRadius: '10px',
// With TOKEN surface card:
backgroundColor: '#111113',
border: '1px solid rgba(255,255,255,0.07)',
borderTop: '1px solid rgba(255,255,255,0.09)',
borderRadius: '10px',
boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
```

**Trust stats number color** (page.tsx lines 395–400):
```typescript
// Replace var(--text-primary) with brand color:
color: '#6366f1',
fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em',
```

**Tool card hover** — add CSS class to globals or inject `<style>` tag for `.home-tool-card:hover { border-top-color: rgba(255,255,255,0.14) !important; }` (page.tsx already uses `className="home-tool-card"`).

---

### `src/app/account/page.tsx` (Server Component, button + progress bar upgrade)

**Analog:** `src/app/trade/TradeClient.tsx` (primaryBtn + progress bar pattern)
**Change scope:** Style-only. Server Component.

**Manage Billing → primary micro-gradient** (account/page.tsx lines 133–149):
```typescript
// Replace transparent border button with:
style={{
  padding: '8px 16px',
  background: 'linear-gradient(180deg, #7578f2 0%, #5558e8 100%)',
  color: '#fff',
  border: '1px solid rgba(99,102,241,0.45)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)',
  borderRadius: '7px',
  fontSize: '13px', fontWeight: 500,
  fontFamily: 'inherit', cursor: 'pointer',
}}
```

**Upgrade plan → also primary micro-gradient** (account/page.tsx lines 150–165): same gradient applied to the `<Link>` wrapper.

**Quota progress bar TOKEN upgrade** (account/page.tsx lines 189–203) — replace CSS vars with TOKEN values:
```typescript
// Track:
height: '4px',
background: 'rgba(0,0,0,0.35)',
borderRadius: '2px',
boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.4)',
overflow: 'hidden',
// Fill:
height: '100%',
width: `${usedPercent}%`,
background: usedPercent >= 100 ? '#ef4444' : '#6366f1',
transition: 'width 0.3s ease',
borderRadius: '2px',
```

**Plan badge pill** — wrap plan label in pill (account/page.tsx line 128):
```typescript
<span style={{
  fontSize: '12px', fontWeight: 600, letterSpacing: '0.04em',
  color: '#6366f1',
  backgroundColor: 'rgba(99,102,241,0.12)',
  border: '1px solid rgba(99,102,241,0.3)',
  borderRadius: '4px',
  padding: '2px 8px',
}}>
  {PLAN_LABEL[plan] ?? plan}
</span>
```

**Card surface upgrade** (account/page.tsx lines 59–64, `card` const):
```typescript
const card: React.CSSProperties = {
  backgroundColor: '#111113',
  border: '1px solid rgba(255,255,255,0.07)',
  borderTop: '1px solid rgba(255,255,255,0.09)',
  borderRadius: '10px',
  padding: 'var(--space-6)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)',
}
```

---

## Shared Patterns

### TOKEN Constants
**Source:** `src/app/trade/TradeClient.tsx` lines 13–24
**Apply to:** All Client Component files (`ScreenClient.tsx`, `ReportsClient.tsx`)
**Note:** Server Components cannot export/import client-side `const TOKEN`. Use hardcoded values directly in Server Components (`watchlist/page.tsx`, `page.tsx`, `account/page.tsx`).

### Primary Button (micro-gradient)
**Source:** `src/app/trade/TradeClient.tsx` lines 295–332 (`TradeForm` submit button)
**Apply to:** ScreenClient submit, account Manage Billing, account Upgrade Plan, homepage tool card CTAs

### Secondary Button
**Source:** `src/app/trade/TradeClient.tsx` lines 87–100 (`secondaryBtnStyle` const)
**Apply to:** ScreenClient action buttons, watchlist Remove/Dismiss, ReportsClient View/PDF buttons

### Progress Bar (4px track + indigo fill + 1.4s ease)
**Source:** `src/app/trade/TradeClient.tsx` `LoadingView` component (lines 339–374)
**Apply to:** ScreenClient LoadingView (replace GlowLoader), account quota bar (static, no animation needed)

### Surface Card
**Source:** TOKEN values from `src/app/trade/TradeClient.tsx` line 15 (`surface: '#111113'`)
**Apply to:** All page cards — `#111113` bg, `rgba(255,255,255,0.07)` border, `rgba(255,255,255,0.09)` top border, `border-radius: 10px`, box-shadow `0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)`

### Status/Risk Pill
**Source:** `src/app/trade/TradeClient.tsx` `SanctionBadge` component (lines 179–195)
**Apply to:** watchlist sanction status cells, reports risk badges
```typescript
// Pill pattern:
color: statusColor,
backgroundColor: `${statusColor}18`,
border: `1px solid ${statusColor}44`,
borderRadius: '4px',
padding: '2px 7px',
fontSize: '11px', fontWeight: 600, letterSpacing: '0.04em',
```

### Section Label (uppercase caps)
**Source:** `src/app/trade/TradeClient.tsx` lines 969–972
**Apply to:** All section headings in upgraded files
```typescript
fontSize: '11px', color: '#55556a',
textTransform: 'uppercase', letterSpacing: '0.07em',
marginBottom: '12px',
```

---

## No Analog Found

All 6 files have close analogs. No files require falling back to RESEARCH.md patterns.

---

## Critical Implementation Notes

1. **GlowLoader removal:** ScreenClient currently imports GlowLoader (line 8). Remove the import after replacing `LoadingView`. Do NOT delete the GlowLoader file — other components may reference it.

2. **screen/page.tsx `<main>` container:** Currently has `maxWidth: 'var(--max-width)'`. Must be removed so ScreenClient's Split Panel grid fills the full viewport. Pattern: `<main>` with no style prop (same as trade/page.tsx line 47).

3. **Server Component hover limitation:** `watchlist/page.tsx` and `page.tsx` are Server Components — they cannot use `useState` for hover effects. Options: (a) inject a `<style>` tag with hover CSS, (b) extract hover-needing elements into small Client Components. Prefer `<style>` tag injection to minimize 'use client' boundaries.

4. **`secondaryBtnStyle` in ReportsClient:** The existing `GhostButton` uses `var(--accent-primary)` colored border. The new secondary button uses `rgba(255,255,255,0.07)` border. The danger variant (`Yes` in delete confirm) should keep red color: `color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)'`.

5. **watchlist/page.tsx plan check:** The file checks `plan === 'professional' || plan === 'enterprise'` (line 181). Do not change this logic — style upgrade only.

---

## Metadata

**Analog search scope:** `src/app/trade/TradeClient.tsx`, `src/app/trade/page.tsx`, all 5 target files
**Files scanned:** 8 total
**Pattern extraction date:** 2026-04-19

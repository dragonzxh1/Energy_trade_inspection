# Phase 13: Trade Check UI Redesign — Pattern Map

**Mapped:** 2026-04-19
**Files analyzed:** 2 (new/modified production files)
**Analogs found:** 2 / 2

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/trade/TradeClient.tsx` | component (full rewrite) | request-response, three-state UI | `src/app/screen/ScreenClient.tsx` | role-match (same client component shape) |
| `src/app/trade/page.tsx` | route (minor edit) | request-response | `src/app/screen/page.tsx` | exact |

---

## Pattern Assignments

### `src/app/trade/TradeClient.tsx` (component, request-response + three-state UI)

This file is a **full in-place rewrite** of the existing 896-line component. The new version
introduces: Split Panel grid shell, TOKEN constant block, focus-state input pattern,
progress-bar loading, Recent Checks with localStorage, and single-column form.

All sub-patterns below are sourced from the existing TradeClient.tsx and the closest analog
ScreenClient.tsx, plus the locked sketch HTML.

---

#### Pattern A — TOKEN constant block (design tokens)

**Source:** `src/app/trade/TradeClient.tsx` lines 14–31 (existing RISK_COLOR/BG/BORDER maps)
**New requirement (CONTEXT.md § CSS 变量映射):** Add a `TOKEN` object at file top grouping
all hardcoded values.

Copy existing color-map pattern, extend to a single TOKEN object:

```typescript
// TOKEN — all hardcoded values live here; never scatter magic strings
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

Pattern precedent: the existing `RISK_COLOR`, `RISK_BG`, `RISK_BORDER` Record<RiskLevel, string>
maps (TradeClient.tsx lines 14–31) — same idea, grouped differently.

---

#### Pattern B — Split Panel grid shell

**Source:** `.planning/sketches/002-trade-check-form/index.html` lines 318–379 (Variant B,
the confirmed winner)

```html
<!-- sketch HTML — translate directly to JSX inline style -->
<div style="display:grid;grid-template-columns:380px 1fr;min-height:calc(100vh - 44px)">

  <!-- LEFT panel -->
  <div style="border-right:1px solid rgba(255,255,255,0.07);
              padding:32px 24px;overflow-y:auto;background:#111113">
    ...form + recent checks...
  </div>

  <!-- RIGHT panel -->
  <div style="padding:32px;overflow-y:auto">
    ...empty | loading | result...
  </div>

</div>
```

JSX translation (inline style, using TOKEN):

```tsx
<div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', minHeight: 'calc(100vh - 44px)' }}>
  <div style={{
    borderRight: `1px solid ${TOKEN.border}`,
    padding: '32px 24px',
    overflowY: 'auto',
    background: TOKEN.surface,
  }}>
    {/* form + recent checks */}
  </div>
  <div style={{ padding: '32px', overflowY: 'auto' }}>
    {/* three-state right panel */}
  </div>
</div>
```

---

#### Pattern C — Input focus state via onFocus/onBlur

**Source decision (CONTEXT.md § Inputs):** Use `onFocus`/`onBlur` state instead of CSS
pseudo-class (avoids global CSS class conflicts with inline-style-heavy component).

No existing analog in codebase uses this exact approach (all existing inputs use static
`inputStyle()` function without focus state). Pattern defined by locked sketch spec:

```tsx
// State for each focused field
const [focused, setFocused] = useState<string | null>(null)

function inputStyleNew(key: string, hasError?: boolean): React.CSSProperties {
  const isFocused = focused === key
  return {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: 'rgba(0,0,0,0.28)',
    border: `1px solid ${
      hasError    ? 'rgba(239,68,68,0.5)' :
      isFocused   ? '#6366f1'             :
                    TOKEN.border
    }`,
    boxShadow: isFocused
      ? 'inset 0 2px 3px rgba(0,0,0,0.3), 0 0 0 2px rgba(99,102,241,0.18)'
      : 'inset 0 2px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(0,0,0,0.12)',
    borderRadius: '7px',
    color: TOKEN.text,
    fontSize: '13px',
    fontFamily: 'inherit',
    padding: '8px 12px',
    outline: 'none',
  }
}

// Usage on input element:
<input
  onFocus={() => setFocused('seller')}
  onBlur={() => setFocused(null)}
  style={inputStyleNew('seller', sellerErr)}
  ...
/>
```

---

#### Pattern D — Label uppercase caps style

**Source:** `.planning/sketches/002-trade-check-form/index.html` `.field-label` class (line 91–95)
and CONTEXT.md § Form 布局调整.

```tsx
function labelStyleNew(): React.CSSProperties {
  return {
    display: 'block',
    fontSize: '11px',
    fontWeight: 500,
    color: TOKEN.textMuted,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    marginBottom: '5px',
  }
}
```

Existing analog (different values): `labelStyle()` at TradeClient.tsx lines 167–176 uses
`fontSize: '12px'`, `fontWeight: 600`, no `textTransform`. Replace with new values above.

---

#### Pattern E — Primary button with micro-gradient

**Source:** `.planning/sketches/002-trade-check-form/index.html` `.btn-primary` CSS (lines 61–74)
and CONTEXT.md § Primary Button.

```tsx
// Base style (store in variable, not repeated inline)
const primaryBtnStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 0',
  background: 'linear-gradient(180deg, #7578f2 0%, #5558e8 100%)',
  color: '#fff',
  border: '1px solid rgba(99,102,241,0.45)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25)',
  borderRadius: '7px',
  fontSize: '13px',
  fontWeight: 500,
  fontFamily: 'inherit',
  cursor: 'pointer',
  transition: 'all 0.12s ease',
  letterSpacing: '0.01em',
}

// Hover managed via onMouseEnter/onMouseLeave state (same pattern as existing
// SaveTradeWatchButton toggle — TradeClient.tsx lines 625–679)
```

Hover style override:
```tsx
const primaryBtnHover: React.CSSProperties = {
  background: 'linear-gradient(180deg, #818cf8 0%, #6366f1 100%)',
  boxShadow: '0 1px 0 rgba(255,255,255,0.12) inset, 0 4px 10px rgba(99,102,241,0.35)',
  transform: 'translateY(-1px)',
}
```

---

#### Pattern F — Secondary button

**Source:** CONTEXT.md § Secondary Buttons and sketch `.btn-secondary` (line 75–81).

```tsx
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
}
```

Existing analog: `SaveTradeWatchButton` button (TradeClient.tsx lines 668–679) and the
"New check" button (lines 723–734) — same visual intent, now upgraded to match sketch spec.

---

#### Pattern G — Three-state right panel

**Source:** `.planning/sketches/002-trade-check-form/index.html` lines 385–517 (Variant B,
`#b-empty`, `#b-loading`, `#b-result` divs).

**Empty state:**
```tsx
// Centered placeholder — flex column, full panel height
<div style={{
  display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center',
  minHeight: '400px', textAlign: 'center',
}}>
  <div style={{
    fontSize: '28px', color: TOKEN.textSubtle, marginBottom: '12px',
  }}>⚡</div>
  <p style={{ fontSize: '14px', color: TOKEN.textSubtle }}>
    Run a trade check to see results
  </p>
</div>
```

**Loading state (replaces GlowLoader):**

Pattern from sketch Variant B `#b-loading` (lines 392–396) + CONTEXT.md § Loading 进度条:

```tsx
function LoadingView({ seller, vessel }: { seller: string; vessel: string }) {
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
      <p style={{ fontSize: '14px', color: TOKEN.textMuted }}>Screening trade...</p>
      <div style={{
        width: '200px', height: '3px',
        background: 'rgba(0,0,0,0.35)',
        borderRadius: '2px', overflow: 'hidden',
      }}>
        <div
          ref={barRef}
          style={{
            height: '100%', background: TOKEN.primary,
            width: '0%', transition: 'width 1.4s ease',
          }}
        />
      </div>
      <p style={{ fontSize: '12px', color: TOKEN.textSubtle }}>
        {seller}{vessel ? ` · ${vessel}` : ''}
      </p>
    </div>
  )
}
```

`useRef` pattern precedent: `src/components/entity/ScoreGauge.tsx` lines 3–25 — same
pattern of `useRef<HTMLDivElement>` + `useEffect` + `setTimeout` for animation trigger.

**Result state:** Keep existing `ResultsView`, `ResultBanner`, `FlagCard`, `PartyCard`,
`VesselCard`, `PortCard` sub-components intact. Only update their action buttons to
`secondaryBtnStyle`.

---

#### Pattern H — Recent Checks (localStorage)

**Source:** CONTEXT.md § Recent Checks + sketch HTML Variant B lines 361–378.

No localStorage analog exists in production codebase. Use the pattern below (matches
the sketch's `.recent-item` and CONTEXT.md schema).

```typescript
const LS_KEY = 'eti_recent_trade_checks'
const MAX_RECENT = 5

interface RecentCheck {
  seller: string
  vessel?: string
  commodity?: string
  loadingPort?: string
  overallRisk: RiskLevel
  checkedAt: string  // ISO string
}

// Read
function getRecent(): RecentCheck[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as RecentCheck[]
  } catch { return [] }
}

// Write (after successful result)
function pushRecent(entry: RecentCheck) {
  const list = [entry, ...getRecent().filter(r => r.seller !== entry.seller || r.vessel !== entry.vessel)]
  localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_RECENT)))
}
```

State initialization pattern (SSR-safe — localStorage only accessed in useEffect):

```tsx
const [recent, setRecent] = useState<RecentCheck[]>([])

useEffect(() => {
  setRecent(getRecent())
}, [])
```

Render pattern (from sketch Variant B lines 361–378 + CONTEXT.md § Recent Checks):

```tsx
// Section header
<div style={{
  fontSize: '11px', color: TOKEN.textSubtle,
  textTransform: 'uppercase', letterSpacing: '0.07em',
  marginBottom: '12px',
}}>
  Recent Checks
</div>

// List items
{recent.map((r, i) => (
  <div
    key={i}
    onClick={() => setValues({
      seller: r.seller, vessel: r.vessel ?? '',
      commodity: r.commodity ?? '', loadingPort: r.loadingPort ?? '',
      imo: '', date: '', sellerDomain: '',
    })}
    style={{
      padding: '8px 10px', borderRadius: '7px', cursor: 'pointer',
      transition: 'background 0.1s ease',
    }}
    onMouseEnter={e => (e.currentTarget.style.background = TOKEN.elevated)}
    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
  >
    <div style={{ fontSize: '13px', fontWeight: 500, color: TOKEN.text }}>
      {r.seller}
    </div>
    <div style={{ fontSize: '11px', color: TOKEN.textMuted }}>
      {[r.commodity, r.loadingPort].filter(Boolean).join(' · ')}
      {r.commodity || r.loadingPort ? ' · ' : ''}
      <span style={{ color: RISK_COLOR[r.overallRisk] }}>
        {r.overallRisk.toUpperCase()}
      </span>
    </div>
  </div>
))}
```

Risk colors for Recent Checks items (from CONTEXT.md § Recent Checks):
- low: `#4ade80`, medium: `#fbbf24`, high: `#f97316`, critical: `#ef4444`

---

#### Pattern I — Form single-column layout + state lifting

**Source:** Existing `TradeForm` sub-component at TradeClient.tsx lines 182–282, but refactored.

The new design collapses the 2-column grid (line 245 `gridTemplateColumns: '1fr 1fr'`) into
single-column, and the `FormValues` state must be lifted to the parent (`TradeClient`) so
Recent Checks can call `setValues`. Pattern for lifted state:

```tsx
// In TradeClient (parent):
const [values, setValues] = useState<FormValues>({
  seller: initSeller, vessel: initVessel,
  imo: '', date: '', loadingPort: '', commodity: '', sellerDomain: '',
})

// TradeForm becomes controlled:
function TradeForm({ values, setValues, onSubmit }: {
  values: FormValues
  setValues: React.Dispatch<React.SetStateAction<FormValues>>
  onSubmit: (v: FormValues) => void
}) { ... }
```

Precedent for lifting form state to parent: `HeroTradeForm.tsx` manages its own state
locally and pushes to router; here we lift because Recent Checks in the parent needs write
access. Same `touched` / `sellerErr` validation pattern as existing lines 191–205.

---

### `src/app/trade/page.tsx` (route, minor edit)

**Analog:** `src/app/screen/page.tsx` (exact match — same auth gate + plan check pattern)

**Only change:** Remove `maxWidth` and `margin: '0 auto'` from `<main>` style so the
split panel fills the full viewport width.

Current `<main>` style (page.tsx lines 48–52):
```tsx
style={{
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: 'var(--space-8) var(--space-4)',
}}
```

New `<main>` style:
```tsx
style={{
  // maxWidth removed — split panel must fill viewport
  // margin: '0 auto' removed
  // padding also removed (split panel owns its own padding)
}}
```

Or simply:
```tsx
<main>   {/* no style prop needed — split panel owns padding */}
```

Everything else in page.tsx (auth redirect, plan check, UpgradePrompt, Suspense boundary)
remains identical. Copy pattern from `src/app/screen/page.tsx` lines 26–64.

---

## Shared Patterns

### Inline-style component convention
**Source:** `src/app/trade/TradeClient.tsx` (entire file), `src/app/screen/ScreenClient.tsx`
**Apply to:** All JSX in TradeClient.tsx
This project uses zero CSS modules / zero Tailwind. All styles are React inline `style` props
with `React.CSSProperties` type. CSS variable references (`var(--text-primary)`) are used
for existing tokens; new sketch-specific values use hardcoded hex/rgba (managed via TOKEN).

### Risk badge / color maps
**Source:** `src/app/trade/TradeClient.tsx` lines 14–31 (`RISK_COLOR`, `RISK_BG`, `RISK_BORDER`)
**Apply to:** Recent Checks risk color display
Keep existing maps. `RISK_COLOR` values match CONTEXT.md Recent Checks spec except
`low` (existing `#22c55e` vs spec `#4ade80`). Use spec value `#4ade80` for Recent Checks
only (display context), keep existing `#22c55e` for badge components.

### ViewState / conditional rendering
**Source:** `src/app/trade/TradeClient.tsx` lines 781–894 (`type ViewState = 'form' | 'loading' | 'results' | 'error'`)
**Apply to:** Right panel three-state logic

New ViewState is simplified because form is always visible in left panel:
```typescript
type RightPanelState = 'empty' | 'loading' | 'result' | 'error'
```
`'empty'` replaces `'form'` as the initial right-panel state.

### useRef animation trigger (setTimeout 50ms)
**Source:** `src/components/entity/ScoreGauge.tsx` lines 23–66 (useRef + useEffect animation)
**Apply to:** LoadingView progress bar (Pattern G above)
ScoreGauge uses `requestAnimationFrame`; progress bar uses simpler `setTimeout(..., 50)`
as specified in sketch. Both follow the same `ref.current.style.xxx = value` imperative
update pattern after component mount.

### 'use client' directive placement
**Source:** `src/app/trade/TradeClient.tsx` line 1, `src/app/screen/ScreenClient.tsx` line 1
**Apply to:** TradeClient.tsx
Must be first line of file, before all imports.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| localStorage Recent Checks | utility (inline) | client-state persistence | No localStorage usage exists anywhere in production codebase. Use pattern defined in CONTEXT.md and Pattern H above. |
| CSS grid split panel | layout | — | No CSS grid split panel exists in production components. Sketch Variant B HTML is the canonical reference. |

---

## Metadata

**Analog search scope:** `src/app/`, `src/components/`, `.planning/sketches/`
**Files scanned:** TradeClient.tsx (896 lines), page.tsx (trade + screen), ScreenClient.tsx,
ScoreGauge.tsx, HeroTradeForm.tsx, GlowLoader.tsx, globals.css, sketches/002/index.html,
sketches/001/index.html
**Pattern extraction date:** 2026-04-19

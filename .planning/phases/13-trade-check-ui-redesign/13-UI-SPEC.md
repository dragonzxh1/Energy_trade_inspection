# Phase 13: Trade Check UI Redesign — UI Design Contract

**Source:** Sketch Wrap-Up 2026-04-19 (sessions 001-controls-quality, 002-trade-check-form)
**Status:** Locked (from validated sketch experiments)

---

## 1. Layout

**Split Panel (Variant B — confirmed winner)**

```
┌─────────────────────────┬────────────────────────────────────┐
│  380px (fixed)          │  flex: 1                           │
│                         │                                    │
│  [Form]                 │  [Empty state]                     │
│  Seller *               │  OR [Loading bar]                  │
│  Vessel                 │  OR [Result view]                  │
│  IMO                    │                                    │
│  Trade Date             │                                    │
│  Port                   │                                    │
│  Commodity              │                                    │
│  Seller Domain          │                                    │
│                         │                                    │
│  [Recent Checks]        │                                    │
└─────────────────────────┴────────────────────────────────────┘
```

Grid: `display: grid; grid-template-columns: 380px 1fr; min-height: calc(100vh - 44px)`
Left panel: `border-right: 1px solid rgba(255,255,255,0.07); background: #111113; padding: 32px 24px; overflow-y: auto`
Right panel: `padding: 32px; overflow-y: auto`

**Trade page `<main>` container**: Remove `maxWidth: var(--max-width)` — split panel must fill viewport width.

---

## 2. Controls

### Primary Button
```css
background: linear-gradient(180deg, #7578f2 0%, #5558e8 100%);
color: #fff;
border: 1px solid rgba(99,102,241,0.45);
box-shadow: 0 1px 0 rgba(255,255,255,0.1) inset, 0 2px 5px rgba(99,102,241,0.25);
border-radius: 7px; padding: 8px 16px;
font-size: 13px; font-weight: 500;
transition: all 0.12s ease;
```
Hover: gradient `#818cf8→#6366f1` + `transform: translateY(-1px)` + glow `0 4px 10px rgba(99,102,241,0.35)`
"Run Trade Check →": full-width (`width: 100%`), padding `11px 0`

### Secondary Button (Watch trade, Export PDF, New check)
```css
background: #1e1e24; color: #8b8b9a;
border: 1px solid rgba(255,255,255,0.07);
border-radius: 7px; padding: 6px 14px; font-size: 13px;
box-shadow: 0 1px 2px rgba(0,0,0,0.15);
transition: all 0.12s ease;
```
Hover: `background: #26262e; transform: translateY(-1px)`

### Input Fields
```css
background: rgba(0,0,0,0.28);
border: 1px solid rgba(255,255,255,0.07);
box-shadow: inset 0 2px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(0,0,0,0.12);
border-radius: 7px; color: #f1f1f3;
font-size: 13px; padding: 8px 12px; width: 100%;
```
Focus:
```css
border-color: #6366f1;
box-shadow: inset 0 2px 3px rgba(0,0,0,0.3), 0 0 0 2px rgba(99,102,241,0.18);
```

### Field Labels
```css
font-size: 11px; font-weight: 500; color: #8b8b9a;
text-transform: uppercase; letter-spacing: 0.07em;
margin-bottom: 5px;
```

### Section Headers (Recent Checks, etc.)
```css
font-size: 11px; color: #55556a;
text-transform: uppercase; letter-spacing: 0.07em;
margin-bottom: 12px;
```

---

## 3. Right Panel — Three States

### Empty State
- Centered content (flex column, align-items: center, justify-content: center)
- Muted icon (e.g. shield or search icon, 32px, `color: #55556a`)
- Text: "Run a trade check to see results" (`font-size: 14px; color: #55556a`)

### Loading State
Replace GlowLoader with inline progress bar:
```html
<div style="display:flex;flex-direction:column;align-items:center;gap:16px">
  <p style="font-size:14px;color:#8b8b9a">Screening trade...</p>
  <div style="width:200px;height:3px;background:rgba(0,0,0,0.35);border-radius:2px;overflow:hidden">
    <div ref={barRef} style="height:100%;background:#6366f1;width:0%;transition:width 1.4s ease" />
  </div>
  <p style="font-size:12px;color:#55556a">{seller}{vessel ? ` · ${vessel}` : ''}</p>
</div>
```
Trigger: `setTimeout(() => { barRef.current.style.width = '100%' }, 50)`

### Result State
Keep existing ResultBanner + FlagCards + PartyCards components. Update their buttons to secondary button style (above).

---

## 4. Recent Checks (Left Panel)

Storage: `localStorage`, key `eti_recent_trade_checks`, max 5 entries.
Schema: `{ seller: string; vessel?: string; commodity?: string; loadingPort?: string; overallRisk: RiskLevel; checkedAt: string }`

Render:
```
Recent Checks  [section header]

Vitol SA
Crude Oil · Primorsk · LOW [color-coded]

ZHENFU ENERGY
Fuel Oil · CNHAK · MEDIUM

...
```

Each row: `cursor: pointer`, click prefills form via state update (`setValues({ seller, vessel, ... })`).
Risk color: `#4ade80` (low), `#fbbf24` (medium), `#f97316` (high), `#ef4444` (critical).
On successful result: push new entry to localStorage (max 5, oldest dropped).

---

## 5. Form Field Order (Single Column)
1. Seller / Counterparty *
2. Vessel Name
3. IMO Number
4. Trade Date
5. Loading Port (LOCODE)
6. Commodity
7. Seller Domain (optional)

Form is single-column in the 380px left panel (no 2-column grid).

---

## 6. What NOT to change
- `/api/trade` backend API — no changes
- Trade result types (`TradeCheckResult`, `TradePartyResult`, etc.) — no changes
- `page.tsx` `UpgradePrompt` component — no changes
- `GlowLoader` component — retained for other pages; not deleted, just unused in TradeClient

---

*Source: Sketch sessions validated 2026-04-19*
*Designer: Sketch Wrap-Up synthesis*

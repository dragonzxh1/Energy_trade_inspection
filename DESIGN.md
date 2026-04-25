---
name: ETI Verify
description: B2B compliance and risk screening platform for energy traders
colors:
  canvas-deep: "#020617"
  surface-navy: "#0f172a"
  elevated-slate: "#1e293b"
  subtle-slate: "#334155"
  text-primary: "#f1f5f9"
  text-secondary: "#94a3b8"
  text-muted: "#64748b"
  text-faint: "#475569"
  text-on-accent: "#ffffff"
  brand-50: "#f0f9ff"
  brand-100: "#e0f2fe"
  brand-400: "#38bdf8"
  brand-500: "#0ea5e9"
  brand-600: "#0284c7"
  brand-900: "#0c4a6e"
  status-clear: "#10b981"
  status-listed: "#ef4444"
  status-unknown: "#8a8f98"
  risk-low: "#22c55e"
  risk-medium: "#f59e0b"
  risk-high: "#f97316"
  risk-critical: "#ef4444"
  accent-primary: "#0ea5e9"
  accent-secondary: "#22d3ee"
  accent-hover: "#38bdf8"
  accent-violet: "#38bdf8"
  border-default: "rgba(56, 189, 248, 0.1)"
  border-subtle: "rgba(56, 189, 248, 0.06)"
  border-solid: "#1e293b"
typography:
  display:
    fontFamily: "'Space Grotesk', var(--font-sans)"
    fontSize: "clamp(36px, 6vw, 56px)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "'Space Grotesk', var(--font-sans)"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "'Space Grotesk', var(--font-sans)"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: 1.40
    letterSpacing: "-0.01em"
  body:
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.57
  label:
    fontFamily: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.40
    letterSpacing: "-0.13px"
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace"
    fontSize: "14px"
    lineHeight: 1.43
    fontFeatureSettings: "normal"
rounded:
  micro: "2px"
  standard: "4px"
  comfortable: "6px"
  card: "12px"
  featured: "16px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  base: "16px"
  lg: "20px"
  xl: "24px"
  2xl: "32px"
  3xl: "40px"
  4xl: "48px"
  5xl: "64px"
components:
  button-primary:
    backgroundColor: "#0284c7"
    textColor: "#ffffff"
    borderColor: "rgba(14, 165, 233, 0.4)"
    rounded: "6px"
    padding: "12px 28px"
  button-primary-hover:
    backgroundColor: "#0ea5e9"
    boxShadow: "0 4px 15px rgba(14, 165, 233, 0.35)"
    transform: "translateY(-1px)"
  glass-panel:
    backgroundColor: "#0f172a"
    borderColor: "rgba(56, 189, 248, 0.1)"
  card:
    backgroundColor: "#0f172a"
    borderColor: "rgba(56, 189, 248, 0.06)"
    rounded: "12px"
  input:
    backgroundColor: "#0f172a"
    borderColor: "rgba(56, 189, 248, 0.1)"
    rounded: "6px"
---

# Design System: ETI Verify

## 1. Overview

**Creative North Star: "The Control Room"**

A B2B compliance platform where information density meets visual precision. The interface should feel like standing in front of a situation room dashboard — dark, focused, every element serving a purpose. Not a marketing site that happens to have data, not a dashboard that happens to be dark. A tool built for people who need to make high-stakes decisions under time pressure.

The aesthetic philosophy rejects decoration in favor of signal. Every color, weight, and spacing choice communicates hierarchy. The brand personality — 精准 · 可信 · 克制 (Precise, Trustworthy, Restrained) — manifests as a system where nothing is accidental.

**Key Characteristics:**
- Deep navy canvas with controlled luminance hierarchy
- Single brand accent used sparingly — its rarity gives it power
- Risk signals are the only source of chromatic saturation on any screen
- Space Grotesk for headings/display establishes brand authority; Inter for body ensures long-session readability
- Information architecture driven by decision priority, not visual balance
- Motion as feedback, never as choreography

## 2. Colors

A restrained system built on near-black navy with a single steel-blue accent. Risk signals break the monochrome deliberately — green for clear, amber for warning, red for critical. The accent appears on CTAs, active states, and interactive focus only.

### Brand
- **Steel Blue** (`#0ea5e9`): Primary brand accent. Used on CTAs, active navigation states, interactive focus indicators, and link hovers. Never used for risk status or data visualization.
- **Steel Blue Light** (`#38bdf8`): Hover states on brand elements, subtle border tints.
- **Steel Blue Dark** (`#0284c7`): Primary button background, pressed states.

### Neutral
- **Canvas Deep** (`#020617`): Deepest background. The primary canvas for the entire application.
- **Surface Navy** (`#0f172a`): Card and panel backgrounds. First level of elevation above canvas.
- **Elevated Slate** (`#1e293b`): Dropdowns, modals, elevated overlays. Second elevation step.
- **Subtle Slate** (`#334155`): Hover states, disabled elements. Third elevation step.
- **Text Primary** (`#f1f5f9`): Near-white for headings, labels, and primary content.
- **Text Secondary** (`#94a3b8`): Body text, descriptions, secondary labels.
- **Text Muted** (`#64748b`): Placeholders, captions, timestamps.
- **Text Faint** (`#475569`): Disabled text, legal footnotes.

### Status (Semantic)
- **Clear** (`#10b981`): Sanction status "not listed", low risk confirmation.
- **Listed** (`#ef4444`): Sanction status "listed", critical risk.
- **Unknown** (`#8a8f98`): Unverified or pending status.

### Risk Levels
- **Low** (`#22c55e`): Green, safe/verified.
- **Medium** (`#f59e0b`): Amber, caution/warning.
- **High** (`#f97316`): Orange-red, elevated risk.
- **Critical** (`#ef4444`): Red, immediate attention required.

### Borders
- **Subtle** (`rgba(56, 189, 248, 0.06)`): Default card and section borders.
- **Default** (`rgba(56, 189, 248, 0.1)`): Input fields, active containers.
- **Solid** (`#1e293b`): Section dividers, footer borders.

### Named Rules

**The One Accent Rule.** The brand accent (`#0ea5e9`) appears on ≤10% of any given screen. Its rarity is the point. If everything is highlighted, nothing is. CTAs, active nav, focus rings, link hovers — that's it.

**The Risk-Only Saturation Rule.** On any screen, the only fully saturated colors are the risk indicators (green/amber/red). Everything else lives in the navy-slate spectrum with the single blue accent.

## 3. Typography

**Display Font:** Space Grotesk (with fallback: var(--font-sans) → system-ui)
**Body Font:** Inter Variable (with fallback: system-ui, -apple-system, Segoe UI, sans-serif)
**Label/Mono Font:** JetBrains Mono (with fallback: ui-monospace, SF Mono, Menlo, monospace)

**Character:** A dual-font system where Space Grotesk's geometric precision establishes brand authority at display and heading sizes, while Inter's clarity ensures long-session readability for body text. Space Grotesk's distinctive character prevents the interface from blending into generic dark-mode templates. Inter's tabular numerals are essential for data-dense screens. JetBrains Mono handles all codes, identifiers, and technical values.

### Hierarchy
- **Display** (weight 600, clamp 36-56px, line-height 1.15, letter-spacing -0.025em): Homepage hero heading only.
- **Headline** (weight 600, 32px, line-height 1.25, letter-spacing -0.025em): Page titles, section headers.
- **Title** (weight 500, 20px, line-height 1.40, letter-spacing -0.01em): Card titles, panel headers.
- **Body** (weight 400, 14px, line-height 1.57): Default body text. Max 65-75ch line length.
- **Body Medium** (weight 500, 14px, line-height 1.57): Emphasized body text, form labels.
- **Small** (weight 400, 13px, line-height 1.60): Secondary text, descriptions.
- **Caption** (weight 500, 12px, line-height 1.40, letter-spacing -0.13px): Badges, labels, timestamps.

### Named Rules

**The Display/Body Split Rule.** Space Grotesk is reserved for h1, h2, h3, and display text only. All body copy, labels, UI text, and navigation use Inter. This preserves Space Grotesk's authority by preventing it from being used at small sizes where its character becomes noise.

**The No-700-Body Rule.** Weight 700 is reserved for headings and hero displays only. Body text, labels, badges, and navigation never exceed weight 600. This preserves the visual impact of bold text.

## 4. Elevation

This system uses tonal layering, not shadows. Depth is conveyed through background luminance steps: Canvas → Surface → Elevated → Subtle. At rest, all surfaces are flat. Shadows appear only as a response to hover state on interactive cards.

### Shadow Vocabulary
- **Card Hover** (`0 10px 40px rgba(14, 165, 233, 0.2)`): Appears only on entity card hover. Subtle brand-tinted lift.
- **Button Hover** (`0 4px 15px rgba(14, 165, 233, 0.35)`): Primary button hover state only.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state (hover, elevation, focus). No persistent drop shadows on cards, panels, or containers.

**The No-Glass Rule.** Backdrop blur (`backdrop-filter`) is not used for decorative cards or panels. The `.glass-panel` utility uses a solid `var(--bg-surface)` background — blur was removed in the polish pass. Backdrop blur serves a functional purpose only when content must remain readable over dynamic backgrounds.

**The No-Glow-Border Rule.** Decorative `box-shadow` glows on borders are prohibited. Any `.glow-border` usage is a design smell — remove it.

## 5. Components

### Buttons
- **Shape:** Gently rounded corners (6px standard, 12px for large CTA).
- **Primary:** `var(--brand-600)` background, white text, 6px radius, 1px solid `rgba(14, 165, 233, 0.4)` border, 12px 28px padding. Hover: `var(--brand-500)` background with brand-tinted shadow and `translateY(-1px)`. Active: `translateY(0)` with shadow removed.
- **Ghost:** Transparent background, `var(--text-secondary)` text. Hover: `var(--text-primary)` text, no background shift.
- **Pill:** Transparent background, `var(--text-secondary)` text, 9999px border radius. Used for filter chips and status toggles.

### Cards / Containers
- **Corner Style:** Comfortably rounded (12px standard, 16px for featured cards).
- **Background:** `var(--bg-surface)` for standard cards. `var(--bg-elevated)` for elevated surfaces.
- **Border:** 1px solid `var(--border-subtle)` for standard cards. Semantic borders for risk-tinted cards (e.g., red border for sanctioned entities).
- **Internal Padding:** `var(--space-6)` (24px) standard. `var(--space-4)` (16px) for compact cards.
- **Hover:** Subtle lift (`translateY(-2px)`) with brand-tinted shadow. Border color shifts to brand accent.

### Inputs / Fields
- **Style:** `var(--bg-surface)` background, 1px solid `var(--border-default)` border, 6px radius.
- **Focus:** Border shifts to brand color, 2px solid `var(--accent-primary)` outline with 2px offset.
- **Error:** Border shifts to `var(--status-listed)` red.

### Navigation
- **Style:** Sticky header on `var(--bg-surface)` background. Links at 13-14px weight 500, `var(--text-secondary)` text → `var(--text-primary)` on hover.
- **Active State:** Brand accent color (`#0ea5e9`), no underline.
- **Mobile:** Text nav links hidden below 480px, icon-only navigation.

### Badges / Pills
- **Status Badge:** 12px weight 500 text, 9999px border radius (pill). Background is tinted version of status color (`${color}15`), border is semi-transparent (`${color}30`).
- **Risk Badge:** Same shape as status badge. Color maps to risk level (green/amber/red).
- **Sanction Badge:** Glowing pulse animation for "listed" status (`redPulse 2.2s`). Subtle glow pulse for "not listed" (`glowPulse 2.8s`).

### ScoreGauge (Signature Component)
- **Shape:** Circular ring gauge with animated stroke-dashoffset.
- **Track:** `var(--bg-elevated)` background, 8px stroke width.
- **Progress:** Risk-colored stroke, rounded linecap, animated on first visibility via IntersectionObserver.
- **Center:** Score displayed at 32px weight 700, risk-colored. "/ 100" label below in muted text.
- **Breakdown:** 5-dimension progress bars below, each 3px height with risk-colored fill.
- **Animation:** 1.2s count-up with cubic-bezier easing (0.33, 1, 0.68, 1). Respects `prefers-reduced-motion`.

## 6. Do's and Don'ts

### Do:
- **Do** use Space Grotesk for h1, h2, h3 and display text. Reserve it for large sizes where its character adds authority.
- **Do** use Inter for all body text, labels, navigation, and UI text. Keep it at 14px or below.
- **Do** build on the deep navy canvas (`#020617`) — this is the native medium, not a "dark mode."
- **Do** reserve brand accent (`#0ea5e9`) for primary CTAs, active states, and interactive focus only.
- **Do** use risk signals (green/amber/red) as the only fully saturated colors on any screen.
- **Do** convey elevation through background luminance steps, not persistent shadows.
- **Do** ensure risk status is communicated through color + icon/text together, never color alone.
- **Do** cap body text line length at 65-75 characters for readability.
- **Do** use JetBrains Mono for all data values, codes, and technical labels.
- **Do** use `brand-text` (solid `var(--brand-400)`) for inline brand emphasis. Never use gradient text.

### Don't:
- **Don't** use `background-clip: text` with a gradient for decorative text effects. It's decorative, never meaningful, and fails the AI slop test. Use solid color via `.brand-text` or weight/size emphasis.
- **Don't** use `backdrop-filter: blur()` for decorative glass panels. Use solid `var(--bg-surface)` background.
- **Don't** use `box-shadow` glows on borders (`.glow-border`). They are decorative and prohibited.
- **Don't** use weight 700 for body text, labels, badges, or navigation. Maximum 600 for body emphasis, 500 for default UI text.
- **Don't** use pure white (`#ffffff`) as text color. `#f1f5f9` is the maximum luminance.
- **Don't** use `border-left` or `border-right` greater than 1px as a colored accent stripe on cards or list items.
- **Don't** introduce warm colors (amber, orange) into UI chrome. They are reserved for risk states only.
- **Don't** animate CSS layout properties (width, height, padding, margin). Use transform and opacity.
- **Don't** use identical card grids with icon + heading + text repeated endlessly. Vary structure for visual hierarchy.
- **Don't** use consumer SaaS clichés (cartoon illustrations, playful emojis, rounded "friendly" elements).
- **Don't** use Web3/crypto aesthetics (neon overload, pixel art, hype-driven visual noise).

# Design System Inspired by Linear

## 1. Visual Theme & Atmosphere

Linear's website is a masterclass in dark-mode-first product design — a near-black canvas (`#08090a`) where content emerges from darkness like starlight. The overall impression is one of extreme precision engineering: every element exists in a carefully calibrated hierarchy of luminance, from barely-visible borders (`rgba(255,255,255,0.05)`) to soft, luminous text (`#f7f8f8`). This is not a dark theme applied to a light design — it is darkness as the native medium, where information density is managed through subtle gradations of white opacity rather than color variation.

The typography system is built entirely on **Inter Variable** with OpenType features `"cv01"` and `"ss03"` enabled globally, giving the typeface a cleaner, more geometric character. Inter is used at a remarkable range of weights — from 300 (light body) through 510 (medium, Linear's signature weight) to 590 (semibold emphasis). Berkeley Mono serves as the monospace companion for code and technical labels.

**Key Characteristics:**
- Dark-mode-native: `#08090a` marketing background, `#0f1011` panel background, `#191a1b` elevated surfaces
- Inter Variable with `"cv01"`, `"ss03"` globally
- Signature weight 510 for most UI text
- Aggressive negative letter-spacing at display sizes
- Brand indigo-violet: `#5e6ad2` (bg) / `#7170ff` (accent) / `#828fff` (hover)
- Semi-transparent white borders: `rgba(255,255,255,0.05)` to `rgba(255,255,255,0.08)`

---

## 2. Color Palette & Roles

**Background Surfaces**
- Marketing Black (`#08090a`): deepest background
- Panel Dark (`#0f1011`): sidebar and panel backgrounds
- Level 3 Surface (`#191a1b`): elevated surfaces, cards, dropdowns
- Secondary Surface (`#28282c`): hover states

**Text & Content**
- Primary Text (`#f7f8f8`): near-white, default text
- Secondary Text (`#d0d6e0`): cool silver-gray for body
- Tertiary Text (`#8a8f98`): muted gray for placeholders
- Quaternary Text (`#62666d`): timestamps, disabled

**Brand & Accent**
- Brand Indigo (`#5e6ad2`): CTAs, brand marks
- Accent Violet (`#7170ff`): links, active states
- Accent Hover (`#828fff`): hover on accent elements

**Status Colors**
- Green (`#27a644`): success/active/low risk
- Emerald (`#10b981`): pill badges, completion
- Red (`#e5484d`): critical/error
- Amber (`#f59e0b`): warning/medium risk

**Border & Divider**
- Border Subtle (`rgba(255,255,255,0.05)`): default
- Border Standard (`rgba(255,255,255,0.08)`): cards, inputs
- Border Primary (`#23252a`): solid dark border

---

## 3. Typography Rules

**Font Family**
- Primary: Inter Variable (fallbacks: SF Pro Display, -apple-system, system-ui)
- Monospace: Berkeley Mono (fallbacks: ui-monospace, SF Mono, Menlo)
- OpenType Features: `"cv01"`, `"ss03"` enabled globally via `font-feature-settings`

**Hierarchy**

| Role | Size | Weight | Line Height | Letter Spacing |
|------|------|--------|-------------|----------------|
| Display XL | 72px | 510 | 1.00 | -1.584px |
| Display | 48px | 510 | 1.00 | -1.056px |
| Heading 1 | 32px | 400 | 1.13 | -0.704px |
| Heading 2 | 24px | 400 | 1.33 | -0.288px |
| Heading 3 | 20px | 590 | 1.33 | -0.24px |
| Body Large | 18px | 400 | 1.60 | -0.165px |
| Body | 16px | 400 | 1.50 | normal |
| Body Medium | 16px | 510 | 1.50 | normal |
| Small | 15px | 400 | 1.60 | -0.165px |
| Caption | 13px | 400–510 | 1.50 | -0.13px |
| Label | 12px | 400–590 | 1.40 | normal |

**Principles**
- 510 is the signature weight — Linear's default emphasis
- Weight 700 is never used; max is 590

---

## 4. Component Stylings

**Buttons**
- Ghost: `rgba(255,255,255,0.02)` bg, `#e2e4e7` text, 6px radius, `1px solid rgb(36,40,44)` border
- Primary: `#5e6ad2` bg, white text, 8px 16px padding, 6px radius
- Pill: transparent bg, `#d0d6e0` text, 9999px radius

**Cards & Containers**
- Background: `rgba(255,255,255,0.02–0.05)` (translucent)
- Border: `1px solid rgba(255,255,255,0.08)`
- Radius: 8px (standard), 12px (featured)

**Badges & Pills**
- Success: `#10b981` bg, 50% radius, 10px weight 510
- Neutral: transparent, `1px solid rgb(35,37,42)` border

**Navigation**
- Dark sticky header on `#0f1011`
- Links: 13–14px weight 510, `#d0d6e0` text → `#f7f8f8` on hover

---

## 5. Layout Principles

**Spacing**
- Base unit: 8px
- Scale: 4px, 8px, 12px, 16px, 20px, 24px, 32px

**Border Radius Scale**
- Micro: 2px (inline badges)
- Standard: 4px
- Comfortable: 6px (buttons, inputs)
- Card: 8px
- Panel: 12px
- Pill: 9999px

---

## 6. Depth & Elevation

| Level | Treatment |
|-------|-----------|
| Flat | `#010102` bg, no shadow |
| Surface | `rgba(255,255,255,0.05)` bg + border |
| Elevated | `rgba(0,0,0,0.4) 0px 2px 4px` shadow |

Elevation via background luminance steps, not shadow darkness.

---

## 7. Do's and Don'ts

**Do**
- Use Inter Variable with `"cv01"`, `"ss03"` on ALL text
- Use weight 510 as default emphasis
- Build on near-black backgrounds: `#08090a` / `#0f1011`
- Use semi-transparent white borders
- Reserve brand indigo for primary CTAs only

**Don't**
- Use pure white (`#ffffff`) as primary text
- Use solid colored backgrounds for buttons
- Use weight 700 (max 590)
- Introduce warm colors into UI chrome
- Use drop shadows on dark surfaces

---

## 8. Quick Reference

**Colors**
- Page bg: `#08090a`
- Panel bg: `#0f1011`
- Surface: `#191a1b`
- Heading: `#f7f8f8`
- Body: `#d0d6e0`
- Muted: `#8a8f98`
- Accent: `#7170ff`
- CTA: `#5e6ad2`
- Border: `rgba(255,255,255,0.08)`

**ETI-Specific Status Colors**
- Low Risk: `#27a644` (green)
- Medium Risk: `#f59e0b` (amber)
- High Risk: `#e5484d` (red)
- Critical: `#b91c1c` (deep red)
- Sanctioned: `#ef4444` with glow
- Not Listed: `#10b981` (emerald)

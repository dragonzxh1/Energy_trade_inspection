---
phase: 05-decision-engine-upgrade
plan: 03
subsystem: ui-compliance
tags: [sanction-badge, trade-client, verdict-label, flag-explanations, ui, typescript]
dependency_graph:
  requires:
    - 05-01-PLAN.md  # FLAG_EXPLANATIONS, TradeVerdict, FlagCode union
    - 05-02-PLAN.md  # TradeCheckResult.verdict field
  provides:
    - SanctionBadge sources prop + JS-driven tooltip
    - VerdictLabel pill component in ResultBanner
    - FlagCard explanation section (What this means + source attribution)
    - Complete FLAG_LABEL map (18 entries)
    - "Export Audit PDF" button text
  affects:
    - src/components/entity/SanctionBadge.tsx
    - src/app/trade/TradeClient.tsx
tech_stack:
  added: []
  patterns:
    - useState(false) for tooltip open/closed state — no third-party library
    - IIFE pattern in JSX for inline conditional rendering with local variable lookup
    - VERDICT_RISK_MAP bridging TradeVerdict to existing RiskLevel design tokens
key_files:
  created: []
  modified:
    - src/components/entity/SanctionBadge.tsx
    - src/app/trade/TradeClient.tsx
decisions:
  - "SanctionBadge sources prop is optional — entity page call sites (Company, Vessel, Terminal) left without sources prop since Company/Vessel types lack sanctionSources field; tooltip simply does not appear"
  - "VerdictLabel uses result.verdict guard for backward compatibility with old stored JSONB sessions lacking verdict field"
  - "IIFE used in FlagCard explanation section to allow FLAG_EXPLANATIONS lookup without adding a named helper function"
  - "Typography correction applied per UI-SPEC: ResultBanner headline fontSize 15px→14px, fontWeight 600→590"
metrics:
  duration: ~3min
  completed: 2026-04-14
  tasks_completed: 2
  files_modified: 2
---

# Phase 05 Plan 03: UI Compliance Surfaces Summary

SanctionBadge upgraded with optional sources tooltip, TradeClient.tsx updated with VerdictLabel pill, FlagCard explanation section, complete 18-entry FLAG_LABEL map, and "Export Audit PDF" button text. Delivers the visible compliance officer experience for DECISION-01, DECISION-02, and DECISION-03.

## What Was Built

### SanctionBadge tooltip (DECISION-01)

Rewrote `src/components/entity/SanctionBadge.tsx` to add:
- `sources?: string[]` optional prop to `SanctionBadgeProps`
- `useState(false)` for tooltip open/closed state — no third-party library
- Wrapper `<span>` with `position: relative`, `onMouseEnter`/`onMouseLeave`/`onClick` handlers
- Tooltip `<span>` with `role="tooltip"`, `id="sanction-tooltip"`, `aria-describedby` wiring
- Tooltip only renders when `status === 'listed'` and `sources.length > 0`
- Styled per UI-SPEC: `var(--bg-elevated)` background, `var(--border-default)` border, 6px radius, 8px/12px padding

The badge itself is unchanged — only the wrapping markup and tooltip are new. The `'use client'` directive is added since `useState` requires client-side rendering.

Call sites on entity pages (`company/[slug]`, `vessel/[imo]`, `terminal/[id]`, `SearchFiltersPanel`) do not pass `sources` — the `Company`/`Vessel`/`Terminal` types lack a `sanctionSources` field. Tooltip simply does not appear at those sites, which is acceptable per the plan.

### VerdictLabel + ResultBanner update (DECISION-02)

Added to `src/app/trade/TradeClient.tsx`:
- Import `TradeVerdict` type and `FLAG_EXPLANATIONS` value from `@/lib/server/trade-rules`
- `VERDICT_RISK_MAP: Record<TradeVerdict, RiskLevel>` — maps `block→critical`, `review→high`, `safe→low`
- `VERDICT_DISPLAY: Record<TradeVerdict, string>` — maps to `'BLOCK'`, `'REVIEW'`, `'SAFE'`
- `VerdictLabel` function component with `aria-label="Compliance verdict: {verdict}"`, styled using existing `RISK_COLOR`/`RISK_BG`/`RISK_BORDER` design tokens
- In `ResultBanner`: `{result.verdict && <VerdictLabel verdict={result.verdict} />}` placed before `<RiskBadge>` in the header row — guards against old stored sessions lacking the field
- Typography correction per UI-SPEC: headline `fontSize: '15px'` → `'14px'`, `fontWeight: 600` → `590`

### FlagCard explanation section (DECISION-03)

Added to the `FlagCard` component in `TradeClient.tsx`, after evidence chips:
- IIFE `{(() => { ... })()}` pattern to look up `FLAG_EXPLANATIONS[flag.code]` and return null if not found
- Separator: `borderTop: 1px solid var(--border-subtle)`, `marginTop/paddingTop: var(--space-2)`
- Title: "What this means" — `fontSize: 12px`, `fontWeight: 590`, `color: var(--text-primary)`
- Description: `explanation.description` — `fontSize: 12px`, `color: var(--text-secondary)`, `lineHeight: 1.5`
- Source attribution: `"Source: {flag.dataSource} · Last synced: {date}"` — `fontSize: 12px`, `color: var(--text-muted)`, `fontFamily: var(--font-mono)`

### FLAG_LABEL extended to 18 entries

Added 7 missing entries to the existing 11-entry `FLAG_LABEL` map:
- `PSC_OFFSHORE_CONTROL: 'Offshore PSC Control'`
- `SPARSE_REGISTRY_DATA: 'Sparse Registry Data'`
- `OFFSHORE_LOW_SUBSTANCE: 'Offshore Low Substance'`
- `KNOWN_FRAUD_ALERT: 'Known Fraud Alert'`
- `DOMAIN_SPOOFING_RISK: 'Domain Spoofing Risk'`
- `DOMAIN_WHOIS_RISK: 'Domain WHOIS Risk'`
- `RELATED_PARTY_RISK: 'Related Party Risk'`

### PDF export button text

Changed link text from `↓ Download PDF` to `Export Audit PDF` in `ResultsView`. Same `href`, same `download` attribute, same styling.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | dcb387a | feat(05-03): upgrade SanctionBadge with sources prop and JS-driven tooltip |
| Task 2 | a6a7b67 | feat(05-03): add VerdictLabel, FlagCard explanation section, complete FLAG_LABEL, update PDF button |

## Verification

- `npm run type-check` exits 0 (zero TypeScript errors) — verified after each task and again after both tasks
- `npm run lint` — pre-existing infrastructure gap (no ESLint config); not applicable per 05-01-SUMMARY note

### Done criteria check
- `sources?: string[]` in SanctionBadge props — PASS
- `useState` import from 'react' in SanctionBadge — PASS
- `role="tooltip"` on tooltip element — PASS
- `onMouseEnter` and `onClick` handlers — PASS
- `RELATED_PARTY_RISK: 'Related Party Risk'` in FLAG_LABEL — PASS
- `VERDICT_RISK_MAP` constant — PASS
- `function VerdictLabel(` — PASS
- `result.verdict && <VerdictLabel` in ResultBanner — PASS
- `What this means` label in FlagCard — PASS
- `Export Audit PDF` button text — PASS
- `flag.dataSource` in FlagCard explanation section — PASS

## Deviations from Plan

None — plan executed exactly as written. All six changes in Task 2 applied as specified. The `'use client'` directive added to `SanctionBadge.tsx` was required by `useState` — the plan's code spec already included it (line 1 of the provided template).

## Known Stubs

None. All UI components render from live data:
- `result.verdict` comes from `TradeCheckResult` (populated by `deriveVerdict()` in Plan 02)
- `FLAG_EXPLANATIONS` is the complete 18-entry constant from Plan 01
- `flag.dataSource` and `flag.dataSourceSyncedAt` are on every `TradeFlag` (populated in Plan 01)
- `sources` prop on `SanctionBadge` is optional — absence at entity page call sites is correct behavior (data not available in those types), not a stub

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes. Both trust boundaries from the plan's threat model are resolved as accepted:
- `T-5-03` (SanctionBadge tooltip): Source names are DB-sourced strings rendered as React text nodes, not innerHTML
- `T-5-03` (FlagCard dataSource): Static compile-time strings from trade-rules.ts, rendered as React text content

## Self-Check

### Files exist:
- `src/components/entity/SanctionBadge.tsx` — FOUND (modified)
- `src/app/trade/TradeClient.tsx` — FOUND (modified)
- `.planning/phases/05-decision-engine-upgrade/05-03-SUMMARY.md` — this file

### Commits exist:
- `dcb387a` — verified (feat(05-03): upgrade SanctionBadge...)
- `a6a7b67` — verified (feat(05-03): add VerdictLabel...)

## Self-Check: PASSED

---
phase: 09-data-enrichment-foundations
plan: "03"
subsystem: frontend
tags: [fraud-alerts, server-component, tab-insertion, content-lock, company-page, vessel-page]

# Dependency graph
requires:
  - "09-01: IcijMatch interface + OffshoreLeaksPanel badge"
  - "09-02: FraudAlertRow interface + getCompanyFraudAlerts + getVesselFraudAlerts"
provides:
  - "FraudAlertsPanel Server Component (src/components/entity/FraudAlertsPanel.tsx)"
  - "company/[slug]/page.tsx: fraud-alerts tab + FraudAlertsPanel panel + fraudAlerts prefetch"
  - "vessel/[imo]/page.tsx: fraud-alerts tab + FraudAlertsPanel panel + vesselFraudAlerts prefetch"
affects:
  - Phase 10: Network Graph Core — FraudAlertsPanel amber color pattern reusable for orange fraud nodes

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Props-fed Server Component pattern: data prefetched in page.tsx, passed as props to panel"
    - "f3Unlocked gate: ternary guard in Promise.all / await call — dual protection with ContentLock"
    - "Tab/panel index correspondence: manual count verification (10/10 company, 8/8 vessel)"

key-files:
  created:
    - src/components/entity/FraudAlertsPanel.tsx
  modified:
    - src/app/company/[slug]/page.tsx
    - src/app/vessel/[imo]/page.tsx

decisions:
  - "FraudAlertsPanel imports FraudAlertRow from repository (not re-declared) — single source of truth"
  - "Empty state: single card with section title + centered copy + sub-copy (matches OffshoreLeaksPanel pattern)"
  - "Populated state: blacklistCount only shown in section title (not total count) per UI-SPEC Copywriting Contract"
  - "Alert item key includes idx to handle duplicate source::company_name pairs at render layer"
  - "vessel.currentOperator passed to getVesselFraudAlerts (vessel.manager not in schema per RESEARCH.md Q-1)"

metrics:
  duration: "~15 min"
  completed: "2026-04-16"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
requirements: [NETDATA-03, NETDATA-04]
---

# Phase 9 Plan 03: FraudAlertsPanel UI Integration Summary

FraudAlertsPanel Server Component with source badges, list-type badges, and fraud alert item layout; inserted as F3-gated tab in company and vessel detail pages with server-side data prefetch.

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-04-16
- **Tasks:** 2/2 complete (checkpoint:human-verify pending)
- **Files:** 1 created, 2 modified

## Accomplishments

### Task 1: FraudAlertsPanel Server Component (`a47bd58`)

- Pure Server Component — no `use client` directive, data via props only
- Empty state: exact UI-SPEC copy ("No fraud alerts on record for this entity." + sub-copy)
- Populated state: section title shows `Fraud Alerts (N)` where N = blacklist count only
- Alert item layout: company_name + source badge (amber), fraud_type label + "Reported {date}" metadata, description (truncated at 120 chars), scam_url with "Fake site:" prefix
- Source badge: amber (`var(--accent-amber)`) with `SOURCE_LABEL` map for 5 known sources
- List type badge: amber BLACKLIST / emerald WHITELIST with correct colors per UI-SPEC
- Panel footnote: exact copy per UI-SPEC Copywriting Contract
- `className="data-row"` on each alert item for CSS hover consistency

### Task 2: Tab insertion into company and vessel pages (`0792214`)

**company/[slug]/page.tsx:**
- Import: `getCompanyFraudAlerts` added to repository import; `FraudAlertsPanel` imported from components
- Promise.all extended: `f3Unlocked ? getCompanyFraudAlerts(company.name) : Promise.resolve([])` — double-fence with ContentLock (T-9-03 mitigated)
- Tabs: `{ id: 'fraud-alerts', label: 'Fraud Alerts' }` inserted at index 5 (after flags, before offshore)
- Panels: `<ContentLock key="fraud-alerts"><FraudAlertsPanel alerts={fraudAlerts} /></ContentLock>` at index 5
- Total tabs: 10 | Total panels: 10 — index correspondence verified

**vessel/[imo]/page.tsx:**
- Import: `getVesselFraudAlerts` added to repository import; `FraudAlertsPanel` imported from components
- Data prefetch: `vesselFraudAlerts = f3Unlocked ? await getVesselFraudAlerts(vessel.currentOperator) : []` after warningHits
- Tabs: `{ id: 'fraud-alerts', label: 'Fraud Alerts' }` inserted at index 4 (after flags, before history)
- Panels: `<ContentLock key="fraud-alerts"><FraudAlertsPanel alerts={vesselFraudAlerts} /></ContentLock>` at index 4
- Total tabs: 8 | Total panels: 8 — index correspondence verified

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create FraudAlertsPanel Server Component | a47bd58 | src/components/entity/FraudAlertsPanel.tsx |
| 2 | Insert fraud-alerts tab into company and vessel pages | 0792214 | src/app/company/[slug]/page.tsx, src/app/vessel/[imo]/page.tsx |

## Verification

- `npm run type-check` — PASSED (exit 0)
- `npm run build` — PASSED (exit 0, "Compiled successfully in 2.9s")
- `grep "use client" FraudAlertsPanel.tsx` — empty (PASS)
- `grep "FraudAlertRow" FraudAlertsPanel.tsx` — import line found (PASS)
- `grep "No fraud alerts on record" FraudAlertsPanel.tsx` — empty state copy found (PASS)
- `grep "Covers Rotterdam Port Blacklist" FraudAlertsPanel.tsx` — sub-copy found (PASS)
- `grep "Fraud alerts sourced from industry blacklists" FraudAlertsPanel.tsx` — footnote found (PASS)
- `grep "data-row" FraudAlertsPanel.tsx` — className found (PASS)
- `grep "accent-amber" FraudAlertsPanel.tsx` — source badge color found (PASS)
- `grep "fraud-alerts" company/[slug]/page.tsx` — tab + ContentLock key (2 hits, PASS)
- `grep "FraudAlertsPanel" company/[slug]/page.tsx` — import + JSX (2 hits, PASS)
- `grep "getCompanyFraudAlerts" company/[slug]/page.tsx` — import + call (2 hits, PASS)
- `grep "fraud-alerts" vessel/[imo]/page.tsx` — tab + ContentLock key (2 hits, PASS)
- `grep "FraudAlertsPanel" vessel/[imo]/page.tsx` — import + JSX (2 hits, PASS)
- `grep "getVesselFraudAlerts" vessel/[imo]/page.tsx` — import + call (2 hits, PASS)
- `grep "f3Unlocked" company/[slug]/page.tsx` — guard at getCompanyFraudAlerts call (PASS)
- `grep "f3Unlocked" vessel/[imo]/page.tsx` — guard at vesselFraudAlerts assignment (PASS)

## Threat Model Compliance

- T-9-03 (Elevation of Privilege — company): `f3Unlocked ? getCompanyFraudAlerts(company.name) : Promise.resolve([])` in page.tsx + `<ContentLock unlocked={f3Unlocked}>` — dual protection. Free-plan users receive empty array and see locked UI.
- T-9-03 (Elevation of Privilege — vessel): `f3Unlocked ? await getVesselFraudAlerts(vessel.currentOperator) : []` in page.tsx + `<ContentLock unlocked={f3Unlocked}>` — dual protection.
- T-9-02 (DoS): FraudAlertsPanel is pure render — no DB queries. LIMIT 50 enforced in repository layer (Plan 02).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. `FraudAlertsPanel` receives live `FraudAlertRow[]` data from repository functions created in Plan 02. No hardcoded values or placeholders in the rendering path.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced. All new surface (data prefetch + render) is within existing SSR page components behind existing `f3Unlocked` and `ContentLock` gates.

## Checkpoint Status

This plan includes a `checkpoint:human-verify` (blocking) gate as Task 3. The two autonomous tasks (Task 1 + Task 2) have completed and been committed. Human verification of the dev server UI is required before Phase 9 is considered complete.

**Awaiting:** Human verification that:
1. "Fraud Alerts" tab appears in company detail page tab bar (between Risk Flags and Offshore Leaks)
2. "Fraud Alerts" tab appears in vessel detail page tab bar (between Risk Flags and PSC History)
3. ContentLock renders correctly for free-plan users
4. Empty state copy matches: "No fraud alerts on record for this entity."
5. Offshore Leaks tab still renders correctly (no index drift)

## Self-Check

**Files exist:**
- `src/components/entity/FraudAlertsPanel.tsx` — FOUND
- `src/app/company/[slug]/page.tsx` (contains fraud-alerts) — FOUND
- `src/app/vessel/[imo]/page.tsx` (contains fraud-alerts) — FOUND

**Commits exist:**
- `a47bd58` (Task 1 — FraudAlertsPanel component) — FOUND
- `0792214` (Task 2 — tab insertion) — FOUND

## Self-Check: PASSED

---
*Phase: 09-data-enrichment-foundations*
*Completed: 2026-04-16*

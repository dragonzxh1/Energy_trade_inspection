---
phase: 09-data-enrichment-foundations
verified: 2026-04-16T05:30:00Z
status: human_needed
score: 3/4
overrides_applied: 0
deferred:
  - truth: "In the network graph (Phase 10 dependency), ICIJ nodes marked is_sanctioned=true render as red rather than grey"
    addressed_in: "Phase 10"
    evidence: "Phase 10 success criteria #4: 'Nodes use color coding: red for sanctioned entities'. REQUIREMENTS.md NETDATA-02 is explicitly mapped to Phase 10."
human_verification:
  - test: "Fraud Alerts tab visible in company detail page tab bar"
    expected: "Tab labeled 'Fraud Alerts' appears between 'Risk Flags' and 'Offshore Leaks' in the tab bar"
    why_human: "Tab rendering requires a live browser — cannot verify visual tab bar layout programmatically"
  - test: "Fraud Alerts tab visible in vessel detail page tab bar"
    expected: "Tab labeled 'Fraud Alerts' appears between 'Risk Flags' and 'PSC History' in the tab bar"
    why_human: "Tab rendering requires a live browser"
  - test: "ContentLock renders correctly for free-plan users on Fraud Alerts panel"
    expected: "Free-plan user sees locked overlay on Fraud Alerts tab content; paid user sees empty-state copy or alert list"
    why_human: "Requires authentication context and browser session to verify"
  - test: "Empty state text is displayed when no fraud alerts match"
    expected: "Text reads exactly: 'No fraud alerts on record for this entity.'"
    why_human: "Requires browser rendering with a company/vessel that has no fraud alert matches"
  - test: "Offshore Leaks tab renders without index drift after fraud-alerts tab insertion"
    expected: "Offshore Leaks tab and its panel content render correctly; no content mismatch between tabs and panels"
    why_human: "Tab/panel array index correspondence can only be confirmed visually at runtime"
---

# Phase 9: Data Enrichment Foundations — Verification Report

**Phase Goal:** Users can see sanctions↔ICIJ linkage and fraud alert data on entity detail pages
**Verified:** 2026-04-16T05:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After ICIJ sync runs, entities that fuzzy-match a sanctioned entity have `is_sanctioned=true` in the database | VERIFIED | `matchSanctions()` exists in `scripts/sync-icij-offshore.mjs` (L393–421), called from `main()` at L463 after `linkToEntities()`. Full UPDATE SQL with `word_similarity > 0.72` threshold. `is_sanctioned` and `sanctions_match` columns added by migration 036. |
| 2 | A company detail page shows a FraudAlertsPanel listing matched fraud alert records when matches exist | VERIFIED | `FraudAlertsPanel` imported and rendered in `company/[slug]/page.tsx` (L14, L818–819). Data pre-fetched via `getCompanyFraudAlerts(company.name)` at L768, guarded by `f3Unlocked`. Component renders alert list when alerts.length > 0. |
| 3 | A vessel detail page shows a FraudAlertsPanel with fraud alerts matched via operator/manager name | VERIFIED | `FraudAlertsPanel` imported and rendered in `vessel/[imo]/page.tsx` (L14, L491–492). Data pre-fetched via `getVesselFraudAlerts(vessel.currentOperator)` at L454–456, guarded by `f3Unlocked`. |
| 4 | In the network graph (Phase 10 dependency), ICIJ nodes marked `is_sanctioned=true` render as red rather than grey | DEFERRED | This is a Phase 10 graph rendering requirement (GRAPH-04 / NETDATA-02). The data foundation (`is_sanctioned` column + `isSanctioned` field in IcijMatch) is in place from this phase. |

**Score:** 3/4 truths verified (1 deferred to Phase 10 — does not affect score)

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | ICIJ nodes marked `is_sanctioned=true` render as red in network graph | Phase 10 | Phase 10 success criteria #4: "Nodes use color coding: red for sanctioned entities". REQUIREMENTS.md maps NETDATA-02 to Phase 10. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `db/migrations/036_icij_sanctions_linkage.sql` | ALTER TABLE adds is_sanctioned + sanctions_match; sparse index | VERIFIED (partial) | EXISTS. Adds both columns with correct defaults. Sparse index `idx_icij_sanctioned WHERE is_sanctioned = TRUE` present. **The initial full re-match UPDATE was removed** — moved to sync script (D-01 design decision, noted in SUMMARY). See WR-01 note. |
| `scripts/sync-icij-offshore.mjs` | matchSanctions() function called from main() | VERIFIED | EXISTS. `matchSanctions()` at L393–421 with correct UPDATE SQL. Called from `main()` at L463 after `linkToEntities()` under `!DRY_RUN && total > 0` guard. |
| `src/lib/server/repository.ts` | IcijMatch extended with isSanctioned?/sanctionsMatch?; getIcijMatches() extended; FraudAlertRow + getCompanyFraudAlerts + getVesselFraudAlerts | VERIFIED | All present. IcijMatch at L1010–1011, getIcijMatches() SELECT at L1016–1022. FraudAlertRow at L1507–1517 (includes synced_at: Date). getCompanyFraudAlerts at L1523, getVesselFraudAlerts at L1561. |
| `src/components/entity/FraudAlertsPanel.tsx` | Props-fed Server Component, min 80 lines, all required copy | VERIFIED | EXISTS (184 lines). No `use client`. Imports FraudAlertRow. Empty state copy exact match. Sub-copy, footnote, source badge (amber), list-type badge (BLACKLIST/WHITELIST), `data-row` className all present. |
| `src/app/company/[slug]/page.tsx` | fraud-alerts tab inserted; FraudAlertsPanel panel; fraudAlerts prefetch | VERIFIED | fraud-alerts tab at L797 (index 5, between flags and offshore). Panel at L818–819. fraudAlerts in Promise.all at L768. Total tabs: 10, panels: 10. |
| `src/app/vessel/[imo]/page.tsx` | fraud-alerts tab inserted; FraudAlertsPanel panel; vesselFraudAlerts prefetch | VERIFIED | fraud-alerts tab at L474 (index 4, between flags and history). Panel at L491–492. vesselFraudAlerts at L454–456. Total tabs: 8, panels: 8. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scripts/sync-icij-offshore.mjs:main()` | `icij_entities.is_sanctioned` | `matchSanctions()` UPDATE SQL | WIRED | Called at L463; UPDATE targets both `is_sanctioned` and `sanctions_match` columns |
| `src/app/company/[slug]/page.tsx` | `IcijMatch.isSanctioned` | `getIcijMatches()` return value | WIRED | SELECT includes `is_sanctioned`, mapped to `isSanctioned` at L1037. Used in OffshoreLeaksPanel badge at L513 |
| `src/app/company/[slug]/page.tsx` | `repository.ts:getCompanyFraudAlerts` | f3Unlocked conditional call | WIRED | L768: `f3Unlocked ? getCompanyFraudAlerts(company.name) : Promise.resolve([])` |
| `src/app/vessel/[imo]/page.tsx` | `repository.ts:getVesselFraudAlerts` | f3Unlocked conditional call | WIRED | L454–456: `f3Unlocked ? await getVesselFraudAlerts(vessel.currentOperator) : []` |
| `src/app/company/[slug]/page.tsx` | `src/components/entity/FraudAlertsPanel.tsx` | import + panels array | WIRED | Imported at L14; rendered at L818–819 with `alerts={fraudAlerts}` |
| `src/app/vessel/[imo]/page.tsx` | `src/components/entity/FraudAlertsPanel.tsx` | import + panels array | WIRED | Imported at L14; rendered at L491–492 with `alerts={vesselFraudAlerts}` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `FraudAlertsPanel.tsx` | `alerts: FraudAlertRow[]` | `getCompanyFraudAlerts()` / `getVesselFraudAlerts()` in page.tsx | Yes — queries `fraud_alerts` table via pg_trgm with `normalized_name` comparison | FLOWING |
| `OffshoreLeaksPanel` badge | `m.isSanctioned` | `getIcijMatches()` → `icij_entities.is_sanctioned` column | Yes — DB column populated by `matchSanctions()` sync | FLOWING (after sync runs) |

### Behavioral Spot-Checks

Step 7b: SKIPPED — requires running Next.js dev server for UI rendering. Covered by human verification items.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| NETDATA-01 | 09-01-PLAN | ICIJ entities auto-matched to sanctions on sync, `is_sanctioned=true` tagged | SATISFIED | Migration 036 adds columns; `matchSanctions()` in sync script runs full UPDATE |
| NETDATA-02 | 09-01-PLAN | `is_sanctioned=true` ICIJ nodes display as red in network graph | DEFERRED to Phase 10 | Data foundation in place (`isSanctioned` field on IcijMatch). Graph rendering is Phase 10 (GRAPH-04). |
| NETDATA-03 | 09-02-PLAN, 09-03-PLAN | Company detail page FraudAlertsPanel | SATISFIED | `FraudAlertsPanel` in company page with `getCompanyFraudAlerts()`, F3-gated, tab in correct position |
| NETDATA-04 | 09-02-PLAN, 09-03-PLAN | Vessel detail page FraudAlertsPanel via operator/manager name | SATISFIED | `FraudAlertsPanel` in vessel page with `getVesselFraudAlerts(vessel.currentOperator)`, F3-gated |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/components/entity/FraudAlertsPanel.tsx` | 132 | CR-01: `scam_url` used directly as `href` without protocol validation — `javascript:` or `data:` URLs could execute script in browser | Warning | XSS vector. `scam_url` comes from `fraud_alerts` table which is admin-controlled data (not user-supplied), but a compromised DB entry could exploit users. Mitigated by `rel="noopener noreferrer"` but not by protocol check. |
| `scripts/sync-icij-offshore.mjs` | 191–228 | WR-01: `upsertBatch()` does not save `source_url` — only 11 columns inserted, `source_url` excluded from INSERT and ON CONFLICT UPDATE | Warning | `icij_entities.source_url` remains NULL after sync. The `source_url` field is mapped in `getIcijMatches()` and displayed as "ICIJ" link in OffshoreLeaksPanel. With NULL source_url, the ICIJ link never renders for any entity. |
| `db/migrations/036_icij_sanctions_linkage.sql` | (file) | Initial re-match UPDATE removed from migration — only ADD COLUMN and CREATE INDEX remain | Info | Design decision (D-01/D-02): UPDATE moved to sync script to avoid long-running startup transaction. Correct pattern for large tables. Means `is_sanctioned` is FALSE for all rows until first sync run completes. |

### Human Verification Required

#### 1. Fraud Alerts Tab Visibility (Company Page)

**Test:** Run `npm run dev`, visit any company detail page. Check the tab bar.
**Expected:** "Fraud Alerts" tab appears between "Risk Flags" and "Offshore Leaks"
**Why human:** Tab rendering requires a live browser and cannot be verified programmatically.

#### 2. Fraud Alerts Tab Visibility (Vessel Page)

**Test:** Visit any vessel detail page. Check the tab bar.
**Expected:** "Fraud Alerts" tab appears between "Risk Flags" and "PSC History"
**Why human:** Tab rendering requires a live browser.

#### 3. ContentLock F3 Gating Behavior

**Test:** Visit a company or vessel page as a free-plan user, click "Fraud Alerts" tab.
**Expected:** ContentLock overlay is shown (locked state). With a paid account, the panel content renders (empty state or alert list).
**Why human:** Requires authentication session and browser interaction.

#### 4. Empty State Copy Validation

**Test:** Visit a company or vessel with no matching fraud alerts, click "Fraud Alerts" tab with a paid account.
**Expected:** Text reads exactly: "No fraud alerts on record for this entity."
**Why human:** Requires browser rendering with specific data condition.

#### 5. Tab/Panel Index Integrity (Offshore Leaks Not Drifted)

**Test:** On a company detail page with ICIJ matches, click the "Offshore Leaks" tab.
**Expected:** The Offshore Leaks panel renders correctly (not shifted to show wrong content).
**Why human:** Tab/panel array correspondence can only be confirmed by clicking tabs in a live browser.

---

## Known Issues Requiring Fix

### CR-01: XSS Risk in FraudAlertsPanel (scam_url href)

`scam_url` is used directly as an `href` attribute without protocol validation:

```tsx
// src/components/entity/FraudAlertsPanel.tsx L131–138
<a href={alert.scam_url} target="_blank" rel="noopener noreferrer">
```

A `javascript:` or `data:` URL in `scam_url` could execute script. Although `fraud_alerts` data is admin-controlled (not direct user input), a database compromise or malicious import could exploit this. Recommended fix:

```tsx
const safeUrl = /^https?:\/\//i.test(alert.scam_url) ? alert.scam_url : '#'
<a href={safeUrl} ...>
```

### WR-01: source_url Never Persisted to icij_entities

`upsertBatch()` in `sync-icij-offshore.mjs` does not include `source_url` in its INSERT column list. The `source_url` field in `mapRow()` (L185) is set from CSV data but never saved to the database. As a result:

- `icij_entities.source_url` is always NULL after sync
- The ICIJ external link (`<a href={m.sourceUrl}>ICIJ</a>`) in OffshoreLeaksPanel never renders
- This is a pre-existing issue from before Phase 9 that Phase 9 did not introduce or worsen, but it is visible because Phase 9 extended the `getIcijMatches()` SELECT to include `source_url`

Recommended fix: add `source_url` to the `upsertBatch()` INSERT column list (update placeholder count from 11 to 12).

---

## Gaps Summary

No blocking gaps. All automated-verifiable must-haves are satisfied:
- Migration 036 exists with correct column definitions and index
- `matchSanctions()` is substantive and wired into the sync script
- Both repository functions (`getCompanyFraudAlerts`, `getVesselFraudAlerts`) exist and are data-connected
- `FraudAlertsPanel` is a substantive, wired Server Component (no stubs)
- Both detail pages have the tab inserted at the correct position with f3Unlocked guards

The phase is **human_needed** because Plan 03 explicitly requires a blocking `checkpoint:human-verify` gate for UI rendering and F3 gating behavior, which cannot be verified programmatically.

Two quality issues (CR-01, WR-01) are noted but do not block the phase goal — they require follow-up fixes.

---

_Verified: 2026-04-16T05:30:00Z_
_Verifier: Claude (gsd-verifier)_

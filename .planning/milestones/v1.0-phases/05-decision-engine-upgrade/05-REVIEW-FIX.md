---
phase: 05-decision-engine-upgrade
fixed_at: 2026-04-14T00:00:00Z
review_path: .planning/phases/05-decision-engine-upgrade/05-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 05: Code Review Fix Report

**Fixed at:** 2026-04-14T00:00:00Z
**Source review:** .planning/phases/05-decision-engine-upgrade/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (Warning severity — no Criticals)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### WR-01: Unsafe Type Assertion for Director Extraction Bypasses Type Safety

**Files modified:** `src/lib/server/trade-service.ts`
**Commit:** ca0eb80
**Applied fix:** Replaced the double type assertion `(sellerFullEntity as { directors?: ... } | null)?.directors` with a local `isCompany(e: unknown): e is Company` runtime type guard. The guard checks `typeof e === 'object' && e !== null && 'directors' in e` and narrows to the already-imported `Company` type. If the entity is not a company, `sellerDirectors` falls back to `[]` explicitly rather than via a silent cast.

---

### WR-02: Duplicate `id="sanction-tooltip"` Breaks ARIA When Multiple Badges Render

**Files modified:** `src/components/entity/SanctionBadge.tsx`
**Commit:** 716855a
**Applied fix:** Added `useId` to the existing `react` import and replaced the hardcoded `const tooltipId = 'sanction-tooltip'` with `const tooltipId = useId()`. React 18's `useId()` generates a stable, document-unique ID per component instance, eliminating the duplicate `id` attribute when multiple `SanctionBadge` components render on the same page.

---

### WR-03: Wrong `dataSource` Attribution on Seller-Country GEO_MISMATCH Flag

**Files modified:** `src/lib/server/trade-rules.ts`
**Commit:** 80f32bc
**Applied fix:** Changed `dataSource: 'AIS Tracking System'` to `dataSource: 'Company Registry'` in the seller-country `GEO_MISMATCH` flag block (line 268). The port-country and vessel-country variants at lines 273–295 correctly retain `'AIS Tracking System'` since those draw from AIS/vessel records.

---

### WR-04: `DOMAIN_WHOIS_RISK` Flag Emitted for `severity === 'critical'` Without Explicit Guard

**Files modified:** `src/lib/server/trade-rules.ts`
**Commit:** c1443c7
**Applied fix:** Added `severity === 'critical'` as the leading condition in the Rule 17 guard (line 693): `if (severity === 'critical' || severity === 'high' || severity === 'medium')`. Previously a `critical`-severity domain signal with no spoofing match was silently dropped; it now triggers a `DOMAIN_WHOIS_RISK` flag like the other actionable severity levels.

---

_Fixed: 2026-04-14T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

---
phase: 05-decision-engine-upgrade
reviewed: 2026-04-14T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/lib/server/trade-rules.ts
  - src/lib/server/trade-service.ts
  - src/app/trade/TradeClient.tsx
  - src/components/entity/SanctionBadge.tsx
  - src/lib/pdf/trade-report.tsx
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-04-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Five files were reviewed covering the Phase 5 decision-engine upgrade: the rule engine (`trade-rules.ts`), the service orchestrator (`trade-service.ts`), the trade UI client (`TradeClient.tsx`), the sanction badge component (`SanctionBadge.tsx`), and the PDF report renderer (`trade-report.tsx`).

The focused security concern — SQL injection risk in `checkRelatedPartyRisk()` — was **not found**. Both similarity queries use `$1`/`$2` parameterized bindings; no string interpolation is present in any database query.

The `FLAG_EXPLANATIONS` record covers all 18 `FlagCode` values exactly — no exhaustiveness gap.

Both the UI (`TradeClient.tsx:595`) and PDF (`trade-report.tsx:474`) guard `result.verdict` with a truthiness check before rendering, correctly protecting against old stored sessions that lack the field.

Four warnings were found: an unsafe type assertion for director extraction, a duplicate DOM `id` in `SanctionBadge` that breaks ARIA when multiple instances render, an incorrect `dataSource` attribution for seller-country geo flags, and a missing null check for `DOMAIN_WHOIS_RISK` severity before flag emission. Three informational items are also noted.

---

## Warnings

### WR-01: Unsafe Type Assertion for Director Extraction Bypasses Type Safety

**File:** `src/lib/server/trade-service.ts:312-313`

**Issue:** `sellerFullEntity` is returned from `getEntityByKey()`, which returns `SearchResult | null`. It is then cast via a double type assertion to a structural type containing `directors?`. If the returned object does not actually have a `directors` field (e.g. the API changes, or the entity is a vessel rather than a company), the cast silently produces `undefined`, the nullish coalescing falls to `[]`, and `checkRelatedPartyRisk` is called with zero directors — suppressing the RELATED_PARTY_RISK flag with no error. This is a silent failure mode in a compliance-critical path.

```typescript
// Current — cast bypasses compiler checks:
const sellerDirectors: Array<{ name: string; role?: string }> =
  (sellerFullEntity as { directors?: Array<{ name: string; role?: string }> } | null)?.directors ?? []
```

**Fix:** Cast through the already-imported `Company` type, which correctly declares `directors`. If `getEntityByKey` may return non-Company entities, add a runtime type guard:

```typescript
import type { Company } from '@/lib/types'

function isCompany(e: unknown): e is Company {
  return typeof e === 'object' && e !== null && 'directors' in e
}

const sellerDirectors =
  isCompany(sellerFullEntity) ? (sellerFullEntity.directors ?? []) : []
```

---

### WR-02: Duplicate `id="sanction-tooltip"` Breaks ARIA When Multiple Badges Render

**File:** `src/components/entity/SanctionBadge.tsx:38`

**Issue:** `tooltipId` is hardcoded as the string `'sanction-tooltip'`. The HTML `id` attribute must be unique per document. Trade check results pages render two `SanctionBadge` components — one for the seller and one for the vessel — both with `status === 'listed'` in sanctioned cases. Both will write `id="sanction-tooltip"` to the DOM. This violates the ARIA spec (`aria-describedby` must reference a unique element), breaks screen reader associations, and will cause the browser to return the first matching element when resolving the `id`, potentially pointing the wrong badge's tooltip to the wrong element.

```typescript
// Current — static ID, duplicates on every rendered instance:
const tooltipId = 'sanction-tooltip'
```

**Fix:** Generate a unique ID per instance. In React 18+, use `useId()`:

```typescript
import { useState, useId } from 'react'

export default function SanctionBadge({ status, size = 'md', sources }: SanctionBadgeProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const tooltipId = useId()  // stable, unique per instance
  // ...
}
```

---

### WR-03: Wrong `dataSource` Attribution on Seller-Country GEO_MISMATCH Flag

**File:** `src/lib/server/trade-rules.ts:267`

**Issue:** When a `GEO_MISMATCH` flag fires because the **seller's company registration country** is a high-risk jurisdiction, the flag's `dataSource` field is set to `'AIS Tracking System'`. This is factually wrong — the seller's country comes from the company registry, not AIS. Audit trails and the PDF report display this `dataSource` string directly to compliance officers (trade-report.tsx lines 309–318), so an incorrect attribution could mislead a review.

```typescript
// Current (line 267):
if (isHighRisk(sellerCC)) {
  flags.push({
    code: 'GEO_MISMATCH',
    severity: 'high',
    target: 'seller',
    reason: `Seller is registered in a high-risk sanctioned jurisdiction: ${sellerCC}.`,
    evidence: ['Company Registry', 'OFAC/UN/EU Sanctioned Country List'],
    dataSource: 'AIS Tracking System',   // <-- wrong
    dataSourceSyncedAt: null,
  })
}
```

**Fix:** Change `dataSource` to `'Company Registry'` for the seller-country check. The port-country and vessel-country variants at lines 273–295 correctly use `'AIS Tracking System'` since those draw from AIS/vessel records.

```typescript
dataSource: 'Company Registry',
```

---

### WR-04: `DOMAIN_WHOIS_RISK` Flag Emitted for `severity === 'critical'` Without Explicit Guard

**File:** `src/lib/server/trade-rules.ts:693`

**Issue:** Rule 17 (DOMAIN_WHOIS_RISK) has an explicit severity guard that only fires for `'high'` or `'medium'`. If `sellerDomainCheck.severity` is `'critical'` — a valid value per the union type at lines 143–144 — and there are no spoofing matches (so Rule 16 does not fire), the domain risk is silently dropped. No flag is raised at all, despite `flagged: true` and `evidence.length > 0`. A critical-severity domain signal with no spoofing match goes unreported.

```typescript
// Current (lines 692-704):
const severity = input.sellerDomainCheck.severity
if (severity === 'high' || severity === 'medium') {
  flags.push({ code: 'DOMAIN_WHOIS_RISK', severity, ... })
}
// severity === 'critical' falls through — no flag emitted
```

**Fix:** Include `'critical'` in the guard (or use a blocklist exclusion of `'low'`):

```typescript
if (severity === 'critical' || severity === 'high' || severity === 'medium') {
  flags.push({ code: 'DOMAIN_WHOIS_RISK', severity, ... })
}
```

---

## Info

### IN-01: Focused Security Confirmation — Parameterized Queries Verified

**File:** `src/lib/server/trade-service.ts:195-220`

**Issue:** No issue found. Both `checkRelatedPartyRisk()` queries against `sanctions_entries` (line 201) and `regulatory_warnings` (line 215) use `$1` and `$2` positional parameters with the `normalized` value passed as a bound parameter. The normalized string is derived by stripping all non-alphanumeric characters from the person's name (line 191), providing defense-in-depth even if the parameterization were somehow bypassed. No SQL injection vector is present.

**Fix:** No action required.

---

### IN-02: FLAG_EXPLANATIONS Exhaustiveness Confirmed

**File:** `src/lib/server/trade-rules.ts:744-835`

**Issue:** No issue found. The `FLAG_EXPLANATIONS` object is typed as `Record<FlagCode, ...>`, which requires the TypeScript compiler to enforce that every member of the `FlagCode` union has an entry. All 18 codes — including the newly added `RELATED_PARTY_RISK` — are present. Coverage is complete.

**Fix:** No action required.

---

### IN-03: Fire-and-Forget TTL Cleanup Query Missing Inline Error Logging

**File:** `src/lib/server/trade-service.ts:408`

**Issue:** The TTL cleanup `DELETE` at line 408 uses `.catch(err => console.error(...))` for the seller trade-event insert at line 414 and vessel insert at line 422, but the TTL cleanup itself at line 408 has no `.catch()` handler:

```typescript
// Line 408 — no catch handler:
db.query(`DELETE FROM trade_sessions WHERE created_at < NOW() - INTERVAL '90 days'`)
  .catch((err) => console.error('[trade] TTL cleanup error:', err))
```

Actually on re-read, `.catch` is chained at line 409. This is correct. However, the fire-and-forget pattern means errors are logged but never surfaced. This is acceptable for a cleanup job but worth noting that transient DB connectivity errors will silently fail to clean old sessions.

**Fix:** No immediate code change required. Consider a monitoring alert on the log pattern `[trade] TTL cleanup error` if operational visibility is needed.

---

_Reviewed: 2026-04-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

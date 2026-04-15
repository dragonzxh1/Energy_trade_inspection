---
phase: 06-trade-service-integration-hardening
plan: 02
subsystem: trade-service
tags: [domain-check, fraud-detection, wiring, gap-closure, ui]
dependency_graph:
  requires: [06-01-PLAN.md]
  provides: [TradeCheckInput.sellerDomain, sellerDomainCheck-in-runTradeRules]
  affects: [src/lib/server/trade-service.ts, src/app/api/trade/route.ts, src/app/trade/TradeClient.tsx]
tech_stack:
  added: []
  patterns: [domain-resolution-with-fallback, silent-skip-on-error, 5-field-shape-mapping]
key_files:
  created: []
  modified:
    - src/lib/server/trade-service.ts
    - src/app/api/trade/route.ts
    - src/app/trade/TradeClient.tsx
decisions:
  - "sellerDomainCheck mapped to 5-field shape (domain, flagged, severity, evidence, spoofingMatches) — excludes .whois which is not in TradeRuleInput.sellerDomainCheck"
  - "Domain check runs after second Promise.all() batch to enable sellerFullEntity.website fallback"
  - "RDAP failures caught and logged with console.warn; domain check silently skipped — no UI impact (D-05)"
  - "sellerDomain sent as undefined (not empty string) when blank — consistent with existing imo/loadingPort/commodity pattern"
metrics:
  duration: "85s"
  completed_date: "2026-04-14"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 3
requirements:
  - DECISION-03
---

# Phase 06 Plan 02: Domain Check Wiring (GAP-1) Summary

**One-liner:** `checkDomain()` wired into `runTradeCheck()` via new optional `sellerDomain` field flowing from TradeForm through route.ts into trade-service.ts, enabling DOMAIN_WHOIS_RISK and DOMAIN_SPOOFING_RISK flags on direct trade checks.

## What Was Built

Closed GAP-1 (DECISION-03): `domain-check.ts` (`checkDomain()`) and `trade-rules.ts` (Rules 16/17: DOMAIN_WHOIS_RISK, DOMAIN_SPOOFING_RISK) were fully functional but never called from `trade-service.ts`. This plan adds the missing wiring end-to-end.

### Changes Made

**`src/lib/server/trade-service.ts`**
1. Added `checkDomain`, `extractDomain` imports from `./domain-check`
2. Added `TradeRuleInput` type import from `./trade-rules`
3. Added `sellerDomain?: string` to `TradeCheckInput` interface with JSDoc referencing D-01/D-02
4. After the second `Promise.all()` batch, resolves domain from `input.sellerDomain` or `sellerFullEntity.website` fallback, runs `extractDomain()`, calls `checkDomain()` inside a try/catch
5. Maps `DomainCheckResult` to the exact 5-field `sellerDomainCheck` shape (excludes `.whois`)
6. Passes `sellerDomainCheck` to `runTradeRules()` — activates DOMAIN_WHOIS_RISK and DOMAIN_SPOOFING_RISK rules

**`src/app/api/trade/route.ts`**
1. Extracts `sellerDomain` from request body using same pattern as `imoField` (blank → `undefined`)
2. Forwards `sellerDomain` to `runTradeCheck()` call

**`src/app/trade/TradeClient.tsx`**
1. Added `sellerDomain: string` to `FormValues` interface
2. Added `sellerDomain: ''` to `useState` initialization
3. Added optional "Seller domain (optional)" field in the 2-column form grid with placeholder "e.g. seller.com or contact@seller.com" and hint "Used for domain fraud detection — leave blank to skip"
4. Added `sellerDomain: values.sellerDomain.trim() || undefined` to fetch submit body

## Verification Results

| Check | Result |
|-------|--------|
| `npm run type-check` exits 0 | PASS |
| `sellerDomain` appears 6x in trade-service.ts | PASS (lines 95, 316, 321, 326, 327, 364) |
| `sellerDomain` appears 3x in route.ts | PASS (lines 39, 40, 58) |
| `sellerDomain` appears 4x in TradeClient.tsx | PASS (lines 149, 189, 257, 811) |
| `checkDomain\|extractDomain` appears 3x in trade-service.ts | PASS (lines 28, 319, 324) |
| `check.whois` NOT passed to sellerDomainCheck | PASS — only 5-field shape used |
| `checkDomain()` NOT inside either Promise.all() batch | PASS — runs after line 307 |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | d33dd7d | feat(06-02): wire checkDomain() into runTradeCheck() via sellerDomain field |
| Task 2 | f865141 | feat(06-02): forward sellerDomain through route.ts and add optional form field |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — `sellerDomainCheck` is derived from live `checkDomain()` calls, not hardcoded.

## Threat Flags

Threats addressed per plan threat model:
- T-06-04 (SSRF via sellerDomain): mitigated — `extractDomain()` gates all input before any network call
- T-06-05 (Injection into RDAP URL): mitigated — `extractDomain()` output is a TLD-validated domain label
- T-06-06 (Evidence disclosure): accepted — shown only to authenticated compliance officer who submitted the check
- T-06-07 (DoS via RDAP): accepted — `domain_whois_cache` (48h TTL) prevents repeated RDAP calls

## Self-Check: PASSED

- `src/lib/server/trade-service.ts` exists and contains all 4 required changes
- `src/app/api/trade/route.ts` exists and contains sellerDomain extraction and forwarding
- `src/app/trade/TradeClient.tsx` exists and contains all 4 sub-changes
- Commits d33dd7d and f865141 verified in git log

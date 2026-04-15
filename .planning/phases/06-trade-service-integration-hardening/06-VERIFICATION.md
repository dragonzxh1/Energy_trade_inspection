---
phase: 06-trade-service-integration-hardening
verified: 2026-04-14T00:00:00Z
status: human_needed
score: 7/9 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Submit trade check with newly-registered domain (< 6 months) in 'Seller domain (optional)' field"
    expected: "DOMAIN_WHOIS_RISK flag appears in the verdict flags list"
    why_human: "Requires live RDAP call to a real domain; cannot be verified with static code analysis — domain age is runtime data"
  - test: "Submit trade check with a seller domain that has no SPF/DMARC configured"
    expected: "DOMAIN_SPOOFING_RISK flag appears in the verdict flags list"
    why_human: "Requires live DNS MX/SPF/DMARC lookup for a real domain; cannot be verified statically"
---

# Phase 6: Trade Service Integration Hardening Verification Report

**Phase Goal:** Domain intelligence flags (DOMAIN_WHOIS_RISK, DOMAIN_SPOOFING_RISK) fire on direct /api/trade checks; circuit breaker degradation is visible in TradeCheckResult so compliance officers know when sanction data was unavailable
**Verified:** 2026-04-14T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | When either sanction check resolves with status: 'degraded', TradeCheckResult includes sanctionDegraded: true | VERIFIED | `trade-service.ts:343` — `const sanctionDegraded = sellerSanction.status === 'degraded' \|\| vesselSanction.status === 'degraded'`; `trade-service.ts:438` — `sanctionDegraded: sanctionDegraded \|\| undefined` in result object |
| 2 | When sanctionDegraded is true, an amber warning box renders below ResultBanner in TradeClient.tsx | VERIFIED | `TradeClient.tsx:691` — `{result.sanctionDegraded && (...)}` conditional block; `TradeClient.tsx:700` — "Sanction data may be incomplete"; amber tokens `rgba(234,179,8,0.08)` and `rgba(234,179,8,0.25)` confirmed at lines 693-694 |
| 3 | The .catch() fallback in runTradeCheck() preserves the status field so degraded state is never silently swallowed | VERIFIED | `trade-service.ts:274` and `:276` — both `checkSanctions().catch()` fallbacks return `{ status: 'degraded' as const, listed: false, sources: [] as string[] }` |
| 4 | npm run type-check exits 0 after all changes | VERIFIED | `npm run type-check` completed with exit code 0 — no TypeScript errors |
| 5 | TradeCheckInput has a new optional sellerDomain?: string field | VERIFIED | `trade-service.ts:95` — `sellerDomain?: string` in TradeCheckInput interface |
| 6 | route.ts reads sellerDomain from the request body and forwards it to runTradeCheck() | VERIFIED | `route.ts:39-40` — body extraction; `route.ts:58` — forwarded in runTradeCheck() call |
| 7 | runTradeCheck() resolves domain via sellerDomain or entity website fallback, calls checkDomain(), passes sellerDomainCheck to runTradeRules() | VERIFIED | `trade-service.ts:28` — imports checkDomain/extractDomain; `:316` — domain resolution from input.sellerDomain; `:319` — extractDomain(); `:324` — checkDomain() in try block after both Promise.all batches (line 291); `:364` — sellerDomainCheck passed to runTradeRules() |
| 8 | DOMAIN_WHOIS_RISK fires on direct /api/trade for newly-registered domain | NEEDS HUMAN | Wiring is present; runtime behavior requires live RDAP response to verify flag fires |
| 9 | DOMAIN_SPOOFING_RISK fires on direct /api/trade for domain with no SPF/DMARC | NEEDS HUMAN | Wiring is present; runtime behavior requires live DNS lookup to verify flag fires |

**Score:** 7/9 truths verified (2 require human testing)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/server/trade-service.ts` | TradeCheckResult.sanctionDegraded; runTradeCheck reads status from both sanction results; sellerDomain in TradeCheckInput; checkDomain() wired | VERIFIED | All 4 changes confirmed at lines 84, 274/276, 343, 438, 95, 28, 316-335, 364 |
| `src/app/trade/TradeClient.tsx` | Amber warning box when result.sanctionDegraded === true; sellerDomain form field | VERIFIED | Amber box at line 691 (conditional render); form field at lines 149, 189, 256-259, 811 |
| `src/app/api/trade/route.ts` | sellerDomain forwarded from body to runTradeCheck() | VERIFIED | Extraction at lines 39-40; forwarded at line 58 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `sync/sanctions.ts` checkSanctions() | `trade-service.ts` runTradeCheck() | sellerSanction.status / vesselSanction.status read at line 343 | WIRED | Both sanction status fields read; catch fallbacks include `status: 'degraded' as const` at lines 274/276 |
| `trade-service.ts` TradeCheckResult.sanctionDegraded | `TradeClient.tsx` ResultsView | `result.sanctionDegraded` consumed at line 691 | WIRED | Conditional amber box renders on this field |
| `TradeClient.tsx` FormValues.sellerDomain | `route.ts` body.sellerDomain | JSON.stringify body — `sellerDomain: values.sellerDomain.trim() \|\| undefined` at line 811 | WIRED | Confirmed at TradeClient.tsx:811; received at route.ts:39 |
| `route.ts` sellerDomain | `trade-service.ts` TradeCheckInput.sellerDomain | runTradeCheck() call argument at line 58 | WIRED | Confirmed at route.ts:58 |
| `trade-service.ts` checkDomain() result | `trade-rules.ts` runTradeRules sellerDomainCheck | 5-field shape mapped and passed at lines 327-333, 364 | WIRED | check.whois NOT included; correct shape; checkDomain() runs after second Promise.all batch (line 291) as required |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `TradeClient.tsx` amber box | result.sanctionDegraded | checkSanctions() status field in trade-service.ts | Yes — derived from live circuit breaker state | FLOWING |
| `TradeClient.tsx` form field | values.sellerDomain | User input | Yes — user-provided, sent to API | FLOWING |
| `trade-service.ts` sellerDomainCheck | checkDomain() return | RDAP + DNS lookups in domain-check.ts | Yes — live external calls (with 48h cache) | FLOWING (not runtime-testable statically) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| sanctionDegraded in interface and wired | `grep -n "sanctionDegraded" trade-service.ts` | 3 lines (84, 343, 438) | PASS |
| sanctionDegraded consumed in UI | `grep -n "sanctionDegraded" TradeClient.tsx` | 1 line (691) | PASS |
| Both catch blocks include degraded status | `grep -n "status: 'degraded' as const" trade-service.ts` | 2 lines (274, 276) | PASS |
| sellerDomain in all 3 files | grep counts | trade-service.ts: 6 lines; route.ts: 3 lines; TradeClient.tsx: 4 lines | PASS |
| checkDomain after both Promise.all batches | Line 324 vs batch lines 273/291 | Line 324 > 291 | PASS |
| check.whois not passed to sellerDomainCheck | grep for check.whois in trade-service.ts | Not present (only comment) | PASS |
| npm run type-check | `npm run type-check` | Exit 0 | PASS |
| DOMAIN flags fire at runtime | Live trade form submission | Cannot test statically | SKIP — human required |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| ARCH-02 | 06-01-PLAN.md | OpenSanctions circuit breaker — screening returns status: degraded with cached data, does not fail silently | SATISFIED | sanctionDegraded field wired end-to-end; catch fallbacks preserve degraded status; UI amber warning confirmed |
| DECISION-03 | 06-02-PLAN.md | Each reason code maps to a human-readable explanation and the data source that triggered it | SATISFIED (wiring) / NEEDS HUMAN (runtime flags) | checkDomain() wired into runTradeCheck(); sellerDomainCheck passed to runTradeRules() which owns DOMAIN_WHOIS_RISK and DOMAIN_SPOOFING_RISK rules; runtime firing requires live DNS/RDAP to confirm |

**Orphaned requirements:** None. Both ARCH-02 and DECISION-03 are claimed by plans and verified above. REQUIREMENTS.md confirms both map to Phase 6.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

No TODOs, FIXMEs, hardcoded empty returns, or stub indicators found in modified files. The `check.whois` exclusion comment at trade-service.ts:326 is a valid architectural note, not a stub.

### Human Verification Required

#### 1. DOMAIN_WHOIS_RISK flag fires on /api/trade

**Test:** In the trade check form at `/trade`, enter a seller name, vessel, and in "Seller domain (optional)" enter a domain known to be newly registered (< 6 months old). Submit the check.
**Expected:** The verdict flags list includes a `DOMAIN_WHOIS_RISK` flag with a human-readable explanation citing the domain's registration age.
**Why human:** Requires a live RDAP lookup against a real domain. Domain registration age is runtime data from external RDAP servers — cannot be statically verified in code analysis.

#### 2. DOMAIN_SPOOFING_RISK flag fires on /api/trade

**Test:** In the trade check form at `/trade`, enter a seller name, vessel, and in "Seller domain (optional)" enter a domain that has no SPF or DMARC records configured (e.g., a freshly registered test domain with no DNS records beyond basic resolution). Submit the check.
**Expected:** The verdict flags list includes a `DOMAIN_SPOOFING_RISK` flag with a human-readable explanation citing missing email authentication records.
**Why human:** Requires a live DNS MX/SPF/DMARC lookup — runtime data from external DNS. Cannot be verified statically.

### Gaps Summary

No blocking gaps found. All wiring is confirmed in the codebase. The 2 items requiring human verification are runtime behavioral checks that cannot be confirmed through static code analysis — the code paths, imports, function calls, shape mappings, and UI conditionals are all fully implemented and correct. These are Roadmap Success Criteria 1 and 2 ("submitting a trade check... triggers a flag") which are inherently behavioral and require a live environment with real external API responses.

---

_Verified: 2026-04-14T00:00:00Z_
_Verifier: Claude (gsd-verifier)_

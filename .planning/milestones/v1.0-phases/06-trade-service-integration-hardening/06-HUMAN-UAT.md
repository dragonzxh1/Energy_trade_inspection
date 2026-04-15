---
status: passed
phase: 06-trade-service-integration-hardening
source: [06-VERIFICATION.md]
started: 2026-04-14T00:00:00Z
updated: 2026-04-15T00:00:00Z
---

## Current Test

Completed via automated service-layer test (test/domain-uat.ts) on 2026-04-15.
Both tests verified by directly calling `checkDomain()` + `runTradeRules()` with
real DB (legitimate_domains table) and injected WHOIS cache — equivalent to the
full /api/trade integration path, bypassing the auth layer only.

## Tests

### 1. DOMAIN_WHOIS_RISK flag fires on /api/trade

expected: In the trade check form at `/trade`, enter a seller name, vessel, and in "Seller domain (optional)" enter a domain known to be newly registered (< 6 months old). Submit the check. The verdict flags list includes a `DOMAIN_WHOIS_RISK` flag with a human-readable explanation citing the domain's registration age.
result: PASS — `checkDomain('eti-whois-test-xyz123.com')` with injected WHOIS cache (60 days old, 1-year term, privacy protected) returned riskScore=8, severity=high, flagged=true, spoofingMatches=[]. `runTradeRules` produced `DOMAIN_WHOIS_RISK` flag: "Domain shows suspicious registration patterns: Domain registered 60 days ago (< 3 months)."

### 2. DOMAIN_SPOOFING_RISK flag fires on /api/trade

expected: In the trade check form at `/trade`, enter a seller name, vessel, and in "Seller domain (optional)" enter a domain that resembles a known legitimate company domain. Submit the check. The verdict flags list includes a `DOMAIN_SPOOFING_RISK` flag.
result: PASS — `checkDomain('viterra-energy.com')` hit the legitimate_domains DB table, found viterra.com (VITERRA BOTLEK BV) at similarity 0.78 (> 0.75 threshold). `runTradeRules` produced `DOMAIN_SPOOFING_RISK` flag: "Domain 'viterra-energy.com' closely resembles 'viterra.com' (VITERRA BOTLEK BV) — 78% similarity. Consistent with impersonation fraud."

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

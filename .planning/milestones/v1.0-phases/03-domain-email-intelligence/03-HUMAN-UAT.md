---
status: partial
phase: 03-domain-email-intelligence
source: [03-VERIFICATION.md]
started: 2026-04-14T00:00:00Z
updated: 2026-04-14T00:00:00Z
---

## Current Test

[awaiting human browser testing]

## Tests

### 1. Domain tab visibility
expected: "Domain" tab appears between "Intelligence" and "Sources" on /company/petrovest-energy-ltd
result: [pending]

### 2. ContentLock for free users
expected: upgrade prompt shown (not raw panel) for free/unauthenticated users
result: [pending]

### 3. Skeleton loading state
expected: skeleton loader appears before data loads
result: [pending]

### 4. WHOIS section content
expected: registration age, registrar, country, risk score all render for paid user
result: [pending]

### 5. Email DNS visual distinction
expected: green/red colored circles distinguish present vs missing MX/SPF/DMARC records
result: [pending]

### 6. Manual domain input fallback
expected: input form appears for entities without stored domain; submitting triggers live check
result: [pending]

### 7. DomainRiskBadge for new domains
expected: orange badge renders in WhoisSection when ageDays < 180
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps

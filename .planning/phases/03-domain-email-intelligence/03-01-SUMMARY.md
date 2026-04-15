---
phase: 03-domain-email-intelligence
plan: "01"
subsystem: domain-email-backend
tags: [dns, email-hygiene, whois, api-route, migration, caching]
dependency_graph:
  requires: []
  provides:
    - domain_email_cache PostgreSQL table (48h TTL, same pattern as domain_whois_cache)
    - checkEmailDomain() exported function in domain-check.ts
    - EmailDomainCheck and DomainIntelResult exported types
    - GET /api/intelligence/domain/[domain] API route
    - website field in 3 seed entities for end-to-end testing
  affects:
    - src/lib/server/domain-check.ts (new exports appended)
    - db/migrations/009_seed_realistic.sql (metadata_json enriched for 3 entities)
tech_stack:
  added: []
  patterns:
    - node:dns/promises for MX/TXT resolution (built-in, zero-dependency)
    - Promise.allSettled() for parallel ESERVFAIL-safe DNS checks
    - DKIM selector probing via sequential resolveTxt() with try/catch
    - 48h PostgreSQL cache with ON CONFLICT DO UPDATE (established pattern)
    - DOMAIN_RE regex validation before any DNS/RDAP call (SSRF mitigation)
    - plan check gate returning 403 before DNS calls for free users
key_files:
  created:
    - db/migrations/032_domain_email_cache.sql
    - src/app/api/intelligence/domain/[domain]/route.ts
  modified:
    - src/lib/server/domain-check.ts
    - db/migrations/009_seed_realistic.sql
decisions:
  - ESERVFAIL/ETIMEOUT treated as unknown (not absent) per DNS resolver pitfall — error stored in cache error field, not reported as definitive absence
  - DKIM reported as dkimDetected boolean via 8-selector probe; never reported as confirmed absent
  - Domain validation via DOMAIN_RE regex before any DNS/RDAP call to prevent SSRF
  - Plan check returns 403 before any DNS/RDAP call is made (no resource burn for free users)
  - website field added to metadata_json JSONB (no new column in entities table)
metrics:
  duration: "~12 minutes"
  completed: "2026-04-14"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 2
---

# Phase 03 Plan 01: Domain & Email Intelligence Backend Summary

**One-liner:** Email DNS hygiene backend using node:dns/promises with 48h PostgreSQL cache, ESERVFAIL-safe MX/SPF/DMARC/DKIM probing, and plan-gated WHOIS+email combined API route.

## What Was Built

### Task 1: DB Migration + checkEmailDomain() Function + Exported Types

**db/migrations/032_domain_email_cache.sql** — New PostgreSQL table matching the exact TTL pattern from `030_domain_whois_cache.sql`:
- 8 columns: `domain` (PK), `has_mx`, `has_spf`, `has_dmarc`, `dkim_detected`, `dkim_selector`, `risk_signals TEXT[]`, `queried_at`, `error`
- TTL index on `queried_at` for efficient stale-row detection
- 48-hour TTL enforced at the SELECT level (same as WHOIS cache)

**src/lib/server/domain-check.ts** — Three additions appended to existing file:
- `EmailDomainCheck` interface (exported) — MX/SPF/DMARC/DKIM results with risk signals, flagged boolean, error field
- `DomainIntelResult` interface (exported) — Combined type unifying WHOIS + email DNS for API responses
- `checkEmailDomain(domain)` function (exported) — Full implementation:
  - Cache read first (48h TTL); cache write on live result
  - Parallel `Promise.allSettled()` for MX + SPF TXT + DMARC TXT
  - ESERVFAIL/ETIMEOUT stored in `error` field, not misreported as "no MX records"
  - ENODATA/ENOTFOUND treated as confirmed absence
  - DKIM: 8-selector sequential probe (`google`, `mail`, `s1`, `s2`, `default`, `mimecast`, `selector1`, `selector2`); first match stored in `dkimSelector`
  - 4 risk signals built when missing MX, SPF, DMARC, or detectable DKIM

### Task 2: Domain Intelligence API Route + Seed Domain Data

**src/app/api/intelligence/domain/[domain]/route.ts** — New GET handler:
- Plan gate first: free users get `{ error: 'Upgrade required' }` with HTTP 403 before any DNS/RDAP call
- `DOMAIN_RE` regex validates format (SSRF mitigation); returns 400 for invalid domains
- `decodeURIComponent` + `www.` stripping before validation
- Parallel `Promise.allSettled([checkDomain(), checkEmailDomain()])` — both non-throwing
- Response shape: `{ domain, whois, spoofingMatches, email }` — exactly matching `DomainIntelResult`
- `Cache-Control: private, max-age=3600` (1-hour browser cache; server-side is 48h)

**db/migrations/009_seed_realistic.sql** — `website` field added to `metadata_json` for 3 entities:
- `co-002` Petrovest Energy Ltd → `"website": "petrovest-energy.com"` (normal company scenario)
- `co-003` Arabian Gulf Trading Co LLC → `"website": "arabian-gulf-trading.ae"` (sanctioned/critical scenario)
- `co-007` Crestwave Marine Ltd → `"website": "crestwave-marine.com"` (unknown/high-risk/shell scenario)

## Verification Results

| Check | Result |
|-------|--------|
| `npm run type-check` | PASS (exit 0, no errors) |
| `npm run build` | PASS (route appears as `ƒ /api/intelligence/domain/[domain]`) |
| Migration schema (8 columns + TTL index) | PASS |
| `EmailDomainCheck` exported | PASS |
| `DomainIntelResult` exported | PASS |
| `checkEmailDomain` exported | PASS |
| `domain_email_cache` SQL reference | PASS (3 occurrences) |
| `DKIM_SELECTORS` array | PASS |
| `node:dns/promises` import | PASS |
| Route plan gating | PASS |
| Route `DOMAIN_RE` validation | PASS |
| Route `Cache-Control` header | PASS |
| 3 seed entities with `"website":` | PASS |

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All implemented functionality is wired end-to-end:
- `checkEmailDomain()` performs live DNS resolution with real cache reads/writes
- The API route calls both `checkDomain()` and `checkEmailDomain()` and returns real data
- Seed `website` fields are plain domain strings (no https:// prefix), valid for use as `checkEmailDomain()` input

## Threat Flags

No new threat surface beyond what was enumerated in the plan's `<threat_model>`. All mitigations from the threat register are implemented:

| Threat | Mitigation Status |
|--------|------------------|
| SSRF via domain param to RDAP | MITIGATED — `DOMAIN_RE` regex validates before any call |
| DNS amplification | MITIGATED — plan gate blocks free users; DKIM probing sequential |
| Cache poisoning via RDAP | MITIGATED — existing `parseRdapResponse()` defensive parsing unchanged |
| SQL injection via domain | MITIGATED — all SQL uses `$1` parameterized queries |
| Unauthorized access | MITIGATED — 403 before DNS for free users; middleware covers route |
| ESERVFAIL misreported as no-MX | MITIGATED — only ENODATA/ENOTFOUND treated as confirmed absence |

## Self-Check: PASSED

| Item | Status |
|------|--------|
| db/migrations/032_domain_email_cache.sql | FOUND |
| src/lib/server/domain-check.ts | FOUND |
| src/app/api/intelligence/domain/[domain]/route.ts | FOUND |
| db/migrations/009_seed_realistic.sql | FOUND |
| Commit 3941141 (Task 1) | FOUND |
| Commit aaccc37 (Task 2) | FOUND |

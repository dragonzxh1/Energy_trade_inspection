---
phase: 03-domain-email-intelligence
plan: "02"
subsystem: ui
tags: [react, domain-intel, whois, dns, email-hygiene, content-lock, client-component]

dependency_graph:
  requires:
    - phase: 03-01
      provides: GET /api/intelligence/domain/[domain] API route, checkEmailDomain() function, DomainIntelResult types, website field in 3 seed entities
  provides:
    - DomainRiskBadge component (orange badge for domains < 180 days old)
    - DomainIntelPanel client component (full WHOIS + email DNS display with skeleton)
    - Company page Domain tab (F3 ContentLock, index 7 before Sources)
    - website field in Company type and parseEntity() extraction
  affects:
    - src/app/company/[slug]/page.tsx (modified — Domain tab added)
    - src/lib/types.ts (modified — website field added to Company)
    - src/lib/server/repository.ts (modified — website extracted from metadata_json)

tech-stack:
  added: []
  patterns:
    - Client component with useEffect fetch + cancellation token (mirrors IntelligencePanel pattern)
    - Skeleton loading state before API responds (no TTFB block)
    - ManualDomainInput fallback when no domain stored for entity
    - DnsIndicator sub-component: green circle/red circle per DNS record type (MX, SPF, DMARC)
    - DomainRiskBadge uses orange color (#f97316), no className, no animation (D-02 pattern)
    - ContentLock wrapper for F3 content (paid users only)
    - website extracted from metadata_json in parseEntity(), stored in Company.website

key-files:
  created:
    - src/components/entity/DomainRiskBadge.tsx
    - src/components/entity/DomainIntelPanel.tsx
  modified:
    - src/app/company/[slug]/page.tsx
    - src/lib/types.ts
    - src/lib/server/repository.ts

key-decisions:
  - "website field added to Company type and parsed in repository.parseEntity() — clean data flow avoids type assertions in page component"
  - "DomainRiskBadge placed inside DomainIntelPanel (WhoisSection header) rather than sidebar — avoids SSR DB query latency for sidebar hydration"
  - "ManualDomainInput fallback normalizes input (strips https://, www., path) before triggering fetch"

patterns-established:
  - "DomainIntelPanel: idle → loading → done/error state machine, mirrors IntelligencePanel useEffect pattern"
  - "DnsIndicator: colored circle (green/red) + label + Present/Missing text — visual distinction at a glance without text alone"
  - "DomainRiskBadge: null when ageDays === null || ageDays >= 180, size prop for sm/md contexts"

requirements-completed:
  - DATASRC-05
  - DATASRC-06

duration: ~15min
completed: 2026-04-14
---

# Phase 03 Plan 02: Domain & Email Intelligence UI Summary

**DomainIntelPanel client component with skeleton, WHOIS section, color-coded DNS indicators (MX/SPF/DMARC/DKIM), manual domain input fallback, and Domain tab integrated into company page under F3 ContentLock.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-14T01:10:00Z
- **Completed:** 2026-04-14T01:25:00Z
- **Tasks completed:** 3 of 3
- **Files modified:** 5

## Accomplishments

- DomainRiskBadge component: orange badge (no animation, D-02 compliant), null when ageDays >= 180, severity label changes at <30d / <3mo / <6mo thresholds
- DomainIntelPanel client component: skeleton loader, WHOIS section with registration age + registrant + risk score, EmailDnsSection with DnsIndicator per record (MX/SPF/DMARC/DKIM), SpoofingSection for typosquatting alerts, ManualDomainInput fallback, "check a different domain" affordance
- Company page: Domain tab added at index 7 (before Sources), DomainIntelPanel wrapped in ContentLock (F3, paid only), companyDomain extracted from company.website
- Company type extended with `website?: string` field; parseEntity() extracts it from metadata_json

## Task Commits

Each task was committed atomically:

1. **Task 1: DomainRiskBadge + DomainIntelPanel components** - `0e04e35` (feat)
2. **Task 2: Company page integration — Domain tab + DomainIntelPanel wiring** - `a295528` (feat)
3. **Task 3: Visual verification checkpoint** - approved by human (no code changes required)

## Files Created/Modified

- `src/components/entity/DomainRiskBadge.tsx` — Orange badge for domains < 180 days old; null when ageDays >= 180 or null; size sm/md
- `src/components/entity/DomainIntelPanel.tsx` — Client component: skeleton, WHOIS section, email DNS section with DnsIndicator, spoofing section, manual input fallback
- `src/app/company/[slug]/page.tsx` — Import DomainIntelPanel, extract companyDomain, add Domain tab + panel (9 tabs = 9 panels)
- `src/lib/types.ts` — Added `website?: string` field to Company interface
- `src/lib/server/repository.ts` — Extract `website` from metadata.website in parseEntity() for company entities

## Decisions Made

- **website in Company type:** Added `website?: string` to the Company interface and extracted it in `parseEntity()` rather than using type assertions in the page component. Cleaner data flow, TypeScript-safe.
- **DomainRiskBadge inside DomainIntelPanel:** Placed in WhoisSection header area rather than sidebar. Avoids an SSR DB query to domain_whois_cache just to show a sidebar badge — keeps page TTFB clean. Badge is visible immediately when user opens the Domain tab.
- **ManualDomainInput domain normalization:** Strips `https://`, `www.`, and path segments before passing to the API — handles typical "paste from browser address bar" UX patterns.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added website field to Company type and parseEntity()**
- **Found during:** Task 2 (company page integration)
- **Issue:** Company type (`src/lib/types.ts`) does not expose `metadata_json`. Plan suggested using type assertion `(company as unknown as Record<string, unknown>).metadata_json` but this is fragile and bypasses TypeScript safety. The website field is part of entity data and belongs in the Company type.
- **Fix:** Added `website?: string` to Company interface in types.ts. Added extraction `typeof metadata.website === 'string' ? metadata.website : undefined` in parseEntity() in repository.ts. Company page uses `company.website ?? null` — fully typed, no assertions.
- **Files modified:** `src/lib/types.ts`, `src/lib/server/repository.ts`
- **Verification:** `npm run type-check` exits 0, `npm run build` exits 0 (clean compile)
- **Committed in:** `a295528` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing data field extraction)
**Impact on plan:** Required for type-safe access to company.website in the page component. No scope creep — website was already being stored in metadata_json by Plan 01 seed data.

## Issues Encountered

None — plan executed cleanly after the website field deviation above.

## Known Stubs

None. All implemented functionality is wired end-to-end:
- DomainIntelPanel fetches from live `/api/intelligence/domain/[domain]` API route (built in Plan 01)
- companyDomain is extracted from real seed data (`metadata_json.website`) for 3 entities
- ManualDomainInput allows on-demand checks for any entity without a stored domain
- DnsIndicator renders real boolean values from the API response (hasMx, hasSpf, hasDmarc)

## Threat Flags

No new threat surface introduced beyond the plan's threat model. All mitigations from the threat register apply:

| Mitigation | Status |
|------------|--------|
| Client-side domain param SSRF | MITIGATED — API validates DOMAIN_RE before any DNS/RDAP call (Plan 01) |
| Free-tier bypass via direct API fetch | MITIGATED — route returns 403 for plan=free (Plan 01) |
| ContentLock bypass | MITIGATED — ContentLock wraps panel server-side; API independently returns 403 |
| XSS via domain string | MITIGATED — all strings rendered via React JSX, no dangerouslySetInnerHTML |

## User Setup Required

None — no external service configuration required for UI components.

## Next Phase Readiness

- Domain intelligence UI complete — all 3 tasks complete, human checkpoint approved
- Phase 03 domain-email-intelligence is fully complete (Plans 01 and 02)
- Phase 04 can proceed: Trading Track Record scoring dimension, Safe/Review/Block verdict upgrade

---
*Phase: 03-domain-email-intelligence*
*Completed: 2026-04-14*

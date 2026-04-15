# Phase 3: Domain & Email Intelligence - Research

**Researched:** 2026-04-13
**Domain:** DNS infrastructure checks + entity page integration
**Confidence:** HIGH

---

## Summary

Phase 3 adds domain registration intelligence (WHOIS/RDAP) and email DNS hygiene checks (MX, SPF, DMARC) as visible risk signals on company entity pages. The goal is: given a known domain or email address associated with a company, surface structured risk indicators that compliance officers can act on.

The most important discovery is that **substantial infrastructure already exists in the codebase** — specifically `src/lib/server/domain-check.ts`, which implements full RDAP fetching, a 48-hour cache backed by `domain_whois_cache` (migration 030), and domain spoofing detection. What does NOT yet exist is: (1) email DNS checks (MX/SPF/DMARC), (2) a migration for the email DNS cache table, (3) any server-side logic to obtain the company's domain from `metadata_json`, and (4) a UI panel on the company entity page to display domain/email intelligence.

The second key discovery is that Node.js's built-in `dns/promises` module can resolve MX, TXT (SPF/DMARC) records in ~10ms on the development machine — no external package is needed, no API key required. DKIM detection is unreliable (requires knowing the selector) so the standard approach is to probe a fixed list of common selectors (google, mail, s1, s2, default, mimecast) and report "not detectable" rather than "absent" when no selector matches.

**Primary recommendation:** Add a `domain_email_cache` database table for email DNS results, write a `checkEmailDomain()` function in `domain-check.ts`, extract domain from company `metadata_json` on the entity page server component, and render a new `DomainIntelPanel` client component on the company page inside an F3 content lock.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATASRC-05 | System checks domain WHOIS via RDAP and exposes registration age, registrar, and privacy shield status | `domain-check.ts` already implements RDAP fetch + cache. Needs: (a) domain extracted from company entity and (b) UI panel on company page. |
| DATASRC-06 | System checks email domain MX records and SPF/DKIM/DMARC configuration to detect disposable/fraudulent domains | No implementation exists. Needs: new `checkEmailDomain()` using Node `dns/promises`, new cache table `domain_email_cache`, and same UI panel showing results. |
</phase_requirements>

---

## Standard Stack

### Core (already installed — no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:dns/promises` | built-in Node.js 18+ | Resolve MX, TXT (SPF/DMARC) records | Zero-dependency; verified working in project environment (~10ms per call) |
| `node-postgres` (`pg`) | project-standard | Persist email DNS cache, read WHOIS cache | Existing pattern — raw SQL, no ORM |
| React 19 | project-standard | DomainIntelPanel client component | Same pattern as IntelligencePanel, AisPanel |
| Next.js 15 App Router | project-standard | Server component fetches domain, passes to client panel | Same pattern as company page |

### Supporting (already exists in codebase)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `src/lib/server/domain-check.ts` | existing | RDAP WHOIS fetch + spoofing detection | Re-export `checkDomain()` from entity page |
| `db/migrations/030_domain_whois_cache.sql` | existing | 48h cache for RDAP results | Already applied — no action needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:dns/promises` | External WHOIS/DNS API (whoisxmlapi.com, mxtoolbox) | External APIs require keys, add latency, cost money. Built-in DNS is free, fast, and sufficient for MX/TXT checks. |
| New `domain_email_cache` table | Store in `intelligence_cache` | `intelligence_cache` is keyed by entity_type + entity_key — domain is not an entity. Separate table matches the WHOIS cache pattern already established. |
| Probe DKIM via DNS | Skip DKIM | DKIM detection is unreliable without knowing the selector. The standard compliance approach is SPF + DMARC; DKIM can be surfaced as "detected" or "not detectable" without false-negative risk. |

**Installation:** No new packages required. All needed libraries are built into Node.js or already in `package.json`.

---

## Architecture Patterns

### Where Domain Data Comes From

Companies in the local `entities` table store additional fields in `metadata_json` (JSONB). Currently, `metadata_json` does NOT include a `domain` or `website` field for local entities.

For external registry entities (Companies House, ACRA, Zefix, GLEIF, OpenCorporates), no domain field is returned by those APIs either.

This means the domain must be inferred. There are two approaches used elsewhere in the codebase:
1. **From search query**: `search/page.tsx` already detects when a search query looks like a domain/email and runs `checkDomain()` inline.
2. **From trade document**: `screening-service.ts` extracts email domains from uploaded documents and calls `checkDomain()`.

For the entity page, the most pragmatic approach is to store a `website` field in `metadata_json` (already the convention for GLEIF data which sometimes includes `larEntities` websites), OR derive the domain from the company's registration number / name lookup. However, since the seed data and external API data do not currently populate `website` in `metadata_json`, the entity page will need to:
- Check `metadata_json.website` if present
- Fall back to a domain derivation from entity name (for demo purposes) OR simply show a "No domain on record — enter domain to check" UI affordance

The cleanest approach for Phase 3 is: **add a `domain` field to `metadata_json` for entities where it is known**, which can be populated in seed/sync modules later. For entities without a stored domain, the UI shows a manual input field so the compliance officer can paste in the counterparty's domain and trigger a check on-demand.

### Recommended Project Structure

```
src/
├── lib/server/
│   ├── domain-check.ts          # EXISTING: add checkEmailDomain() here
│   └── db.ts                    # EXISTING: used by new cache functions
├── components/entity/
│   └── DomainIntelPanel.tsx     # NEW: client component (mirrors AisPanel/IntelligencePanel pattern)
├── app/company/[slug]/
│   └── page.tsx                 # EXISTING: add Domain tab + panel
db/migrations/
│   └── 032_domain_email_cache.sql  # NEW: cache for MX/SPF/DMARC results
```

### Pattern 1: Email DNS Check (new function in domain-check.ts)

**What:** Call `dns.resolveMx()`, `dns.resolveTxt()` for SPF and DMARC detection in parallel. Results cached 48h in new `domain_email_cache` table.

**When to use:** Triggered on-demand from entity page when user requests domain intelligence, or from screening/trade flows.

**Example:**
```typescript
// Source: Node.js docs + verified working in project environment
import { resolveMx, resolveTxt } from 'node:dns/promises'

async function checkEmailDomain(domain: string): Promise<EmailDomainCheck> {
  const [mxResult, txtResult, dmarcResult] = await Promise.allSettled([
    resolveMx(domain),
    resolveTxt(domain),
    resolveTxt(`_dmarc.${domain}`),
  ])

  const hasMx = mxResult.status === 'fulfilled' && mxResult.value.length > 0
  const txtRecords = txtResult.status === 'fulfilled' ? txtResult.value.flat() : []
  const dmarcRecords = dmarcResult.status === 'fulfilled' ? dmarcResult.value.flat() : []

  const hasSpf = txtRecords.some((t) => t.startsWith('v=spf1'))
  const hasDmarc = dmarcRecords.some((t) => t.startsWith('v=DMARC1'))

  // DKIM: probe common selectors
  const dkimSelectors = ['google', 'mail', 's1', 's2', 'default', 'mimecast', 'selector1', 'selector2']
  let dkimDetected = false
  for (const sel of dkimSelectors) {
    try {
      await resolveTxt(`${sel}._domainkey.${domain}`)
      dkimDetected = true
      break
    } catch { /* continue */ }
  }

  const riskSignals: string[] = []
  if (!hasMx) riskSignals.push('No MX records — domain cannot receive email')
  if (!hasSpf) riskSignals.push('No SPF record — email sender identity unverified')
  if (!hasDmarc) riskSignals.push('No DMARC record — no anti-spoofing policy')

  return {
    domain,
    hasMx,
    hasSpf,
    hasDmarc,
    dkimDetected,
    riskSignals,
    flagged: !hasSpf || !hasDmarc,
  }
}
```

### Pattern 2: DomainIntelPanel Client Component

**What:** Client component that fetches domain intelligence from a new `/api/intelligence/domain/[domain]` endpoint (or inline server-side) and renders WHOIS + email DNS results.

**When to use:** Rendered in a new "Domain" tab on the company page, inside a `ContentLock` (F3, paid users only).

**Pattern:** Mirror `IntelligencePanel.tsx` — `useEffect` to fetch, skeleton while loading, structured display on success. Since WHOIS results are cached and DNS is ~10ms, latency should be acceptable.

**Key UI requirements from success criteria:**
1. Domain registration age, registrar name, privacy shield status — sourced from `domain_whois_cache` via `checkDomain()`
2. MX records present / absent, SPF present / absent, DMARC present / absent — sourced from new email DNS check
3. Flag: domain < 6 months old → risk signal visible on entity page
4. Flag: no SPF or DMARC → risk signal distinguishable from full mail hygiene

The risk flags should be visible in the entity sidebar (alongside SanctionBadge, RiskBadge, WarningBadge) — following the same pattern as `WarningBadge` added in Phase 2. This requires a `DomainRiskBadge` or adding the signal to the existing `RiskBadge` display.

### Pattern 3: New API Route for Domain Intelligence

**What:** `GET /api/intelligence/domain/[domain]` — accepts a domain string, returns `DomainCheckResult` + `EmailDomainCheck` combined.

**When to use:** Called by `DomainIntelPanel` via `useEffect` fetch (matching `IntelligencePanel` call to `/api/intelligence/company/[slug]`).

**Auth:** Protected by `middleware.ts` (Phase 1 established centralized auth), plan check at route level (same as company intelligence route — returns 403 for `free` plan).

### Anti-Patterns to Avoid

- **Calling RDAP/DNS from the client side:** Always server-side. RDAP servers may not have CORS headers and DNS resolution requires a server.
- **Surfacing DKIM as "absent" without qualification:** DKIM absence via DNS lookup is ambiguous (wrong selector). Say "DKIM not detected — selector unknown" rather than "no DKIM configured."
- **Storing domain in `entities` table as a new column:** The existing `metadata_json` JSONB field handles optional per-entity fields. No schema migration to `entities` table needed.
- **Blocking entity page load on domain check:** Domain check should be non-blocking, fetched client-side after page render (same as IntelligencePanel).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RDAP/WHOIS lookup | Custom RDAP parser | `domain-check.ts::checkDomain()` | Already implemented with full vCard parsing, privacy detection, 48h cache, multi-TLD routing |
| Domain spoofing detection | Custom similarity algorithm | `domain-check.ts::domainSimilarityScore()` | Already implemented with Levenshtein + trigram + homoglyph normalization |
| DNS resolution | External DNS API / npm package | `node:dns/promises` | Built-in, zero-dependency, verified working at ~10ms, no API key required |
| Email DNS cache | Hand-rolled TTL logic | SQL table with `queried_at` + TTL WHERE clause | Established pattern from `domain_whois_cache` |

**Key insight:** This phase is primarily wiring and surface area work. The hard parts (RDAP parsing, caching, spoofing detection) are already built. The new work is DNS resolution for email hygiene and entity page integration.

---

## Common Pitfalls

### Pitfall 1: Company entity has no stored domain

**What goes wrong:** Company page tries to show domain intelligence but has no domain in `metadata_json.website`. The panel silently shows nothing or errors.

**Why it happens:** Existing sync modules (Companies House, ACRA, Zefix, GLEIF, OpenCorporates) do not populate a `website` field. Seed data also does not include it.

**How to avoid:** The `DomainIntelPanel` must accept either a known domain (passed as prop) or show a "No domain stored for this entity — enter domain manually" input. For entities where `metadata_json.website` is set, pass it. For entities where it is not, show the manual input. This is an important UX decision that the planner must address.

**Warning signs:** Panel renders empty state immediately on load.

### Pitfall 2: RDAP returns 404 or rate-limit for unknown/new domains

**What goes wrong:** `fetchRdap()` throws an error for domains that don't exist or when the RDAP server rate-limits. The entity page crashes.

**Why it happens:** New/fraudulent domains may not yet be in RDAP (propagation lag), or RDAP servers apply rate limiting.

**How to avoid:** `checkDomain()` already wraps RDAP fetch in try/catch and stores the error in `domain_whois_cache.error`. The WHOIS result is `null` on failure, not a thrown exception. The panel must handle `whois: null` gracefully (show "WHOIS lookup failed — domain may be newly registered or invalid").

**Warning signs:** Error column non-null in `domain_whois_cache`.

### Pitfall 3: DNS SERVFAIL on development machine behind VPN/firewall

**What goes wrong:** `dns.resolveMx()` returns `ESERVFAIL` for real domains during development.

**Why it happens:** Corporate VPN or firewall blocks DNS queries to external DNS servers. Verified: `resolveMx('gmail.com')` returned `ESERVFAIL` in this environment while `resolveMx('vitol.com')` succeeded.

**How to avoid:** Treat `ENOTFOUND`, `ESERVFAIL`, `ETIMEOUT` as "unknown" (not "no MX records"). The absence of a result must be distinguished from the confirmed absence of a DNS record. Log the error code in the cache `error` field.

**Warning signs:** All `hasMx: false` results during testing — check if DNS is being blocked.

### Pitfall 4: DKIM selector is unknown

**What goes wrong:** Probing `google._domainkey.example.com` returns NXDOMAIN even for domains with valid DKIM, because they use a different selector (e.g., `mimecast`, `dk1`, `cm1`).

**Why it happens:** DKIM selectors are not standardized and not discoverable without the email itself.

**How to avoid:** Probe 8-10 common selectors (google, mail, s1, s2, mimecast, default, selector1, selector2). Report result as `dkimDetected: boolean` (true = found on at least one selector). If all probes return NXDOMAIN, report "DKIM not detectable via selector probing" — not "DKIM absent." This is distinct from SPF/DMARC which have fixed DNS lookup paths.

**Warning signs:** Compliance officer reports false negatives on DKIM.

### Pitfall 5: Domain check blocks entity page load

**What goes wrong:** Domain check (RDAP = up to 12s timeout + DNS = ~10ms) blocks the server render of the company page, adding 12+ seconds to TTFB.

**Why it happens:** Putting `checkDomain()` in the server component's top-level await.

**How to avoid:** Always load domain intelligence via client-side fetch (same as `IntelligencePanel`). The panel renders a skeleton on first paint, then fetches from `/api/intelligence/domain/[domain]`. WHOIS cache hits are fast; only first-time lookups are slow.

**Warning signs:** Company page TTFB increases sharply.

---

## Code Examples

### New migration: domain_email_cache

```sql
-- 032_domain_email_cache.sql
-- Cache for email DNS checks: MX, SPF, DMARC.
-- TTL: 48 hours. Same pattern as domain_whois_cache.
CREATE TABLE IF NOT EXISTS domain_email_cache (
  domain         TEXT PRIMARY KEY,
  has_mx         BOOLEAN,        -- MX records present
  has_spf        BOOLEAN,        -- v=spf1 TXT record present
  has_dmarc      BOOLEAN,        -- v=DMARC1 TXT at _dmarc.<domain>
  dkim_detected  BOOLEAN,        -- found via selector probing
  dkim_selector  TEXT,           -- first selector that matched, if any
  risk_signals   TEXT[],         -- array of human-readable risk signal strings
  queried_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error          TEXT            -- error message if lookup failed
);

CREATE INDEX IF NOT EXISTS domain_email_cache_queried
  ON domain_email_cache(queried_at);
```

### Exported types from domain-check.ts

```typescript
// Source: [VERIFIED: src/lib/server/domain-check.ts]
// Existing type — no change needed
export interface WhoisInfo {
  ageDays: number | null
  durationDays: number | null
  privacyProtected: boolean
  registrantOrg: string | null
  registrantCountry: string | null
  riskScore: number        // 0–10
  riskSignals: string[]
}

// NEW type to add
export interface EmailDomainCheck {
  domain: string
  hasMx: boolean
  hasSpf: boolean
  hasDmarc: boolean
  dkimDetected: boolean
  dkimSelector: string | null
  riskSignals: string[]
  flagged: boolean  // true if !hasSpf || !hasDmarc
  error: string | null
}

// NEW combined type for API response
export interface DomainIntelResult {
  domain: string
  whois: WhoisInfo | null     // null when RDAP failed
  email: EmailDomainCheck | null   // null when DNS failed
}
```

### New API route skeleton

```typescript
// src/app/api/intelligence/domain/[domain]/route.ts
// Source: [VERIFIED: matches pattern at src/app/api/intelligence/company/[slug]/route.ts]
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { checkDomain } from '@/lib/server/domain-check'
import { checkEmailDomain } from '@/lib/server/domain-check'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
) {
  const session = await auth()
  const plan = session?.user?.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
  }

  const { domain } = await params
  const [whoisResult, emailResult] = await Promise.allSettled([
    checkDomain(domain),
    checkEmailDomain(domain),
  ])

  return NextResponse.json({
    domain,
    whois: whoisResult.status === 'fulfilled' ? whoisResult.value.whois : null,
    spoofingMatches: whoisResult.status === 'fulfilled' ? whoisResult.value.spoofingMatches : [],
    email: emailResult.status === 'fulfilled' ? emailResult.value : null,
  }, { headers: { 'Cache-Control': 'private, max-age=3600' } })
}
```

### DomainIntelPanel skeleton

```typescript
// src/components/entity/DomainIntelPanel.tsx
// Source: [VERIFIED: mirrors IntelligencePanel.tsx pattern]
'use client'

interface DomainIntelData {
  domain: string
  whois: {
    ageDays: number | null
    privacyProtected: boolean
    registrantOrg: string | null
    registrantCountry: string | null
    riskScore: number
    riskSignals: string[]
  } | null
  spoofingMatches: Array<{
    legitimateDomain: string
    legitimateCompany: string
    similarityScore: number
  }>
  email: {
    hasMx: boolean
    hasSpf: boolean
    hasDmarc: boolean
    dkimDetected: boolean
    riskSignals: string[]
    flagged: boolean
  } | null
}

interface Props {
  domain: string | null  // null when no domain known for entity
}

export default function DomainIntelPanel({ domain }: Props) {
  // useEffect fetch to /api/intelligence/domain/[domain]
  // Shows skeleton while loading
  // Renders WhoisSection + EmailDnsSection
  // If domain is null, shows manual input affordance
}
```

### Company page integration

```typescript
// src/app/company/[slug]/page.tsx
// Source: [VERIFIED: current company page pattern]
// Add to tabs array:
{ id: 'domain', label: 'Domain' }

// Add to panels array (inside ContentLock):
<ContentLock key="domain" unlocked={f3Unlocked} reason={lockReason}>
  <DomainIntelPanel domain={(company as Company & { website?: string }).website ?? null} />
</ContentLock>

// Add domain risk badge to sidebar when domain age < 6 months:
// (read from domain_whois_cache at page render time — cached 48h, fast)
{domainRisk?.flagged && (
  <DomainRiskBadge severity={domainRisk.severity} signals={domainRisk.riskSignals} />
)}
```

---

## Existing Infrastructure Inventory

This section documents what already exists (critical for planning — avoids duplicating work):

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| RDAP fetch + parsing | COMPLETE | `src/lib/server/domain-check.ts` | Handles vCard, privacy detection, 13 TLD-specific RDAP endpoints |
| WHOIS cache | COMPLETE | `db/migrations/030_domain_whois_cache.sql` | 48h TTL, indexed |
| Domain spoofing detection | COMPLETE | `src/lib/server/domain-check.ts::findSpoofingMatches()` | Levenshtein + trigram + homoglyph |
| `checkDomain()` public API | COMPLETE | `src/lib/server/domain-check.ts` | Returns `DomainCheckResult` with WHOIS + spoofing |
| `extractDomain()` utility | COMPLETE | `src/lib/server/domain-check.ts` | Handles email addresses and URLs |
| `DomainCheckCard` UI | COMPLETE | `src/app/search/page.tsx` | Used in search results only — not on entity page |
| Legitimate domains table | COMPLETE | `db/migrations/029_legitimate_domains.sql` | Powers spoofing detection |
| Email DNS check | MISSING | — | Needs `checkEmailDomain()` + `domain_email_cache` |
| Entity page domain tab | MISSING | — | Needs `DomainIntelPanel` component + tab |
| Domain intelligence API route | MISSING | — | Needs `/api/intelligence/domain/[domain]` |
| Domain risk badge in sidebar | MISSING | — | Needs surface-level flag for < 6 month domain |
| Domain field in `metadata_json` | MISSING | — | Entities don't currently store a `website` field |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| WHOIS over port 43 (text protocol) | RDAP over HTTPS (JSON) | ICANN mandate 2019; widely adopted by 2023 | RDAP returns structured JSON, no port 43 firewalling issues, includes vCard |
| External WHOIS API services | Node.js `node:dns/promises` for DNS | DNS has always been built-in; project confirms it works | Zero API key dependency for email DNS hygiene |
| Separate DMARC check tool | `_dmarc.<domain>` TXT lookup | Standard RFC 7489 | Built-in via `resolveTxt()` — no library needed |

**Deprecated/outdated:**
- Port 43 WHOIS: do not use. RDAP is the current standard and already implemented.
- `whois` npm package: would add a dependency with no advantage over the built-in RDAP implementation already in the codebase.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Companies in `metadata_json` do not currently store a `website` or `domain` field | Existing Infrastructure Inventory | If wrong, domain extraction already works and the "manual input" fallback is unnecessary |
| A2 | The `domain_whois_cache` migration 030 has been applied to the running database | Existing Infrastructure | If not applied, `checkDomain()` will fail at the cache step — planner should add migration verification to Wave 0 |
| A3 | DKIM selector probing with 8-10 common selectors covers ~80% of real-world company domains | Common Pitfalls | If wrong, `dkimDetected: false` is more common than expected — DKIM display would mislead users |
| A4 | The new `/api/intelligence/domain/[domain]` route will be covered by the `middleware.ts` auth established in Phase 1 | Architecture Patterns | If Phase 1 middleware was not fully applied, this route may be exposed without auth |

---

## Open Questions

1. **Where does the domain come from for local entities?**
   - What we know: `metadata_json` has no `website` field for most entities; sync modules do not populate it.
   - What's unclear: Should the planner (a) add domain population in a future sync pass, (b) show a manual input on the entity page, or (c) skip the domain panel for entities without a known domain?
   - Recommendation: Plan for a manual input fallback. This lets compliance officers use the feature immediately for any counterparty, regardless of whether the entity is in the database with a stored domain.

2. **Should domain risk signals appear in the entity sidebar (F1/F2) or only in the Domain tab (F3)?**
   - What we know: Success criterion 3 says "the flag is visible on the entity page" — could be sidebar or tab.
   - What's unclear: Is the domain age flag free-tier visible (like SanctionBadge) or paid-only (like ContentLock panels)?
   - Recommendation: Make the domain age flag (< 6 months) visible in the sidebar as an F2 element (always free), so compliance officers see risk context without needing to upgrade. Detailed WHOIS + email DNS data stays F3.

3. **Should the phase add a `website` field to the seed data / sync modules?**
   - What we know: Phase 3 requirements (DATASRC-05, DATASRC-06) say "for a company entity with a known domain" — implying domain availability is a precondition.
   - What's unclear: Are there seed entities with known domains we can use for end-to-end testing?
   - Recommendation: Add `website` to at least 2-3 seed entities (e.g., demo entities in `009_seed_realistic.sql`) to enable end-to-end testing without manual input. This does not require a migration — just UPDATE statements.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node:dns/promises` | Email DNS checks (MX, TXT) | Yes (built-in) | Node.js 24.11.1 | — |
| `node:dns/promises` MX resolution | DATASRC-06 | Yes — verified on vitol.com | — | — |
| `node:dns/promises` TXT resolution | SPF/DMARC detection | Yes — verified on vitol.com | — | — |
| RDAP fetch (existing) | DATASRC-05 | Yes — in `domain-check.ts` | — | — |
| PostgreSQL (domain_whois_cache) | WHOIS cache reads | Yes (existing migration 030) | 16 | — |
| DKIM selector probing | DATASRC-06 (DKIM) | Partial — selector guessing only | — | Report as "not detectable" |

**Note on DNS environment:** `resolveMx('gmail.com')` returned `ESERVFAIL` in this environment while `resolveMx('vitol.com')` succeeded. This suggests the local DNS resolver handles some domains but not others, possibly due to caching or VPN. In production (Ubuntu/PM2), standard DNS resolution should work reliably. The code must handle `ESERVFAIL` gracefully.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None (explicit in Out of Scope in REQUIREMENTS.md: "Automated test suite — not in scope") |
| Config file | None |
| Quick run command | `npm run type-check` (TypeScript strict, no ORM) |
| Full suite command | `npm run build` (ensures no compilation errors) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATASRC-05 | Domain WHOIS/RDAP exposure on entity page | manual (browser) | — | N/A |
| DATASRC-06 | Email DNS MX/SPF/DMARC on entity page | manual (browser) | — | N/A |
| DATASRC-05 SC-3 | Domain < 6 months flagged | manual (browser) | — | N/A |
| DATASRC-06 SC-4 | No SPF/DMARC distinguishable from full hygiene | manual (browser) | — | N/A |

**TypeScript compile check serves as the automated gate** per project conventions.

### Wave 0 Gaps

- [ ] `npm run type-check` must pass after adding `EmailDomainCheck` types to `domain-check.ts`
- [ ] `npm run build` must pass after adding new route and component
- [ ] `domain_email_cache` migration must be in place before testing

*(No automated test suite in scope per REQUIREMENTS.md Out of Scope section)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Existing `middleware.ts` (Phase 1) + session check in new route |
| V3 Session Management | No — existing sessions unchanged | — |
| V4 Access Control | Yes | F3 plan check in `/api/intelligence/domain/[domain]` — same pattern as company intelligence route |
| V5 Input Validation | Yes | Domain string must be validated/normalized before DNS lookup and before SQL parameterized query |
| V6 Cryptography | No | No crypto operations in this phase |

### Known Threat Patterns for DNS/RDAP Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| DNS amplification via user-supplied domain | Spoofing | Validate domain format (regex) before calling `dns.resolveMx()`; rate-limit per user via existing quota system |
| SSRF via domain parameter to RDAP | Tampering | `checkDomain()` already validates domain length and format; RDAP URLs are constructed from a fixed allowlist of RDAP servers (`RDAP_BASE`) — no user-controlled URL construction |
| Cache poisoning via malicious RDAP response | Tampering | Store raw RDAP JSON in `raw_json` column; parse defensively in `parseRdapResponse()` (already null-safe) |
| SQL injection via domain parameter | Tampering | All SQL uses parameterized queries (`$1`, `$2`) — established pattern throughout codebase |
| Unauthorized domain intelligence access | Elevation of privilege | Route protected by `middleware.ts` + plan check — free users get 403 |

---

## Sources

### Primary (HIGH confidence)

- [VERIFIED: src/lib/server/domain-check.ts] — Confirmed full RDAP + spoofing implementation exists
- [VERIFIED: db/migrations/030_domain_whois_cache.sql] — Confirmed cache schema
- [VERIFIED: src/app/search/page.tsx] — Confirmed DomainCheckCard UI pattern + domain detection
- [VERIFIED: src/lib/server/screening-service.ts] — Confirmed checkDomain() usage in trade flow
- [VERIFIED: npm view node:dns/promises] — Built-in module; DNS MX/TXT verified working in project environment at ~10ms

### Secondary (MEDIUM confidence)

- [CITED: RFC 7489 DMARC] — `_dmarc.<domain>` TXT record is the standard DMARC lookup path
- [CITED: RFC 7208 SPF] — `v=spf1` TXT record at root domain is the standard SPF lookup path
- [CITED: RFC 6376 DKIM] — `<selector>._domainkey.<domain>` TXT record; selector is variable

### Tertiary (LOW confidence)

- [ASSUMED] DKIM selector probing covers ~80% of real company domains — based on training knowledge of common providers (Google Workspace, Mimecast, etc.)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified in-repo or as built-in Node.js modules
- Architecture patterns: HIGH — codebase thoroughly read, patterns confirmed against existing components
- Pitfalls: HIGH — DNS ESERVFAIL verified empirically; DKIM selector limitation confirmed by probing
- Missing infrastructure: HIGH — confirmed via grep + glob that email DNS check and entity page tab do not exist
- Domain data source: MEDIUM — confirmed that `metadata_json` has no `website` field, but did not exhaustively check all sync modules

**Research date:** 2026-04-13
**Valid until:** 2026-07-13 (stable — DNS standards and RDAP are mature; Node.js DNS API stable since v18)

# Phase 6: Trade Service Integration Hardening - Research

**Researched:** 2026-04-14
**Domain:** TypeScript service wiring — trade-service.ts + domain-check.ts + TradeClient.tsx
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** Domain source is dual: new optional "Seller domain / email" form field. If filled in, that value is used via `extractDomain()`. If blank, fall back to `sellerFullEntity.website`. If neither resolves, silently skip.

**D-02:** `TradeCheckInput` gains a new optional field `sellerDomain?: string`. The trade form UI adds a corresponding optional input.

**D-03:** Domain is extracted using existing `extractDomain()` from `domain-check.ts`, then passed to `checkDomain()` to produce `sellerDomainCheck`. Result passed as `sellerDomainCheck` to `runTradeRules()`.

**D-04:** When no domain can be resolved (no form input AND no `website` on seller entity), silently skip domain check. No flags raised, no UI notification.

**D-05:** When the RDAP request fails (timeout, network error), silently fail. Server logs error, domain check treated as skipped. No UI impact.

**D-06:** `TradeCheckResult` gains a new field `sanctionDegraded?: boolean`. Set to `true` when either the seller sanction check or the vessel sanction check returns `status: 'degraded'`. If both are `'ok'`, field is absent or `false`.

**D-07:** The `.catch(() => ({ listed: false, sources: [] }))` pattern in `trade-service.ts` must be updated to preserve the `status` field from `checkSanctions()` so degraded state is not silently swallowed.

**D-08:** UI treatment: when `sanctionDegraded === true`, display a standalone amber warning box directly below the `ResultBanner` in `TradeClient.tsx`. Text intent: "Sanction data may be incomplete — OpenSanctions API was unavailable during this check. Cached data was used. Manual verification recommended." No changes to the verdict or flag list.

### Claude's Discretion

- Exact wording of the amber warning box text (within the intent of D-08)
- Whether `sanctionDegraded` is a top-level field or nested under a `meta` key in `TradeCheckResult`
- CSS styling of the amber warning box (use existing CSS variable patterns)
- Label for the new trade form field ("Seller email or domain", "Seller domain (optional)", etc.)
- Whether `checkDomain()` is called inside the first or second `Promise.all()` batch in `runTradeCheck()`

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ARCH-02 | OpenSanctions API circuit breaker — when API is unavailable, screening returns `status: degraded` with cached data and does not fail silently | Circuit breaker is already implemented in `sanctions.ts`. Gap: `trade-service.ts` line 268 `.catch()` swallows the `status` field. Fix: let resolved `status: 'degraded'` propagate, add `sanctionDegraded` to `TradeCheckResult`, surface amber warning in UI. |
| DECISION-03 | Each reason code in the trade verdict maps to a human-readable explanation and the data source that triggered it | Domain rules (16+17) in `trade-rules.ts` already exist and already carry `dataSource` + `dataSourceSyncedAt`. Gap: `sellerDomainCheck` is never passed to `runTradeRules()` from `trade-service.ts`. Fix: wire `checkDomain()` call and pass result. |
</phase_requirements>

---

## Summary

Phase 6 closes two integration gaps where existing code was never connected end-to-end. Both gaps are purely wiring problems — no new algorithms, data sources, or schema migrations are required.

**GAP-1 (DECISION-03):** The domain fraud detection module (`domain-check.ts`) and the trade rule engine (`trade-rules.ts` Rules 16/17) both exist and are fully functional. They are already connected in the document-upload path (`screening-service.ts`). They are simply not connected in the direct trade check path (`trade-service.ts`). The fix is: (1) add `sellerDomain?: string` to `TradeCheckInput`, (2) resolve the domain from the form field or `sellerFullEntity.website`, (3) call `checkDomain()`, (4) pass the result as `sellerDomainCheck` to `runTradeRules()`.

**GAP-2 (ARCH-02):** The circuit breaker is already implemented in `checkSanctions()` which returns `{ status: 'ok' | 'degraded', ... }`. However `trade-service.ts` catches errors with `.catch(() => ({ listed: false, sources: [] }))` which discards the `status` field entirely. When the circuit is open, `checkSanctions()` resolves (does NOT throw) with `status: 'degraded'` — so the `.catch()` never fires, and `status` is simply never read. The fix is: read `status` from the resolved result, set `sanctionDegraded: true` on `TradeCheckResult`, and show an amber warning box in `TradeClient.tsx`.

**Primary recommendation:** Both gaps are 10-20 line changes each in `trade-service.ts`. The form field addition and amber warning box in `TradeClient.tsx` are the most visible changes but remain straightforward.

---

## Standard Stack

No new libraries. All dependencies are already installed.

### Core (already installed)
| Module | Version | Purpose |
|--------|---------|---------|
| `src/lib/server/domain-check.ts` | — (internal) | `checkDomain()`, `extractDomain()` — used for GAP-1 |
| `src/lib/server/sync/sanctions.ts` | — (internal) | `checkSanctions()` — circuit breaker already implemented |
| `src/lib/server/trade-service.ts` | — (internal) | Primary file to edit for both gaps |
| `src/lib/server/trade-rules.ts` | — (internal) | `TradeRuleInput.sellerDomainCheck` already typed |
| `src/app/trade/TradeClient.tsx` | — (internal) | Form + amber warning box additions |

**Installation:** None required.

---

## Architecture Patterns

### Existing Pattern: Domain Check in screening-service.ts

The reference implementation for GAP-1 is `src/lib/server/screening-service.ts` lines 258–300. It:

1. Extracts domains from document text
2. Calls `checkDomain()` for each domain
3. Picks the highest-severity result as `sellerDomainCheck`
4. Passes it to `runTradeRules()` as `sellerDomainCheck: { domain, flagged, severity, evidence, spoofingMatches }`

The trade-service.ts implementation is simpler: one domain (not a list), from one of two sources (form field or `sellerFullEntity.website`).

```typescript
// Source: src/lib/server/screening-service.ts lines 258–300 [VERIFIED: codebase]
// Pattern: calling checkDomain and passing result to runTradeRules
const sellerDomainCheck = sellerDomainCheck?.flagged ? {
  domain: sellerDomainCheck.domain,
  flagged: sellerDomainCheck.flagged,
  severity: sellerDomainCheck.severity,
  evidence: sellerDomainCheck.evidence,
  spoofingMatches: sellerDomainCheck.spoofingMatches,
} : null
```

### Existing Pattern: Second Promise.all() batch in runTradeCheck()

`trade-service.ts` uses two sequential `Promise.all()` batches. The first fetches data needed to identify the seller entity. The second batch (lines 285–303) fetches data that depends on the seller DB match — specifically `sellerFullEntity`. Since the domain fallback needs `sellerFullEntity.website`, the `checkDomain()` call must go in the second batch or after it.

```typescript
// Source: src/lib/server/trade-service.ts lines 285–303 [VERIFIED: codebase]
// Second batch — runs after sellerDbMatch is resolved
const [sellerIcijCount, sellerDbIncDate, sellerUltimateParentJurisdiction, pscSummary, draftRisk, sellerFullEntity] = await Promise.all([
  // ... existing items ...
  sellerDbMatch?.registrationNumber
    ? getEntityByKey(sellerDbMatch.registrationNumber).catch(() => null)
    : Promise.resolve(null),
])
// Domain check: add after the second batch, using resolved sellerFullEntity
```

### Existing Pattern: checkSanctions() status propagation

`checkSanctions()` never throws — it always resolves. [VERIFIED: codebase src/lib/server/sync/sanctions.ts lines 238–270]

- When local DB has data: returns `{ status: 'ok', listed: ..., sources: ... }`
- When circuit is open (degraded): returns `{ status: 'degraded', listed: false, sources: [], reason: 'opensanctions_api_unavailable' }`
- On any exception: catches internally, returns `{ status: 'degraded', listed: false, sources: [], reason: 'opensanctions_api_unavailable' }`

The current `trade-service.ts` call:
```typescript
// Source: trade-service.ts line 268 [VERIFIED: codebase]
checkSanctions(seller).catch(() => ({ listed: false, sources: [] as string[] })),
```

This `.catch()` is unreachable (checkSanctions never rejects). More importantly, even when it resolves with `status: 'degraded'`, the `status` field is never read — the caller destructures only `{ listed, sources }`. The fix is to destructure `status` from the resolved value and use it to set `sanctionDegraded`.

### Recommended Fix Pattern for GAP-2

```typescript
// Source: derived from trade-service.ts analysis [VERIFIED: codebase]
// DO NOT use .catch() to swallow status — checkSanctions() never throws
const [sellerSanction, ..., vesselSanction, ...] = await Promise.all([
  checkSanctions(seller).catch(() => ({ status: 'degraded' as const, listed: false, sources: [] as string[] })),
  // ...
  checkSanctions(vessel).catch(() => ({ status: 'degraded' as const, listed: false, sources: [] as string[] })),
  // ...
])
// After batch:
const sanctionDegraded = sellerSanction.status === 'degraded' || vesselSanction.status === 'degraded'
```

### Existing Pattern: CSS Design Tokens for Amber Warning

CSS variables for amber (warning) style are defined in `globals.css` [VERIFIED: codebase]:

```css
--accent-amber:   #f59e0b;  /* Amber — warnings */
--risk-medium:    #f59e0b;  /* Medium risk — amber */
```

The `RISK_COLOR`, `RISK_BG`, `RISK_BORDER` maps in `TradeClient.tsx` use hardcoded rgba values that correspond to `medium` level [VERIFIED: codebase]:

```typescript
// Source: src/app/trade/TradeClient.tsx lines 14–31 [VERIFIED: codebase]
const RISK_COLOR = { medium: '#eab308', ... }
const RISK_BG    = { medium: 'rgba(234,179,8,0.08)', ... }
const RISK_BORDER = { medium: 'rgba(234,179,8,0.25)', ... }
```

The amber warning box should use these values (or inline equivalents from `--accent-amber`) to match the existing design system. Reference: the `ResultBanner` component uses `RISK_BG[overallRisk]` / `RISK_BORDER[overallRisk]` for its border/background — the amber box follows the same pattern with `medium`-level colors.

### Existing Pattern: TradeForm field() helper

`TradeClient.tsx` defines a `field()` helper function (lines 207–241) [VERIFIED: codebase] that creates labeled inputs with the consistent design:

```typescript
field(
  label: string,
  key: keyof FormValues,
  placeholder: string,
  hint?: string,
  required?: boolean,
  type?: string
)
```

To add the seller domain field:
1. Add `sellerDomain: string` to the `FormValues` interface
2. Initialize it as `''` in `useState`
3. Add `{field('Seller domain (optional)', 'sellerDomain', 'e.g. seller.com or contact@seller.com', 'Used for domain fraud detection')}` to the form grid
4. Include it in the `JSON.stringify` body sent to `/api/trade`

### Recommended Project Structure (Files to Touch)

```
src/
├── lib/server/
│   └── trade-service.ts          # Both gaps: TradeCheckInput, runTradeCheck(), TradeCheckResult
├── app/
│   ├── api/trade/
│   │   └── route.ts              # Read sellerDomain from body, pass to runTradeCheck()
│   └── trade/
│       └── TradeClient.tsx       # FormValues + form field + amber warning box in ResultsView
```

No other files require changes. `trade-rules.ts` and `domain-check.ts` are consumed as-is.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Domain WHOIS lookup | Custom RDAP fetcher | `checkDomain()` in `domain-check.ts` | Already built, cached 48h, handles all TLDs, spoofing detection included |
| Domain extraction from email/URL | Custom parser | `extractDomain()` in `domain-check.ts` | Already tested, handles email `@domain` and URL `http://...` formats |
| Circuit breaker state | Custom in-memory state | Already in `sanctions.ts` | Implemented in Phase 1; `checkSanctions()` returns `status` field |
| Amber warning styling | Custom CSS class | Inline style with `RISK_BG['medium']` / `RISK_BORDER['medium']` values | Matches existing design system; no new CSS required |

**Key insight:** Everything is already built. This phase is 100% integration — wiring existing modules together.

---

## Common Pitfalls

### Pitfall 1: Assuming checkSanctions() throws on circuit open

**What goes wrong:** Developer reads the `.catch()` in trade-service.ts and thinks it handles the degraded case. It does not. `checkSanctions()` resolves (with `status: 'degraded'`) rather than throwing when the circuit is open.
**Why it happens:** The catch guard was written before the return signature included `status`. It is now a no-op for the normal degraded path.
**How to avoid:** Read `status` from the resolved value directly: `const { status, listed, sources } = await checkSanctions(name)`.
**Warning signs:** `sanctionDegraded` always false even when OpenSanctions is down.

### Pitfall 2: Calling checkDomain() in the first Promise.all() batch

**What goes wrong:** The domain fallback needs `sellerFullEntity.website`, which is only available after the second batch. Calling `checkDomain()` in the first batch means the fallback path never has data.
**Why it happens:** The first batch looks like the natural place to add parallel checks.
**How to avoid:** Per D-03/D-04, resolve the domain source after the second batch (where `sellerFullEntity` is available), then call `checkDomain()` in a third await or add a parallel step after the second batch.
**Warning signs:** Domain fallback via `website` never fires even when the entity has a `website` field.

### Pitfall 3: Forgetting to update route.ts to forward sellerDomain

**What goes wrong:** `TradeCheckInput.sellerDomain` is added to the type, the form sends it, but `route.ts` never reads it from the request body, so it is always `undefined`.
**Why it happens:** `route.ts` manually destructures each field from `body`.
**How to avoid:** Add `const sellerDomain = body.sellerDomain ? String(body.sellerDomain).trim() || undefined : undefined` to `route.ts` and include it in the `runTradeCheck()` call.
**Warning signs:** TypeScript `type-check` passes (field is optional), but domain flags never fire even when the form field is filled.

### Pitfall 4: TypeScript type error on catch fallback

**What goes wrong:** `catch(() => ({ listed: false, sources: [] }))` — the fallback object is missing the `status` field required by the updated code that reads `sellerSanction.status`.
**Why it happens:** The catch was written when `checkSanctions()` returned a simpler type.
**How to avoid:** Update `.catch()` to return `{ status: 'degraded' as const, listed: false, sources: [] as string[] }` so TypeScript is satisfied.
**Warning signs:** `npm run type-check` fails with "Property 'status' does not exist on type '{ listed: false; sources: string[]; }'".

### Pitfall 5: Amber warning box placed inside ResultBanner instead of below it

**What goes wrong:** Warning text is embedded inside the risk banner, making it look like it affects the verdict severity.
**Why it happens:** D-08 says "directly below the ResultBanner" but `ResultBanner` is a self-contained component — the placement must be in `ResultsView`, not inside `ResultBanner`.
**How to avoid:** Render the amber box in `ResultsView` immediately after `<ResultBanner result={result} />`, as a sibling JSX element.
**Warning signs:** Warning text appears with the same risk-level background as the overall verdict.

### Pitfall 6: checkDomain() result passed with wrong shape

**What goes wrong:** `TradeRuleInput.sellerDomainCheck` expects an object with `{ domain, flagged, severity, evidence, spoofingMatches }` — passing the full `DomainCheckResult` (which includes `whois`) causes TypeScript to complain about extra properties.
**Why it happens:** `DomainCheckResult` has a `whois` field that `TradeRuleInput.sellerDomainCheck` does not expect.
**How to avoid:** Map to the exact shape expected, as `screening-service.ts` does (lines 292–300): `{ domain: r.domain, flagged: r.flagged, severity: r.severity, evidence: r.evidence, spoofingMatches: r.spoofingMatches }`.
**Warning signs:** TypeScript type-check error: "Object literal may only specify known properties, and 'whois' does not exist in type...".

---

## Code Examples

### GAP-1: Adding domain resolution to runTradeCheck()

```typescript
// Source: derived from screening-service.ts pattern [VERIFIED: codebase]
// Place after the second Promise.all() batch (sellerFullEntity is now resolved)

// Resolve domain source: form field → entity website → skip
const rawDomain = input.sellerDomain
  ?? (sellerFullEntity as Company | null)?.website
  ?? null
const resolvedDomain = rawDomain ? extractDomain(rawDomain) : null

let sellerDomainCheck: TradeRuleInput['sellerDomainCheck'] = null
if (resolvedDomain) {
  try {
    const check = await checkDomain(resolvedDomain)
    if (check.flagged) {
      sellerDomainCheck = {
        domain: check.domain,
        flagged: check.flagged,
        severity: check.severity,
        evidence: check.evidence,
        spoofingMatches: check.spoofingMatches,
      }
    }
  } catch (err) {
    console.warn('[trade] domain check failed, skipping:', err)
  }
}
```

### GAP-2: Preserving sanction status for degradation detection

```typescript
// Source: derived from sanctions.ts return type analysis [VERIFIED: codebase]
// In the first Promise.all() batch, update .catch() to preserve status shape:

const [sellerSanction, ..., vesselSanction, ...] = await Promise.all([
  checkSanctions(seller).catch(() => ({
    status: 'degraded' as const,
    listed: false,
    sources: [] as string[],
  })),
  // ... other items unchanged ...
  checkSanctions(vessel).catch(() => ({
    status: 'degraded' as const,
    listed: false,
    sources: [] as string[],
  })),
  // ...
])

// After batch — derive degradation flag:
const sanctionDegraded =
  sellerSanction.status === 'degraded' || vesselSanction.status === 'degraded'
```

### GAP-2: Adding sanctionDegraded to TradeCheckResult

```typescript
// Source: trade-service.ts TradeCheckResult interface [VERIFIED: codebase]
export interface TradeCheckResult {
  id: string
  checkedAt: string
  input: { ... }
  seller: TradePartyResult
  vessel: TradeVesselResult
  port: TradePortResult | null
  flags: TradeFlag[]
  overallRisk: RiskLevel
  verdict: TradeVerdict
  summary: string
  sanctionDegraded?: boolean    // NEW: true when either sanction check was degraded
}

// In runTradeCheck() result object construction:
const result: TradeCheckResult = {
  // ... existing fields ...
  sanctionDegraded: sanctionDegraded || undefined,  // omit when false
}
```

### GAP-2: Amber warning box in ResultsView

```typescript
// Source: TradeClient.tsx ResultsView pattern [VERIFIED: codebase]
// Placement: immediately after <ResultBanner result={result} />, before the Actions row

function ResultsView({ result, onReset }: { result: TradeCheckResult; onReset: () => void }) {
  return (
    <>
      <ResultBanner result={result} />

      {result.sanctionDegraded && (
        <div style={{
          backgroundColor: 'rgba(234,179,8,0.08)',
          border: '1px solid rgba(234,179,8,0.25)',
          borderRadius: '8px',
          padding: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
        }}>
          <p style={{ fontSize: '13px', fontWeight: 600, color: '#eab308', margin: '0 0 4px' }}>
            Sanction data may be incomplete
          </p>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>
            The OpenSanctions API was unavailable during this check. Cached data was used where available.
            Manual verification against OFAC, EU FSF, and UN consolidated lists is recommended.
          </p>
        </div>
      )}

      {/* Actions, Flags, etc. — existing content unchanged */}
      ...
    </>
  )
}
```

### GAP-1: Updating TradeForm for sellerDomain field

```typescript
// Source: TradeClient.tsx FormValues + field() pattern [VERIFIED: codebase]

interface FormValues {
  seller: string
  vessel: string
  imo: string
  date: string
  loadingPort: string
  commodity: string
  sellerDomain: string    // NEW
}

// In useState initialization:
const [values, setValues] = useState<FormValues>({
  seller: initialSeller, vessel: initialVessel, imo: '', date: '',
  loadingPort: '', commodity: '',
  sellerDomain: '',       // NEW
})

// In the form grid (field() call):
{field('Seller domain (optional)', 'sellerDomain',
  'e.g. seller.com or contact@seller.com',
  'Used for domain fraud detection — leave blank to skip')}

// In submit() body:
body: JSON.stringify({
  seller:       values.seller.trim(),
  vessel:       values.vessel.trim(),
  imo:          values.imo.trim() || undefined,
  date:         values.date || undefined,
  loadingPort:  values.loadingPort.trim() || undefined,
  commodity:    values.commodity.trim() || undefined,
  sellerDomain: values.sellerDomain.trim() || undefined,  // NEW
})
```

### GAP-1: Updating route.ts to forward sellerDomain

```typescript
// Source: src/app/api/trade/route.ts [VERIFIED: codebase]
// Add after existing destructuring of imoField:

const sellerDomain = body.sellerDomain
  ? String(body.sellerDomain).trim() || undefined
  : undefined

// Include in runTradeCheck() call:
const result = await runTradeCheck(session.user.id, {
  seller, vessel, date, loadingPort, commodity, imoField,
  sellerDomain,   // NEW
})
```

---

## State of the Art

| Old Approach | Current Approach | Status | Impact |
|--------------|------------------|--------|--------|
| `checkSanctions()` swallowed by `.catch()` in trade-service.ts | Read `status` field from resolved result | Phase 6 fix | Enables `sanctionDegraded` flag |
| Domain check only in screening-service.ts (document upload path) | Domain check wired into runTradeCheck() (direct trade check path) | Phase 6 fix | DOMAIN_WHOIS_RISK + DOMAIN_SPOOFING_RISK fire on /api/trade |
| No amber warning when sanction data is stale | Amber warning box in TradeClient.tsx below ResultBanner | Phase 6 fix | Compliance officers see explicit data quality warning |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `checkDomain()` is called after the second `Promise.all()` batch (so `sellerFullEntity` is available for the website fallback) | Architecture Patterns | Domain fallback via `website` never resolves — but domain check still works via form field, so functional impact is partial |
| A2 | `DomainCheckResult` from `checkDomain()` is structurally compatible with `TradeRuleInput.sellerDomainCheck` when mapped to the 5-field shape | Don't Hand-Roll | TypeScript error at compile time — caught immediately by `npm run type-check` |
| A3 | `sellerFullEntity` is of type `Company | null` at the point domain fallback is checked (no other entity types have a `website` field) | Code Examples | TypeScript type assertion needed; if another entity type is returned, `website` would be undefined (fallback gracefully skips) |

**Claims A2 and A3 are LOW risk** — both are caught by the type-check gate (`npm run type-check` exits 0 is a success criterion).

---

## Open Questions

1. **Should `sanctionDegraded` be top-level or under `meta`?**
   - What we know: CONTEXT.md marks this as Claude's Discretion
   - What's unclear: Impact on the persisted `result_json` in `trade_sessions` table — changing structure would not break existing rows (PostgreSQL JSONB) but would differ from older records
   - Recommendation: Use top-level field (`sanctionDegraded?: boolean`) for simplicity. All flag data is also top-level; nesting under `meta` adds indirection with no benefit.

2. **Should the amber warning appear in the PDF export?**
   - What we know: CONTEXT.md explicitly excludes "changes to entity pages or PDF template" from scope
   - What's unclear: Whether a future compliance officer would want the audit PDF to note that sanction data was degraded at the time of the check
   - Recommendation: Out of scope for Phase 6 per CONTEXT.md. Defer. The `result_json` that powers PDF generation will include `sanctionDegraded` already, so a Phase 7+ task can add it to the PDF template without re-doing service work.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 6 is purely code/config changes with no external tool dependencies. All runtime dependencies (PostgreSQL, Node.js, Next.js) are already in use by the running application. The domain check module makes outbound RDAP HTTP calls, but these are handled within the existing `checkDomain()` implementation with built-in error handling.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | TypeScript compiler (`tsc --noEmit`) — sole automated gate per REQUIREMENTS.md "Out of Scope: Automated test suite" |
| Config file | `tsconfig.json` (strict mode enabled) |
| Quick run command | `npm run type-check` |
| Full suite command | `npm run type-check` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DECISION-03 | `DOMAIN_WHOIS_RISK` flag fires when seller domain < 6 months old | Manual smoke test — submit trade check with a newly-registered domain | `npm run type-check` (structural gate) | N/A |
| DECISION-03 | `DOMAIN_SPOOFING_RISK` flag fires when domain resembles legitimate domain | Manual smoke test | `npm run type-check` | N/A |
| ARCH-02 | `sanctionDegraded: true` in result when OpenSanctions unavailable | Manual smoke test — trip circuit breaker or mock | `npm run type-check` | N/A |
| ARCH-02 | Amber warning box visible in TradeClient when `sanctionDegraded === true` | Manual UI check | `npm run type-check` | N/A |
| All | TypeScript strict mode passes | Automated | `npm run type-check` | ✅ |

**Note:** Per REQUIREMENTS.md, automated test suites are explicitly out of scope for this milestone. The phase success criterion "npm run type-check exits 0 after all changes" is the primary automated gate. Manual smoke tests cover functional verification.

### Sampling Rate
- **Per task commit:** `npm run type-check`
- **Per wave merge:** `npm run type-check`
- **Phase gate:** `npm run type-check` exits 0 before `/gsd-verify-work`

### Wave 0 Gaps
None — no test infrastructure needs to be created. TypeScript compiler is the sole automated gate.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth changes |
| V3 Session Management | no | No session changes |
| V4 Access Control | no | No access control changes |
| V5 Input Validation | yes | `sellerDomain` form input — validated by `extractDomain()` which returns `null` for invalid input, silently skipped |
| V6 Cryptography | no | No cryptographic operations |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SSRF via `sellerDomain` input | Tampering / Information Disclosure | `extractDomain()` only extracts the domain portion; `checkDomain()` constructs fixed RDAP URLs (`${RDAP_BASE[tld]}/domain/${domain}`) — not a free-form URL. Arbitrary redirects are not possible. |
| Domain input injection | Tampering | `extractDomain()` uses URL parsing and regex — rejects non-domain strings by returning `null`. Null result silently skips the domain check (D-04). |

**Security assessment:** The `sellerDomain` field is a low-risk addition. The `extractDomain()` function is already used in production (screening-service.ts) with the same RDAP lookup path. No new attack surface is introduced. [VERIFIED: codebase analysis]

---

## Sources

### Primary (HIGH confidence)
- `src/lib/server/domain-check.ts` — full file read; `checkDomain()`, `extractDomain()`, `DomainCheckResult` interface verified
- `src/lib/server/trade-service.ts` — full file read; `runTradeCheck()`, `TradeCheckInput`, `TradeCheckResult`, `.catch()` pattern on line 268 verified
- `src/lib/server/trade-rules.ts` — lines 130–155 (sellerDomainCheck type), 664–707 (Rules 16+17) verified
- `src/lib/server/sync/sanctions.ts` — lines 130–270; circuit breaker state, `checkSanctions()` return type `{ status: 'ok' | 'degraded', ... }` verified
- `src/app/trade/TradeClient.tsx` — full file read; `ResultsView`, `ResultBanner`, `FormValues`, `TradeForm`, `field()` helper verified
- `src/app/api/trade/route.ts` — full file read; body destructuring pattern verified
- `src/lib/server/screening-service.ts` — lines 250–310; reference implementation of `sellerDomainCheck` wiring verified
- `src/lib/types.ts` — lines 60–90; `Company.website?: string` verified
- `src/styles/globals.css` — lines 1–56; CSS variables for amber (`--accent-amber: #f59e0b`) verified
- `npm run type-check` — executed successfully (exit 0) confirming baseline TypeScript passes

### Secondary (MEDIUM confidence)
- `.planning/phases/01-architecture-hardening/01-CONTEXT.md` — circuit breaker design decisions (3 failures, 60s cooldown)
- `.planning/phases/05-decision-engine-upgrade/05-CONTEXT.md` — DOMAIN_SPOOFING_RISK is a hard-block code (D-01)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all modules verified by direct codebase read
- Architecture patterns: HIGH — reference implementation in screening-service.ts confirmed
- Pitfalls: HIGH — derived from exact line-level code analysis of the gaps
- Security: HIGH — same RDAP path as existing production code

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable codebase, no external API changes relevant)

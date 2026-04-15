---
phase: 06-trade-service-integration-hardening
reviewed: 2026-04-14T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/lib/server/trade-service.ts
  - src/app/trade/TradeClient.tsx
  - src/app/api/trade/route.ts
findings:
  critical: 2
  warning: 5
  info: 3
  total: 10
status: issues_found
---

# Phase 06: Code Review Report

**Reviewed:** 2026-04-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

All three files implement the trade check pipeline: API route (`route.ts`) validates input and enforces plan gating, `trade-service.ts` orchestrates multi-source data fetching and risk rule evaluation, and `TradeClient.tsx` renders the form and results. The integration is generally solid — parallel data fetching, circuit-breaker fallbacks on external calls, and explicit degraded-state signaling are all well executed.

Two critical issues were found: an authentication bypass where a null session crashes the server rather than returning 401, and a seller-domain input that bypasses length/format validation and is passed directly into RDAP/WHOIS lookups. Five warnings cover logic correctness issues including a missing `'degraded'` branch in `SanctionStatus` mapping, an AIS `Promise.race` timeout that leaks the unresolved promise, fire-and-forget DB writes whose errors are swallowed, sequential per-person DB queries inside a loop, and an unvalidated date string forwarded to PostgreSQL. Three info items cover code quality.

---

## Critical Issues

### CR-01: Unauthenticated request causes server crash instead of 401

**File:** `src/app/api/trade/route.ts:16`

**Issue:** The session is retrieved with `(await auth())!` — the non-null assertion operator. When the request arrives without a valid session (unauthenticated user, expired token, middleware misconfiguration), `auth()` returns `null` and the `!` assertion suppresses the TypeScript error at compile time. At runtime, the very next line `session.user.plan` throws `TypeError: Cannot read properties of null`, which propagates as an unhandled exception and causes the route to return a generic 500 instead of a proper 401. Any log aggregator will surface these as internal errors, masking the true cause.

**Fix:**
```typescript
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const plan = session.user.plan ?? 'free'
  // ... rest of handler
}
```

---

### CR-02: Seller domain passes no validation before external RDAP/WHOIS lookup

**File:** `src/lib/server/trade-service.ts:316-338`

**Issue:** `input.sellerDomain` is accepted directly from user input (passed through from the API body). The route handler does no format validation on it beyond `String(...).trim()`. In `trade-service.ts`, `extractDomain()` is called on the raw value and the result is then handed to `checkDomain()`, which performs external RDAP and WHOIS network requests. An attacker with a paid account can craft values such as `localhost`, `169.254.169.254`, `internal-host.corp`, or very long strings to probe internal infrastructure (SSRF) or cause slow requests. The `extractDomain` function is not visible in the reviewed files so its sanitization is unknown; the review must flag the gap at the boundary.

**Fix:** Add an allowlist-style domain format check in `route.ts` before passing to the service:
```typescript
// In route.ts, after parsing sellerDomain:
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i
const sellerDomain = body.sellerDomain
  ? (() => {
      const raw = String(body.sellerDomain).trim().toLowerCase()
        .replace(/^https?:\/\//i, '')   // strip scheme if user pasted URL
        .split('/')[0]                   // drop path
      return DOMAIN_RE.test(raw) && raw.length <= 253 ? raw : undefined
    })()
  : undefined
```
Additionally, in `trade-service.ts` (line 324), ensure `checkDomain` resolves hostnames only against public DNS (block RFC-1918 and link-local ranges at the HTTP client level).

---

## Warnings

### WR-01: `SanctionStatus` mapping ignores the `'degraded'` circuit-breaker state

**File:** `src/lib/server/trade-service.ts:341-342`

**Issue:** `checkSanctions` can return `status: 'degraded'` (as documented in the catch fallbacks on lines 274 and 276). The mapping on lines 341-342 maps only `listed` vs. `not_listed`:

```typescript
const sellerSanctionStatus: SanctionStatus = sellerSanction.listed ? 'listed' : 'not_listed'
const vesselSanctionStatus: SanctionStatus = vesselSanction.listed ? 'listed' : 'not_listed'
```

When the circuit breaker is open (`status: 'degraded'`), `listed` is `false`, so the entity is stamped `'not_listed'` and rendered with a green "CLEAR" badge in `SanctionBadge`. Although `sanctionDegraded` is set and a warning banner is shown in the UI, the individual entity badge communicates false confidence. If a user screenshots the entity card, the degraded context is lost.

The `SanctionStatus` type (defined in `@/lib/types`) includes `'unknown'` — the correct value for a degraded result.

**Fix:**
```typescript
const sellerSanctionStatus: SanctionStatus =
  sellerSanction.status === 'degraded' ? 'unknown' :
  sellerSanction.listed ? 'listed' : 'not_listed'

const vesselSanctionStatus: SanctionStatus =
  vesselSanction.status === 'degraded' ? 'unknown' :
  vesselSanction.listed ? 'listed' : 'not_listed'
```

---

### WR-02: AIS `Promise.race` timeout leaks an unresolved promise

**File:** `src/lib/server/trade-service.ts:115-121`

**Issue:** `getAisForTrade` races `getVesselAis(imo)` against a 4-second timeout. When the timeout wins, `getVesselAis` continues running in the background with no reference retained. If the AIS call ultimately resolves or rejects, the rejection is silently dropped (Node.js may emit an `UnhandledPromiseRejection` depending on version). This also means a DB connection or HTTP connection opened by `getVesselAis` may remain open past the response.

```typescript
return await Promise.race([
  getVesselAis(imo),
  new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000)),
])
```

**Fix:** Use `AbortController` to cancel the AIS fetch on timeout, or wrap with a proper race utility that cleans up:
```typescript
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 4_000)
try {
  const result = await getVesselAis(imo, controller.signal)
  clearTimeout(timer)
  return result
} catch {
  clearTimeout(timer)
  return null
}
```
If `getVesselAis` does not accept a signal yet, at minimum suppress the floating rejection:
```typescript
const aisPromise = getVesselAis(imo)
aisPromise.catch(() => {}) // prevent unhandled rejection if timeout wins
return await Promise.race([
  aisPromise,
  new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000)),
])
```

---

### WR-03: Fire-and-forget DB writes after response — errors only logged, not retried

**File:** `src/lib/server/trade-service.ts:441-466`

**Issue:** The `trade_sessions` insert (line 441), the TTL cleanup query (line 447), and both `trade_events` inserts (lines 451-456, 459-465) are all issued as unawaited promises with `.catch(console.error)`. If the `trade_sessions` insert fails (e.g., primary key conflict from a UUID collision, schema mismatch after a failed migration, or pool exhaustion), the check result is returned to the user with an `id` that does not exist in the database. Subsequent requests for `/api/trade/${result.id}/report` will produce 404s with no explanation.

The TTL cleanup is intentionally fire-and-forget (acceptable), but the session insert is business-critical.

**Fix:** Await the session insert and handle the error before returning:
```typescript
try {
  await db.query(
    `INSERT INTO trade_sessions (id, user_id, input_json, result_json, overall_risk, flag_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, JSON.stringify(result.input), JSON.stringify(result), overallRisk, flags.length]
  )
} catch (err) {
  console.error('[trade] Failed to persist session:', err)
  // Optionally: still return result but set result.id = null so report link is hidden
}

// TTL cleanup remains fire-and-forget — acceptable
db.query(`DELETE FROM trade_sessions WHERE created_at < NOW() - INTERVAL '90 days'`)
  .catch((err) => console.error('[trade] TTL cleanup error:', err))
```

---

### WR-04: Sequential per-person DB queries inside `checkRelatedPartyRisk` loop

**File:** `src/lib/server/trade-service.ts:194-264`

**Issue:** `checkRelatedPartyRisk` iterates over `people` (directors + beneficial owners) and for each person fires two sequential `await db.query(...)` calls (lines 201-226). For a company with 10 directors this is 20 sequential round-trips to PostgreSQL, all on the critical path of the trade check. More importantly, the function returns early on the **first** match (line 253: `return [{ ... }]`). This means if director #1 has no match, director #2 triggers two more round-trips, and so on — worst case is O(n) sequential query pairs. While performance is out of v1 scope, the **correctness concern** is that the early-return means only a single flag is ever emitted even when multiple directors are sanctioned; callers (line 384) merge flags with `[...relatedPartyFlags, ...ruleFlags]` expecting potentially multiple RELATED_PARTY_RISK flags.

The function's own JSDoc on line 179 explicitly states "Returns RELATED_PARTY_RISK flags (0 or 1) -- never more than one per seller" which matches the implementation but may hide multi-match cases from compliance officers.

**Fix:** If the single-flag design is intentional, document it in the result object and in the UI flag card. If all matches should surface, restructure to collect all hits before returning:
```typescript
const allFlags: TradeFlag[] = []
for (const person of people) {
  // ... existing query logic ...
  if (best) {
    allFlags.push({ code: 'RELATED_PARTY_RISK', ... })
    // do not return early; continue to collect all hits
  }
}
return allFlags
```

---

### WR-05: Unvalidated date string forwarded to PostgreSQL

**File:** `src/app/api/trade/route.ts:35` and `src/lib/server/trade-service.ts:454`

**Issue:** `date` is accepted as `String(body.date).trim()` with no format validation. It is stored into `trade_events.event_date` via a parameterized query (line 454: `[..., date, ...]`). PostgreSQL will cast the string to a `DATE` or `TIMESTAMP` column type. If the column type is strict (e.g. `DATE NOT NULL`), an invalid date string like `"not-a-date"` will cause a PostgreSQL cast error. This error is caught by the `.catch(console.error)` on line 456 and silently swallowed — the trade event is not written, but the user sees no indication. More subtly, a value like `"2025-13-01"` (invalid month) will error silently in PostgreSQL while passing all JavaScript-level checks.

**Fix:** Validate date format in `route.ts` before forwarding:
```typescript
const date = body.date ? String(body.date).trim() : null
if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  return NextResponse.json({ error: 'Field "date" must be in YYYY-MM-DD format.' }, { status: 400 })
}
```

---

## Info

### IN-01: Inline IIFE in JSX for flag explanation rendering adds unnecessary complexity

**File:** `src/app/trade/TradeClient.tsx:358-383`

**Issue:** The flag explanation section in `FlagCard` uses an IIFE (`{(() => { ... })()}`) to conditionally render the explanation block. This pattern works but makes the JSX harder to read. An early-return sub-component or simple conditional assignment would be clearer.

**Fix:** Extract to a named component or use a simple conditional:
```tsx
const explanation = FLAG_EXPLANATIONS[flag.code as keyof typeof FLAG_EXPLANATIONS]
// Then in JSX:
{explanation && (
  <div style={{ ... }}>
    ...
  </div>
)}
```

---

### IN-02: `required` parameter in `field()` helper is declared but never used for its intended purpose

**File:** `src/app/trade/TradeClient.tsx:209-243`

**Issue:** The `field()` helper inside `TradeForm` accepts a `required` parameter (line 212) and renders a red asterisk when it is truthy (line 225). However, the `<input>` element never receives `required={required}` as an HTML attribute (line 227-234). This means browser-native form validation is bypassed — the form relies solely on the custom `touched`/`sellerErr`/`vesselErr` logic. The `required` parameter is effectively dead for its primary semantic purpose.

**Fix:** Pass the attribute through to the input:
```tsx
<input
  type={type}
  value={values[key]}
  onChange={set(key)}
  onBlur={isReq ? blur(key as 'seller' | 'vessel') : undefined}
  placeholder={placeholder}
  required={required}
  style={inputStyle(hasError)}
/>
```

---

### IN-03: Commented-out and orphaned `required` argument in field calls

**File:** `src/app/trade/TradeClient.tsx:251`

**Issue:** The `TradeDate` field call passes `false` as the `required` argument — an explicit false that serves no purpose since the parameter defaults to falsy and no other non-required field passes it:

```tsx
{field('Trade Date', 'date', '', 'Used to correlate AIS dark periods', false, 'date')}
```

The `false` is a mild readability noise. Relatedly, the `required` argument on line 248 for `Seller` and `Vessel` fields is `undefined` (not passed), yet the `field()` helper sets `isReq` based on `key === 'seller' || key === 'vessel'` — meaning the `required` parameter is actually ignored for required-field determination. The visual asterisk and the `isReq` logic are thus driven by two separate code paths that could diverge.

**Fix:** Unify: either drive `isReq` from the `required` parameter, or remove the parameter and keep the `key`-based check. Remove the explicit `false` in the date field call.

---

_Reviewed: 2026-04-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

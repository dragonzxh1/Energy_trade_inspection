# Phase 7: Entity Sanction Wiring & Admin Sync Fix — Pattern Map

**Mapped:** 2026-04-15
**Files analyzed:** 6 (all modified; no new files created)
**Analogs found:** 6 / 6

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/lib/types.ts` | model / type definitions | — | Self (field already added) | exact |
| `src/lib/server/repository.ts` | service / data-access | request-response | Self — existing `screenSanctions()` guard at line 848 | exact |
| `src/app/api/admin/sync/route.ts` | route / admin handler | request-response | Existing `fraud` branch in same file (lines 133–141) | exact |
| `src/app/company/[slug]/page.tsx` | component / SSR page | request-response | `src/app/vessel/[imo]/page.tsx` and `src/app/terminal/[id]/page.tsx` | exact |
| `src/app/vessel/[imo]/page.tsx` | component / SSR page | request-response | `src/app/company/[slug]/page.tsx` | exact |
| `src/app/terminal/[id]/page.tsx` | component / SSR page | request-response | `src/app/company/[slug]/page.tsx` | exact |

---

## Pattern Assignments

### `src/lib/types.ts` (model, type definitions)

**Status:** Change already applied in working tree.

**What was added** (line 48):
```typescript
// In interface BaseEntity (lines 41–55):
sanctionSources?: string[] // e.g. ['OFAC SDN', 'EU FSF'] — only present when status === 'listed'
```

**Pattern rule:** Optional fields on `BaseEntity` follow JSDoc inline comment format and use `?:` (TypeScript optional). This field sits immediately after `sanctionStatus` to visually group them. The existing `SanctionStatus` union type at line 5 was not changed.

---

### `src/lib/server/repository.ts` (service, request-response)

**Status:** Change already applied in working tree (lines 860–866).

**Analog — existing `screenSanctions()` guard** (lines 847–858, same file):
```typescript
// Pattern: conditional enrichment block — guard status, call helper, update entity
if (entity.sanctionStatus === 'unknown') {
  const status = await screenSanctions(entity.name).catch(() => 'unknown' as SanctionStatus)
  if (status !== 'unknown') {
    entity.sanctionStatus = status
    db.query(
      "UPDATE entities SET sanction_status = $1 WHERE id = $2",
      [status, entity.id]
    ).catch(console.error)
  }
}
```

**New enrichment block** (lines 860–866):
```typescript
// Fetch sanction list sources for listed entities so the UI can show tooltip details.
if (entity.sanctionStatus === 'listed') {
  const result = await checkSanctions(entity.name).catch(() => ({ listed: true, sources: [] as string[] }))
  if (result.sources.length > 0) {
    entity.sanctionSources = result.sources
  }
}
```

**Import pattern** (line 5, already present):
```typescript
import { checkSanctions } from './sync/sanctions'
```

**Key patterns to copy:**
- Guard is mutually exclusive with the `'unknown'` block above it (`if ... === 'listed'` vs `if ... === 'unknown'`)
- `.catch()` fallback is mandatory — `checkSanctions()` is a best-effort network/DB call; failure must not block the entity response
- Attach to `entity` object directly (mutation pattern, not return-new-object)
- Only attach if `result.sources.length > 0` — do not set the field to an empty array

---

### `src/app/api/admin/sync/route.ts` (route, request-response)

**Status:** Change already applied in working tree (lines 158–167).

**Analog — existing `fraud` branch** (lines 133–141, same file):
```typescript
if (source === 'fraud') {
  try {
    const results = await runSync('fraud')
    const hasError = results.some((r) => !r.success)
    return NextResponse.json({ results }, { status: hasError ? 207 : 200 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

**New `warninglists` branch** (lines 158–167):
```typescript
if (source === 'warninglists') {
  try {
    const results = await runSync('warninglists')
    const hasError = results.some((r) => !r.success)
    return NextResponse.json({ results }, { status: hasError ? 207 : 200 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

**Legacy fallback block** (lines 169–172) that the new branch must precede:
```typescript
const legacySource = (['ofac', 'all'] as SyncSource[]).includes(source as SyncSource)
  ? (source as SyncSource)
  : 'all'
```

**Key patterns:**
- `hasError ? 207 : 200` — partial success returns HTTP 207 Multi-Status, not 500
- `error instanceof Error ? error.message : String(error)` — standard error extraction used throughout this file
- New branch must be placed before the `legacySource` assignment (ordering is load-bearing)
- Auth check is already handled at the top of `POST()` via `isAuthorized()` — no per-branch auth needed

**Auth pattern** (lines 91–99, applies to the entire `POST` handler):
```typescript
export async function POST(req: NextRequest) {
  const session = await auth()
  const authResult = isAuthorized(req, session?.user?.email)
  if (!authResult.authorized) {
    const status = authResult.reason === 'no_session' ? 401 : 403
    return NextResponse.json(
      { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
      { status }
    )
  }
  // ... body parsing and dispatch ...
}
```

---

### `src/app/company/[slug]/page.tsx` (SSR page component, request-response)

**Status:** Change already applied in working tree (line 835).

**SanctionBadge call site — after change** (line 835):
```tsx
<SanctionBadge status={company.sanctionStatus} sources={company.sanctionSources} />
```

**SanctionBadge call site — before change** (what the planner should verify against):
```tsx
<SanctionBadge status={company.sanctionStatus} />
```

**Analog — `vessel/[imo]/page.tsx` SanctionBadge usage** (line 523):
```tsx
<SanctionBadge status={vessel.sanctionStatus} sources={vessel.sanctionSources} />
```

**Pattern:** `sources` prop is passed directly from `entity.sanctionSources`. No local variable needed. TypeScript accepts this because `sanctionSources` is `string[] | undefined` on `BaseEntity` and `sources` is `string[] | undefined` on `SanctionBadgeProps` — both optional, types align.

---

### `src/app/vessel/[imo]/page.tsx` (SSR page component, request-response)

**Status:** Change already applied in working tree (line 523).

**SanctionBadge call site — after change** (line 523):
```tsx
<SanctionBadge status={vessel.sanctionStatus} sources={vessel.sanctionSources} />
```

**Analog — `company/[slug]/page.tsx`** (line 835, same pattern):
```tsx
<SanctionBadge status={company.sanctionStatus} sources={company.sanctionSources} />
```

**Context** — the `<SanctionBadge>` is rendered inside `<aside>` following `<ScoreGauge>`:
```tsx
<ScoreGauge
  score={vessel.authenticityScore}
  tier={tier}
  breakdown={f3Unlocked ? vessel.scoreBreakdown : null}
  showBreakdown={f3Unlocked}
/>
<div style={{ marginTop: 'var(--space-4)' }}>
  <SanctionBadge status={vessel.sanctionStatus} sources={vessel.sanctionSources} />
</div>
```

---

### `src/app/terminal/[id]/page.tsx` (SSR page component, request-response)

**Status:** Change already applied in working tree (line 433).

**SanctionBadge call site — after change** (line 433):
```tsx
<SanctionBadge status={terminal.sanctionStatus} sources={terminal.sanctionSources} />
```

**Analog — `company/[slug]/page.tsx`** (line 835, identical structure):
```tsx
<SanctionBadge status={company.sanctionStatus} sources={company.sanctionSources} />
```

---

## Shared Patterns

### Authentication (Admin Route)

**Source:** `src/app/api/admin/sync/route.ts` lines 21–52  
**Apply to:** `route.ts` POST and GET handlers — already covers all branches including `warninglists`

```typescript
function isAuthorized(req: NextRequest, userEmail?: string | null): AuthResult {
  const adminSecret = process.env.ADMIN_SECRET ?? process.env.SYNC_SECRET
  if (adminSecret) {
    const authHeader = req.headers.get('authorization') ?? ''
    if (authHeader === `Bearer ${adminSecret}`) {
      return { authorized: true, reason: 'bearer_valid' }
    }
  }
  // No ADMIN_SECRET set — localhost bypass (dev only)
  if (!adminSecret) {
    const host = req.headers.get('host') ?? ''
    if (host.startsWith('localhost') || host.startsWith('127.')) {
      return { authorized: true, reason: 'bearer_valid' }
    }
  }
  // ... admin email check ...
}
```

### Error Handling (Admin Route)

**Source:** `src/app/api/admin/sync/route.ts` lines 84–87 and 138–141  
**Apply to:** Every `try/catch` block in route handlers

```typescript
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return NextResponse.json({ error: message }, { status: 500 })
}
```

### Conditional Entity Enrichment (Repository)

**Source:** `src/lib/server/repository.ts` lines 847–866  
**Apply to:** Any future optional field that should only be populated under a specific entity state

```typescript
// Pattern: guard on status → call helper → attach field only if result has data
if (entity.sanctionStatus === 'listed') {
  const result = await checkSanctions(entity.name).catch(() => ({ listed: true, sources: [] as string[] }))
  if (result.sources.length > 0) {
    entity.sanctionSources = result.sources
  }
}
```

### SanctionBadge Prop Pattern (SSR Pages)

**Source:** `src/app/company/[slug]/page.tsx` line 835  
**Apply to:** All three entity page `<SanctionBadge>` call sites

```tsx
// Always pass both status and sources; sources is undefined when not listed
<SanctionBadge status={entity.sanctionStatus} sources={entity.sanctionSources} />
```

The `SanctionBadge` component (lines 34–85 of `SanctionBadge.tsx`) guards internally:
```typescript
const showTooltip = status === 'listed' && sources != null && sources.length > 0
```
So passing `undefined` for non-listed entities is safe and correct.

### Partial-Success Response Pattern (Admin Route)

**Source:** `src/app/api/admin/sync/route.ts` lines 137–138  
**Apply to:** Any sync dispatch that returns `SyncResult[]`

```typescript
const hasError = results.some((r) => !r.success)
return NextResponse.json({ results }, { status: hasError ? 207 : 200 })
```

---

## Pre-existing Type Error to Address

### `src/lib/stripe.ts` — Stripe API Version Mismatch

**File:** `src/lib/stripe.ts` line 8  
**Current value:** `apiVersion: '2025-03-31.basil'`  
**TypeScript expects:** `'2026-03-25.dahlia'` (the version bundled with the installed Stripe SDK)

**Pattern to copy — from the same file (lines 7–9):**
```typescript
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-03-25.dahlia',  // update from '2025-03-31.basil'
})
```

This is a one-line housekeeping change unrelated to Phase 7's core features, but required to make `npm run type-check` exit 0 (SC-3).

---

## No Analog Found

None. All six modified files have direct analogs within the same file or in peer files.

---

## Metadata

**Analog search scope:** `src/lib/types.ts`, `src/lib/server/repository.ts`, `src/app/api/admin/sync/route.ts`, `src/app/company/[slug]/page.tsx`, `src/app/vessel/[imo]/page.tsx`, `src/app/terminal/[id]/page.tsx`, `src/components/entity/SanctionBadge.tsx`, `src/lib/server/sync/index.ts`, `src/lib/stripe.ts`  
**Files scanned:** 9  
**Pattern extraction date:** 2026-04-15

### Implementation Note

All six target files are already modified in the working tree. RESEARCH.md (sources section) confirms this via `git diff` and direct `Read` tool verification. The planner should treat Phase 7 as a **verification and commit** task, not a net-new implementation task. The plan actions should:
1. Verify each change matches the patterns documented above
2. Run `npm run type-check` — fix the Stripe version string if needed to achieve exit 0
3. Run `npm run lint`
4. Stage and commit the working-tree changes

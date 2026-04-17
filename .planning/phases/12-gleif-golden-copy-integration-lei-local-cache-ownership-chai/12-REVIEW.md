---
phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai
reviewed: 2026-04-17T05:19:38Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - db/migrations/037_lei_cache.sql
  - src/lib/server/sync/index.ts
  - package.json
  - src/lib/server/sync/gleif-golden-copy.ts
  - scripts/sync-gleif-full.mjs
  - src/lib/server/repository.ts
  - src/lib/server/gleif.ts
  - src/lib/server/scoring.ts
  - src/app/api/cron/gleif-delta/route.ts
  - src/app/api/admin/sync/route.ts
  - next.config.ts
findings:
  critical: 1
  warning: 6
  info: 3
  total: 10
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-04-17T05:19:38Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

This phase introduces the GLEIF Golden Copy local cache (`lei_cache` table), three in-process delta sync functions (Level 1, Level 2 RR, REPEX), a background full-import child process script, a cron route, and the cache-first lookup integration in `repository.ts` and `gleif.ts`. The architecture is sound and the cache-first pattern is well applied. The most serious issue is a concurrency / transaction-safety bug in the streaming sync functions. Several secondary issues relate to missing input validation, silent fallback behaviors, and duplicated code blocks in `repository.ts`.

---

## Critical Issues

### CR-01: Async callbacks inside stream events break Node.js backpressure and swallow errors

**File:** `src/lib/server/sync/gleif-golden-copy.ts:87-97` (also `scripts/sync-gleif-full.mjs:116-143`)

**Issue:** The `streamGleifRecords` helper passes an `async` function as the `'data'` event listener on the stream-json `StreamArray`. Node.js event emitters do not `await` async listeners — they fire-and-forget. This means:

1. Multiple `onRecord` (or `flushBatch`) calls can execute concurrently, violating the ordering assumption. If two records arrive before the first `await db.query(...)` resolves, `batch` is mutated by two concurrent invocations and the `ON CONFLICT` UPSERT can be issued with partially-assembled data.
2. An error thrown inside the async listener calls `reject(err)` correctly, but subsequent data events still fire (the stream is not paused/destroyed), so the promise may resolve with `count` while an error was already rejected. In Node.js the second `reject` is swallowed, but the `count` returned is unreliable.

In `sync-gleif-full.mjs` the same pattern appears with `batch.push(...)` and `await flushBatch().catch(reject)` inside a non-awaited async listener. The `flushBatch` can be called concurrently with itself.

**Fix:** Pause the stream before each async operation and resume after:

```typescript
// In streamGleifRecords, replace the async 'data' handler with a synchronous one
// that drains the stream sequentially using a queue or by pausing/resuming.
// Simplest correct approach: switch to async-iterator consumption.

async function streamGleifRecords(
  apiUrl: string,
  onRecord: (record: unknown) => Promise<void>,
): Promise<number> {
  const res = await fetch(apiUrl, { redirect: 'follow', headers: { ... } })
  if (!res.ok || !res.body) throw new Error(...)

  const nodeStream = Readable.fromWeb(res.body as ...)
  let count = 0

  await new Promise<void>((resolve, reject) => {
    nodeStream
      .pipe(unzipper.Parse())
      .on('entry', (entry) => {
        if (entry.name?.endsWith('.json') || entry.path?.endsWith('.json')) {
          const jsonStream = entry.pipe(chain([withParser()])) as NodeJS.ReadableStream
          // Pause the stream; process records one-at-a-time
          ;(async () => {
            for await (const { value } of jsonStream as AsyncIterable<{ value: unknown }>) {
              await onRecord(value)
              count++
            }
          })().then(resolve).catch(reject)
        } else {
          entry.autodrain()
        }
      })
      .on('error', reject)
  })
  return count
}
```

Alternatively, convert `stream-json` output to an async iterable and `for await` over it, which gives natural sequential processing with proper backpressure.

---

## Warnings

### WR-01: `syncLeiLevel2` and `syncLeiExceptions` issue individual UPDATE queries per record — N+1 problem at scale

**File:** `src/lib/server/sync/gleif-golden-copy.ts:267-276` and `327-334`

**Issue:** For the Level 2 RR delta and REPEX delta, each record triggers one `UPDATE` query against `lei_cache`. At delta sizes of thousands of records, this is thousands of individual round-trips per sync run. While the batch-commit-every-10K logic reduces WAL pressure, the underlying query count is still O(n). Unlike the Level 1 delta, no batch UPSERT is used.

Additionally, because the critical async-in-data-event bug (CR-01) applies here too, these individual UPDATEs are issued concurrently in practice, which can cause row-lock contention.

**Fix:** Accumulate records in an in-memory map and flush with a single multi-row `UPDATE ... FROM (VALUES ...) AS v(...)` per batch, the same pattern used by the Level 1 delta flush. Example for Level 2:

```typescript
// Collect (childLei, parentLei, relType) tuples
// Then bulk update:
const directUpdates = batch.filter(r => r.relType === 'IS_DIRECTLY_CONSOLIDATED_BY')
if (directUpdates.length > 0) {
  const values = directUpdates.map((_, i) => `($${i*2+1}, $${i*2+2})`).join(',')
  await client.query(
    `UPDATE lei_cache SET direct_parent_lei = v.parent_lei, last_synced_at = NOW()
     FROM (VALUES ${values}) AS v(child_lei, parent_lei)
     WHERE lei_cache.lei = v.child_lei`,
    directUpdates.flatMap(r => [r.childLei, r.parentLei])
  )
}
```

### WR-02: `gleif:full` source is registered in the admin sync POST handler but NOT in `runSync` / `SyncSource` — silent routing gap

**File:** `src/app/api/admin/sync/route.ts:133-151` and `src/lib/server/sync/index.ts:13-21`

**Issue:** The POST handler at `route.ts:133` has a dedicated `if (source === 'gleif:full')` branch that spawns the child process directly. However, `SyncSource` in `sync/index.ts` does not include `'gleif:full'` as a union member, and `runSync()` has no handler for it. If any other code path calls `runSync('gleif:full' as SyncSource)`, it will return an empty results array silently — no error, no sync performed. The type gap means TypeScript does not catch this mismatch.

**Fix:** Add `'gleif:full'` to the `SyncSource` union and add an explicit handler in `runSync`:

```typescript
export type SyncSource =
  | 'ofac'
  | 'fraud'
  | 'legitdomains'
  | 'warninglists'
  | 'gleif'
  | 'gleif:full'   // <-- add this
  | 'gleif:delta'
  | 'gleif:level2'
  | 'gleif:exceptions'
  | 'all'
```

### WR-03: Cron route runs all three delta syncs in parallel despite documented sequential dependency

**File:** `src/app/api/cron/gleif-delta/route.ts:41-51`

**Issue:** The comment at line 40 states _"Run all three delta syncs sequentially (RR and REPEX depend on lei_cache rows from delta)"_ but the implementation immediately uses `Promise.allSettled(...)`, which runs all three concurrently. If `syncLeiDelta()` is still inserting new LEI rows while `syncLeiLevel2()` is attempting to `UPDATE lei_cache ... WHERE lei = $1`, the Level 2 UPDATE for newly-inserted LEIs may silently update 0 rows (the row does not yet exist at the time the UPDATE fires).

**Fix:** Run sequentially as the comment intends:

```typescript
const deltaResult    = await syncLeiDelta().then(v => ({ status: 'fulfilled' as const, value: v })).catch(r => ({ status: 'rejected' as const, reason: r }))
const level2Result   = await syncLeiLevel2().then(v => ({ status: 'fulfilled' as const, value: v })).catch(r => ({ status: 'rejected' as const, reason: r }))
const exceptionsResult = await syncLeiExceptions().then(v => ({ status: 'fulfilled' as const, value: v })).catch(r => ({ status: 'rejected' as const, reason: r }))
```

Or simply use the `Promise.allSettled` shape but run sequentially by awaiting each:

```typescript
const deltaResult = await Promise.allSettled([syncLeiDelta()])
await Promise.allSettled([syncLeiLevel2()])
await Promise.allSettled([syncLeiExceptions()])
```

### WR-04: Massive code duplication for the `lei-{lei}` and `gleif:{lei}` cache-hit/miss paths

**File:** `src/lib/server/repository.ts:906-1043`

**Issue:** The logic for `lei-{lei}` (lines 906–973) and `gleif:{lei}` (lines 975–1043) is functionally identical: both resolve to a `GleifLeiRecord`, call `resolveGleifRecord`, apply the opacity exception risk flag, and apply the score deduction. The two blocks are copy-pasted with only the string prefix extraction differing (`slice(4)` vs `slice(6)` and `.toUpperCase()` vs not). Any bug fixed in one block (including CR-01-adjacent stream issues) must be fixed in both.

**Fix:** Extract a helper function:

```typescript
async function resolveGleifByLei(lei: string): Promise<Company | null> {
  const normalizedLei = lei.toUpperCase()
  const cachedLei = await getLeiCacheRecord(normalizedLei)
  if (cachedLei) {
    // ... cache-hit path
  } else {
    // ... cache-miss path
  }
}
```

Then call it from both branches:
```typescript
if (idOrSlugOrImo.startsWith('lei-')) return resolveGleifByLei(idOrSlugOrImo.slice(4))
if (idOrSlugOrImo.startsWith('gleif:')) return resolveGleifByLei(idOrSlugOrImo.slice(6))
```

### WR-05: `ADMIN_SECRET` absence check produces an incorrect localhost bypass in production if `ADMIN_SECRET` is intentionally unset

**File:** `src/app/api/admin/sync/route.ts:31-36`

**Issue:** The `isAuthorized` function grants access to any request coming from `localhost` or `127.*` when `ADMIN_SECRET` is not set. The module-level warn fires once at startup, but if a process restart in production loses the env var (e.g., deployment oversight), the sync endpoint becomes accessible to anyone on the same host — including other co-located services or compromised processes. A warning log is not a defense.

**Fix:** The localhost bypass should be hard-disabled in production regardless of env var state:

```typescript
// No ADMIN_SECRET — localhost bypass (ONLY in non-production)
if (!adminSecret && process.env.NODE_ENV !== 'production') {
  const host = req.headers.get('host') ?? ''
  if (host.startsWith('localhost') || host.startsWith('127.')) {
    return { authorized: true, reason: 'bearer_valid' }
  }
}
```

### WR-06: `lei_cache` similarity search in `searchEntities` uses raw user input `query` (not normalized) for the trigram search

**File:** `src/lib/server/repository.ts:469-476`

**Issue:** The trigram search against `lei_cache.legal_name` passes the raw `query` string directly to the SQL parameter, while all other searches in the same function use the `normalized` variable (which has legal suffixes stripped). This inconsistency means a search for "Acme Corp Ltd" will not match "Acme Corp" in `lei_cache` with the same recall as it would match the local `entities` table. It also means that any characters in `query` that affect pg_trgm scoring (e.g., leading/trailing spaces, punctuation) are passed through unfiltered.

**Fix:** Use the already-computed `normalized` variable:

```typescript
const { rows } = await db.query<LeiCacheRow>(
  `SELECT * FROM lei_cache
   WHERE SIMILARITY(legal_name, $1) > 0.45
     AND entity_status = 'ACTIVE'
   ORDER BY SIMILARITY(legal_name, $1) DESC
   LIMIT 5`,
  [normalized],  // was: [query]
)
```

---

## Info

### IN-01: `DB_URL` fallback in `sync-gleif-full.mjs` hard-codes dev credentials

**File:** `scripts/sync-gleif-full.mjs:29`

**Issue:** The fallback `'postgresql://eti:eti_password@127.0.0.1:5432/energy_trade_inspection'` is used when `DATABASE_URL` is not set. The `syncLeiFull()` caller in `gleif-golden-copy.ts` explicitly passes `DATABASE_URL: process.env.DATABASE_URL` in the child process env, so the fallback should never be needed in practice. But if the env var is unexpectedly absent in production (deployment error), the script silently connects to a different database rather than failing fast.

**Fix:** Fail immediately if `DATABASE_URL` is not set:

```javascript
const DB_URL = process.env.DATABASE_URL
if (!DB_URL) {
  console.error('[gleif:full] DATABASE_URL is not set — aborting.')
  process.exit(1)
}
```

### IN-02: Duplicate `OPACITY_EXCEPTION_TYPES` set defined in both `gleif.ts` and `repository.ts`

**File:** `src/lib/server/gleif.ts:191` and `src/lib/server/repository.ts:685`

**Issue:** The constant `OPACITY_EXCEPTION_TYPES = new Set(['NON_CONSOLIDATING', 'NON_PUBLIC', 'NO_LEI'])` is defined identically in both files. If the set is ever updated (e.g., a new GLEIF exception type is added), both copies must be changed. The set should be exported from one canonical location.

**Fix:** Export from `gleif.ts` and import in `repository.ts`:

```typescript
// gleif.ts
export const OPACITY_EXCEPTION_TYPES = new Set(['NON_CONSOLIDATING', 'NON_PUBLIC', 'NO_LEI'])

// repository.ts
import { OPACITY_EXCEPTION_TYPES } from './gleif'
```

### IN-03: Orphaned `stream-json` import — `chain` is imported but `withParser` usage is inconsistent

**File:** `src/lib/server/sync/gleif-golden-copy.ts:14-15`

**Issue:** The import `import { chain } from 'stream-chain'` and `import { withParser } from 'stream-json/streamers/stream-array.js'` produce a pipeline `chain([withParser()])`. `withParser` from `stream-array` emits `{ key, value }` pairs representing array elements, which is correct. However, the `chain(...)` wrapper around a single transform is redundant — `withParser()` returns a transform stream directly. The `chain` import would be needed only for a multi-step pipeline. This is minor dead code.

**Fix:** Remove the `chain` wrapper and use `withParser()` directly:

```typescript
import { withParser } from 'stream-json/streamers/stream-array.js'
// Remove: import { chain } from 'stream-chain'

// In streamGleifRecords:
const jsonStream = (entry as unknown as NodeJS.ReadableStream).pipe(withParser())
```

---

_Reviewed: 2026-04-17T05:19:38Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

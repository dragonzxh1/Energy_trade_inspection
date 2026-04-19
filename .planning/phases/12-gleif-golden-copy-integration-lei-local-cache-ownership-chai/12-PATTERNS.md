# Phase 12: GLEIF Golden Copy Integration — Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 8 new/modified files
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `db/migrations/037_lei_cache.sql` | migration | batch | `db/migrations/011_ports_psc_icij.sql` | exact |
| `src/lib/server/sync/gleif-golden-copy.ts` | service | streaming + batch | `src/lib/server/sync/ofac.ts` + `scripts/sync-opensanctions.mjs` | role-match |
| `scripts/sync-gleif-full.mjs` | utility (child process script) | streaming + batch | `scripts/sync-opensanctions.mjs` | exact |
| `src/lib/server/sync/index.ts` | config | request-response | self (add to existing `SyncSource` union) | modify |
| `src/app/api/cron/gleif-delta/route.ts` | controller | request-response | `src/app/api/cron/cleanup/route.ts` | exact |
| `src/app/api/admin/sync/route.ts` | controller | request-response | self (add `gleif:*` dispatch block) | modify |
| `src/lib/server/repository.ts` | service | CRUD + request-response | self (`resolveGleifRecord`, `searchEntities` GLEIF path) | modify |
| `src/lib/server/scoring.ts` | service | transform | self (`scoreCompany` communityReputation block) | modify |

---

## Pattern Assignments

### `db/migrations/037_lei_cache.sql` (migration)

**Analog:** `db/migrations/011_ports_psc_icij.sql`

**Table + index creation pattern** (lines 52–78 of 011):
```sql
CREATE TABLE IF NOT EXISTS icij_entities (
  node_id             TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  dataset             TEXT NOT NULL,
  ...
  synced_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_icij_name_trgm ON icij_entities
  USING GIN (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_icij_dataset   ON icij_entities (dataset);
CREATE INDEX IF NOT EXISTS idx_icij_linked    ON icij_entities (linked_entity_id)
  WHERE linked_entity_id IS NOT NULL;
```

**Apply to `037_lei_cache.sql`:** Use `IF NOT EXISTS` guards on all DDL. Add `gin_trgm_ops` index on `legal_name` (not lowered — GLEIF names are mixed case), B-tree on `registration_authority_entity_id` and `jurisdiction`. The schema is fully specified in CONTEXT.md D-01 — copy it verbatim, then add indexes matching the `icij_entities` pattern.

**Note on `pg_trgm`:** Extension already present from migration 010/011 — use `CREATE EXTENSION IF NOT EXISTS pg_trgm` defensively.

---

### `src/lib/server/sync/gleif-golden-copy.ts` (service, streaming + batch)

**Analog:** `src/lib/server/sync/ofac.ts`

**Imports pattern** (ofac.ts lines 1–9):
```typescript
import { XMLParser } from 'fast-xml-parser'
import { db } from '@/lib/server/db'
import { normalizeEntityName } from '@/lib/server/normalize'
```

For `gleif-golden-copy.ts`, replace with:
```typescript
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import unzipper from 'unzipper'
import { withParser } from 'stream-json/streamers/StreamArray'
import { chain } from 'stream-chain'
import { db } from '@/lib/server/db'
```

**Sync function shell + sync log pattern** (ofac.ts lines 64–190):
```typescript
export async function syncOFAC(): Promise<{ count: number }> {
  const startMs = Date.now()

  // ... fetch + parse ...

  const client = await db.connect()
  let upsertCount = 0

  try {
    await client.query('BEGIN')
    // ... batch upsert ...

    await client.query(
      `INSERT INTO sanctions_sync_log (source, status, record_count, duration_ms)
       VALUES ('ofac', 'success', $1, $2)`,
      [upsertCount, Date.now() - startMs]
    )

    await client.query('COMMIT')
    return { count: upsertCount }
  } catch (error) {
    await client.query('ROLLBACK')
    await db.query(
      `INSERT INTO sanctions_sync_log (source, status, error_message, duration_ms)
       VALUES ('ofac', 'error', $1, $2)`,
      [String(error), Date.now() - startMs]
    )
    throw error
  } finally {
    client.release()
  }
}
```

**Batch accumulator + flushBatch pattern** (ofac.ts lines 104–134):
```typescript
const BATCH_SIZE = 500
let batch: unknown[][] = []

async function flushBatch() {
  if (batch.length === 0) return

  const placeholders = batch
    .map((_, i) => {
      const base = i * 8
      return `($${base + 1},$${base + 2},...)`
    })
    .join(',')

  await client.query(
    `INSERT INTO sanctions_entries (...) VALUES ${placeholders}
     ON CONFLICT (id) DO UPDATE SET
       entity_name = EXCLUDED.entity_name,
       last_updated = NOW()`,
    batch.flat()
  )
  upsertCount += batch.length
  batch = []
}

// In processing loop:
if (batch.length >= BATCH_SIZE) {
  await flushBatch()
}
await flushBatch() // flush remainder
```

**Apply to `gleif-golden-copy.ts`:** Use BATCH_SIZE = 1000 (per D-03). The UPSERT targets `lei_cache` with `ON CONFLICT (lei) DO UPDATE`. For `syncLeiFull()` and `syncLeiDelta()`, use the batch pattern. For `syncLeiLevel2()` and `syncLeiExceptions()`, use targeted UPDATE (not full upsert) — only touch `direct_parent_lei`/`ultimate_parent_lei` and `reporting_exception_type`/`reporting_exception_reason` respectively.

**Progress logging pattern** (from sync-opensanctions.mjs lines 75–78):
```javascript
if (received - lastReport >= 10_000_000) {
  process.stdout.write(`\r  已下载 ${(received / 1_000_000).toFixed(0)} MB...`)
  lastReport = received
}
```

Adapt: log every 100K records processed (per D-03): `if (count % 100_000 === 0) console.log(`[gleif] processed ${count.toLocaleString()} records...`)`

**CRITICAL — Transaction commit per batch** (per RESEARCH.md Pitfall 6): Unlike OFAC (which wraps everything in one transaction for ~15K rows), GLEIF full import processes ~2.3M rows. Commit every 10K records (10 × 1000-row batches) by releasing and re-acquiring a client per commit interval. Do NOT use a single long-running transaction.

---

### `scripts/sync-gleif-full.mjs` (child process script, streaming + batch)

**Analog:** `scripts/sync-opensanctions.mjs`

**Script header + pg Pool setup** (sync-opensanctions.mjs lines 1–43):
```javascript
#!/usr/bin/env node
/**
 * sync-gleif-full.mjs
 * ...
 */
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const { Pool } = pg
const DB_URL = process.env.DATABASE_URL ?? 'postgresql://eti:eti_password@127.0.0.1:5432/energy_trade_inspection'
const pool = new Pool({ connectionString: DB_URL, max: 3 })
```

**Error + sync log pattern** (sync-opensanctions.mjs lines 317–333):
```javascript
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  const durationMs = Date.now() - startMs
  await client.query(`
    INSERT INTO sanctions_sync_log (source, status, error_message, duration_ms)
    VALUES ('opensanctions', 'error', $1, $2)
  `, [String(err.message), durationMs]).catch(() => {})
  console.error('[sync] 同步失败:', err.message)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}
```

**Apply:** Replace `'opensanctions'` with `'gleif:full'`. The `run()` pattern (lines 167+) is the structural template. Replace CSV COPY strategy with streaming ZIP/JSON using `unzipper` + `stream-json`. Use `process.exit(1)` on failure to signal to parent process. Report progress every 100K records to stdout.

---

### `src/lib/server/sync/index.ts` (config, modify existing)

**Analog:** Self — modify existing file.

**Current `SyncSource` type** (index.ts line 11):
```typescript
export type SyncSource = 'ofac' | 'fraud' | 'legitdomains' | 'warninglists' | 'all'
```

**Extend to:**
```typescript
export type SyncSource =
  | 'ofac'
  | 'fraud'
  | 'legitdomains'
  | 'warninglists'
  | 'gleif'
  | 'gleif:full'
  | 'gleif:delta'
  | 'gleif:level2'
  | 'gleif:exceptions'
  | 'all'
```

**Dispatch block pattern** (index.ts lines 24–42, the `if (source === 'ofac' || source === 'all')` block):
```typescript
if (source === 'ofac' || source === 'all') {
  const start = Date.now()
  try {
    const { count } = await syncOFAC()
    results.push({ source: 'ofac', success: true, count, durationMs: Date.now() - start })
  } catch (err) {
    results.push({ source: 'ofac', success: false, error: String(err), durationMs: Date.now() - start })
  }
}
```

**Apply:** Add analogous blocks for `'gleif:delta'`, `'gleif:level2'`, `'gleif:exceptions'`. `'gleif:full'` is NOT dispatched via `runSync()` — it spawns a child process from `admin/sync/route.ts` directly. Import the three delta functions from `./gleif-golden-copy`.

---

### `src/app/api/cron/gleif-delta/route.ts` (controller, request-response)

**Analog:** `src/app/api/cron/cleanup/route.ts` — exact copy of structure.

**Full auth + GET handler pattern** (cleanup/route.ts lines 15–60):
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET ?? process.env.SYNC_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  // ... do work ...

  return NextResponse.json({ ok: true, ... })
}
```

**Apply to `gleif-delta/route.ts`:** Copy `isAuthorized()` verbatim. Replace cleanup DB queries with calls to `syncLeiDelta()`, `syncLeiLevel2()`, `syncLeiExceptions()` (imported from `@/lib/server/sync/gleif-golden-copy`). Return `{ ok: true, counts: { delta, level2, exceptions }, durationMs }`. Do NOT import `db` directly — the sync functions manage their own connections.

---

### `src/app/api/admin/sync/route.ts` (controller, modify existing)

**Analog:** Self — add one new dispatch block.

**Existing child process spawn pattern** (admin/sync/route.ts lines 111–130):
```typescript
if (source === 'opensanctions') {
  const scriptPath = path.join(process.cwd(), 'scripts', 'sync-opensanctions.mjs')
  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL,
      FORCE_SYNC: force ? '1' : '0',
    },
  })
  child.unref()

  return NextResponse.json({
    success: true,
    source: 'opensanctions',
    pid: child.pid,
    message: 'OpenSanctions sync started in the background. Check GET /api/admin/sync for progress.',
  })
}
```

**Apply:** Add an analogous block for `source === 'gleif:full'` — spawn `scripts/sync-gleif-full.mjs`. For `source === 'gleif:delta'` | `'gleif:level2'` | `'gleif:exceptions'`, call `runSync(source as SyncSource)` in-process (these are small: 3–58 MB). No `force` flag needed for GLEIF (GLEIF delta is always applied).

---

### `src/lib/server/repository.ts` — `resolveGleifRecord` (service, modify)

**Analog:** Self — insert cache-first lookup before existing live API call.

**Existing `resolveGleifRecord` function signature** (repository.ts lines 617–713):
```typescript
async function resolveGleifRecord(
  record: Awaited<ReturnType<typeof getGleifRecordByLei>>
): Promise<Company | null> {
  if (!record) return null

  const raId  = record.registrationAuthorityId?.toUpperCase()
  const regNum = record.registrationAuthorityEntityId

  // Route to Companies House
  if (raId === RA_COMPANIES_HOUSE && regNum) { ... }
  // Route to ACRA
  if (raId === RA_ACRA && regNum) { ... }
  // Route to Zefix
  if (raId === RA_ZEFIX && regNum) { ... }
  // Fallback: OpenCorporates → buildGleifCompany
  ...
}
```

**Cache-first read pattern** (from `intelligence-cache.ts` lines 12–26):
```typescript
export async function readIntelligenceCache(
  entityType: EntityType,
  entityKey: string,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await db.query<{ data_json: Record<string, unknown> }>(
      `SELECT data_json FROM intelligence_cache
       WHERE entity_type = $1 AND entity_key = $2 AND expires_at > NOW()`,
      [entityType, entityKey],
    )
    return result.rows[0]?.data_json ?? null
  } catch {
    return null
  }
}
```

**Apply to `repository.ts`:** Add two new internal helpers:

```typescript
// Insert near the top of repository.ts, after existing imports
async function getLeiCacheRecord(lei: string): Promise<LeiCacheRow | null> {
  try {
    const { rows } = await db.query<LeiCacheRow>(
      `SELECT * FROM lei_cache WHERE lei = $1 LIMIT 1`,
      [lei]
    )
    return rows[0] ?? null
  } catch {
    return null
  }
}

async function writeLeiCacheRecord(record: GleifLeiRecord): Promise<void> {
  try {
    await db.query(
      `INSERT INTO lei_cache (lei, legal_name, jurisdiction, country,
         registration_authority_id, registration_authority_entity_id,
         initial_registration_date, entity_status, last_synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',NOW())
       ON CONFLICT (lei) DO UPDATE SET
         legal_name = EXCLUDED.legal_name,
         jurisdiction = EXCLUDED.jurisdiction,
         last_synced_at = NOW()`,
      [record.lei, record.legalName, record.jurisdiction, record.country,
       record.registrationAuthorityId, record.registrationAuthorityEntityId,
       record.initialRegistrationDate]
    )
  } catch (err) {
    console.error('[lei-cache] write failed:', err)
  }
}
```

For the call site in `getEntityByKey` (where `getGleifRecordByLei` is called): check `lei_cache` by LEI before the live API. For `searchEntities` GLEIF path (lines 463–518): add a `lei_cache` similarity query before the `searchGleifMultiple()` call, using `SIMILARITY(legal_name, $1) > 0.45 AND entity_status = 'ACTIVE' LIMIT 5`.

**UPSERT write-back pattern** (from intelligence-cache.ts lines 29–47):
```typescript
await db.query(
  `INSERT INTO intelligence_cache (...) VALUES ($1, $2, $3, NOW(), NOW() + INTERVAL '${TTL_HOURS} hours')
   ON CONFLICT (entity_type, entity_key)
   DO UPDATE SET data_json = EXCLUDED.data_json, fetched_at = NOW(), expires_at = ...`,
  [entityType, entityKey, JSON.stringify(data)],
)
```

---

### `src/lib/server/scoring.ts` — `scoreCompany` + `ScoringInputs` (service, modify)

**Analog:** Self — minimal surgical addition to `ScoringInputs` interface and `scoreCompany`.

**Current `ScoringInputs` interface** (scoring.ts lines 31–47):
```typescript
export interface ScoringInputs {
  entityType:         'company' | 'vessel' | 'terminal'
  sanctionStatus:     'not_listed' | 'listed' | 'unknown'
  fraudAlertCount?:   number
  whitelisted?:       boolean
  country:            string
  registrationNumber: string | null
  imo?:               string | null
  aisData?:           VesselAisData | null
  intelligence?:      IntelligenceSnapshot | null
  domainAgeDays?: number | null
  hasWebPresence?: boolean | null
}
```

**Current `scoreCompany` communityReputation block** (scoring.ts lines 162–174):
```typescript
// Community Reputation (max 10)
const sanctionHits = intelligence?.sanctions_hits?.length ?? 0
const fraudHits    = fraudAlertCount ?? 0
if (fraudHits > 0) {
  C = 0
} else {
  C += sanctionHits === 0 ? 6 : 0
  C += riskHits === 0 ? 4 : 2
  if (whitelisted) C = Math.min(10, C + 2)
}
```

**Apply:** Add `reportingExceptionFlag?: boolean` to `ScoringInputs`. In `scoreCompany`, after the `if (whitelisted)` line, add:
```typescript
// GLEIF Reporting Exception: opacity-indicating types reduce trust signal
if (inputs.reportingExceptionFlag) {
  C = Math.max(0, C - 3)
}
```

The deduction applies AFTER the whitelisted bonus, using `Math.max(0, ...)` to prevent going below 0. The `clamp()` call on line 179 already prevents exceeding 10.

---

## Shared Patterns

### Sync Log (Write to `sanctions_sync_log`)
**Source:** `src/lib/server/sync/ofac.ts` lines 169–173
**Apply to:** `gleif-golden-copy.ts` (all four sync functions), `scripts/sync-gleif-full.mjs`
```typescript
await client.query(
  `INSERT INTO sanctions_sync_log (source, status, record_count, duration_ms)
   VALUES ($1, 'success', $2, $3)`,
  ['gleif:delta', recordCount, Date.now() - startMs]
)
```
Error case writes `status='error', error_message=$1` (no `record_count`).

### Cron Bearer Auth
**Source:** `src/app/api/cron/cleanup/route.ts` lines 22–27
**Apply to:** `src/app/api/cron/gleif-delta/route.ts`
```typescript
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET ?? process.env.SYNC_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}
```

### Admin Dual Auth (Bearer + session email)
**Source:** `src/app/api/admin/sync/route.ts` lines 21–52
**Apply to:** `src/app/api/admin/sync/route.ts` (already present — the `gleif:full` and `gleif:delta` dispatch blocks reuse the existing `authResult` check already at the top of `GET` and `POST`).

### UPSERT ON CONFLICT Pattern
**Source:** `src/lib/server/intelligence-cache.ts` lines 34–44
**Apply to:** `writeLeiCacheRecord()` helper in `repository.ts`, all batch upserts in `gleif-golden-copy.ts`
```typescript
`INSERT INTO ... VALUES (...)
 ON CONFLICT (key_column) DO UPDATE SET
   col1 = EXCLUDED.col1,
   last_synced_at = NOW()`
```

### Child Process Spawn (for long-running sync)
**Source:** `src/app/api/admin/sync/route.ts` lines 112–129
**Apply to:** New `'gleif:full'` dispatch block in same file
```typescript
const scriptPath = path.join(process.cwd(), 'scripts', 'sync-gleif-full.mjs')
const child = spawn(process.execPath, [scriptPath], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
})
child.unref()
return NextResponse.json({ success: true, pid: child.pid, message: '...' })
```

### GLEIF `parseRecord` Field Mapping (Live API Shape)
**Source:** `src/lib/server/gleif.ts` lines 44–71
```typescript
function parseRecord(record: any): GleifLeiRecord | null {
  if (!record?.id || !record?.attributes) return null
  const { entity, registration } = record.attributes
  const jur = entity?.jurisdiction ?? null
  return {
    lei:                           record.id as string,
    legalName:                     entity?.legalName?.name ?? '',
    jurisdiction:                  jur ? jur.slice(0, 2).toUpperCase() : null,
    country:                       entity?.legalAddress?.country ?? null,
    initialRegistrationDate:       registration?.initialRegistrationDate ?? null,
    registrationAuthorityId:       entity?.registeredAt?.id ?? null,
    registrationAuthorityEntityId: regAs != null ? String(regAs) : null,
  }
}
```
The Golden Copy JSON uses the same field names but wraps all text values in `{ "$": "value" }`. Write a `val()` helper (`const val = (x: any) => x?.['$'] ?? null`) and adapt field paths from the live API shape to Golden Copy shape per RESEARCH.md Pattern 3.

### `RiskFlag` Construction
**Source:** `src/lib/types.ts` lines 32–38
```typescript
export interface RiskFlag {
  id: string
  category: string
  severity: RiskLevel
  submittedAt: string // ISO 8601
  status: 'pending' | 'verified'
}
```
The `reporting_exception` flag has no `description` field in the current type. Per RESEARCH.md open question 1: rely on `category: 'reporting_exception'` for rendering; do not add a `description` field yet (that would require a type change — leave for a follow-up). Construct as:
```typescript
const exceptionFlag: RiskFlag = {
  id: `gleif-exception-${exceptionType.toLowerCase()}`,
  category: 'reporting_exception',
  severity: 'medium',
  status: 'verified',
  submittedAt: new Date().toISOString(),
}
```

---

## No Analog Found

All files have a close analog. No entries in this section.

---

## Implementation Notes for Planner

### Prerequisite: npm install
Before any implementation begins:
```bash
npm install unzipper stream-json
npm install --save-dev @types/unzipper
```
`@types/stream-json` does not exist — use `// @ts-expect-error` or write minimal type declarations inline.

### GLEIF API URL Correction
CONTEXT.md references v1 URLs (`?type=LEI2&extension=JSON`). RESEARCH.md verified (2026-04-17) the live API is now v2 with direct 302 redirect — no manifest JSON step:
- Full: `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/latest.json`
- Delta: `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/latest.json?delta=LastDay`
- RR:   `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/rr/latest.json`
- REPEX:`https://goldencopy.gleif.org/api/v2/golden-copies/publishes/repex/latest.json`

### Reporting Exception Injection Point
CONTEXT.md mentions `intelligence.ts` as the integration point, but `src/lib/server/intelligence.ts` is a Python CLI wrapper — not the correct location. The exception flag is injected in `buildGleifCompany()` (in `gleif.ts`) and/or in the `resolveGleifRecord()` fallback path in `repository.ts`, by checking `lei_cache.reporting_exception_type` after the cache read.

### `LeiCacheRow` TypeScript Interface
Define in `gleif-golden-copy.ts` or a shared types file:
```typescript
interface LeiCacheRow {
  lei: string
  legal_name: string
  jurisdiction: string | null
  country: string | null
  registration_authority_id: string | null
  registration_authority_entity_id: string | null
  initial_registration_date: string | null
  entity_status: string
  entity_category: string | null
  direct_parent_lei: string | null
  ultimate_parent_lei: string | null
  reporting_exception_type: string | null
  reporting_exception_reason: string | null
  last_synced_at: string
  created_at: string
}
```

---

## Metadata

**Analog search scope:** `src/lib/server/sync/`, `src/app/api/cron/`, `src/app/api/admin/sync/`, `src/lib/server/`, `db/migrations/`, `scripts/`
**Files scanned:** 12
**Pattern extraction date:** 2026-04-17

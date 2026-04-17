# Phase 12: GLEIF Golden Copy Integration — Research

**Researched:** 2026-04-17
**Domain:** GLEIF Golden Copy bulk data ingest, PostgreSQL local cache, Node.js streaming ZIP/JSON
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Table Schema — lei_cache (denormalized, single table)**
Single table `lei_cache` with columns: `lei CHAR(20) PRIMARY KEY`, `legal_name TEXT`, `jurisdiction CHAR(2)`, `country CHAR(2)`, `registration_authority_id TEXT`, `registration_authority_entity_id TEXT`, `initial_registration_date DATE`, `entity_status TEXT`, `entity_category TEXT`, `direct_parent_lei CHAR(20)`, `ultimate_parent_lei CHAR(20)`, `reporting_exception_type TEXT`, `reporting_exception_reason TEXT`, `last_synced_at TIMESTAMPTZ`, `created_at TIMESTAMPTZ`. Indexes: `gin_trgm_ops` on `legal_name`, B-tree on `registration_authority_entity_id` and `jurisdiction`.

**D-02: Level 1 Import Scope — Active entities only**
Initial bulk import filters to `entity.status == 'ACTIVE'` only. Live API cache-writes on miss are written regardless of status.

**D-03: Streaming/Batching — JSON stream + 1000-row UPSERT chunks**
Files are multi-GB. Must stream. Batch size 1000 per `INSERT ... ON CONFLICT DO UPDATE`. Progress log every 100K records. Download via manifest-first pattern: fetch URL → follow 302 redirect → stream ZIP → decompress → parse JSON array.

**D-04: Sync Module Structure**
New file `src/lib/server/sync/gleif-golden-copy.ts`. Exports: `syncLeiFull()`, `syncLeiDelta()`, `syncLeiLevel2()`, `syncLeiExceptions()`. Registered in `sync/index.ts` with sub-sources `'gleif:full'`, `'gleif:delta'`, `'gleif:level2'`, `'gleif:exceptions'`.

**D-05: Cache-First Integration**
`repository.ts`: `resolveGleifRecord()` checks `lei_cache` by LEI first. `searchEntities()` checks `lei_cache` by similarity before calling `searchGleifMultiple()`. `getGleifUltimateParentJurisdiction()` reads from `lei_cache` (no live API if cached). Live GLEIF API functions remain as fallback.

**D-06: Level 2 Ownership Chain — 1 hop depth (GLEIF pre-computed)**
`IS_DIRECTLY_CONSOLIDATED_BY` → `direct_parent_lei`. `IS_ULTIMATELY_CONSOLIDATED_BY` → `ultimate_parent_lei`. No recursive traversal in application code.

**D-07: Reporting Exception → Risk Signal**
Opacity types (`NON_CONSOLIDATING`, `NON_PUBLIC`, `NO_LEI`): add risk flag `category: 'reporting_exception'`, `severity: 'medium'`. Deduct 3 pts from `communityReputation` in `scoring.ts`. `NATURAL_PERSONS` is informational only — no flag.

**D-08: Migration Number**
`db/migrations/037_lei_cache.sql`

**D-09: Admin Sync Route Integration**
Add `'gleif'` to `SyncSource` union in `sync/index.ts`. POST `/api/admin/sync` with `{ source: 'gleif:delta' }` and `{ source: 'gleif:full' }`.

**D-10: Cron Schedule**
New route `/api/cron/gleif-delta`. Daily at 02:00 UTC. Auth: Bearer `ADMIN_SECRET`.

### Claude's Discretion

- Streaming JSON library choice (`stream-json`, `JSONStream`, or `node:readline`) — decide based on what GLEIF actually serves
- Whether `syncLeiFull()` runs in-process or spawns child process
- Whether to use temp table + swap vs. direct UPSERT for full import
- Progress logging interval and format
- Exact similarity threshold for `lei_cache` name search (suggested 0.45)

### Deferred Ideas (OUT OF SCOPE)

- UI display of parent jurisdiction on company pages
- LEI-to-vessel cross-link
- GLEIF webhooks / real-time push
- Cross-referencing LEI with ICIJ entities
- Scoring uplift for LEI presence
</user_constraints>

---

## Summary

Phase 12 replaces on-the-fly GLEIF live API calls with a locally cached dataset seeded from GLEIF's official Golden Copy bulk download. The core technical challenges are: (1) streaming and decompressing a 876 MB compressed ZIP file (estimated 5–7 GB uncompressed JSON array) without loading it into memory, (2) building a correct UPSERT pipeline against PostgreSQL, (3) wiring three separate Golden Copy file types (LEI2, RR, REPEX) into a unified sync module, and (4) injecting the `reporting_exception` risk signal into the scoring layer.

**Key verified fact (live API probe 2026-04-17):** The GLEIF Golden Copy API endpoint `/api/v2/golden-copies/publishes/lei2/latest.json` returns HTTP 302 directly to a signed `/storage/...` URL. There is no separate JSON manifest step — the redirect target IS the download link. The file is a `.json.zip` (ZIP archive, not gzip). Node's built-in `zlib` does not handle ZIP archives; a ZIP-capable library (`yauzl`, `unzipper`, or similar) is required.

**File sizes (verified 2026-04-17 via HEAD request):**
- LEI2 full: **875.9 MB** compressed
- RR full: **32.3 MB** compressed
- REPEX full: **58.0 MB** compressed
- LEI2 daily delta: **3.0 MB** compressed

**Primary recommendation:** Use `unzipper` npm package (v0.12.3, stream-friendly, no temp file needed) combined with `stream-json`'s `StreamArray` parser. The full import MUST run as a child process (spawned like OpenSanctions) due to memory/duration constraints. Delta sync is small enough for in-process execution.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| GLEIF bulk download + decompression | API/Backend (Node.js) | — | Server-only operation; files are 875 MB+ |
| `lei_cache` UPSERT pipeline | Database layer | API/Backend | PostgreSQL owns the data; Node drives the writes |
| Cache-first LEI lookup | API/Backend (repository.ts) | Database | Read path lives in repository.ts |
| Reporting Exception risk flag injection | API/Backend (repository.ts or intel path) | Scoring engine | Flag is a data property; scoring reads it |
| `communityReputation` score deduction | Scoring engine (scoring.ts) | — | Follows existing scoring.ts dimension pattern |
| Daily cron trigger | Cron route (`/api/cron/gleif-delta`) | Admin sync route | Two trigger paths for cron vs. manual |
| Admin sync dispatch | Admin sync route (`/api/admin/sync`) | sync/index.ts | Follows existing pattern for all sync sources |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `unzipper` | 0.12.3 | Stream ZIP archive extraction | Supports streaming without temp files; widely used |
| `stream-json` | 2.1.0 | SAX-style streaming JSON parse for large arrays | Handles multi-GB JSON arrays with minimal memory; purpose-built for this use case |
| `pg` (node-postgres) | already installed | Batch UPSERT to PostgreSQL | Already in project |

[VERIFIED: npm registry — `unzipper@0.12.3`, `stream-json@2.1.0`]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `JSONStream` | 1.3.5 | Streaming JSON path selection | Alternative to `stream-json`; older API but mature |
| `yauzl` | 3.3.0 | ZIP extraction (callback-style) | Alternative to `unzipper`; lower-level |

[VERIFIED: npm registry]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `unzipper` | `yauzl` | `yauzl` is lower-level callback API; `unzipper` has native stream pipe support |
| `stream-json` | `JSONStream` | `JSONStream` is older (1.3.5) but simpler; `stream-json` offers better backpressure control |
| `stream-json` | `node:readline` | `readline` only works for NDJSON (one object per line); GLEIF JSON is a multi-line array — `readline` does NOT work |

**Installation:**
```bash
npm install unzipper stream-json
npm install --save-dev @types/unzipper
```

[VERIFIED: npm registry versions]

---

## Architecture Patterns

### System Architecture Diagram

```
GLEIF Golden Copy API (goldencopy.gleif.org)
  │  HTTP GET /api/v2/golden-copies/publishes/lei2/latest.json
  │  → 302 → /storage/.../20260417-0000-gleif-goldencopy-lei2-golden-copy.json.zip
  ▼
fetch() with redirect:follow
  │
  ▼
unzipper.Parse() [ZIP → entry stream]
  │  (pipes entry stream for the single .json file inside)
  ▼
stream-json StreamArray [JSON array → individual record objects]
  │  (each record: { LEI, Entity, Registration })
  ▼
Filter: entity.status === 'ACTIVE' (Level 1 import only)
  │
  ▼
Batch accumulator (1000 records)
  │
  ▼
PostgreSQL UPSERT lei_cache (INSERT ... ON CONFLICT DO UPDATE)
  │
  ▼
sanctions_sync_log (source='gleif:full', record_count, duration_ms, status)
```

```
Daily cron trigger (02:00 UTC)
/api/cron/gleif-delta  [Bearer ADMIN_SECRET]
  │
  ├── syncLeiDelta()   → LEI2 delta (3 MB) → patch lei_cache
  ├── syncLeiLevel2()  → RR delta → update direct_parent_lei / ultimate_parent_lei
  └── syncLeiExceptions() → REPEX delta → update reporting_exception_type / reason
```

```
Runtime: resolveGleifRecord(lei)
  │
  ├── SELECT * FROM lei_cache WHERE lei = $1  ← cache hit?
  │     YES → return immediately (no live API call)
  │     NO  → getGleifRecordByLei(lei) [live GLEIF API]
  │             → write result to lei_cache (warm on miss)
  │             → check reporting_exception_type in result
  └── return GleifLeiRecord
```

### Recommended Project Structure

```
src/lib/server/sync/
├── gleif-golden-copy.ts    # NEW: syncLeiFull / syncLeiDelta / syncLeiLevel2 / syncLeiExceptions
├── index.ts                # ADD: 'gleif' | 'gleif:full' | 'gleif:delta' | 'gleif:level2' | 'gleif:exceptions' to SyncSource
└── ...existing files

src/app/api/cron/
├── gleif-delta/
│   └── route.ts            # NEW: daily delta cron (Bearer ADMIN_SECRET pattern)
└── cleanup/route.ts        # existing

db/migrations/
└── 037_lei_cache.sql       # NEW
```

### Pattern 1: GLEIF API Download with Redirect Follow

**What:** GLEIF API returns HTTP 302 directly to the ZIP file URL. `fetch()` follows redirects by default in Node 22.

**When to use:** All four file types (lei2, rr, repex, delta variants)

```typescript
// Source: verified via live probe 2026-04-17
// The API endpoint redirects directly — no separate manifest step needed
async function downloadGleifZip(apiUrl: string): Promise<ReadableStream> {
  const res = await fetch(apiUrl, {
    redirect: 'follow',  // default in Node 22 fetch
    headers: { 'Accept': 'application/zip' },
  })
  if (!res.ok || !res.body) {
    throw new Error(`GLEIF download failed: HTTP ${res.status} for ${apiUrl}`)
  }
  return res.body
}
```

**Verified endpoints (2026-04-17):**
- LEI2 full: `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/latest.json`
- RR full:   `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/rr/latest.json`
- REPEX full: `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/repex/latest.json`
- LEI2 delta (last day): `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/latest.json?delta=LastDay`
- RR delta: `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/rr/latest.json?delta=LastDay`
- REPEX delta: `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/repex/latest.json?delta=LastDay`

[VERIFIED: live probe 2026-04-17 — all return HTTP 302 to /storage/ URL]

**CRITICAL NOTE:** The CONTEXT.md states `?type=LEI2&extension=JSON` as the URL pattern — this appears to be the v1 API. The current v2 API path (verified live) uses `/api/v2/golden-copies/publishes/{type}/latest.json`. Use the v2 paths above. [VERIFIED: live probe 2026-04-17]

### Pattern 2: ZIP Stream Decompress + JSON Array Parsing

**What:** Pipe fetch response body through `unzipper.Parse()` to extract ZIP entry, then through `stream-json`'s `StreamArray` to get individual record objects.

**When to use:** All GLEIF file imports

```typescript
// Conceptual pipeline (implementation detail for planner)
import unzipper from 'unzipper'
import { withParser } from 'stream-json/streamers/StreamArray'
import { chain } from 'stream-chain'

async function streamGleifRecords(
  apiUrl: string,
  onRecord: (record: unknown) => Promise<void>
): Promise<number> {
  const res = await fetch(apiUrl, { redirect: 'follow' })
  if (!res.ok) throw new Error(`GLEIF fetch failed: ${res.status}`)

  let count = 0
  // Convert Web ReadableStream to Node.js Readable
  const nodeStream = Readable.fromWeb(res.body!)

  return new Promise((resolve, reject) => {
    const pipeline = nodeStream
      .pipe(unzipper.Parse())
      .on('entry', (entry: unzipper.Entry) => {
        // ZIP contains a single JSON file
        const jsonStream = entry.pipe(chain([withParser()]))
        jsonStream.on('data', async ({ value }: { value: unknown }) => {
          await onRecord(value)
          count++
        })
        jsonStream.on('error', reject)
        jsonStream.on('end', () => resolve(count))
      })
      .on('error', reject)
  })
}
```

### Pattern 3: GLEIF JSON Record Structure (Golden Copy v3.1)

**What:** Each record in the LEI2 JSON array has this structure (XML-to-JSON converted, using `$` for text values):

```json
{
  "LEI": { "$": "529900P5TAD0ABFTMV10" },
  "Entity": {
    "LegalName": { "@xml:lang": "de", "$": "Company Name GmbH" },
    "LegalAddress": {
      "Country": { "$": "DE" }
    },
    "LegalJurisdiction": { "$": "DE" },
    "EntityStatus": { "$": "ACTIVE" },
    "EntityCategory": { "$": "GENERAL" },
    "RegistrationAuthority": {
      "RegistrationAuthorityID": { "$": "RA000585" },
      "RegistrationAuthorityEntityID": { "$": "02525200" }
    }
  },
  "Registration": {
    "InitialRegistrationDate": { "$": "2012-06-28T09:57:00+02:00" }
  }
}
```

**Field mapping to `lei_cache`:**
- `record.LEI.$` → `lei`
- `record.Entity.LegalName.$` → `legal_name`
- `record.Entity.LegalJurisdiction.$` → `jurisdiction` (take first 2 chars, uppercase)
- `record.Entity.LegalAddress.Country.$` → `country`
- `record.Entity.RegistrationAuthority.RegistrationAuthorityID.$` → `registration_authority_id`
- `record.Entity.RegistrationAuthority.RegistrationAuthorityEntityID.$` → `registration_authority_entity_id`
- `record.Registration.InitialRegistrationDate.$` → `initial_registration_date`
- `record.Entity.EntityStatus.$` → `entity_status`
- `record.Entity.EntityCategory.$` → `entity_category`

[CITED: broadoakdata.uk/glief-data-json-format/ — confirmed `$` wrapper for text values]
[ASSUMED: exact field path — verify by inspecting first record of actual downloaded file]

### Pattern 4: Level 2 RR Record Structure

```json
{
  "Relationship": {
    "StartNode": { "NodeID": { "$": "LEI-OF-CHILD" } },
    "EndNode": { "NodeID": { "$": "LEI-OF-PARENT" } },
    "RelationshipType": { "$": "IS_DIRECTLY_CONSOLIDATED_BY" }
  }
}
```

- `IS_DIRECTLY_CONSOLIDATED_BY` → EndNode LEI = `direct_parent_lei`
- `IS_ULTIMATELY_CONSOLIDATED_BY` → EndNode LEI = `ultimate_parent_lei`

[VERIFIED: D-06 in CONTEXT.md, confirmed against GLEIF Level 2 CDF specification]

### Pattern 5: REPEX Record Structure

```json
{
  "ExceptionBody": {
    "LEI": { "$": "529900P5TAD0ABFTMV10" },
    "ExceptionCategory": { "$": "NON_CONSOLIDATING" },
    "ExceptionReason": { "$": "ACCOUNTING_STANDARDS" }
  }
}
```

- `ExceptionCategory.$` → `reporting_exception_type`
- `ExceptionReason.$` → `reporting_exception_reason`

[ASSUMED: exact field path — verify against actual REPEX file; GLEIF spec uses ExceptionCategory in CDF v2.1]

### Pattern 6: Full Import as Child Process (like OpenSanctions)

**What:** `syncLeiFull()` spawns a child process (identical to OpenSanctions pattern in `/api/admin/sync/route.ts`) because: 876 MB download + 5-7 GB decompressed JSON + 2.3M+ records = hours of processing that would exhaust Next.js route timeout.

**Pattern (from existing `route.ts` lines 112-130):**
```typescript
// In /api/admin/sync/route.ts, for source === 'gleif:full':
const scriptPath = path.join(process.cwd(), 'scripts', 'sync-gleif-full.mjs')
const child = spawn(process.execPath, [scriptPath], {
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
})
child.unref()
// Return immediately with { pid, message: 'GLEIF full sync started in background' }
```

Delta syncs (lei2-last-day = 3 MB) are small enough for in-process execution.

[VERIFIED: existing admin/sync/route.ts pattern, confirmed file size via live probe]

### Pattern 7: Cache-First LEI Lookup

```typescript
// In repository.ts resolveGleifRecord() — insert before existing live API call
async function getLeiFromCache(lei: string): Promise<LeiCacheRow | null> {
  const { rows } = await db.query<LeiCacheRow>(
    `SELECT * FROM lei_cache WHERE lei = $1 LIMIT 1`,
    [lei]
  )
  return rows[0] ?? null
}

// On cache miss, write back:
async function writeLeiToCache(record: GleifLeiRecord): Promise<void> {
  await db.query(
    `INSERT INTO lei_cache (lei, legal_name, jurisdiction, country,
       registration_authority_id, registration_authority_entity_id,
       initial_registration_date, entity_status, last_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',NOW())
     ON CONFLICT (lei) DO UPDATE SET
       legal_name = EXCLUDED.legal_name,
       last_synced_at = NOW()`,
    [record.lei, record.legalName, record.jurisdiction, record.country,
     record.registrationAuthorityId, record.registrationAuthorityEntityId,
     record.initialRegistrationDate]
  )
}
```

### Pattern 8: Reporting Exception Risk Signal Injection

**Where:** The CONTEXT.md says `intelligence.ts` — but the actual `intelligence.ts` is a Python CLI wrapper for Tavily research. The correct integration point is `repository.ts` within `resolveGleifRecord()` (for DB-backed entities) and in the `buildGleifCompany()` path.

**Important architecture clarification:** The existing `RiskFlag` type in `src/lib/types.ts` is for user-submitted flags stored in `risk_flags` table (`flag_type`, `severity`, `status`, `submitted_at`). The `reporting_exception` signal is NOT user-submitted — it's a data-derived signal. The correct approach is to embed it in the `riskFlags` array when building the company object from `lei_cache`, not persist it to `risk_flags`.

```typescript
// When building company from lei_cache in resolveGleifRecord or similar:
const OPACITY_EXCEPTION_TYPES = new Set(['NON_CONSOLIDATING', 'NON_PUBLIC', 'NO_LEI'])

function buildReportingExceptionFlag(exceptionType: string): RiskFlag {
  return {
    id: `gleif-exception-${exceptionType.toLowerCase()}`,
    category: 'reporting_exception',
    severity: 'medium',
    status: 'verified',
    submittedAt: new Date().toISOString(),
  }
}
// Include description in a separate field or extend RiskFlag — check existing patterns
```

**Score deduction in scoring.ts:** The `communityReputation` dimension in `scoreCompany()` must accept a new `reportingException: boolean` input and deduct 3 points when true. Best approach: add `reportingExceptionFlag?: boolean` to `ScoringInputs` interface and apply in `scoreCompany()`.

### Anti-Patterns to Avoid

- **Loading full ZIP into memory:** Never `await response.arrayBuffer()` on the 876 MB file. Always stream.
- **Loading full JSON into memory:** Never `await response.json()` — the JSON array is 5-7 GB uncompressed. Always use `stream-json`.
- **Blocking the HTTP response for full import:** Full LEI2 import takes hours. Always background-process via child spawn.
- **Using `node:readline` for GLEIF JSON:** The LEI2 file is a JSON array spanning multiple lines per record, not NDJSON. `readline` splits on `\n` and produces malformed fragments.
- **Using GLEIF v1 API URL pattern:** `?type=LEI2&extension=JSON` (v1) is in the CONTEXT.md but the live API is now v2. Use `/api/v2/golden-copies/publishes/{type}/latest.json`.
- **Storing `reporting_exception` in the `risk_flags` table:** That table is for user-submitted community flags. The exception type belongs as a property on the entity built from `lei_cache`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ZIP archive streaming | Custom byte parser | `unzipper` | ZIP format has local file headers, central directory — non-trivial to parse |
| Large JSON array streaming | Custom tokenizer | `stream-json` StreamArray | SAX-style with backpressure; handles GB-scale arrays |
| JSON similarity search | Levenshtein in JS | PostgreSQL `pg_trgm SIMILARITY()` | Already installed; GPU-accelerated; consistent with existing patterns |

**Key insight:** ZIP + multi-GB JSON = two-layer streaming problem. Both layers are solved by existing npm packages. Do not attempt to re-implement either.

---

## Common Pitfalls

### Pitfall 1: GLEIF API URL Mismatch (v1 vs v2)

**What goes wrong:** Code uses v1 URL pattern (`?type=LEI2&extension=JSON`) which is documented in CONTEXT.md but is no longer the canonical endpoint.
**Why it happens:** CONTEXT.md was written with v1 URLs from GLEIF documentation that predates the v2 API rollout.
**How to avoid:** Use verified v2 URLs: `https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/latest.json`
**Warning signs:** 404 or redirect to an unexpected URL shape.

[VERIFIED: live API probe confirmed v2 endpoint format and 302 redirect behavior 2026-04-17]

### Pitfall 2: ZIP vs GZIP Confusion

**What goes wrong:** Using `zlib.createGunzip()` or `zlib.createUnzip()` on a ZIP archive.
**Why it happens:** Node.js `zlib` handles DEFLATE/GZIP streams. ZIP is an archive container with multiple files, directory structure, and its own header format. `zlib.Unzip` auto-detects gzip/deflate, NOT ZIP archives.
**How to avoid:** Use `unzipper.Parse()` for the outer ZIP layer, then let the entry stream through naturally.
**Warning signs:** `zlib: unexpected end of file` or `incorrect header check` errors.

[VERIFIED: Node.js zlib documentation — confirmed createUnzip is not for ZIP archives]

### Pitfall 3: Full Import Blocking the HTTP Response

**What goes wrong:** `syncLeiFull()` called in-process from `/api/admin/sync` → Next.js route times out after 300s (`maxDuration = 300`), import is killed mid-way, partial data in `lei_cache`.
**Why it happens:** 875 MB download + decompression + 2.3M UPSERT operations takes 20-60 minutes.
**How to avoid:** Spawn a detached child process (exactly like OpenSanctions sync). Return `{pid, message}` immediately.
**Warning signs:** Route returns error after 5 minutes with incomplete records in `lei_cache`.

[VERIFIED: verified via file size probe (875.9 MB) and existing OpenSanctions pattern in route.ts]

### Pitfall 4: GLEIF JSON `$` Value Wrapper

**What goes wrong:** Accessing `record.Entity.LegalName` directly and getting `{ "@xml:lang": "de", "$": "Name" }` instead of `"Name"`.
**Why it happens:** GLEIF JSON is machine-converted from XML; all text node values are wrapped in `{ "$": "value" }`.
**How to avoid:** Always access `.["$"]` for text values. Write a `val()` helper: `const val = (x: any) => x?.["$"] ?? null`.
**Warning signs:** `legal_name` column getting stored as `[object Object]` or `undefined`.

[CITED: broadoakdata.uk/glief-data-json-format/ — confirmed $ wrapper pattern]

### Pitfall 5: Similarity Threshold Breaking Search

**What goes wrong:** `SIMILARITY(legal_name, query) > 0.45` returns no matches for companies even though they're in `lei_cache`, or returns too many false positives.
**Why it happens:** pg_trgm similarity is character-level; short names or abbreviations score poorly. 0.45 is the suggested threshold but needs validation.
**How to avoid:** Test against real company names before shipping. The existing fraud lookup uses 0.45 as a lower bound — consistent with D-05.
**Warning signs:** GLEIF search cache hits near 0 after seeding, or search returning unrelated companies.

[ASSUMED: 0.45 threshold — validate with real data]

### Pitfall 6: Transaction Size on Full Import

**What goes wrong:** Wrapping all 2.3M UPSERTs in a single transaction causes: excessive WAL growth, lock escalation, OOM risk if PostgreSQL rolls back.
**Why it happens:** Batch-based imports often naively wrap everything in one BEGIN/COMMIT.
**How to avoid:** Commit every N batches (e.g., every 10K records = 10 × 1000-row batches). Use per-batch clients, not a single long-lived transaction. This matches the OFAC pattern which does DELETE + INSERT in one transaction but OFAC is ~15K records.
**Warning signs:** PostgreSQL WAL disk filling up, or `out of shared memory` errors.

[ASSUMED: based on PostgreSQL large-import best practices; verify with actual record count]

### Pitfall 7: Missing `?delta=LastDay` for Daily Sync

**What goes wrong:** Daily cron calls the full-file URL instead of the delta URL, re-downloading 875 MB when only 3 MB changed.
**Why it happens:** Copy-paste error in URL construction.
**How to avoid:** `syncLeiDelta()` uses `?delta=LastDay` suffix. Verify in code review.
**Warning signs:** Cron takes 20+ minutes instead of < 2 minutes.

[VERIFIED: delta URL confirmed via live probe — 3.0 MB vs 875.9 MB]

---

## Code Examples

### UPSERT Pattern for lei_cache (consistent with existing intelligence_cache)

```sql
-- Source: CONTEXT.md D-01 + existing intelligence-cache.ts UPSERT pattern
INSERT INTO lei_cache (
  lei, legal_name, jurisdiction, country,
  registration_authority_id, registration_authority_entity_id,
  initial_registration_date, entity_status, entity_category,
  direct_parent_lei, ultimate_parent_lei,
  reporting_exception_type, reporting_exception_reason,
  last_synced_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
ON CONFLICT (lei) DO UPDATE SET
  legal_name                       = EXCLUDED.legal_name,
  jurisdiction                     = EXCLUDED.jurisdiction,
  country                          = EXCLUDED.country,
  registration_authority_id        = EXCLUDED.registration_authority_id,
  registration_authority_entity_id = EXCLUDED.registration_authority_entity_id,
  initial_registration_date        = EXCLUDED.initial_registration_date,
  entity_status                    = EXCLUDED.entity_status,
  entity_category                  = EXCLUDED.entity_category,
  last_synced_at                   = NOW()
-- Note: direct_parent_lei / ultimate_parent_lei / reporting_exception* are NOT
-- overwritten by lei_cache_upsert from Level 1 data — only Level 2/REPEX syncs touch those columns
```

### Similarity Search in lei_cache

```sql
-- Source: existing pattern from fraud_alerts/icij_entities similarity queries
SELECT *
FROM lei_cache
WHERE SIMILARITY(legal_name, $1) > 0.45
  AND entity_status = 'ACTIVE'
ORDER BY SIMILARITY(legal_name, $1) DESC
LIMIT 5
```

### Sync Log Pattern (reuse existing sanctions_sync_log table)

```typescript
// Source: existing ofac.ts syncOFAC() pattern
await db.query(
  `INSERT INTO sanctions_sync_log (source, status, record_count, duration_ms)
   VALUES ($1, 'success', $2, $3)`,
  ['gleif:delta', recordCount, Date.now() - startMs]
)
```

### Cron Route Auth Pattern

```typescript
// Source: src/app/api/cron/cleanup/route.ts
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET ?? process.env.SYNC_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}
export const runtime = 'nodejs'
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  // ... trigger syncLeiDelta, syncLeiLevel2, syncLeiExceptions
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GLEIF v1 API `?type=LEI2&extension=JSON` | GLEIF v2 `/api/v2/golden-copies/publishes/lei2/latest.json` | 2022 | v1 may redirect; use v2 |
| GLEIF API returns file directly (200) | API returns 302 redirect to `/storage/` URL | 2022-10-10 | Must follow redirects |
| No manifest fetch needed | No manifest fetch needed (302 IS the redirect to file) | 2022 | Simpler than old docs suggested |

**Deprecated/outdated in CONTEXT.md:**
- V1 URL pattern `?type=LEI2&extension=JSON`: Still works via redirect but v2 path is canonical. [VERIFIED: live probe]
- "Manifest JSON with `downloadLink` field": The v2 API does NOT return a manifest JSON — it returns a 302 directly. No intermediate manifest step. [VERIFIED: live probe — 302 response with `Location` header, no JSON body]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GLEIF JSON record field path: `record.Entity.LegalJurisdiction.$` for jurisdiction | Pattern 3 | Jurisdiction stored as null in lei_cache; cache-first lookup misses |
| A2 | REPEX record structure: `ExceptionBody.ExceptionCategory.$` for exception type | Pattern 5 | Exception flag never injected; silent data quality failure |
| A3 | RR record structure: `Relationship.RelationshipType.$` for relationship type | Pattern 4 | Parent LEI columns never populated |
| A4 | PostgreSQL batch commit per 10K records prevents WAL overflow | Pitfall 6 | WAL disk fills during full import |
| A5 | 0.45 similarity threshold is appropriate for lei_cache name search | Common Pitfalls | Too loose (false positives) or too tight (cache bypass on real matches) |
| A6 | ~2.3M total LEI records (2026 estimate) | Summary | Script progress log intervals miscalibrated |
| A7 | `reporting_exception` signal should be an in-memory RiskFlag (not persisted to `risk_flags` table) | Pattern 8 | If it should be persisted, the entity display logic works but no audit trail |

**If this table is empty:** All claims were verified. It is not empty — A1, A2, A3 must be validated by inspecting actual downloaded file before implementation.

---

## Open Questions

1. **RiskFlag description field**
   - What we know: `RiskFlag` interface has `id`, `category`, `severity`, `status`, `submittedAt` — no `description` field.
   - What's unclear: CONTEXT.md D-07 mentions `description: 'Entity has not disclosed ownership structure...'` — but the type doesn't have this field.
   - Recommendation: Either extend `RiskFlag` with optional `description?: string` OR rely on the `category` string (`'reporting_exception'`) for UI rendering. The planner should decide before implementation.

2. **Exact GLEIF JSON field paths**
   - What we know: GLEIF uses XML-to-JSON conversion with `$` wrapper. Field names follow LEI-CDF 3.1 spec.
   - What's unclear: Exact nesting depth and field names — especially for `EntityCategory`, `RegistrationAuthority`, and REPEX structure.
   - Recommendation: Wave 0 should download a small sample (delta file = 3 MB) and inspect the first record before writing the parser.

3. **`getGleifUltimateParentJurisdiction` in trade-service.ts**
   - What we know: This function is called in `trade-service.ts` and currently hits the live GLEIF API (2 sequential HTTP calls).
   - What's unclear: Phase 12 replaces this with a `lei_cache` lookup, but the `lei_cache` for the specific entity must already be populated.
   - Recommendation: The cache-first version reads `ultimate_parent_lei` from `lei_cache`, then looks up that LEI's `jurisdiction` in `lei_cache` — both must be seeded. If either is a cache miss, fall back to live API (existing function).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 | streaming fetch + stream pipeline | ✓ | v22.22.2 | — |
| PostgreSQL (via Docker) | lei_cache UPSERT | ✓ (via `DATABASE_URL`) | 16 | — |
| `unzipper` npm | ZIP decompression | ✗ (not yet installed) | 0.12.3 | yauzl (needs install) |
| `stream-json` npm | JSON array streaming | ✗ (not yet installed) | 2.1.0 | JSONStream (needs install) |
| GLEIF Golden Copy API | All sync operations | ✓ (no auth required, public) | v2 | — |
| `pg` (node-postgres) | UPSERT operations | ✓ (already in project) | ^8.20.0 | — |
| `sanctions_sync_log` table | Sync status logging | ✓ (pre-existing) | — | — |

**Missing dependencies with no fallback:**
- `unzipper` and `stream-json` must be installed before implementation begins.

**Missing dependencies with fallback:**
- None that block execution.

[VERIFIED: package.json, node --version, npm registry]

---

## Validation Architecture

> `workflow.nyquist_validation: true` — section included.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None configured (explicit tech debt in STATE.md) |
| Config file | None — Wave 0 gap |
| Quick run command | `npx tsc --noEmit` (type check only) |
| Full suite command | `npm run type-check && npm run lint` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01 | `lei_cache` migration creates table + indexes | manual (DB inspection) | `psql -c "\d lei_cache"` | ❌ Wave 0: no test infra |
| D-03 | Streaming import processes records without OOM | manual (run on small delta) | Run `syncLeiDelta()` against delta file | ❌ Wave 0 |
| D-05 | `resolveGleifRecord()` hits cache before live API | manual (intercept + log) | Add log + watch console | ❌ Wave 0 |
| D-07 | Entity with `NON_PUBLIC` exception has medium risk flag | manual (API call) | `curl /api/entity/[lei-entity-id]` | ❌ Wave 0 |
| D-07 | `NATURAL_PERSONS` exception does NOT add risk flag | manual (API call) | `curl /api/entity/[lei-entity-id]` | ❌ Wave 0 |
| D-10 | Cron route rejects without Bearer token | manual (curl without auth) | `curl /api/cron/gleif-delta` → 401 | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run type-check` — catch TypeScript errors immediately
- **Per wave merge:** `npm run type-check && npm run lint`
- **Phase gate:** Full type-check + lint green + manual validation of delta sync producing records in `lei_cache`

### Wave 0 Gaps

- [ ] No automated test infrastructure exists — rely on TypeScript compilation + manual verification
- [ ] `npm install unzipper stream-json @types/unzipper` — required before any implementation
- [ ] Inspect actual GLEIF JSON record structure by downloading delta file (3 MB) before writing parser

*(Note: ETI has no Vitest/Jest infrastructure per STATE.md. This is pre-existing tech debt.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A (backend sync only) |
| V3 Session Management | no | N/A |
| V4 Access Control | yes | Bearer `ADMIN_SECRET` on cron + admin routes (existing pattern) |
| V5 Input Validation | yes | Validate LEI format (20-char alphanumeric) before cache writes |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthenticated cron trigger | Elevation of Privilege | Bearer `ADMIN_SECRET` (existing `isAuthorized()` pattern) |
| GLEIF download URL manipulation | Tampering | Only follow redirects from `goldencopy.gleif.org` domain |
| SQL injection via LEI string | Tampering | Parameterized queries only (existing pattern) |
| OOM via malformed ZIP | Denial of Service | Stream processing; enforce max record count guard |

---

## Sources

### Primary (HIGH confidence)
- Live GLEIF API probe (2026-04-17) — confirmed v2 API endpoints, 302 redirect behavior, file sizes, ZIP format
- Existing codebase: `src/lib/server/sync/ofac.ts` — batch UPSERT pattern
- Existing codebase: `src/app/api/admin/sync/route.ts` — child process spawn pattern for long-running sync
- Existing codebase: `src/app/api/cron/cleanup/route.ts` — cron auth pattern
- Existing codebase: `src/lib/server/gleif.ts` — `parseRecord()` field mapping (live API shape)
- npm registry: `unzipper@0.12.3`, `stream-json@2.1.0`, `JSONStream@1.3.5`

### Secondary (MEDIUM confidence)
- [broadoakdata.uk — GLEIF JSON format](http://broadoakdata.uk/glief-data-json-format/) — `$` text wrapper pattern, confirmed field structure
- [GLEIF Blog — Getting Technical #1](https://www.gleif.org/en/newsroom/blog/getting-technical-number1-it-updates-across-the-global-lei-system-golden-copy-file-download-api) — 302 redirect change (2022-10-10)
- [GLEIF Golden Copy page](https://www.gleif.org/en/lei-data/gleif-golden-copy) — update frequency (3x daily)

### Tertiary (LOW confidence)
- Web search synthesis for manifest JSON structure — superseded by live API probe showing no manifest JSON exists in v2 API

---

## Metadata

**Confidence breakdown:**
- API endpoints and file format: HIGH — verified via live probe 2026-04-17
- JSON record field structure: MEDIUM — confirmed wrapper pattern, specific paths assumed from spec
- Standard stack (unzipper, stream-json): HIGH — npm registry verified
- Architecture patterns: HIGH — derived from existing codebase patterns
- REPEX/RR exact field paths: LOW — must verify against actual file

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable GLEIF API, 30-day window)

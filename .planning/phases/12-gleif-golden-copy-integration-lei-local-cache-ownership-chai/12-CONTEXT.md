# Phase 12: GLEIF Golden Copy Integration — Context

**Gathered:** 2026-04-17
**Status:** Ready for planning
**Mode:** Auto (all decisions self-selected)

<domain>
## Phase Boundary

Phase 12 replaces the current on-the-fly GLEIF live API calls with a locally cached dataset seeded from GLEIF's official Golden Copy bulk download. It delivers:

1. **Level 1 local cache** (`lei_cache` table): seeded from GLEIF Golden Copy Level 1 JSON — active entities only (~1–1.5M records), streamed and batch-upserted. Future reads check `lei_cache` first before calling the live GLEIF API.
2. **Daily delta sync**: A cron/admin-triggered sync downloads the GLEIF daily delta file and applies incremental updates to `lei_cache`. Triggered via `/api/admin/sync` with source `'gleif'`.
3. **Level 2 ownership chain** (`direct_parent_lei` + `ultimate_parent_lei` columns on `lei_cache`): seeded from the GLEIF Level 2 RR (Reporting Relationships) Golden Copy file. Resolves to the immediate parent LEI and the ultimate parent LEI. Used to surface parent jurisdiction on company pages.
4. **Reporting Exceptions risk signal**: GLEIF EX (Exceptions) file loaded into `lei_cache.reporting_exception_type`. Entities that decline to report their parent ownership are flagged with a new `reporting_exception` risk flag in the intelligence/scoring layer.

Phase 12 does NOT cover: real-time LEI webhooks, cross-linking LEI to vessels, UI changes to company pages beyond the risk flag badge (purely backend/data layer). Any UI display of parent jurisdiction belongs to a subsequent phase.

</domain>

<decisions>
## Implementation Decisions

### D-01: Table Schema — lei_cache (denormalized, single table)

Use a **single denormalized table** `lei_cache` with these columns:

```sql
CREATE TABLE lei_cache (
  lei                              CHAR(20) PRIMARY KEY,
  legal_name                       TEXT NOT NULL,
  jurisdiction                     CHAR(2),         -- ISO 3166-1 alpha-2
  country                          CHAR(2),         -- from legalAddress.country
  registration_authority_id        TEXT,            -- e.g. "RA000585"
  registration_authority_entity_id TEXT,            -- e.g. "02525200"
  initial_registration_date        DATE,
  entity_status                    TEXT,            -- 'ACTIVE', 'INACTIVE', 'ANNULLED', 'LAPSED'
  entity_category                  TEXT,            -- 'GENERAL', 'SOLE_PROPRIETOR', 'FUND', etc.
  direct_parent_lei                CHAR(20),        -- from Level 2 RR (null if not reported)
  ultimate_parent_lei              CHAR(20),        -- from Level 2 RR (null if not reported)
  reporting_exception_type         TEXT,            -- from EX file: 'NO_LEI', 'NON_CONSOLIDATING', 'NATURAL_PERSONS', 'NON_PUBLIC'
  reporting_exception_reason       TEXT,
  last_synced_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX lei_cache_legal_name_trgm ON lei_cache USING gin(legal_name gin_trgm_ops);
CREATE INDEX lei_cache_registration_authority_entity_id ON lei_cache(registration_authority_entity_id);
CREATE INDEX lei_cache_jurisdiction ON lei_cache(jurisdiction);
```

Rationale: Denormalized matches the `intelligence_cache` table pattern. No JOIN complexity for the primary use case (jurisdiction lookup by LEI or by company name).

### D-02: Level 1 Import Scope — Active entities only

The initial import filters to **`entity.status == 'ACTIVE'`** entities only. Inactive, annulled, and lapsed records (~30–40% of the full Level 1 file) are excluded to keep the table lean. If a live API lookup returns an inactive entity, it is written to `lei_cache` normally (the filter applies only to bulk import, not cache writes from live lookups).

### D-03: Streaming/Batching — JSON stream + 1000-row UPSERT chunks

The Golden Copy JSON files are multi-GB. The import script must **stream** the JSON (e.g., using `JSONStream` or `node:stream` with a custom line-splitter for NDJSON, or `clarinet` for nested JSON). Batch size: **1000 records per `INSERT ... ON CONFLICT DO UPDATE`**. Progress logged every 100K records.

Download URLs (GLEIF Golden Copy REST API):
- Level 1 (all LEI records): `https://goldencopy.gleif.org/api/v1/golden-copy-files/latest?type=LEI2&extension=JSON`
- Level 2 RR (ownership relationships): `https://goldencopy.gleif.org/api/v1/golden-copy-files/latest?type=RR&extension=JSON`
- EX (reporting exceptions): `https://goldencopy.gleif.org/api/v1/golden-copy-files/latest?type=EX&extension=JSON`

The Golden Copy API returns a manifest JSON with a `downloadLink` field — the script fetches the manifest first, then streams from `downloadLink`.

### D-04: Sync Module Structure

New file: `src/lib/server/sync/gleif-golden-copy.ts`

Exports:
- `syncLeiFull()` — Level 1 full import (one-time seed or weekly refresh)
- `syncLeiDelta()` — Level 1 daily delta (uses `?type=LEI2-DELTA&extension=JSON`)
- `syncLeiLevel2()` — Level 2 RR import (update `direct_parent_lei` + `ultimate_parent_lei`)
- `syncLeiExceptions()` — EX import (update `reporting_exception_type` + reason)

All four are registered in `src/lib/server/sync/index.ts` as source `'gleif'` with sub-sources `'gleif:full'`, `'gleif:delta'`, `'gleif:level2'`, `'gleif:exceptions'`. The admin sync route exposes these.

### D-05: Cache-First Integration with Existing GLEIF API Calls

The existing live GLEIF API functions (`searchGleifByName`, `getGleifRecordByLei`, `getGleifUltimateParentJurisdiction`) in `gleif.ts` are **NOT removed** — they remain as the live-API fallback path.

`repository.ts` is updated:
- `resolveGleifRecord()`: Check `lei_cache` by LEI first → hit returns immediately. Cache miss → call live API → write result to `lei_cache` (warm on miss).
- `searchEntities()` GLEIF path: Check `lei_cache` by `SIMILARITY(legal_name, query) > 0.45` first → if ≥ 1 result, skip live API. Cache miss → call `searchGleifMultiple()` → write results to `lei_cache`.
- `getGleifUltimateParentJurisdiction()`: Read `ultimate_parent_lei` from `lei_cache`, then lookup that LEI's jurisdiction in `lei_cache`. No live API calls if both are cached.

### D-06: Level 2 Ownership Chain — 1 hop depth (GLEIF pre-computed)

GLEIF Level 2 already provides **direct parent** and **ultimate parent** as separate relationship types in the RR file. Do not implement recursive traversal in application code — GLEIF has already computed the chain.

Import strategy:
- For each RR record: if `Relationship.RelationshipType == 'IS_DIRECTLY_CONSOLIDATED_BY'` → set `direct_parent_lei`
- If `Relationship.RelationshipType == 'IS_ULTIMATELY_CONSOLIDATED_BY'` → set `ultimate_parent_lei`
- Null values indicate the entity did not file Level 2 data (covered by Reporting Exceptions)

### D-07: Reporting Exception → Risk Signal in Intelligence Layer

When `lei_cache.reporting_exception_type` is non-null and is one of the **opacity-indicating** types (`'NON_CONSOLIDATING'`, `'NON_PUBLIC'`, `'NO_LEI'`), add a risk flag to the entity's risk profile.

Integration point: `src/lib/server/intelligence.ts` — when resolving a company's intelligence snapshot and a LEI is found in `lei_cache`, check `reporting_exception_type`. If opacity type:
- Add risk flag with `category: 'reporting_exception'`, `severity: 'medium'`, `description: 'Entity has not disclosed ownership structure to GLEIF (Reporting Exception: {type})'`
- Deduct 3 points from `communityReputation` in `scoring.ts`

`NATURAL_PERSONS` exception type is informational only — no risk flag (common for natural-person-owned SMEs).

### D-08: Migration Number

New migration: `db/migrations/037_lei_cache.sql`
(Migration 036 = icij_sanctions_linkage, already applied)

### D-09: Admin Sync Route Integration

Add `'gleif'` to the `SyncSource` union type in `src/lib/server/sync/index.ts`.

POST `/api/admin/sync` with body `{ source: 'gleif:delta' }` triggers delta sync.
POST `/api/admin/sync` with body `{ source: 'gleif:full' }` triggers full Level 1 import (long-running — runs in background process like the OpenSanctions sync script).

### D-10: Cron Schedule

Add a daily delta sync cron (analogous to existing `/api/cron/cleanup`):
- New route: `/api/cron/gleif-delta` — calls `syncLeiDelta()` + `syncLeiLevel2()` + `syncLeiExceptions()`
- Schedule: once daily at 02:00 UTC (GLEIF Golden Copy updates around 01:00 UTC)
- Auth: Bearer `ADMIN_SECRET` (same pattern as cleanup cron)

### Claude's Discretion

- Exact streaming JSON library choice (`JSONStream`, `clarinet`, or built-in `node:readline` for NDJSON — check what GLEIF actually serves, JSON array vs NDJSON)
- Exact progress logging interval and format
- Whether to use a temporary table + swap for full import (safer for large imports) or direct UPSERT — Claude decides based on PostgreSQL transaction size limits
- Whether `syncLeiFull()` runs in-process or spawns a child process (like OpenSanctions sync) — Claude decides based on expected memory usage
- Exact similarity threshold for `lei_cache` name search (suggested 0.45, consistent with existing fraud lookup)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Database / Schema
- `db/migrations/036_icij_sanctions_linkage.sql` — most recent migration (037 will follow this)
- `db/migrations/028_fraud_alerts.sql` — `fraud_alerts` table schema (pattern for risk flag tables)
- `db/migrations/011_ports_psc_icij.sql` — `intelligence_cache` table schema (caching pattern to replicate)

### Core Implementation Files (Patterns)
- `src/lib/server/gleif.ts` — existing GLEIF live API client (`searchGleifByName`, `getGleifRecordByLei`, `getGleifUltimateParentJurisdiction`, `parseRecord`, `buildGleifCompany`) — Phase 12 adds cache layer on top, does NOT replace
- `src/lib/server/repository.ts` — `resolveGleifRecord()` function (lines ~617–712) and `searchEntities()` GLEIF path (lines ~463–517) — both need cache-first updates
- `src/lib/server/intelligence.ts` — where intelligence snapshot is assembled — add `reporting_exception` risk flag injection here
- `src/lib/server/scoring.ts` — `communityReputation` scoring logic — add 3-point deduction for opacity exception types
- `src/lib/server/sync/ofac.ts` — streaming XML import pattern (batch processing, error handling, sync log)
- `src/lib/server/sync/index.ts` — `SyncSource` union type and `runSync()` dispatcher — add 'gleif' source
- `src/lib/server/intelligence-cache.ts` — cache read/write pattern (`UPSERT ON CONFLICT DO UPDATE`)
- `src/app/api/cron/cleanup/route.ts` — cron auth pattern (`Bearer ADMIN_SECRET`) for new `/api/cron/gleif-delta`
- `src/app/api/admin/sync/route.ts` — admin sync POST handler — add 'gleif' source dispatch

### GLEIF External References
- GLEIF Golden Copy API: `https://goldencopy.gleif.org/api/v1/golden-copy-files/latest?type=LEI2&extension=JSON`
- GLEIF Level 2 RR: `?type=RR&extension=JSON`
- GLEIF Exceptions EX: `?type=EX&extension=JSON`
- GLEIF Daily Delta: `?type=LEI2-DELTA&extension=JSON`

### Prior Phase Context
- `.planning/phases/10-network-graph-core/10-CONTEXT.md` — codebase patterns established in v1.1 (ServerComponent + client prop pass, ContentLock F3, tab insertion)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `intelligence-cache.ts`: `readIntelligenceCache()` / `writeIntelligenceCache()` — UPSERT pattern for `lei_cache` writes on cache miss
- `src/lib/server/sync/ofac.ts`: Streaming download + batch DB write pattern — replicate for Golden Copy import
- `parseRecord()` in `gleif.ts`: Already parses GLEIF API JSON into `GleifLeiRecord` — the same shape appears in Golden Copy files; reuse or adapt

### Established Patterns
- **Sync module structure**: Each sync module exports named `sync*()` functions, registered in `sync/index.ts` `SyncSource` union, dispatched by `runSync()`
- **Cron auth**: Bearer `ADMIN_SECRET` in `Authorization` header, checked by `isAuthorized()` helper
- **Cache-first with live fallback**: `intelligence-cache.ts` shows the read-miss-write pattern
- **UPSERT**: `INSERT ... ON CONFLICT (key) DO UPDATE SET ...` — used across all cache tables
- **pg_trgm for name search**: `intelligence_cache`, `sanctions_entries`, `icij_entities` all use `gin_trgm_ops` index

### Integration Points
- `repository.ts` `resolveGleifRecord()` (~line 617): Insert cache-first lookup before live API call
- `repository.ts` `searchEntities()` (~line 464): Insert `lei_cache` similarity query before `searchGleifMultiple()`
- `intelligence.ts`: Add `reporting_exception` risk flag after LEI lookup
- `scoring.ts`: Add 3-point `communityReputation` deduction when exception type is opacity-indicating
- `sync/index.ts`: Add `'gleif' | 'gleif:full' | 'gleif:delta' | 'gleif:level2' | 'gleif:exceptions'` to `SyncSource`

</code_context>

<specifics>
## Specific Ideas

- **GLEIF Golden Copy manifest pattern**: The Golden Copy API returns a JSON manifest before the actual data file. The import script must: (1) fetch manifest JSON from `goldencopy.gleif.org`, (2) extract `downloadLink`, (3) stream from `downloadLink`. The download link is typically a signed S3 URL valid for a short period.
- **Entity status filter on import**: `record.attributes.entity.status` = `'ACTIVE'` → import; others → skip during bulk import only
- **Level 2 RR relationship types**: `IS_DIRECTLY_CONSOLIDATED_BY` → `direct_parent_lei`; `IS_ULTIMATELY_CONSOLIDATED_BY` → `ultimate_parent_lei`
- **EX file format**: Each exception record has `LEI`, `ExceptionCategory` (the type: `NO_LEI`, `NON_CONSOLIDATING`, `NATURAL_PERSONS`, `NON_PUBLIC`), and `ExceptionReason`
- **Risk flag category naming**: Use `'reporting_exception'` as the `category` string (consistent with existing `riskFlags` patterns in scoring.ts)
- **Full import memory guard**: GLEIF Level 1 JSON is a JSON array with ~2M objects. Use `JSONStream` npm package or built-in readline with NDJSON if GLEIF supports it. Never load the full array into memory.
- **Sync log**: Reuse `sanctions_sync_log` table pattern — log source, synced_at, record_count, status, error, duration_ms

</specifics>

<deferred>
## Deferred Ideas

- **UI display of parent jurisdiction on company pages** — surfacing `ultimate_parent_lei` jurisdiction in the company detail view is a separate UI concern for a later phase
- **LEI → vessel cross-link** — linking LEI entities to ETI vessels via operator/manager name is a future enrichment
- **GLEIF webhooks / real-time push** — GLEIF does not currently offer webhooks; daily delta is sufficient
- **Cross-referencing LEI with ICIJ entities** — matching LEI records to `icij_entities` by name is a future enrichment (would improve offshore entity identification)
- **Scoring uplift for LEI presence** — currently `buildGleifCompany()` applies 10/25 for entityExistence. Upgrading this score when a cache record exists (confirming real-time API not needed) is a minor future adjustment.

</deferred>

---

*Phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai*
*Context gathered: 2026-04-17 (auto mode)*

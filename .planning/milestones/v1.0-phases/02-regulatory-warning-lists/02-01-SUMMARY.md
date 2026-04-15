---
phase: 02-regulatory-warning-lists
plan: 01
subsystem: data-pipeline
tags: [sync, database, migration, regulatory, warning-lists]
dependency_graph:
  requires: []
  provides: [regulatory_warnings-table, getWarningHits, syncRegulatoryWarnings, warninglists-sync-source]
  affects: [src/lib/server/sync/index.ts, src/lib/types.ts]
tech_stack:
  added: [cheerio (already installed)]
  patterns: [DELETE+INSERT upsert, per-source failure isolation, word_similarity fuzzy query, GIN trigram index]
key_files:
  created:
    - db/migrations/031_regulatory_warnings.sql
    - src/lib/server/sync/regulatory-warnings.ts
    - src/lib/server/warning-lists.ts
  modified:
    - src/lib/types.ts
    - src/lib/server/sync/index.ts
decisions:
  - "Log warning list syncs to sanctions_sync_log with warn: prefix — avoids a new table, audit trail already covers it"
  - "Sequential sync (not parallel) to avoid hammering external regulators simultaneously"
  - "word_similarity threshold 0.72 — matches existing sanctions fuzzy threshold for consistency"
metrics:
  duration: "~3 minutes"
  completed: "2026-04-13"
  tasks_completed: 3
  files_created: 3
  files_modified: 2
---

# Phase 2 Plan 1: Regulatory Warning List Data Pipeline Summary

**One-liner:** DB migration + 7-regulator HTML/CSV scraper + fuzzy-match query module using PostgreSQL word_similarity >= 0.72 against GIN trigram index.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DB migration + WarningHit type | 078d8b1 | db/migrations/031_regulatory_warnings.sql, src/lib/types.ts |
| 2 | Warning list query module | 9711ed7 | src/lib/server/warning-lists.ts |
| 3 | Sync module + index.ts registration | d1623e7 | src/lib/server/sync/regulatory-warnings.ts, src/lib/server/sync/index.ts |

## What Was Built

### Migration (031_regulatory_warnings.sql)
- `regulatory_warnings` table with 9 columns: id, source, source_name, jurisdiction, entity_name, normalized_name, list_url, warning_type, synced_at
- GIN trigram index `idx_regwarn_normalized` on normalized_name for word_similarity queries
- B-tree index `idx_regwarn_source` for per-source DELETE during sync
- Extension guard: `CREATE EXTENSION IF NOT EXISTS pg_trgm`

### Types (src/lib/types.ts)
- `WarningHit` interface added after `ContentTier` type, before `ApiResponse`
- Fields: source, source_name, jurisdiction, entity_name, list_url, warning_type
- `SanctionStatus` type unchanged

### Query Module (src/lib/server/warning-lists.ts)
- `getWarningHits(entityName, _entityType?)` returning `Promise<WarningHit[]>`
- Normalizes query with `stripGeneric=false` to preserve search intent
- Guards against empty/short input (< 2 chars) without hitting DB
- Deduplicates by source using a Map — one hit per regulator, highest similarity first

### Sync Module (src/lib/server/sync/regulatory-warnings.ts)
- 7 scraper functions: scrapeFca, scrapeFinma, scrapeSfc, scrapeMas, scrapeDfsa, scrapeSca, scrapeCmaOman
- FCA uses CSV endpoint with HTML table fallback
- All other sources: HTML table primary selector + list item fallback
- `upsertWarnings()`: DELETE stale rows for source, then batch INSERT (200/batch) with ON CONFLICT DO UPDATE
- `syncSource()`: per-source BEGIN/COMMIT, logs to sanctions_sync_log with `warn:{source}` prefix; on error ROLLBACK + log error, return result without throwing
- `syncRegulatoryWarnings()`: sequential orchestrator over all 7 sources

### Index Registration (src/lib/server/sync/index.ts)
- `SyncSource` union extended: `'ofac' | 'fraud' | 'legitdomains' | 'warninglists' | 'all'`
- `runSync('warninglists')` calls `syncRegulatoryWarnings()` and pushes results with `warn:{source}` key
- `runSync('all')` now includes warning list sync
- `getSyncStatus()` requires no change — warning list rows appear in sanctions_sync_log with `warn:` prefix automatically

## Verification

- `npm run type-check` passes with zero errors
- All 7 source keys present in SCRAPERS array: fca, finma, sfc, mas, dfsa, sca, cma
- DELETE+INSERT pattern confirmed in upsertWarnings()
- sanctions_sync_log logging with `warn:` prefix confirmed in syncSource()

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan creates backend infrastructure only. No UI components or data-dependent rendering.

## Threat Flags

No new threat surface beyond what was documented in the plan's threat model. All source URLs use HTTPS. AbortSignal timeouts are in place (15s HTML, 30s CSV). Parameterized queries prevent SQL injection from scraped content.

## Self-Check

### Files created/modified:
- [x] db/migrations/031_regulatory_warnings.sql — FOUND
- [x] src/lib/server/sync/regulatory-warnings.ts — FOUND
- [x] src/lib/server/warning-lists.ts — FOUND
- [x] src/lib/types.ts (modified) — FOUND
- [x] src/lib/server/sync/index.ts (modified) — FOUND

### Commits:
- [x] 078d8b1 — feat(02-01): add regulatory_warnings migration and WarningHit type
- [x] 9711ed7 — feat(02-01): add warning-lists.ts query module with fuzzy matching
- [x] d1623e7 — feat(02-01): add 7-source regulatory warning sync + index.ts registration

## Self-Check: PASSED

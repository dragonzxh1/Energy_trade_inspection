# Phase 12: GLEIF Golden Copy Integration — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai
**Mode:** Auto (user instructed: "如果有问题，自己选择最好的方式。不要询问我。")
**Areas discussed:** Table Design, Import Scope, Streaming Strategy, Cache Integration, Reporting Exceptions, Level 2 Depth

---

## Table Design (lei_cache schema)

| Option | Description | Selected |
|--------|-------------|----------|
| Denormalized single table | All LEI data + parent LEIs + exception type in one table, no JOINs | ✓ |
| Normalized relational (lei_cache + lei_relationships) | Separate relationships table for L2 data, cleaner but requires JOINs | |

**Auto-selected:** Denormalized single table
**Rationale:** Matches the `intelligence_cache` pattern. The primary use case (jurisdiction lookup by LEI) needs no JOIN. Level 2 data is only 2 columns (`direct_parent_lei`, `ultimate_parent_lei`) — not complex enough to warrant a separate table.

---

## Level 1 Import Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Active entities only | Filter `entity.status == 'ACTIVE'` — ~1–1.5M records | ✓ |
| All entities | Import all ~2M+ including annulled/lapsed/inactive | |
| Jurisdiction-filtered | Only import entities from known energy-trade jurisdictions | |

**Auto-selected:** Active entities only
**Rationale:** ~30–40% of LEI records are inactive. Filtering active-only keeps the table lean while covering all current counterparties. Cache misses from inactive entities are served by live API fallback.

---

## Streaming/Batching Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| JSONStream + 1000-row batch UPSERT | Stream multi-GB file, batch insert | ✓ |
| Full load into memory then insert | Simple but OOM risk on large files | |
| Child process (separate script) | Like OpenSanctions sync | |

**Auto-selected:** JSONStream + 1000-row batch UPSERT
**Rationale:** GLEIF Level 1 JSON is multi-GB. Must stream. 1000 rows per batch is a safe PostgreSQL batch size consistent with existing sync patterns. Whether to run in-process or child process is left to Claude's discretion based on memory profiling.

---

## Cache Integration Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Cache-first, live API fallback on miss | Check lei_cache first; miss → live API → write to cache | ✓ |
| Cache-only (no live API after import) | Only ever use cache; live API disabled | |
| Parallel (cache + live API, prefer cache) | Always call both, use cache result | |

**Auto-selected:** Cache-first with live API fallback
**Rationale:** Ensures continuity during the window between Golden Copy imports. New LEIs (e.g., recently incorporated companies) may not yet be in the cache; live API handles them gracefully.

---

## Reporting Exceptions Risk Signal

| Option | Description | Selected |
|--------|-------------|----------|
| Risk flag (medium severity) for opacity types | Flag NON_CONSOLIDATING, NON_PUBLIC, NO_LEI; skip NATURAL_PERSONS | ✓ |
| No scoring impact (informational only) | Store exception type but no risk deduction | |
| Critical flag for all exceptions | Flag all exception types including NATURAL_PERSONS | |

**Auto-selected:** Medium-severity risk flag for opacity types only
**Rationale:** `NON_CONSOLIDATING`, `NON_PUBLIC`, and `NO_LEI` indicate deliberate opacity in ownership disclosure — a legitimate compliance red flag for energy traders. `NATURAL_PERSONS` is common and benign (sole traders, small firms) — no flag. 3-point `communityReputation` deduction is proportionate.

---

## Level 2 Ownership Chain Depth

| Option | Description | Selected |
|--------|-------------|----------|
| 1 hop (use GLEIF's pre-computed direct + ultimate parent) | Import from GLEIF L2 RR file directly | ✓ |
| Recursive traversal in application code | Follow parent chain step-by-step in code | |

**Auto-selected:** 1 hop (GLEIF pre-computed)
**Rationale:** GLEIF Level 2 already provides `IS_DIRECTLY_CONSOLIDATED_BY` and `IS_ULTIMATELY_CONSOLIDATED_BY` as separate relationship types. The chain computation is done by GLEIF — no need to replicate it in application code.

---

## Claude's Discretion

- Exact streaming JSON library (`JSONStream` vs `clarinet` vs built-in `readline` for NDJSON)
- In-process vs child process for full import based on memory profiling
- Whether to use a temp table + RENAME for full import (atomic swap)
- Exact similarity threshold for `lei_cache` name search
- Sync log integration (reuse `sanctions_sync_log` or new table)

## Deferred Ideas

- UI display of parent jurisdiction on company pages (future phase)
- LEI → vessel cross-link via operator/manager name (future enrichment)
- GLEIF webhooks (not available from GLEIF)
- Cross-referencing LEI with ICIJ entities by name (future enrichment)

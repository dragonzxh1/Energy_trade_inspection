# Phase 2: Regulatory Warning Lists - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Sync seven regulatory warning lists (FCA/UK, FINMA/CH, SFC/HK, MAS/SG, DFSA/Dubai DIFC, SCA/UAE federal, CMA Oman) and surface per-source warning badges on entity pages. No scoring engine changes, no verdict engine changes — pure data ingestion and badge display.

**In scope:**
- New `regulatory_warnings` DB table + migration
- Seven sync modules (one per regulator)
- Per-source warning badge component (`WarningBadge`)
- Warning badge display on company/vessel/terminal entity pages
- Admin sync integration (add warning list sync to existing `/api/admin/sync` endpoint)
- Sync log entries per regulator source

**Out of scope for this phase:**
- Score impact of regulatory warnings (Phase 4/5)
- `warning_listed` vs `sanctioned` badge distinction at the verdict level (Phase 5 DECISION-01)
- Export-restricted distinction (Phase 5)

</domain>

<decisions>
## Implementation Decisions

### D-01: Storage Architecture

New dedicated `regulatory_warnings` table — separate from `sanctions_entries` and `fraud_alerts`. Regulatory warnings are a distinct data type (government investor/consumer protection alerts, not trade sanctions or industry fraud alerts).

Table fields (minimum):
- `id` — `{source}:{slug}` primary key
- `source` — machine-readable source key (e.g. `'fca'`, `'mas'`, `'dfsa'`)
- `source_name` — human-readable (e.g. `'FCA (UK)'`, `'MAS (Singapore)'`)
- `jurisdiction` — ISO region (e.g. `'UK'`, `'SG'`, `'AE-DU'`)
- `entity_name` — original name as listed
- `normalized_name` — `normalizeEntityName(entity_name, true)`
- `list_url` — canonical URL of the warning list page
- `warning_type` — optional free-text (e.g. `'unauthorized_firm'`, `'clone_firm'`)
- `synced_at` — timestamp

Requires trigram index on `normalized_name` for fuzzy matching at query time.

### D-02: Warning Badge Display

Show per-source warning badges — each regulator gets its own badge labeled with its abbreviation and jurisdiction (e.g. **FCA** · UK, **MAS** · SG, **DFSA** · Dubai).

New `WarningBadge` component (separate from existing `SanctionBadge`) — receives `source` and `sourceName` props. Badge color: amber/orange (distinct from red sanctions badge and green clear badge).

Multiple badges stack horizontally if entity appears on multiple warning lists. Badge includes tooltip naming the full regulator name and jurisdiction.

### D-03: Score Impact

Warning list hits do **not** affect the Authenticity Score in this phase. Badges are purely informational. Score integration is deferred to Phase 4/5 where the full scoring architecture is revisited.

This avoids premature scoring logic that Phase 4/5 will need to redesign anyway.

### D-04: Data Access — Failure Isolation

Each regulator's sync module is independent — a single source failure does not block others. Pattern follows existing `fraud-alerts.ts`: all sources attempted in parallel (or sequential), each returns a result object with `success: boolean`, `count`, `error`, `durationMs`.

Sync results logged to `sanctions_sync_log` table (or equivalent) per source so admin panel can show per-regulator sync status.

**Regulator data formats:**
- FCA (UK): CSV download from `register.fca.org.uk` — machine-readable, most reliable
- MAS (SG): HTML table — `eservices.mas.gov.sg` investor alert list
- DFSA (Dubai): HTML — `dfsa.ae` warnings page
- SCA (UAE federal): HTML — `sca.gov.ae` investor protection page
- CMA Oman: HTML — `cma.gov.om` investor protection page
- FINMA (CH): HTML — `finma.ch` warnings page
- SFC (HK): HTML — `sfc.hk` alert list page

All use `cheerio` for HTML parsing (same dependency already in project for `fraud-alerts.ts`). FCA CSV parsed directly.

### D-05: Entity Matching Strategy

Match at query time — when an entity page loads, perform a fuzzy `word_similarity` query against `regulatory_warnings.normalized_name`. Same pattern as `fraud_alerts`.

Claude's discretion on similarity threshold — start at 0.72 (same as `sanctions_entries`) and tune based on false-positive testing. Regulators list exact legal names, so threshold can be set relatively high.

No pre-match/association table needed — keeps sync logic simple.

### Claude's Discretion

- Exact similarity threshold for `word_similarity` fuzzy match (start at 0.72, tune as needed)
- Whether to add a `source_url` per entry (entry-level URL) vs page-level `list_url` — use whichever the source provides
- Sync schedule integration: plug into existing cron/admin sync rather than defining new schedule
- Badge component color palette: amber/orange family, exact hex values match existing CSS variable system

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Sync Pattern
- `src/lib/server/sync/fraud-alerts.ts` — Primary pattern to follow: independent sources, failure isolation, `FraudEntry` interface, `fetchHtml()` helper, cheerio parsing
- `src/lib/server/sync/ofac.ts` — Batch upsert pattern with `BEGIN`/`COMMIT` transaction
- `src/lib/server/sync/index.ts` — How to register a new sync source in the orchestrator (`runSync()` function, `SyncSource` type)

### Existing Badge Pattern
- `src/components/entity/SanctionBadge.tsx` — Existing badge component to model `WarningBadge` after
- `src/components/ui/Badge.tsx` — Base badge primitive used by SanctionBadge

### Entity Page Integration Points
- `src/app/company/[slug]/page.tsx` — Where warning badges must be added (company pages)
- `src/app/vessel/[imo]/page.tsx` — Vessel pages
- `src/app/terminal/[id]/page.tsx` — Terminal pages

### Type System
- `src/lib/types.ts` — `SanctionStatus`, `BaseEntity` types. New `WarningHit` type needed for query results. Do NOT modify `SanctionStatus` (Phase 5 handles the `warning_listed` distinction).

### Database Migrations
- `db/migrations/028_fraud_alerts.sql` — Schema pattern to follow for `regulatory_warnings` table
- Migration numbering: next available is `031_regulatory_warnings.sql`

### Requirements
- `.planning/REQUIREMENTS.md` — DATASRC-01, DATASRC-02, DATASRC-03, DATASRC-04 acceptance criteria
- `.planning/ROADMAP.md` §Phase 2 — Success criteria (5 items)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cheerio` — already a project dependency (used in `fraud-alerts.ts`); use for all HTML scraping
- `src/lib/server/normalize.ts` `normalizeEntityName()` — shared name normalization function; use for `normalized_name` column
- `src/lib/server/db.ts` — singleton pg pool; import as `{ db }` for all DB queries
- `src/lib/server/sync/fraud-alerts.ts` `fetchHtml()` — HTTP helper with user-agent and 15s timeout; copy or import for HTML sources
- `src/components/ui/Badge.tsx` — base badge primitive; `WarningBadge` should use this same primitive

### Established Patterns
- Raw SQL only, no ORM — all new queries follow existing `db.query()` pattern
- Sync modules export async functions named `sync{Source}()` returning `{ count: number }`
- All sync results go through the `SyncResult` interface in `src/lib/server/sync/index.ts`
- Trigram index on normalized name columns (see `028_fraud_alerts.sql` `idx_fraud_normalized`)
- Entity pages fetch sanctions and fraud data separately; warning list query will follow same pattern

### Integration Points
- `src/lib/server/sync/index.ts` — Add `'warninglists'` to `SyncSource` union and `runSync()` switch
- `src/app/api/admin/sync/route.ts` — Exposes sync trigger; warning list sync is added via `index.ts`
- Entity page server components fetch entity data from repository — add warning list query to `src/lib/server/repository.ts` or a new `warning-lists.ts` query module
- `src/app/company/[slug]/page.tsx` lines 819+ — SanctionBadge display; WarningBadge stacks alongside it

</code_context>

<specifics>
## Specific Ideas

- Per-source badges stack horizontally on entity pages — same visual area as `SanctionBadge` but as a separate group below or beside it
- Admin sync panel should show per-regulator sync status (last synced, count, error if any) — existing sync log table handles this if we log per source key
- FCA CSV is the most reliable source and should be the reference implementation for the sync module pattern; scraping modules for the other six can follow the `fraud-alerts.ts` HTML scraping pattern

</specifics>

<deferred>
## Deferred Ideas

- **Score impact of warning lists** — How regulatory warnings reduce the Authenticity Score will be designed in Phase 4/5 alongside the full scoring architecture revision (SCORE-01, SCORE-02)
- **`warning_listed` badge distinction at verdict level** — Phase 5 DECISION-01 requires distinguishing `sanctioned` vs `warning_listed` vs `export_restricted` in trade verdict badges; Phase 2 only adds informational warning badges on entity pages
- **Export-restricted list (BIS/ECFR)** — v2 requirement (DATASRC-V2-01), not in this milestone

</deferred>

---

*Phase: 02-regulatory-warning-lists*
*Context gathered: 2026-04-13*

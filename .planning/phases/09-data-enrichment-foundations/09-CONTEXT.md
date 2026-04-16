# Phase 9: Data Enrichment Foundations - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 9 delivers two capabilities:

1. **ICIJ↔sanctions linkage** (NETDATA-01, 02): Add `is_sanctioned` and `sanctions_match` columns to `icij_entities` (migration 036), and run fuzzy matching against `sanctions_entries` during each ICIJ sync so matched offshore entities are flagged. The `OffshoreLeaksPanel` then shows an inline "Sanctioned Entity" badge on flagged rows.

2. **FraudAlertsPanel on detail pages** (NETDATA-03, 04): A new Server Component panel appears on the company detail page (matching by company name) and vessel detail page (matching by operator + manager names) — showing records from the existing `fraud_alerts` table.

Phase 9 does NOT render the network graph — that is Phase 10. The `is_sanctioned` flag is the data groundwork that Phase 10 will use for red node coloring.

</domain>

<decisions>
## Implementation Decisions

### ICIJ↔Sanctions Matching (NETDATA-01)

- **D-01:** Fuzzy matching that marks `is_sanctioned=true` on `icij_entities` rows **runs automatically embedded in the ICIJ sync job** — no separate admin trigger. After upserting icij_entities, the sync immediately runs the UPDATE to match against `sanctions_entries`.
- **D-02:** Each sync does a **full re-match** of all `icij_entities` rows (not incremental). This ensures newly added or removed sanctions entries are reflected on all icij rows, even pre-existing ones.
- **D-03:** The similarity threshold for ICIJ→sanctions matching follows the existing `sanctions.ts` pattern (`word_similarity > 0.72`) to maintain consistency across the codebase.

### Vessel Fraud Alert Matching (NETDATA-04)

- **D-04:** The vessel page FraudAlertsPanel matches `fraud_alerts` by **operator name OR manager name** (vessel.operator OR vessel.manager). This aligns with the ROADMAP description ("via operator/manager name"). Vessel owner is excluded (weaker linkage to fraud actors).
- **D-05:** The same `SIMILARITY_THRESHOLD = 0.45` used in `fraud-check.ts` applies to vessel matching (consistent with existing fraud lookup patterns).

### FraudAlertsPanel Result Handling

- **D-06:** The panel **shows all matching records** — no cap. In practice, a single entity matches at most 5-10 records across all sources. Pagination is not needed.
- **D-07:** Panel tab is always visible (even when no alerts exist) — the empty state copy is specified in UI-SPEC: "No fraud alerts on record for this entity."

### Claude's Discretion

- Exact SQL for ICIJ→sanctions UPDATE (can use WITH update or subquery — implement cleanest pattern)
- Sort order for FraudAlertsPanel items (blacklists before whitelists, then by source name — Claude decides)
- `getCompanyFraudAlerts()` and `getVesselFraudAlerts()` repository function signatures (match existing patterns in repository.ts)
- Whether to deduplicate when both operator and manager match the same fraud_alerts row

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### UI Design Contract
- `.planning/phases/09-data-enrichment-foundations/09-UI-SPEC.md` — Complete visual/interaction spec for FraudAlertsPanel and ICIJ sanctioned indicator. All styling, copy, placement, and content lock decisions are locked here.

### Requirements
- `.planning/REQUIREMENTS.md` — NETDATA-01 through NETDATA-04 acceptance criteria

### Schema / Migrations
- `db/migrations/011_ports_psc_icij.sql` — Current `icij_entities` schema (columns to ALTER in migration 036)
- `db/migrations/028_fraud_alerts.sql` — `fraud_alerts` table schema

### Core Implementation Files
- `src/lib/server/sync/sanctions.ts` — Fuzzy matching pattern (`word_similarity > 0.72`, `normalizeQuery()`, excluded datasets) — replicate for ICIJ→sanctions match
- `src/lib/server/sync/fraud-alerts.ts` — ICIJ/fraud sync orchestration pattern
- `src/lib/server/sync/index.ts` — Sync orchestrator — where ICIJ sync step is registered
- `src/lib/server/fraud-check.ts` — Existing `checkFraudAlerts(name)` with `SIMILARITY_THRESHOLD = 0.45` — use as template for `getCompanyFraudAlerts()` and `getVesselFraudAlerts()`
- `src/lib/server/repository.ts` — `IcijMatch` interface and `getIcijMatches()` — needs `isSanctioned` and `sanctionsMatch` fields added after migration 036

### Detail Pages (for tab insertion)
- `src/app/company/[slug]/page.tsx` — Company detail page — where FraudAlertsPanel tab is inserted
- `src/app/vessel/[imo]/page.tsx` — Vessel detail page — where FraudAlertsPanel tab is inserted

### Component Patterns
- `src/components/entity/ContentLock.tsx` — F3 content lock pattern (FraudAlertsPanel uses this)
- `src/components/entity/IntelligencePanel.tsx` — Server Component panel pattern to replicate

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `checkFraudAlerts(name)` in `fraud-check.ts`: Existing fuzzy lookup against `fraud_alerts` — use as template for the new repository functions (same threshold, same query structure)
- `normalizeQuery()` in `sanctions.ts`: Name normalization function — reuse for ICIJ→sanctions matching
- `ContentLock` component: Already handles F3 gating — wrap FraudAlertsPanel with it
- `getIcijMatches()` in `repository.ts`: Needs two new fields joined from `icij_entities` after migration 036 (`is_sanctioned`, `sanctions_match`)

### Established Patterns
- **Server Component panels**: `IntelligencePanel`, `DomainIntelPanel` — FraudAlertsPanel follows same pattern (props-fed, no client-side fetch)
- **TabNav insertion**: Company/vessel pages define a tabs array — insert new `{ id: 'fraud-alerts', label: 'Fraud Alerts' }` tab at the position specified in UI-SPEC
- **Fuzzy matching**: `word_similarity(field, query) > threshold` with `pg_trgm` — already enabled, same pattern for ICIJ→sanctions UPDATE
- **Migrations**: Sequential numbered SQL files in `db/migrations/` — next is `036_icij_sanctions_linkage.sql`

### Integration Points
- ICIJ sync: After the `icij_entities` upsert step in the ICIJ sync function, add an UPDATE that runs `word_similarity` against `sanctions_entries` to populate `is_sanctioned` and `sanctions_match`
- Company detail page: Server-side data fetching before render — add `getCompanyFraudAlerts(company.name)` call alongside existing queries
- Vessel detail page: Add `getVesselFraudAlerts(vessel.operator, vessel.manager)` call
- `IcijMatch` type: Add `isSanctioned?: boolean` and `sanctionsMatch?: string | null` — update the SQL in `getIcijMatches()` to SELECT these columns

</code_context>

<specifics>
## Specific Ideas

- **Migration 036** adds two columns to `icij_entities`: `is_sanctioned BOOLEAN DEFAULT FALSE` and `sanctions_match TEXT` (the matched sanctions entry name, for the tooltip)
- The ICIJ sanctioned indicator badge copy and style are locked in UI-SPEC: "Sanctioned Entity", `title={Matched: ${sanctions_match}}`, red (`var(--status-listed)`)
- Vessel fraud matching is an OR — either operator OR manager match triggers a result. The alert row should show which name matched (for traceability)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 09-data-enrichment-foundations*
*Context gathered: 2026-04-16*

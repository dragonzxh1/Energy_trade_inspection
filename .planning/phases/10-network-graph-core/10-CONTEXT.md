# Phase 10: Network Graph Core - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 10 delivers an interactive network graph on company detail pages, enabling users to visually explore a company's ownership and director network across up to 3 hops of relationships. It covers:

1. **React Flow visualization** (GRAPH-01): A new "Network" tab on the company detail page renders an interactive node graph using the React Flow library.
2. **Clickable node navigation** (GRAPH-02): Clicking any node that corresponds to an ETI entity (company, vessel) navigates to that entity's detail page.
3. **3-hop recursive query** (GRAPH-03): A PostgreSQL WITH RECURSIVE CTE traverses ICIJ relationships up to depth 3 (≤100 nodes), alongside flat ETI registry connections (directors, vessels) for the first layer.
4. **Color-coded nodes** (GRAPH-04): red=sanctioned entities (OFAC/EU FSF/UN OR icij is_sanctioned=true), orange=fraud-alerted entities, grey=ICIJ offshore entities, blue=normal entities/persons/vessels.

Phase 10 does NOT cover: ICIJ panels on vessel/port pages (Phase 11), graph SVG export to PDF (Phase 11).

</domain>

<decisions>
## Implementation Decisions

### Tab Placement and Layout

- **D-01:** A new independent **"Network"** tab is added to the company detail page tab list. It is positioned **after "Offshore Leaks"** in the existing tab order.
  - New tab order: Registration / Directors / Beneficial Owners / Vessels / Risk Flags / Fraud Alerts / Offshore Leaks / **Network** / Intelligence / Domain / Sources
- **D-02:** Existing "Offshore Leaks" tab is unchanged — the Network tab is additive, not a replacement.
- **D-03:** Canvas height is Claude's discretion — recommended ~600–700px based on existing panel proportions (similar to AIS map height).

### Node Data Scope (Graph Architecture)

- **D-04:** The graph shows three categories of nodes connected to the root company:
  1. **ETI Registry connections (first-layer, non-recursive):** Directors and beneficial owners from `metadata.directors` / `metadata.beneficial_owners` (Companies House, ACRA, Zefix, OpenCorporates). These are shown as person nodes directly connected to the root — they do not participate in ICIJ recursion.
  2. **Related vessels (first-layer, non-recursive):** Vessels from `metadata.vessels` — shown as vessel nodes connected to the root company. Clickable to navigate to the vessel page. Colored by sanction/fraud status.
  3. **ICIJ offshore entities (recursive):** `icij_entities` linked via `linked_entity_id = company.id` are shown as grey offshore nodes. From these, WITH RECURSIVE CTE traverses `icij_relationships` up to 3 hops (depth limit 3, node limit 100 across all ICIJ nodes).
- **D-05:** Root node = the ETI company entity (center of the graph, blue color).
- **D-06:** Color-coding applied to ALL node types, including ETI directors/vessels: a director whose name matches a sanctions entry → red; a vessel with `sanctionStatus = 'listed'` → red; a director with fraud alerts → orange.

### Data Fetching Architecture

- **D-07:** Server Component approach — the company page (`page.tsx`) calls a new `getNetworkGraph(entityId)` function server-side and passes serialized `{ nodes, edges }` data as props to a new `NetworkGraph` client component (`'use client'`). This matches the existing pattern for FraudAlertsPanel and OffshoreLeaksPanel — data fetched server-side, rendered client-side.
- **D-08:** No new API route needed for Phase 10 — data flows through Server Component props.

### Content Lock

- **D-09:** The Network tab is **F3 content-locked** (paid subscribers only), consistent with Directors, Fraud Alerts, Offshore Leaks, and other premium tabs.

### Empty State and Boundary Conditions

- **D-10:** The "Network" tab is **always visible** (not hidden when data is empty). If a company has no directors, no vessels, and no ICIJ matches, the panel shows an empty state message. This is consistent with the Fraud Alerts tab pattern.
- **D-11:** When 100-node ICIJ limit is hit, truncation metadata is returned from the query (total_node_count). The NetworkGraph component shows a banner: **"Showing 100 of {N} network nodes — graph truncated for performance."** (Claude decides exact copy and visual treatment.)
- **D-12:** When company has directors/vessels but no ICIJ data, the graph still renders — showing the company + its registry connections as a simple star graph. This is meaningful even without ICIJ data.

### Graph Layout

- **D-13:** Auto-layout via the Dagre algorithm (standard React Flow layout library) — Claude decides the exact layout direction and spacing.
- **D-14:** React Flow package to install: `reactflow` (latest stable — check @xyflow/react as the newer package name before installing).

### Claude's Discretion

- Canvas height (recommended 600–700px, match existing panel proportions)
- Node size and label truncation (long company names should be truncated with ellipsis)
- Edge labels (relationship type e.g. "DIRECTOR_OF", "SHAREHOLDER_OF" from `icij_relationships.link` field)
- Dagre layout direction (top-down vs left-right — left-right recommended for wide networks)
- Exact truncation banner copy and styling
- Whether to deduplicate nodes that appear via multiple paths (yes — deduplicate by node_id)
- `getNetworkGraph()` function signature — returns `{ nodes: NetworkNode[], edges: NetworkEdge[], truncated: boolean, totalNodeCount: number }`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements
- `.planning/REQUIREMENTS.md` — GRAPH-01 through GRAPH-04 acceptance criteria (interactive graph, click navigation, 3-hop WITH RECURSIVE CTE, color coding)

### Schema / Data
- `db/migrations/011_ports_psc_icij.sql` — `icij_entities` table schema (node_id, name, dataset, linked_entity_id, is_sanctioned, sanctions_match)
- `db/migrations/014_icij_relationships.sql` — `icij_relationships` table schema (rel_type, link, from_node_id, to_node_id, dataset)
- `db/migrations/028_fraud_alerts.sql` — `fraud_alerts` table schema (for orange node detection)

### Core Implementation Files (Patterns to Follow)
- `src/lib/server/repository.ts` — `getIcijMatches()`, `getIcijOfficerNetwork()`, `getIcijPersonEntities()`, `searchIcijByName()` — existing ICIJ query patterns; new `getNetworkGraph()` follows these patterns with WITH RECURSIVE CTE
- `src/app/company/[slug]/page.tsx` — Company detail page — where Network tab and panel are inserted; tab order and ContentLock pattern
- `src/lib/types.ts` — `Company`, `Director`, `VesselRef` types — used to type first-layer nodes
- `src/components/entity/FraudAlertsPanel.tsx` — Pattern for a panel component (data passed as props, no client-side fetch)
- `src/components/entity/ContentLock.tsx` — F3 content lock wrapper pattern
- `src/components/entity/TabNav.tsx` — Tab insertion pattern

### Phase 9 Context (Data Dependency)
- `.planning/phases/09-data-enrichment-foundations/09-CONTEXT.md` — Phase 9 established `is_sanctioned` and `sanctions_match` fields on `icij_entities` (migration 036) — Phase 10 uses these for red node coloring of ICIJ nodes

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getIcijOfficerNetwork(entityId)` in `repository.ts`: Existing 2-level ICIJ JOIN query — the new `getNetworkGraph()` replaces/extends this with a WITH RECURSIVE CTE for 3 hops
- `getIcijMatches(entityId)`: Returns `icij_entities` linked to a company — these become the starting nodes for ICIJ recursion
- `ContentLock` component: Already handles F3 gating — wrap NetworkGraph tab panel with it
- `FraudAlertsPanel.tsx`: Pattern for a client component receiving server-fetched data as props — NetworkGraph follows the same architecture

### Established Patterns
- **Server Component data fetching + Client Component rendering**: Company page fetches all data server-side, passes to specialized panel components. NetworkGraph follows this — data serialized to plain `{ nodes, edges }` object before passing to client
- **TabNav insertion**: Add `{ id: 'network', label: 'Network' }` to tabs array, add corresponding panel to panels array (same index position)
- **ContentLock F3 wrapping**: `<ContentLock key="network" unlocked={f3Unlocked} reason={lockReason}><NetworkGraph {...} /></ContentLock>`
- **ICIJ data**: `icij_entities.linked_entity_id` links ICIJ nodes to ETI company IDs; `icij_relationships` has directed edges (from_node_id → to_node_id) with rel_type

### Integration Points
- Company page: Add `getNetworkGraph(company.id)` call alongside existing `getIcijMatches()`, `getIcijOfficerNetwork()` calls
- New file: `src/components/entity/NetworkGraph.tsx` — `'use client'` React Flow component
- New function: `getNetworkGraph(entityId)` in `repository.ts` — WITH RECURSIVE CTE returning typed `{ nodes, edges, truncated, totalNodeCount }`
- `reactflow` package: Not yet installed — must add to `package.json` before implementation
- Node navigation (GRAPH-02): Nodes that have an `etlKey` (slug for companies, IMO for vessels) render as clickable links to `/company/{slug}` or `/vessel/{imo}`

</code_context>

<specifics>
## Specific Ideas

- **React Flow package name**: Check whether to install `reactflow` or `@xyflow/react` (the newer namespace) — both point to the same library; `@xyflow/react` is the current maintained package
- **ICIJ WITH RECURSIVE CTE structure**: Start from all `icij_entities.node_id` where `linked_entity_id = $1`, then join `icij_relationships` repeatedly for up to 3 hops, tracking depth and visited nodes to prevent cycles
- **Node deduplication**: A node reached via multiple paths should appear once in the graph — deduplicate by `node_id` in the query result before building edges
- **Node type for ETI directors**: Directors are persons (no ETI entity page) — shown as person nodes (blue, non-clickable unless they have a matching ETI entity via name search). Vessels from `metadata.vessels` DO have ETI pages — clickable.
- **100-node limit scope**: The 100-node cap applies to ICIJ recursive nodes only — ETI directors and vessels (first-layer) are shown in addition to the cap

</specifics>

<deferred>
## Deferred Ideas

- **Cross-vessel network**: Showing connections between vessels associated with the same company — belongs in Phase 11 or future enhancement
- **Real-time graph updates**: WebSocket-driven graph refresh — explicitly out of scope per REQUIREMENTS.md
- **Custom graph layout saving**: User-dragged node positions preserved across sessions — out of scope
- **Director cross-company connections**: Showing other ETI companies the same director appears in (would require a cross-entity director index) — future milestone capability

</deferred>

---

*Phase: 10-network-graph-core*
*Context gathered: 2026-04-16*

# Roadmap: Energy Trade Inspection — Trade Fraud Decision Engine

## Milestones

- ✅ **v1.0 MVP** — Phases 1–8 (shipped 2026-04-15)
- 🔄 **v1.1 Network Intelligence Graph** — Phases 9–11 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–8) — SHIPPED 2026-04-15</summary>

- [x] Phase 1: Architecture Hardening (3/3 plans) — completed 2026-04-13
- [x] Phase 2: Regulatory Warning Lists (2/2 plans) — completed 2026-04-13
- [x] Phase 3: Domain & Email Intelligence (2/2 plans) — completed 2026-04-14
- [x] Phase 4: Scoring Engine Completion (3/3 plans) — completed 2026-04-14
- [x] Phase 5: Decision Engine Upgrade (4/4 plans) — completed 2026-04-14
- [x] Phase 6: Trade Service Integration Hardening (2/2 plans) — completed 2026-04-15
- [x] Phase 7: Entity Sanction Wiring & Admin Sync Fix (2/2 plans) — completed 2026-04-15
- [x] Phase 8: Admin Operations Dashboard (3/3 plans) — completed 2026-04-15

See full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### v1.1 Network Intelligence Graph (Phases 9–11)

- [ ] **Phase 9: Data Enrichment Foundations** — ICIJ↔sanctions linkage + fraud alert panels on company and vessel pages
- [ ] **Phase 10: Network Graph Core** — React Flow interactive node graph with 3-hop recursive query on company pages
- [ ] **Phase 11: Coverage Expansion + PDF Export** — ICIJ panels on vessel/port pages + graph SVG embedded in PDF reports

## Phase Details

### Phase 9: Data Enrichment Foundations
**Goal**: Users can see sanctions↔ICIJ linkage and fraud alert data on entity detail pages
**Depends on**: Phase 8 (v1.0 complete baseline)
**Requirements**: NETDATA-01, NETDATA-02, NETDATA-03, NETDATA-04
**Success Criteria** (what must be TRUE):
  1. After ICIJ sync runs, entities that fuzzy-match a sanctioned entity have `is_sanctioned=true` in the database — visible in admin tools or API response
  2. A company detail page shows a FraudAlertsPanel listing matched fraud alert records (Rotterdam, FuelScamAlert, etc.) when matches exist
  3. A vessel detail page shows a FraudAlertsPanel with fraud alerts matched via operator/manager name
  4. In the network graph (Phase 10 dependency), ICIJ nodes marked `is_sanctioned=true` render as red rather than grey
**Plans**: TBD
**UI hint**: yes

### Phase 10: Network Graph Core
**Goal**: Users can explore a company's ownership and director network as an interactive graph with up to 3 hops
**Depends on**: Phase 9
**Requirements**: GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04
**Success Criteria** (what must be TRUE):
  1. A company detail page renders an interactive node graph showing directors, shareholders, and linked ICIJ offshore entities
  2. Clicking any node that corresponds to an ETI entity navigates the user to that entity's detail page
  3. The graph traverses up to 3 hops of ownership/director relationships, capped at 100 nodes, without page timeout
  4. Nodes use color coding: red for sanctioned entities, orange for fraud-alerted entities, grey for ICIJ offshore entities, blue for normal entities
**Plans**: TBD
**UI hint**: yes

### Phase 11: Coverage Expansion + PDF Export
**Goal**: Users can view ICIJ network panels on vessel and port pages, and export a graph snapshot in entity PDF reports
**Depends on**: Phase 10
**Requirements**: NETCOV-01, NETCOV-02, REPORT-01
**Success Criteria** (what must be TRUE):
  1. A vessel detail page shows an ICIJ network module with entities matched via operator, manager, and owner name fields
  2. A port/terminal detail page shows an ICIJ network module with entities matched via terminal operator name
  3. When a user downloads an entity PDF report, the report contains a static SVG snapshot of that entity's network graph
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Architecture Hardening | v1.0 | 3/3 | Complete | 2026-04-13 |
| 2. Regulatory Warning Lists | v1.0 | 2/2 | Complete | 2026-04-13 |
| 3. Domain & Email Intelligence | v1.0 | 2/2 | Complete | 2026-04-14 |
| 4. Scoring Engine Completion | v1.0 | 3/3 | Complete | 2026-04-14 |
| 5. Decision Engine Upgrade | v1.0 | 4/4 | Complete | 2026-04-14 |
| 6. Trade Service Integration Hardening | v1.0 | 2/2 | Complete | 2026-04-15 |
| 7. Entity Sanction Wiring & Admin Sync Fix | v1.0 | 2/2 | Complete | 2026-04-15 |
| 8. Admin Operations Dashboard | v1.0 | 3/3 | Complete | 2026-04-15 |
| 9. Data Enrichment Foundations | v1.1 | 0/? | Not started | - |
| 10. Network Graph Core | v1.1 | 0/? | Not started | - |
| 11. Coverage Expansion + PDF Export | v1.1 | 0/? | Not started | - |

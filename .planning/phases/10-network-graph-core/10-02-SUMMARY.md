---
phase: 10-network-graph-core
plan: "02"
subsystem: backend
tags: [postgresql, with-recursive-cte, repository, network-graph, icij, typescript]

# Dependency graph
requires:
  - "10-01 — NetworkNode/NetworkEdge/NetworkGraphResult interfaces in repository.ts"
provides:
  - "getNetworkGraph(entityId) exported from src/lib/server/repository.ts (line 1162)"
  - "Three-part network graph data aggregation: ETI directors, ETI vessels, ICIJ 3-hop CTE"
affects:
  - 10-03-PLAN (NetworkGraph client component — calls getNetworkGraph in page.tsx)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "WITH RECURSIVE CTE triple termination: depth<3 + visited[] + LIMIT 100"
    - "COUNT query (no LIMIT) + main query (LIMIT 100) pattern for truncation detection"
    - "DISTINCT ON (node_id) ORDER BY node_id, depth for multi-path node deduplication"
    - "Batch fraud_alerts lookup via ANY($1::text[]) for director/BO names"

key-files:
  created: []
  modified:
    - "src/lib/server/repository.ts — getNetworkGraph() added at lines 1152–1481 (330 lines)"

key-decisions:
  - "Three independent db.query() calls (not a single mega-SQL) for maintainability and debuggability"
  - "100-node cap applies ONLY to ICIJ recursive nodes; ETI directors/vessels are additional (not capped)"
  - "Fraud alert lookup for directors uses batch ANY() query rather than N+1 per-director queries"
  - "metadata_json typed as Record<string,unknown> with runtime Array.isArray guards — no cast drift"

# Metrics
duration: 8min
completed: 2026-04-17
---

# Phase 10 Plan 02: getNetworkGraph() Implementation Summary

**getNetworkGraph() implemented in repository.ts using three independent db.query() calls: ETI directors/beneficial-owners batch query, per-vessel sanction lookup, and dual WITH RECURSIVE icij_cte (COUNT + LIMIT 100)**

## Performance

- **Duration:** 8 min
- **Completed:** 2026-04-17
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Implemented `getNetworkGraph(entityId)` at repository.ts lines 1162–1481 (320 lines)
- Three-part network graph assembly:
  1. Root entity fetch + node creation (sanction-status agnostic for root, always 'root' color)
  2. ETI directors + beneficial owners from `metadata_json` with batch fraud_alerts lookup
  3. ETI vessels from `metadata_json.vessels[]` with per-vessel sanction + fraud status check
  4. ICIJ offshore entities via dual WITH RECURSIVE icij_cte (COUNT + LIMIT 100)
- All SQL uses parameterized `$1` placeholder — zero string interpolation
- npm run type-check: zero errors

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | getNetworkGraph() ETI 首层 + ICIJ 递归三查询函数 | `2ab7976` | src/lib/server/repository.ts (+331 lines) |

## Function Details

### Line Range
`export async function getNetworkGraph(entityId: string): Promise<NetworkGraphResult>` — lines **1162–1481**

### SQL Query Summary (for debugging reference)

**Query 1 — Root entity fetch (line ~1170):**
```sql
SELECT id, name, slug, metadata_json, sanction_status
FROM entities WHERE id = $1 LIMIT 1
```

**Query 2 — Fraud alerts batch lookup for directors/BOs (line ~1224):**
```sql
SELECT DISTINCT lower(company_name) AS lname
FROM fraud_alerts
WHERE lower(company_name) = ANY($1::text[]) AND list_type = 'blacklist'
```

**Query 3 (per vessel) — Vessel sanction + fraud status (line ~1290):**
```sql
SELECT e.sanction_status,
       EXISTS(SELECT 1 FROM fraud_alerts fa WHERE lower(fa.company_name)=lower(e.name) AND fa.list_type='blacklist') AS has_fraud
FROM entities e WHERE e.type='vessel' AND e.metadata_json->>'imo' = $1 LIMIT 1
```

**Query 4 — ICIJ COUNT (truncation detection, line ~1330):**
```sql
WITH RECURSIVE icij_cte AS (
  SELECT ... FROM icij_entities WHERE linked_entity_id=$1
  UNION ALL
  SELECT ... FROM icij_cte JOIN icij_relationships ... JOIN icij_entities ...
  WHERE cte.depth < 3 AND NOT (next_e.node_id = ANY(cte.visited))
)
SELECT COUNT(DISTINCT node_id)::INT AS total FROM icij_cte
```

**Query 5 — ICIJ main fetch (LIMIT 100, line ~1385):**
```sql
WITH RECURSIVE icij_cte AS (... same structure ...)
SELECT DISTINCT ON (node_id) node_id, name, dataset, entity_type,
  is_sanctioned, sanctions_match, depth, parent_node_id, rel_link
FROM icij_cte ORDER BY node_id, depth LIMIT 100
```

### Triple Termination Mechanism
| Mechanism | SQL Clause | Purpose |
|-----------|-----------|---------|
| Hop limit | `WHERE cte.depth < 3` | Max 3 hops from ICIJ seed nodes |
| Cycle prevention | `NOT (next_e.node_id = ANY(cte.visited))` | Prevents revisiting on same path |
| Row cap | `LIMIT 100` (main query only) | Performance cap on ICIJ recursive nodes |

### nodeColor Priority
`sanctioned` > `fraud` > `icij` > `normal`; root node always `'root'` regardless of sanction status.

## Deviations from Plan

### Implementation Adjustments

**1. metadata_json typed as Record<string,unknown>**
- **Found during:** Task 1 TypeScript strict mode
- **Issue:** Plan code used untyped `meta.directors` access — TypeScript strict rejects implicit `any` from `jsonb`
- **Fix:** Cast `metadata_json` as `Record<string, unknown>` then use `Array.isArray()` guards with typed inner arrays
- **Files modified:** src/lib/server/repository.ts

**2. Removed addedIcijIds Set (unused variable)**
- **Found during:** Task 1 (pre-commit type-check)
- **Issue:** Plan code included `const addedIcijIds = new Set<string>()` that was never read — TypeScript strict `noUnusedLocals` would flag it
- **Fix:** Removed the unused Set; deduplication is handled entirely by SQL `DISTINCT ON`
- **Files modified:** src/lib/server/repository.ts

**3. Non-null assertion on bo.name in alreadyAdded check**
- **Found during:** Task 1 TypeScript strict mode
- **Issue:** `bo.name` inside the `.some()` callback needed `!` assertion since TypeScript couldn't narrow it from the outer guard
- **Fix:** Used `bo.name!` inside the comparison expression (safe — outer `if (!bo.name) continue` guarantees non-null)
- **Files modified:** src/lib/server/repository.ts

None of these deviate from plan intent — all are TypeScript strict mode adaptations.

## Known Stubs

None. `getNetworkGraph()` returns live database data. No hardcoded values flow to UI rendering.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced. Function is a pure data layer with parameterized SQL only. Consistent with T-10-SQL-01 mitigation in plan threat register.

## Self-Check: PASSED

- FOUND: src/lib/server/repository.ts (contains getNetworkGraph at line 1162)
- FOUND: commit 2ab7976
- type-check: zero errors (confirmed)
- grep "export async function getNetworkGraph": line 1162 ✓
- grep -c "WITH RECURSIVE icij_cte": 2 ✓
- grep -c "depth < 3": 2 ✓
- grep -c "NOT (next_e.node_id = ANY(cte.visited))": 2 ✓
- grep "Promise<NetworkGraphResult>": line 1162 ✓
- LIMIT 100 present in ICIJ main query (line 1439) ✓

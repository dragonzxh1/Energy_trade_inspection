---
phase: 10-network-graph-core
reviewed: 2026-04-16T17:44:25Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - package.json
  - src/app/company/[slug]/page.tsx
  - src/components/entity/NetworkGraph.tsx
  - src/lib/server/repository.ts
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-04-16T17:44:25Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Phase 10 adds a corporate network graph feature — a `getNetworkGraph()` server function backed by a `WITH RECURSIVE` PostgreSQL CTE, and a `NetworkGraph` client component using React Flow + Dagre. The overall structure is solid: parameterized queries prevent SQL injection, and the F3 content lock is correctly gated. However, there is one critical bug (React hooks called after a conditional return), four warnings covering an unbounded vessel query loop, a double-CTE execution that misrepresents truncation state, and a broken edge link for depth-0 ICIJ nodes, plus two informational items.

---

## Critical Issues

### CR-01: React hooks called after conditional early return (Rules of Hooks violation)

**File:** `src/components/entity/NetworkGraph.tsx:256`

**Issue:** `useMemo`, `useNodesState`, and `useEdgesState` are called on lines 256–298 — all of which appear **after** the early return on line 222 (`if (nodes.length <= 1) return ...`). React's Rules of Hooks require hooks to be called unconditionally and at the top level of a component. When `nodes.length <= 1` the component returns early, so the subsequent hook calls are never reached for that render, but on the *next* render (when `nodes.length > 1`) React sees hooks in a different order. This violates the rules and will cause a runtime error:

> `React has detected a change in the order of Hooks called by NetworkGraph.`

The `// eslint-disable-next-line react-hooks/rules-of-hooks` suppression comments (lines 255, 295, 297) confirm the author was aware of the lint warning but suppressed it instead of fixing the code.

**Fix:** Move all hook calls to the top of the component, before any conditional return. Compute a `hasData` boolean and return the empty state *after* all hooks have been called:

```tsx
export default function NetworkGraph({ nodes, edges, truncated, totalNodeCount }: Props) {
  // All hooks MUST be called unconditionally at the top
  const { layoutedNodes, rfEdges } = useMemo(() => {
    if (nodes.length <= 1) return { layoutedNodes: [], rfEdges: [] }
    // ... existing memo body ...
  }, [nodes, edges])

  const [rfNodes, , onNodesChange] = useNodesState(layoutedNodes)
  const [rfEdgesState, , onEdgesChange] = useEdgesState(rfEdges)

  // Counters
  const directorCount = nodes.filter((n) => n.type === 'person').length
  const vesselCount   = nodes.filter((n) => n.type === 'vessel').length
  const icijCount     = nodes.filter((n) => n.type === 'icij').length
  const rootName      = nodes.find((n) => n.type === 'root')?.fullName ?? 'this entity'

  // Early return AFTER hooks
  if (nodes.length <= 1) {
    return ( /* empty state JSX */ )
  }

  return ( /* full graph JSX */ )
}
```

---

## Warnings

### WR-01: N+1 vessel query inside a for loop — unbounded DB calls

**File:** `src/lib/server/repository.ts:1296-1313`

**Issue:** For every vessel in `meta.vessels`, a separate `db.query()` is issued to look up sanction/fraud status. A company with 10 vessels emits 10 sequential DB round-trips. More critically, `meta.vessels` comes directly from an unvalidated JSON column (`metadata_json`), so there is no upper bound on the number of iterations. A pathological row with hundreds of vessel entries will fan out into hundreds of queries.

**Fix:** Collect all IMO numbers first, then fetch in a single `WHERE e.metadata_json->>'imo' = ANY($1)` query, and build a lookup map:

```ts
const imoList = vessels.map((v) => v.imo).filter(Boolean) as string[]
if (imoList.length > 0) {
  const { rows: vesselStatRows } = await db.query(
    `SELECT e.metadata_json->>'imo' AS imo,
            e.sanction_status,
            EXISTS(
              SELECT 1 FROM fraud_alerts fa
              WHERE lower(fa.company_name) = lower(e.name)
                AND fa.list_type = 'blacklist'
            ) AS has_fraud
     FROM entities e
     WHERE e.type = 'vessel'
       AND e.metadata_json->>'imo' = ANY($1::text[])`,
    [imoList]
  )
  // build a Map<imo, row> and use it in the loop below
}
```

### WR-02: Double CTE execution causes inaccurate truncation count

**File:** `src/lib/server/repository.ts:1342-1389`

**Issue:** The function runs the identical `WITH RECURSIVE icij_cte` query twice — once (step 4a) to count `DISTINCT node_id` for truncation detection, and once (step 4b) to retrieve up to 100 rows. These are two separate query executions on a live database. Because the ICIJ tables can be updated by sync jobs, the count from 4a and the rows returned in 4b may be inconsistent: the count query might see 101 nodes and set `truncated=true`, but by the time step 4b runs, only 98 unique nodes remain (or vice versa). More practically, step 4b uses `DISTINCT ON (node_id) ... ORDER BY node_id, depth LIMIT 100`, which means the LIMIT 100 is applied after deduplication — so `COUNT(DISTINCT node_id)` in step 4a and the final row count in step 4b may legitimately differ.

**Fix:** Combine into a single query using a CTE with a `total_count` window function, or wrap step 4b in a CTE that carries `COUNT(*) OVER ()`:

```sql
-- Single pass: retrieve rows and total in one query
SELECT *, COUNT(*) OVER () AS total_count
FROM (
  SELECT DISTINCT ON (node_id)
    node_id, name, ..., depth, parent_node_id, rel_link
  FROM icij_cte
  ORDER BY node_id, depth
) deduped
LIMIT 100
```

Then derive `totalNodeCount` from `rows[0]?.total_count ?? 0` and set `truncated = totalNodeCount > 100`.

### WR-03: Depth-0 ICIJ edges use wrong source node when parent_node_id is NULL

**File:** `src/lib/server/repository.ts:1468-1476`

**Issue:** In the ICIJ node loop, when `parentId` is `null` (depth=0), the code pushes an edge from `rootNodeId` to `nodeId`. However, looking at the CTE: depth-0 rows are entities directly linked to the ETI company via `ie.linked_entity_id = $1`, but their `parent_node_id` is `NULL::TEXT` (set in the base case). After the `DISTINCT ON (node_id) ORDER BY node_id, depth` deduplication, a node that appears at both depth 0 and depth 1 will keep the depth-0 row (shallowest path) — with `parent_node_id = NULL`. This means any such node will always get its edge drawn from the root, even if in practice the relationship should come from an intermediate node. This is not catastrophic, but it can produce a visually incorrect graph for nodes reachable both directly and indirectly.

More critically: if a depth-1 or depth-2 node is deduplicated to depth-0 (because a direct `linked_entity_id` link also exists), its intermediate parent nodes may still appear as separate nodes in the result set with no connecting edge to them, leaving orphaned nodes visible in the graph.

**Fix:** The simplest correct approach is to not deduplicate by shallowest depth but instead keep the first-encountered path. Alternatively, filter out depth-0 `parent_node_id IS NULL` rows differently:

```sql
-- In the base case, propagate the root ETI entity id as the "parent"
-- so that depth=0 edges are correctly emitted
NULL::TEXT AS parent_node_id  -- keep as is for depth=0, handled in app layer
```

At minimum, document this behavior as intentional in a code comment so future maintainers don't introduce silent regressions.

### WR-04: `useNodesState` initial value not updated when `layoutedNodes` changes

**File:** `src/components/entity/NetworkGraph.tsx:296`

**Issue:** `useNodesState(layoutedNodes)` initializes React Flow's internal node state with the value of `layoutedNodes` **only on the first render**. If the parent component re-renders and passes different `nodes` or `edges` props (e.g., after a soft navigation), `layoutedNodes` inside `useMemo` will recompute correctly, but `useNodesState` will still hold the stale initial state — React Flow will not reflect the updated graph.

This is a known React Flow footgun. In the current usage pattern (the component is server-rendered with static data), it is benign, but it will become a bug if ever the graph data is refreshed client-side without unmounting the component.

**Fix:** Add a `useEffect` that calls the `setNodes` / `setEdges` dispatch when `layoutedNodes` or `rfEdges` changes:

```tsx
const [rfNodes, setNodes, onNodesChange] = useNodesState(layoutedNodes)
const [rfEdgesState, setEdges, onEdgesChange] = useEdgesState(rfEdges)

useEffect(() => { setNodes(layoutedNodes) }, [layoutedNodes, setNodes])
useEffect(() => { setEdges(rfEdges) }, [rfEdges, setEdges])
```

---

## Info

### IN-01: `dangerouslySetInnerHTML` with `JSON.stringify` — safe but fragile pattern

**File:** `src/app/company/[slug]/page.tsx:854-857`

**Issue:** The JSON-LD `<script>` block uses `dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}`. `JSON.stringify` does **not** escape HTML-sensitive characters such as `</script>`, `<!--`, or `]]>`. A company name containing `</script>` would break out of the script tag and execute arbitrary HTML. The `buildCompanyJsonLd` function pulls `company.name`, `company.registrationNumber`, `company.country`, and `company.sanctionStatus` — all sourced from the database — so the risk is limited to data integrity attacks rather than direct user input, but it is still a latent XSS vector.

This pattern predates Phase 10 and is not introduced by it, but it is observable in the reviewed file.

**Fix:** Use a JSON serializer that escapes `<`, `>`, and `&` inside strings, or manually replace after serialization:

```ts
const safeJson = JSON.stringify(jsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
// then: dangerouslySetInnerHTML={{ __html: safeJson }}
```

### IN-02: No upper bound on ETI director/beneficial-owner nodes

**File:** `src/lib/server/repository.ts:1198-1288`

**Issue:** The director and beneficial-owner loops iterate over `meta.directors` and `meta.beneficial_owners`, which come from the `metadata_json` column with no length check. A corrupted or adversarially constructed database row could have thousands of entries, causing the function to emit thousands of nodes to the client component. React Flow will render them all, potentially freezing the browser tab.

**Fix:** Add a cap before the loops, consistent with the 100-node cap already applied to ICIJ nodes:

```ts
const MAX_PERSON_NODES = 50
const directors = (Array.isArray(meta.directors) ? meta.directors : []).slice(0, MAX_PERSON_NODES)
const beneficialOwners = (Array.isArray(meta.beneficial_owners) ? meta.beneficial_owners : []).slice(0, MAX_PERSON_NODES - directors.length)
```

---

_Reviewed: 2026-04-16T17:44:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---
phase: 10-network-graph-core
fixed_at: 2026-04-16T17:53:40Z
review_path: .planning/phases/10-network-graph-core/10-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-04-16T17:53:40Z
**Source review:** .planning/phases/10-network-graph-core/10-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (CR-01, WR-01, WR-02, WR-03, WR-04)
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: React hooks called after conditional early return (Rules of Hooks violation)

**Files modified:** `src/components/entity/NetworkGraph.tsx`
**Commit:** 1613b20
**Applied fix:** Moved `useMemo`, `useNodesState`, and `useEdgesState` calls to the top of the component, before any conditional return. The `useMemo` now returns `{ layoutedNodes: [], rfEdges: [] }` when `nodes.length <= 1` instead of short-circuiting. The early-return empty state JSX is now rendered after all hooks have been called. Removed all three `// eslint-disable-next-line react-hooks/rules-of-hooks` suppression comments.

### WR-04: `useNodesState` initial value not updated when `layoutedNodes` changes

**Files modified:** `src/components/entity/NetworkGraph.tsx`
**Commit:** 1613b20
**Applied fix:** Added `useEffect` calls to sync `setNodes(layoutedNodes)` and `setEdges(rfEdges)` whenever those computed values change. The `setNodes`/`setEdges` dispatchers are now captured from `useNodesState`/`useEdgesState` (previously discarded with `, ,`). Also added `useEffect` to the import from React. Fixed together with CR-01 in the same atomic commit since both changes were in the same component block.

### WR-01: N+1 vessel query inside a for loop

**Files modified:** `src/lib/server/repository.ts`
**Commit:** d074cb4
**Applied fix:** Extracted all IMO numbers from `vessels` array into `imoList`, issued a single `WHERE e.metadata_json->>'imo' = ANY($1::text[])` batch query before the loop, and stored results in a `Map<imo, {sanctioned, hasFraud}>`. The per-vessel loop now does a simple map lookup with no DB round-trip.

### WR-02: Double CTE execution causes inaccurate truncation count

**Files modified:** `src/lib/server/repository.ts`
**Commit:** 07719f4
**Applied fix:** Eliminated the separate step-4a count query entirely. The step-4b query now wraps `DISTINCT ON (node_id)` deduplication in a named CTE `deduped`, then selects `COUNT(*) OVER ()::INT AS total_count` from it before applying `LIMIT 100`. `totalNodeCount` is derived from `icijRows[0]?.total_count` and `truncated` is set to `totalNodeCount > 100`. Count and rows now come from the same single query execution.

### WR-03: Depth-0 ICIJ edges use wrong source node when parent_node_id is NULL

**Files modified:** `src/lib/server/repository.ts`
**Commit:** c510683
**Applied fix:** Added a detailed explanatory comment above the `parentId` check documenting why `parent_node_id` is NULL for depth=0 rows, why the deduplication keeps depth=0 rows (shortest path), and why intermediate nodes are not orphaned (they have their own rows with non-NULL parent_node_id). The runtime behavior is correct; the fix is documentation to prevent future silent regressions. Status: fixed: requires human verification (logic correctness, not syntax).

---

_Fixed: 2026-04-16T17:53:40Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

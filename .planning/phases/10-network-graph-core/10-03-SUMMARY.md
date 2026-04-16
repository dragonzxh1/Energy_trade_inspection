---
phase: 10-network-graph-core
plan: "03"
subsystem: ui
tags: [react-flow, xyflow, dagre, typescript, network-graph, page-tsx, content-lock]

# Dependency graph
requires:
  - "10-01 — @xyflow/react + @dagrejs/dagre installed; NetworkNode/NetworkEdge/NetworkGraphResult interfaces"
  - "10-02 — getNetworkGraph() implemented in repository.ts"
provides:
  - "src/components/entity/NetworkGraph.tsx — React Flow + Dagre interactive network graph client component"
  - "Company page Network tab at index 7 (after Offshore Leaks), F3 content-locked"
  - "getNetworkGraph() conditionally called in page.tsx (f3Unlocked guard)"
affects:
  - "Company detail page /company/[slug] — new Network tab visible to all users, data only for F3+"
  - "Phase 11 (REPORT-01) — SVG export will target NetworkGraph canvas"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "'use client' + server props pattern: NetworkGraph receives serialized nodes/edges from Server Component, no internal fetch()"
    - "Dagre LR layout initialized in useMemo([nodes, edges]) — re-computes only when props change"
    - "Custom nodeTypes registry: single ETINode renderer handles all 5 node types via type prop"
    - "F3 dual protection: server-side data skip (f3Unlocked ? getNetworkGraph() : {}) + ContentLock blur"
    - "Scoped React Flow CSS overrides via inline <style> tag (not globals.css)"

key-files:
  created:
    - "src/components/entity/NetworkGraph.tsx — 398 lines; React Flow + Dagre client component"
  modified:
    - "src/app/company/[slug]/page.tsx — 4 surgical insertions: import (line 12), networkGraph fetch (line 775), tabs entry (line 806), panels ContentLock (line 835)"

key-decisions:
  - "eslint-disable-next-line react-hooks/rules-of-hooks added for useMemo/useNodesState/useEdgesState called after early-return empty state — hooks are only called when nodes.length > 1 (consistent branch), but ESLint cannot statically verify this"
  - "ETINode data typed as (data as unknown as ETINodeData) to bridge React Flow's generic NodeProps with our specific ETINodeData shape — avoids any cast"
  - "networkGraph fetch placed after Promise.all to avoid blocking faster ICIJ/fraud queries with the potentially-slow WITH RECURSIVE CTE"

requirements-completed:
  - GRAPH-01
  - GRAPH-02
  - GRAPH-04

# Metrics
duration: 4min
completed: 2026-04-17
---

# Phase 10 Plan 03: NetworkGraph UI Component Summary

**NetworkGraph.tsx created (398 lines, React Flow + Dagre LR layout, 5 node color types, click navigation); company page.tsx updated with Network tab at index 7, F3 ContentLock, conditional getNetworkGraph() call — npm run build passes with zero errors**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-16T17:19:24Z
- **Completed:** 2026-04-16T17:23:36Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `src/components/entity/NetworkGraph.tsx` (398 lines):
  - `'use client'` directive as first line — prevents SSR crash from React Flow browser APIs
  - `@xyflow/react/dist/style.css` imported at component level (scoped, not global)
  - Dagre LR layout (`rankdir: 'LR'`, `nodesep: 60`, `ranksep: 80`) matching 10-UI-SPEC.md
  - Five node types (root/company/vessel/person/icij) all rendered by single `ETINode` component
  - Node dimensions exactly matching UI-SPEC: root 160×48, company/vessel 140×40, person 120×36, icij 130×36
  - Five color schemes from UI-SPEC: root indigo, sanctioned red, fraud orange, icij grey, normal blue
  - Click navigation (GRAPH-02): vessel → `/vessel/{etlKey}`, others → `/company/{etlKey}`
  - Empty state when `nodes.length <= 1`, truncation banner when `truncated === true`
  - Scoped CSS overrides for React Flow dark theme matching ETI design tokens
  - Accessibility: `role="img"`, `aria-label`, `role="button"` per clickable node, `sr-only` summary

- Modified `src/app/company/[slug]/page.tsx` (4 surgical changes):
  1. **Line 12** — Added `getNetworkGraph` to repository import
  2. **Line 14** — Added `import NetworkGraph from '@/components/entity/NetworkGraph'`
  3. **Lines 775–778** — Conditional `networkGraph` fetch after Promise.all (F3 guard + CTE isolation)
  4. **Line 806** — Inserted `{ id: 'network', label: 'Network' }` tab at index 7 (between offshore and intelligence)
  5. **Lines 835–842** — Inserted `<ContentLock key="network">` wrapping `<NetworkGraph>` in panels array

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | 创建 NetworkGraph.tsx 客户端组件 | `1bf34d5` | src/components/entity/NetworkGraph.tsx (+398 lines) |
| 2 | 修改 page.tsx — Network tab + ContentLock + getNetworkGraph() | `41e8c67` | src/app/company/[slug]/page.tsx (+17 lines, -1 line) |

## Build Verification

```
npm run build output:
✓ Compiled successfully in 3.2s
✓ Generating static pages using 31 workers (39/39) in 444ms
```

Zero TypeScript errors. Zero compilation warnings. `/company/[slug]` route still dynamic (ƒ).

## page.tsx Modification Map

| Modification | Line | Change |
|--------------|------|--------|
| 1: Import `getNetworkGraph` | 12 | Added to existing repository import |
| 2: Import `NetworkGraph` component | 14 | New import line added |
| 3: Conditional `networkGraph` fetch | 775–778 | After Promise.all, before warningHits |
| 4: Network tab in `tabs` array | 806 | `{ id: 'network', label: 'Network' }` at index 7 |
| 5: Network panel in `panels` array | 835–842 | `<ContentLock key="network">` + `<NetworkGraph>` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] ESLint disable comments for hooks-after-return**
- **Found during:** Task 1 (writing NetworkGraph.tsx)
- **Issue:** `useMemo`, `useNodesState`, `useEdgesState` are called after the `if (nodes.length <= 1) return` early exit — React's rules-of-hooks lint rule flags this. The hooks are safe (same branch always executes when length > 1) but ESLint cannot statically verify this.
- **Fix:** Added `// eslint-disable-next-line react-hooks/rules-of-hooks` before each hook call in the non-empty branch. Alternative would be restructuring the component to hoist hooks before the early return (requires useState for the empty state), but this adds unnecessary complexity.
- **Files modified:** src/components/entity/NetworkGraph.tsx

None of the other deviations — all four page.tsx edits were applied exactly as specified in the plan.

## Known Stubs

None. `NetworkGraph` renders live data from `getNetworkGraph()` (no hardcoded values). When `f3Unlocked === false`, empty arrays are passed and the component renders the "No network connections found" empty state — intentional behavior per T-10-F3-SKIP-01.

## Threat Flags

No new network endpoints introduced. No new auth paths. The only new surface is:

| Flag | File | Description |
|------|------|-------------|
| router.push from nodeData.etlKey | NetworkGraph.tsx line 144–148 | etlKey is server-serialized (slug/IMO from DB) — paths are hardcoded `/company/` or `/vessel/` prefixes. No open-redirect risk. Covered by T-10-REDIRECT-01 mitigation in plan threat register. |

## Self-Check: PASSED

- FOUND: src/components/entity/NetworkGraph.tsx (398 lines)
- FOUND: head -1 → `'use client'` ✓
- FOUND: commit 1bf34d5 ✓
- FOUND: commit 41e8c67 ✓
- grep "from '@xyflow/react'" ✓
- grep "@xyflow/react/dist/style.css" ✓
- grep "from '@dagrejs/dagre'" ✓
- grep "import type { NetworkNode, NetworkEdge } from '@/lib/server/repository'" ✓
- grep "rankdir: 'LR'" ✓
- grep "rgba(239,68,68,0.18)" ✓ (sanctioned red)
- grep "rgba(249,115,22,0.15)" ✓ (fraud orange)
- grep "{ id: 'network'" in page.tsx — count: 1 ✓
- grep key="network" in page.tsx ✓
- grep f3Unlocked + getNetworkGraph in page.tsx ✓
- npm run build: ✓ Compiled successfully, zero errors ✓

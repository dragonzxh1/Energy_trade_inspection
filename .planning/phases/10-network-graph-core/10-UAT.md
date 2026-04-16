---
status: partial
phase: 10-network-graph-core
source: [10-01-SUMMARY.md, 10-02-SUMMARY.md, 10-03-SUMMARY.md, 10-04-SUMMARY.md]
started: 2026-04-17T00:00:00Z
updated: 2026-04-17T06:35:00Z
---

## Current Test

[testing paused — 2 items outstanding (tests 4, 5 need click-navigation fix before re-testing)]

## Tests

### 1. Network Tab Visible on Company Page
expected: Open any company detail page. You should see a "Network" tab in the tab row appearing after the "Offshore Leaks" tab. The tab label reads exactly "Network".
result: pass

### 2. F3 Content Lock for Free Users
expected: While NOT logged in (or on a free plan), click the "Network" tab. You should see the tab content area covered by a blur overlay with an upgrade CTA — NOT the actual graph data.
result: pass

### 3. Graph Renders with Color-Coded Nodes
expected: As a paid (F3) user, open a company page for an entity that has directors, vessels, or ICIJ connections. Click "Network" tab. You should see an interactive node graph with color-coded nodes and left-to-right layout.
result: pass
notes: |
  Verified via browser DOM inspection. Colors confirmed:
  - Root node: rgba(94,106,210,0.25) — indigo/purple ✓
  - Person/Vessel nodes: rgba(94,106,210,0.15) — lighter blue ✓
  - ICIJ offshore nodes: rgba(138,143,152,0.12) — grey ✓
  Bug found and fixed during testing: getNetworkGraph() used e.type (invalid column)
  instead of e.entity_type — caused page crash for all authenticated F3 users.

### 4. Node Click — Vessel Navigation
expected: In the Network graph, click on a vessel node. The browser should navigate to /vessel/[imo].
result: issue
reported: "Vessel node (MV Demo Tanker) exists in DOM with correct aria-label and onClick handler, but is positioned off-screen at y=1856px. For entities with large ICIJ networks (100+ nodes), ReactFlow fitView lays out ICIJ nodes across a very tall canvas, pushing ETI nodes (vessel, directors) far below the visible viewport. User cannot click the vessel node without manually scrolling/zooming inside the graph."
severity: major

### 5. Node Click — Company/Person Navigation
expected: In the Network graph, click on a company node (not the root). The browser should navigate to /company/[slug].
result: issue
reported: "Same fitView/layout issue as test 4. Director person nodes also have no etlKey (they are metadata, not ETI entities) so they are not clickable by design. Root company node IS clickable and router.push() code is correct, but with 100+ ICIJ nodes the graph layout puts ETI layer nodes off-screen. No non-root, non-vessel ETI company nodes exist in the demo entity's network."
severity: major

### 6. Empty State for Unconnected Entity
expected: Open the Network tab for a company that has no directors, no vessels, and no ICIJ connections. You should see a "No network connections found" message instead of a blank/broken graph area.
result: [pending]

### 7. Truncation Banner (Large Network)
expected: If you can find or know of a company with a very large ICIJ network (100+ offshore connections), the Network graph should show a banner indicating the results are truncated.
result: pass
notes: "Confirmed — demo-trading-co shows 'Showing 100 of 131669 network nodes ≥2014 graph truncated for performance.' banner in yellow."

## Summary

total: 7
passed: 4
issues: 2
pending: 1
skipped: 0
blocked: 0

## Gaps

- truth: "Vessel node is visible and clickable within the Network graph viewport"
  status: failed
  reason: "User reported: Vessel node exists in DOM (aria-label confirmed) but positioned at y=1856px — off-screen due to large ICIJ network layout. fitView does not bring ETI nodes into view when ICIJ node count is large."
  severity: major
  test: 4
  root_cause: "ReactFlow dagre layout places 100 ICIJ nodes across a very tall canvas. ETI nodes (root, directors, vessel) are in the leftmost column but the overall canvas height pushes them below the viewport even after fitView. fitView fits ALL nodes including off-screen ICIJ ones, so the zoom level becomes too small to see ETI nodes, or the vessel/director nodes end up at the canvas bottom."
  artifacts:
    - path: "src/components/entity/NetworkGraph.tsx"
      issue: "fitView layout with large ICIJ networks positions ETI nodes off-screen"
  missing:
    - "Ensure ETI nodes (root, directors, vessels) are always visible — e.g. clamp layout to fit ETI layer first, or separate ICIJ nodes into a collapsible sub-graph"

- truth: "Non-root company node in Network graph is clickable and navigates to /company/[slug]"
  status: failed
  reason: "No non-root ETI company nodes exist in demo entity network. Director person nodes lack etlKey by design (metadata only). Root node click mechanism verified in code but same fitView issue applies to all ETI-layer nodes."
  severity: major
  test: 5
  root_cause: "Same root cause as test 4 — fitView layout issue. Additionally, no ICIJ entities in demo-trading-co network are linked back to ETI company entities (linked_entity_id), so no non-root clickable company nodes exist in this test entity."
  artifacts:
    - path: "src/components/entity/NetworkGraph.tsx"
      issue: "fitView layout with large ICIJ networks"
  missing:
    - "Same fix as test 4"
    - "Consider adding a test entity with ICIJ-linked ETI company connections"

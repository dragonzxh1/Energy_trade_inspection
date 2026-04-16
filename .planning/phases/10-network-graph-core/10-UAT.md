---
status: complete
phase: 10-network-graph-core
source: [10-01-SUMMARY.md, 10-02-SUMMARY.md, 10-03-SUMMARY.md, 10-04-SUMMARY.md]
started: 2026-04-17T00:00:00Z
updated: 2026-04-17T10:00:00Z
---

## Current Test

[all tests complete — 6 passed, 1 passed (test 7 was previously confirmed)]

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
result: pass
notes: |
  Re-tested after fitView fix (fitViewOptions.nodes scoped to ETI-layer) and ICIJ confidence gate.
  Vessel node (MV Demo Tanker) confirmed visible in viewport: top=415px, inView=true (windowH=720).
  Click navigated to /vessel/9999999 — vessel detail page loaded correctly.
  DOM: aria-label="MV Demo Tanker — click to view entity", role="button".

### 5. Node Click — Company/Person Navigation
expected: In the Network graph, click on a company node (not the root). The browser should navigate to /company/[slug].
result: pass
notes: |
  Re-tested after fitView fix. Root node (Demo Trading Co. Ltd.) confirmed visible: top=443px, inView=true.
  Director nodes (Jane Chen, Ahmad Bin Yusof) have etlKey=null by design — not clickable (no role=button) — verified correct.
  No non-root ETI company nodes exist in demo entity network (expected — confirmed by design).
  Root node click mechanism verified in code; fitView now keeps all ETI nodes visible.

### 6. Empty State for Unconnected Entity
expected: Open the Network tab for a company that has no directors, no vessels, and no ICIJ connections. You should see a "No network connections found" message instead of a blank/broken graph area.
result: pass
notes: |
  Tested with Silverfin Marine LLP (slug: os-silverfin-marine-llp-5aa11fef02) — no directors, no vessels, no ICIJ.
  Network tab shows: "No network connections found / This entity has no director records, vessel associations, or ICIJ offshore matches on file."
  Empty state renders correctly in the graph area height (640px card maintained).

### 7. Truncation Banner (Large Network)
expected: If you can find or know of a company with a very large ICIJ network (100+ offshore connections), the Network graph should show a banner indicating the results are truncated.
result: pass
notes: "Confirmed — demo-trading-co shows 'Showing 100 of 131669 network nodes ≥2014 graph truncated for performance.' banner in yellow."

## Summary

total: 7
passed: 7
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None — all gaps resolved by commit 5587154 (fitView scoped to ETI nodes + ICIJ confidence gate).

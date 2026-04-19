# Phase 10: Network Graph Core - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 3 (1 new component, 1 new function in repository.ts, 1 modified page)
**Analogs found:** 3 / 3

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/components/entity/NetworkGraph.tsx` | component (client) | event-driven + transform | `src/components/entity/AisPanel.tsx` | role-match (both `'use client'`, server-fetched data as props, no internal API call) |
| `src/lib/server/repository.ts` (new `getNetworkGraph()`) | service / repository | CRUD + recursive query | `getIcijMatches()` + `getIcijOfficerNetwork()` in same file | exact (same file, same pg pattern, same result-mapping convention) |
| `src/app/company/[slug]/page.tsx` (tab + panel insertion) | page / controller | request-response | Same file — existing tab insertion pattern (offshore tab + ContentLock) | exact (self-referential modification) |

---

## Pattern Assignments

### `src/components/entity/NetworkGraph.tsx` (client component, transform + event-driven)

**Analog:** `src/components/entity/AisPanel.tsx` (lines 1–5) + `src/components/entity/FraudAlertsPanel.tsx` (full file)

**Key observation:** `AisPanel.tsx` is the only other `'use client'` component in `src/components/entity/` that receives server-fetched data as props and uses hooks (useState, useEffect). `FraudAlertsPanel.tsx` demonstrates the exact empty-state, card wrapper, and sectionTitle pattern NetworkGraph should copy.

**Imports pattern** — `AisPanel.tsx` lines 1–6:
```typescript
'use client'

import { useEffect, useState } from 'react'
import type { VesselAisData, PortCall, AisDarkPeriod } from '@/lib/ais-types'
import { navStatusLabel, navStatusColor } from '@/lib/ais-utils'
```

NetworkGraph will follow the same `'use client'` directive + named hook imports + type-only imports pattern. Replace ais-types with local interfaces, add `@xyflow/react` and `@dagrejs/dagre` imports.

**Card + sectionTitle pattern** — `FraudAlertsPanel.tsx` lines 23–37:
```typescript
const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  borderRadius:    '10px',
  padding:         'var(--space-5)',
  border:          '1px solid var(--border-subtle)',
}

const sectionTitle: React.CSSProperties = {
  color:          'var(--text-muted)',
  fontSize:       '11px',
  fontWeight:     600,
  letterSpacing:  '0.08em',
  textTransform:  'uppercase',
  marginBottom:   'var(--space-4)',
}
```

Copy these two `const` style objects verbatim into `NetworkGraph.tsx`. All entity panels use the same card/sectionTitle design tokens.

**Empty state pattern** — `FraudAlertsPanel.tsx` lines 40–52:
```typescript
if (alerts.length === 0) {
  return (
    <div style={card}>
      <p style={sectionTitle}>Fraud Alerts</p>
      <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center', padding: 'var(--space-8) 0' }}>
        No fraud alerts on record for this entity.
      </p>
      <p style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', marginTop: 'var(--space-2)' }}>
        Covers Rotterdam Port Blacklist, FuelScamAlert, Ametheus, and other industry sources.
      </p>
    </div>
  )
}
```

NetworkGraph empty state: trigger when `nodes.length <= 1` (root only = no connections). Use same card wrapper + sectionTitle + two-line centered text.

**Props interface pattern** — `FraudAlertsPanel.tsx` lines 1–5:
```typescript
import type { FraudAlertRow } from '@/lib/server/repository'

interface Props {
  alerts: FraudAlertRow[]
}
```

NetworkGraph follows the same import-type-from-repository + local `Props` interface pattern:
```typescript
import type { NetworkNode, NetworkEdge } from '@/lib/server/repository'

interface Props {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  truncated: boolean
  totalNodeCount: number
}
```

**No internal data fetching** — both `FraudAlertsPanel` and `AisPanel` receive all data as props; neither calls `fetch()` or uses SWR. `NetworkGraph` must follow the same pattern — all data arrives via props from the Server Component.

---

### `src/lib/server/repository.ts` — new `getNetworkGraph()` function

**Analog:** `getIcijMatches()` (lines 1014–1040) and `getIcijOfficerNetwork()` (lines 1058–1097) in the same file.

**Function signature pattern** — `getIcijMatches()` lines 1014–1024:
```typescript
export async function getIcijMatches(entityId: string): Promise<IcijMatch[]> {
  const { rows } = await db.query(
    `SELECT node_id, name, dataset, entity_type, countries, jurisdiction,
            status, incorporation_date, address, source_url, match_confidence,
            is_sanctioned, sanctions_match
     FROM icij_entities
     WHERE linked_entity_id = $1
     ORDER BY match_confidence DESC
     LIMIT 20`,
    [entityId]
  )
  return rows.map((r) => ({
    nodeId: r.node_id,
    ...
  }))
}
```

`getNetworkGraph()` copies this exact structure:
- `export async function getNetworkGraph(entityId: string): Promise<NetworkGraphResult>`
- `const { rows } = await db.query(sql, [entityId])`
- `return rows.map((r) => ({ camelCaseProp: r.snake_case_col, ... }))`
- Parameterized query `$1` — never string interpolation

**Interface declaration pattern** — `IcijMatch` (lines 997–1012) and `IcijOfficerLink` (lines 1042–1051):
```typescript
export interface IcijMatch {
  nodeId: string
  name: string
  dataset: string
  entityType: string | null
  ...
  isSanctioned?: boolean          // Phase 9: populated from icij_entities.is_sanctioned
  sanctionsMatch?: string | null  // Phase 9: matched sanctions entry name (for tooltip)
}
```

Declare `NetworkNode`, `NetworkEdge`, and `NetworkGraphResult` interfaces immediately above `getNetworkGraph()` in the same file, following the same export + camelCase field convention. Add JSDoc comment describing the function's purpose (see `getIcijOfficerNetwork` lines 1053–1057 for style).

**Multi-query result merge pattern** — `getIcijOfficerNetwork()` lines 1059–1097:
```typescript
export async function getIcijOfficerNetwork(entityId: string): Promise<IcijOfficerLink[]> {
  const { rows } = await db.query(
    `SELECT
       r1.from_node_id   AS officer_node_id,
       off.name          AS officer_name,
       ...
     FROM icij_entities ie
     JOIN icij_relationships r1 ON ...
     JOIN icij_entities off    ON ...
     JOIN icij_relationships r2 ON ...
     JOIN icij_entities ent    ON ...
     WHERE ie.linked_entity_id = $1
     ORDER BY off.name, ent.name
     LIMIT 50`,
    [entityId]
  )
  return rows.map((r) => ({
    officerNodeId:     r.officer_node_id,
    ...
  }))
}
```

`getNetworkGraph()` runs **three sequential `db.query()` calls** (ETI directors query, ETI vessels query, ICIJ WITH RECURSIVE CTE), then merges results in TypeScript. This is consistent with repository.ts style — all queries use `db.query()` from `./db` pool, parameterized, no ORM.

**WITH RECURSIVE CTE placement** — the CTE goes inside the SQL string of the third `db.query()` call, following the same template-literal SQL string style used throughout repository.ts.

---

### `src/app/company/[slug]/page.tsx` — tab + panel insertion

**Analog:** Self — existing tab + ContentLock insertion at lines 791–834.

**Import insertion pattern** — lines 1–24 (existing imports block):
```typescript
import { getEntityByKey, getIcijMatches, getIcijOfficerNetwork, getCompanyFraudAlerts } from '@/lib/server/repository'
import type { IcijMatch, IcijOfficerLink } from '@/lib/server/repository'
import FraudAlertsPanel from '@/components/entity/FraudAlertsPanel'
```

New imports follow the same pattern — add to the existing import lines:
```typescript
import { getEntityByKey, getIcijMatches, getIcijOfficerNetwork, getCompanyFraudAlerts, getNetworkGraph } from '@/lib/server/repository'
import type { IcijMatch, IcijOfficerLink, NetworkNode, NetworkEdge } from '@/lib/server/repository'
import NetworkGraph from '@/components/entity/NetworkGraph'
```

**F3-conditional data fetch pattern** — lines 762–769:
```typescript
const [watchlistRows, icijMatches, icijOfficerLinks, fraudAlerts] = await Promise.all([
  session?.user && (plan === 'professional' || plan === 'enterprise')
    ? getEntityWatchState(session.user.id, company.id)
    : Promise.resolve(false),
  f3Unlocked ? getIcijMatches(company.id) : Promise.resolve([]),
  f3Unlocked ? getIcijOfficerNetwork(company.id) : Promise.resolve([]),
  f3Unlocked ? getCompanyFraudAlerts(company.name) : Promise.resolve([]),
])
```

`getNetworkGraph()` is **not** added to the existing `Promise.all` — it is called separately after (WITH RECURSIVE CTE may be slower; isolating it avoids blocking other fast queries):
```typescript
const networkGraph = f3Unlocked
  ? await getNetworkGraph(company.id)
  : { nodes: [], edges: [], truncated: false, totalNodeCount: 0 }
```

**Tab array insertion pattern** — lines 791–802:
```typescript
const tabs = [
  { id: 'registration',       label: 'Registration' },
  { id: 'directors',          label: 'Directors' },
  { id: 'beneficial-owners',  label: 'Beneficial Owners' },
  { id: 'vessels',            label: 'Vessels' },
  { id: 'flags',              label: 'Risk Flags' },
  { id: 'fraud-alerts',       label: 'Fraud Alerts' },
  { id: 'offshore',           label: 'Offshore Leaks' },
  // INSERT HERE at index 7:
  { id: 'network',            label: 'Network' },
  { id: 'intelligence',       label: 'Intelligence' },
  { id: 'domain',             label: 'Domain' },
  { id: 'sources',            label: 'Sources' },
]
```

**Panel array insertion pattern** — lines 804–834:
```typescript
// Existing pattern for offshore tab (lines 821–826):
<ContentLock key="offshore" unlocked={f3Unlocked} reason={lockReason}>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
    <OffshoreLeaksPanel matches={icijMatches} />
    <IcijOfficerNetworkPanel links={icijOfficerLinks} />
  </div>
</ContentLock>,

// New network panel (insert at index 7, after offshore):
<ContentLock key="network" unlocked={f3Unlocked} reason={lockReason}>
  <NetworkGraph
    nodes={networkGraph.nodes}
    edges={networkGraph.edges}
    truncated={networkGraph.truncated}
    totalNodeCount={networkGraph.totalNodeCount}
  />
</ContentLock>,
```

The `key` prop on each panel JSX element is the tab `id` string — follow this convention exactly.

---

## Shared Patterns

### CSS Design Tokens
**Source:** `src/app/company/[slug]/page.tsx` lines 54–98, mirrored in `src/components/entity/FraudAlertsPanel.tsx` lines 23–37
**Apply to:** `NetworkGraph.tsx`

All style values use CSS custom properties from the global design system. Never hardcode colors:
```typescript
// Use these, not hardcoded hex:
'var(--bg-surface)'       // card background
'var(--bg-elevated)'      // slightly raised surface (controls background)
'var(--border-subtle)'    // card borders, row separators
'var(--text-primary)'     // main text
'var(--text-muted)'       // secondary/label text
'var(--accent-primary)'   // blue interactive color
'var(--accent-amber)'     // amber/warning color (#f59e0b family)
'var(--space-4)'          // 16px spacing unit
'var(--space-5)'          // 20px spacing unit
'var(--space-8)'          // 32px spacing unit
```

Exception: React Flow CSS override `<style>` block in `NetworkGraph.tsx` maps React Flow class selectors (`.react-flow__background`, `.react-flow__controls`) to the same CSS vars — this is the correct scoped approach (not globals.css).

### F3 Content Lock
**Source:** `src/components/entity/ContentLock.tsx` (full file, 134 lines)
**Apply to:** Network tab panel in `page.tsx`

Usage pattern (lines 806–808, 815–820 of page.tsx):
```typescript
<ContentLock key="network" unlocked={f3Unlocked} reason={lockReason}>
  <NetworkGraph ... />
</ContentLock>
```

`f3Unlocked` and `lockReason` are already computed at lines 757–758:
```typescript
const f3Unlocked = !!session?.user && plan !== 'free'
const lockReason = !session?.user ? 'guest' : 'free'
```

No new auth logic needed — reuse existing variables.

### Parameterized SQL (no injection risk)
**Source:** Throughout `src/lib/server/repository.ts`
**Apply to:** `getNetworkGraph()` in `repository.ts`

Every query uses `$1`, `$2`, ... placeholders. The `db.query()` call signature:
```typescript
const { rows } = await db.query(
  `SELECT ... WHERE some_col = $1`,
  [paramValue]
)
```

The WITH RECURSIVE CTE in `getNetworkGraph()` must pass `entityId` as `$1` in the params array — never interpolated into the SQL string.

### emptyState style object
**Source:** `src/app/company/[slug]/page.tsx` line 93–98:
```typescript
const emptyState: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '14px',
  textAlign: 'center',
  padding: 'var(--space-8) 0',
}
```

This same style is used in inline form inside `FraudAlertsPanel` empty state. `NetworkGraph` empty state should match this exact styling for consistency.

---

## No Analog Found

No files in this phase are entirely without analog. All three files have strong analogs:

| File | Why Analog Found |
|------|-----------------|
| `NetworkGraph.tsx` | `AisPanel.tsx` (client component receiving server props) + `FraudAlertsPanel.tsx` (card/empty-state pattern) cover the entire structure; only React Flow import block is novel |
| `getNetworkGraph()` | Directly extends the pattern of `getIcijMatches()` and `getIcijOfficerNetwork()` in the same file; WITH RECURSIVE CTE is novel SQL but follows the same `db.query()` wrapper |
| `page.tsx` tab insertion | Self-analog — copies existing tab/ContentLock pattern at the `offshore` entry |

The only genuinely novel element with no codebase analog is the React Flow + Dagre layout initialization logic inside `NetworkGraph.tsx`. For this, RESEARCH.md Pattern 2 (`applyDagreLayout` function) and Pattern 3 (custom node component) are the authoritative references.

---

## Metadata

**Analog search scope:** `src/components/entity/`, `src/lib/server/repository.ts`, `src/app/company/[slug]/page.tsx`
**Files scanned:** 15 (13 entity components, repository.ts, page.tsx)
**Pattern extraction date:** 2026-04-17

# Phase 10: Network Graph Core - Research

**Researched:** 2026-04-17
**Domain:** React Flow 可视化图谱 + PostgreSQL WITH RECURSIVE CTE + Next.js Server Component 数据传递
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** 新增独立 "Network" tab，位于 "Offshore Leaks" 之后
  - Tab 顺序：Registration / Directors / Beneficial Owners / Vessels / Risk Flags / Fraud Alerts / Offshore Leaks / **Network** / Intelligence / Domain / Sources
- **D-02:** 现有 "Offshore Leaks" tab 不变，Network tab 是增量添加
- **D-03:** Canvas 高度为 Claude 自行决定（推荐 600–700px）
- **D-04:** 图谱三类节点：① ETI 注册连接（directors/beneficial_owners 首层，非递归）② 关联船舶（vessels 首层，非递归）③ ICIJ 离岸实体（递归，WITH RECURSIVE CTE，最多 3 跳）
- **D-05:** 根节点 = ETI 公司实体（图谱中心，蓝色）
- **D-06:** 颜色编码适用于所有节点类型（含 ETI directors/vessels）：sanctioned → 红，fraud-alerted → 橙，ICIJ 离岸 → 灰，正常 → 蓝
- **D-07:** Server Component 方案：公司 page.tsx 调用 `getNetworkGraph(entityId)`，序列化为 `{ nodes, edges }` props 传给 `NetworkGraph` client component（`'use client'`）
- **D-08:** Phase 10 不新增 API route
- **D-09:** Network tab 为 **F3 内容锁定**（付费用户）
- **D-10:** Network tab 始终可见（即使数据为空也显示，空状态展示提示）
- **D-11:** 达到 100 节点上限时，NetworkGraph 组件显示截断提示横幅
- **D-12:** 无 ICIJ 数据时仍渲染图谱（公司 + 注册连接的简单星形图）
- **D-13:** 自动布局：Dagre 算法，方向由 Claude 决定
- **D-14:** React Flow 包：优先 `@xyflow/react`（最新维护版）

### Claude's Discretion

- Canvas 高度（推荐 600–700px，参考现有面板比例）
- 节点大小和标签截断（长名称截断加省略号）
- 边标签（关系类型，如 "DIRECTOR_OF"、"SHAREHOLDER_OF"）
- Dagre 布局方向（推荐左→右，适合宽屏网络）
- 截断横幅文案和样式
- 多路径节点去重方式（按 node_id 去重）
- `getNetworkGraph()` 函数签名：返回 `{ nodes: NetworkNode[], edges: NetworkEdge[], truncated: boolean, totalNodeCount: number }`

### Deferred Ideas (OUT OF SCOPE)

- 跨船舶网络（同一公司关联船舶间连接）
- 实时图谱更新（WebSocket）
- 自定义图谱布局保存（用户拖拽节点位置）
- 董事跨公司连接（需要跨实体董事索引）

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GRAPH-01 | 用户可在公司详情页看到交互式节点网络图，展示董事、股东和关联 ICIJ 离岸实体 | `@xyflow/react` v12.10.2 提供完整交互式图谱能力；`getNetworkGraph()` 聚合三类节点 |
| GRAPH-02 | 用户可点击网络图中的任意节点跳转到对应 ETI 实体详情页 | React Flow `onNodeClick` 事件 + `useRouter().push()` 实现；节点 data 携带 `etlKey` 字段 |
| GRAPH-03 | 网络图追踪至多 3 跳关系链（节点上限 100），通过 PostgreSQL WITH RECURSIVE CTE 实现 | PostgreSQL 16 支持 WITH RECURSIVE；现有 `icij_relationships` 表有正确索引 |
| GRAPH-04 | 颜色编码区分节点风险类型：红=制裁，橙=欺诈预警，灰=ICIJ 离岸，蓝=正常 | `icij_entities.is_sanctioned`（migration 036）+ `fraud_alerts` 表查询；颜色值已由 UI-SPEC 锁定 |

</phase_requirements>

---

## Summary

Phase 10 在公司详情页新增 "Network" 可视化图谱 tab，允许用户通过交互式节点图探索公司的所有权和董事网络，支持最多 3 跳的 ICIJ 离岸实体递归追踪。

**技术组合：** `@xyflow/react` v12.10.2（图谱渲染） + `@dagrejs/dagre` v3.0.0（自动布局） + PostgreSQL WITH RECURSIVE CTE（3 跳查询）。数据流遵循现有 Server Component → Client Component props 模式（与 FraudAlertsPanel 一致）。

**主要约束已确认：** 数据架构（三类节点）、内容锁（F3）、空状态行为、100 节点上限截断提示——均已在 CONTEXT.md 和 UI-SPEC 中锁定。颜色值、节点尺寸、画布高度、交互规范已由 `10-UI-SPEC.md` 完整定义。

**Primary recommendation:** 按 Server Component 获取 + Client Component 渲染的分层架构实现；`getNetworkGraph()` 单函数整合三类节点（ETI 首层 + ICIJ 递归）；`NetworkGraph.tsx` 封装 React Flow 实例 + Dagre 布局计算。

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 图谱数据聚合（3跳 CTE + ETI首层） | API / Backend (Server Component) | — | 查询涉及多表 JOIN + WITH RECURSIVE，必须在服务端执行；Next.js App Router Server Component 天然支持 |
| 图谱渲染 + 交互（缩放/点击/Dagre布局） | Browser / Client | — | React Flow 依赖浏览器 DOM；Dagre 布局计算在 Client Component 内初始化时执行 |
| 节点颜色判断 | API / Backend (Server Component) | — | 颜色取决于数据库字段（is_sanctioned、fraud_alerts）；在服务端计算后序列化为节点 data |
| 点击导航 | Browser / Client | — | 需要 `useRouter`（Next.js Client Hook） |
| F3 内容锁 | Frontend Server (SSR) | Browser / Client | `ContentLock` 逻辑在 Server Component 中判断 `f3Unlocked`；渲染在客户端 |
| CSS/样式覆盖（React Flow 黑暗主题） | Browser / Client | — | React Flow CSS 变量覆盖仅在客户端组件中注入，避免污染全局 globals.css |

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@xyflow/react` | 12.10.2 | 交互式节点图谱渲染 | `reactflow` 旧包的官方新命名空间；D-14 已锁定选择；React ≥17 peer dep 满足（项目用 React 19）[VERIFIED: npm registry] |
| `@dagrejs/dagre` | 3.0.0 | 自动图谱布局算法 | xyflow 官方文档推荐的 dagre 维护 fork；自带 TypeScript 类型（`./dist/types/index.d.ts`）[VERIFIED: npm registry + Context7] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@xyflow/react/dist/style.css` | (随包) | React Flow 基础样式 | 在 `NetworkGraph.tsx` 中导入，不导入到 globals.css |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@xyflow/react` | `reactflow` (旧) | `reactflow` 是旧包名，不再维护；`@xyflow/react` 是当前维护版本 [CITED: github.com/xyflow/react-flow] |
| `@dagrejs/dagre` | `dagre` (旧) | `dagre` 原包停止维护；`@dagrejs/dagre` 是官方维护 fork [VERIFIED: npm registry] |
| `@dagrejs/dagre` | ELK、d3-hierarchy | ELK 需要 WebAssembly，更复杂；d3-hierarchy 仅适合严格树形结构；dagre 最简单且足够 |

**Installation:**
```bash
npm install @xyflow/react @dagrejs/dagre
```

**Version verification:**
```bash
npm view @xyflow/react version   # → 12.10.2
npm view @dagrejs/dagre version  # → 3.0.0
```
[VERIFIED: npm registry, 2026-04-17]

---

## Architecture Patterns

### System Architecture Diagram

```
公司 page.tsx (Server Component)
        │
        ├─ f3Unlocked?
        │     ├─ YES → getNetworkGraph(company.id)  ←── repository.ts
        │     │              │
        │     │         ┌────┴──────────────────────────────────────────┐
        │     │         │  PostgreSQL 查询（单函数三个部分）               │
        │     │         │                                               │
        │     │         │  Part 1: ETI directors + beneficial_owners    │
        │     │         │    └─ FROM entities metadata_json (首层)       │
        │     │         │                                               │
        │     │         │  Part 2: ETI vessels (首层)                    │
        │     │         │    └─ FROM entities metadata_json.vessels      │
        │     │         │                                               │
        │     │         │  Part 3: WITH RECURSIVE icij_cte              │
        │     │         │    └─ icij_entities WHERE linked_entity_id=$1  │
        │     │         │       → UNION ALL icij_relationships (depth≤3) │
        │     │         │       → JOIN fraud_alerts (橙节点检测)           │
        │     │         │       → 节点上限 100，返回 truncated flag         │
        │     │         └────────────────────────────────────────────────┘
        │     │              │
        │     │         { nodes: NetworkNode[], edges: NetworkEdge[],
        │     │           truncated: boolean, totalNodeCount: number }
        │     │
        │     └─ NO  → { nodes: [], edges: [], truncated: false, totalNodeCount: 0 }
        │
        ↓
ContentLock(f3Unlocked) → NetworkGraph(节点, 边, 截断标志) [Client Component]
                                    │
                          ┌─────────┴──────────────────┐
                          │  Dagre 布局计算 (初始化时)   │
                          │  ReactFlow 渲染              │
                          │  Background (dots)           │
                          │  Controls (底部左)           │
                          │  截断横幅 (顶部, 绝对定位)    │
                          │  onNodeClick → router.push() │
                          └────────────────────────────┘
```

### Recommended Project Structure
```
src/
├── lib/server/
│   └── repository.ts        # 新增 getNetworkGraph() 函数（约 80-100 行 SQL + 映射）
├── components/entity/
│   └── NetworkGraph.tsx      # 新建：'use client' React Flow 组件
└── app/company/[slug]/
    └── page.tsx              # 修改：插入 Network tab + ContentLock 包装
```

### Pattern 1: WITH RECURSIVE ICIJ CTE（3跳限制 + 节点上限）

**What:** 从 `icij_entities.linked_entity_id = $1` 开始，递归遍历 `icij_relationships`，最多 3 跳，节点总数 ≤ 100。

**When to use:** `getNetworkGraph(entityId)` 中构建 ICIJ 节点和边的部分。

**Example:**
```sql
-- Source: 基于 icij_relationships 表设计 + PostgreSQL WITH RECURSIVE 标准语法
WITH RECURSIVE icij_cte AS (
  -- 基础案例：直接链接到 ETI 公司的 ICIJ 实体
  SELECT
    ie.node_id,
    ie.name,
    ie.dataset,
    ie.entity_type,
    ie.is_sanctioned,
    ie.sanctions_match,
    0 AS depth,
    ARRAY[ie.node_id] AS visited          -- 防环：记录已访问路径
  FROM icij_entities ie
  WHERE ie.linked_entity_id = $1          -- $1 = company.id (ETI entity ID)

  UNION ALL

  -- 递归案例：通过 icij_relationships 扩展
  SELECT
    next_e.node_id,
    next_e.name,
    next_e.dataset,
    next_e.entity_type,
    next_e.is_sanctioned,
    next_e.sanctions_match,
    cte.depth + 1,
    cte.visited || next_e.node_id
  FROM icij_cte cte
  JOIN icij_relationships rel
    ON rel.from_node_id = cte.node_id OR rel.to_node_id = cte.node_id
  JOIN icij_entities next_e
    ON next_e.node_id = CASE
         WHEN rel.from_node_id = cte.node_id THEN rel.to_node_id
         ELSE rel.from_node_id
       END
  WHERE cte.depth < 3                     -- 最多 3 跳
    AND NOT (next_e.node_id = ANY(cte.visited))  -- 防止重复访问（去环）
)
-- 去重：一个节点可能通过多条路径到达，取最浅深度
SELECT DISTINCT ON (node_id) *
FROM icij_cte
ORDER BY node_id, depth
LIMIT 100;                                 -- 节点上限（ICIJ 节点，不含 ETI 首层）
```

**截断检测（totalNodeCount）：**
```sql
-- 在主查询外，用同样的 CTE 但不加 LIMIT 做 COUNT(*) 来确定总数
-- 实现：在 getNetworkGraph() 中，当结果数 = 100 时设置 truncated = true，
-- 并用 COUNT 子查询获取 totalNodeCount
```

### Pattern 2: Dagre 自动布局（LR 方向）

**What:** 在 React Flow client component 初始化时，用 Dagre 计算所有节点的 x/y 坐标。

**When to use:** `NetworkGraph.tsx` 中，从 server props 接收节点数据后、传给 `<ReactFlow>` 前。

**Example:**
```typescript
// Source: Context7 /xyflow/web docs + @dagrejs/dagre v3 API
import dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'

// 节点宽高由 UI-SPEC 定义
const NODE_WIDTH: Record<string, number> = {
  root: 160, company: 140, vessel: 140, person: 120, icij: 130
}
const NODE_HEIGHT: Record<string, number> = {
  root: 48, company: 40, vessel: 40, person: 36, icij: 36
}

function applyDagreLayout(nodes: Node[], edges: Edge[]) {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 80 })

  nodes.forEach((node) => {
    const w = NODE_WIDTH[node.type ?? 'company'] ?? 140
    const h = NODE_HEIGHT[node.type ?? 'company'] ?? 40
    g.setNode(node.id, { width: w, height: h })
  })
  edges.forEach((edge) => g.setEdge(edge.source, edge.target))

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    const w = NODE_WIDTH[node.type ?? 'company'] ?? 140
    const h = NODE_HEIGHT[node.type ?? 'company'] ?? 40
    return {
      ...node,
      targetPosition: 'left' as const,
      sourcePosition: 'right' as const,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    }
  })
}
```

### Pattern 3: 自定义节点组件 + 点击导航

**What:** 针对不同节点类型（root/company/person/vessel/icij）注册自定义渲染组件；点击时导航到 ETI 实体页面。

**When to use:** `NetworkGraph.tsx` 中定义 `nodeTypes` 并传给 `<ReactFlow>`。

**Example:**
```typescript
// Source: Context7 /xyflow/react-flow custom node pattern
'use client'
import { useRouter } from 'next/navigation'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'

interface ETINodeData {
  label: string         // 截断后标签 (≤20 chars)
  fullName: string      // 完整名称（tooltip）
  subtype: string       // "Director" | "Vessel" | "Offshore Entity" | "Company"
  etlKey: string | null // slug（company）或 IMO（vessel），null 表示不可点击
  nodeColor: 'sanctioned' | 'fraud' | 'icij' | 'normal' | 'root'
}

function ETINode({ data, type }: NodeProps) {
  const router = useRouter()
  const clickable = !!data.etlKey

  return (
    <div
      role={clickable ? 'button' : undefined}
      aria-label={clickable ? `${data.fullName} — click to view entity` : undefined}
      title={data.fullName}
      onClick={() => {
        if (!data.etlKey) return
        if (type === 'vessel') router.push(`/vessel/${data.etlKey}`)
        else router.push(`/company/${data.etlKey}`)
      }}
      style={{
        cursor: clickable ? 'pointer' : 'default',
        // ... 颜色样式由 UI-SPEC 定义
      }}
    >
      <Handle type="target" position={Position.Left} />
      <span>{data.label}</span>
      <span style={{ fontSize: 11 }}>{data.subtype}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
```

### Anti-Patterns to Avoid

- **不要在 Server Component 中直接 import `@xyflow/react`：** React Flow 使用了 `window`、`document` 等浏览器 API，必须在 `'use client'` 组件中使用。否则会在 SSR 时崩溃。[VERIFIED: @xyflow/react peer dep 说明 + 项目现有 AisPanel.tsx 的 use client 模式]
- **不要使用 `dynamic(() => import(...), { ssr: false })` 包装 NetworkGraph：** 由于数据在 Server Component 中获取并通过 props 传递，NetworkGraph 本身只是一个 `'use client'` 组件，不需要额外 `dynamic`。`'use client'` 标记已足够让 Next.js 在客户端渲染。
- **不要在全局 `globals.css` 中添加 React Flow CSS 覆盖：** React Flow 的 `.react-flow__*` 选择器在全局范围会影响任何可能存在的其他 Flow 实例。使用 `<style>` 标签或 CSS Module 限定范围。
- **不要在递归 CTE 中省略防环机制：** `icij_relationships` 是有向图但存在双向关系（同一连接 from→to 和 to→from 可能都存在），必须用 `visited` 数组防止无限循环。
- **不要将 `@xyflow/react/dist/style.css` 导入到 `globals.css` 或 `layout.tsx`：** 应在 `NetworkGraph.tsx` 文件顶部导入，作用域限定在该客户端组件。

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 节点自动布局算法 | 手写力导向算法或坐标计算 | `@dagrejs/dagre` | Dagre 处理 DAG 层次布局，已经优化了节点间距和层级排序；手写会花费数百行且效果差 |
| 缩放/平移/选择交互 | 自定义 SVG 事件处理 | `@xyflow/react` 内置 Controls | React Flow 内置了缩放、平移、fit view、键盘导航；所有边界情况已处理 |
| 节点渲染 | 手写 SVG/Canvas 图谱 | `@xyflow/react` 自定义节点 | React Flow 允许任意 React 组件作为节点；性能优化、选中状态均已内置 |
| 图遍历防环 | 手写 BFS/DFS | PostgreSQL WITH RECURSIVE + `visited` 数组 | 数据库内置遍历效率远高于应用层；ICIJ 数据量大，必须在 DB 层限制 |

**Key insight:** 图谱可视化的复杂性（边的碰撞检测、层级排布、动态缩放）超过表面看起来的难度。React Flow + Dagre 的组合在 xyflow 官方文档中有完整示例，是 "auto-layout 树形/DAG 图" 的标准方案。

---

## Common Pitfalls

### Pitfall 1: React Flow 在 Next.js App Router 中的 SSR 问题
**What goes wrong:** 直接在 Server Component 或没有 `'use client'` 的组件中 import `@xyflow/react`，导致 `window is not defined` 或 `document is not defined` 错误。
**Why it happens:** React Flow 内部访问浏览器全局 API。
**How to avoid:** `NetworkGraph.tsx` 必须以 `'use client'` 开头。所有 React Flow imports 在该文件内。数据在 Server Component 获取并序列化为纯 JSON props 传入。
**Warning signs:** 构建时出现 `ReferenceError: window is not defined`。

### Pitfall 2: WITH RECURSIVE CTE 无限循环
**What goes wrong:** `icij_relationships` 中存在双向边（A→B 和 B→A 同时存在），CTE 在同一路径上反复访问相同节点，导致无限递归。
**Why it happens:** ICIJ 数据导出中，部分关系类型（如 `same_name_as`）是无向的，实际存储为两条有向记录。
**How to avoid:** CTE 中维护 `visited ARRAY`，每步检查 `NOT (next_e.node_id = ANY(cte.visited))`。注意：PostgreSQL 要求 WITH RECURSIVE 有终止条件（`depth < 3` 也是一个保险条件）。
**Warning signs:** 查询超时或内存耗尽。

### Pitfall 3: 节点去重问题（多路径到达同一节点）
**What goes wrong:** 一个 ICIJ 实体通过两条不同路径（深度 1 和深度 2）都能到达，CTE 会返回两条记录。如果不去重，React Flow 会收到重复的 `id`，导致渲染警告或边连接错误。
**Why it happens:** 递归 CTE 探索所有路径，同一节点出现在多条路径上。
**How to avoid:** 在 SQL 层使用 `DISTINCT ON (node_id) ... ORDER BY node_id, depth` 取最浅路径；或在 TypeScript 层按 `node_id` 做 Map 去重。推荐 SQL 层处理（效率更高）。
**Warning signs:** React Flow 控制台警告 "Duplicate node id"。

### Pitfall 4: Dagre 节点尺寸不匹配
**What goes wrong:** Dagre 使用传入的宽高计算布局，但实际渲染的 React Flow 节点尺寸不同，导致节点重叠。
**Why it happens:** Dagre 不知道 DOM 实际渲染尺寸；必须显式指定与 CSS 匹配的宽高。
**How to avoid:** 严格按照 UI-SPEC 定义的节点尺寸（root:160×48, company:140×40, person:120×36, icij:130×36）传给 `g.setNode()`，并确保 CSS 使用相同数值。
**Warning signs:** 节点渲染后出现重叠或间距异常。

### Pitfall 5: 100 节点上限的作用域理解错误
**What goes wrong:** 将 100 节点上限应用于所有节点（包括 ETI directors 和 vessels），导致首层关联被错误截断。
**Why it happens:** D-11 和 D-04 Specifics 说明：100 节点上限**仅适用于 ICIJ 递归节点**；ETI directors 和 vessels 是额外展示的，不计入上限。
**How to avoid:** SQL 的 `LIMIT 100` 仅放在 WITH RECURSIVE CTE 部分；ETI 首层节点单独查询。
**Warning signs:** 公司有 5 个 directors 但图谱没有显示所有 directors。

### Pitfall 6: ContentLock 内仍执行昂贵查询
**What goes wrong:** 即使用户没有 F3 权限，仍然执行 `getNetworkGraph()` 查询（涉及 WITH RECURSIVE CTE，可能较慢）。
**Why it happens:** 在 page.tsx 的 Promise.all 中不加权限检查直接调用。
**How to avoid:** 按 UI-SPEC 中的模式：`const networkGraph = f3Unlocked ? await getNetworkGraph(company.id) : { nodes: [], edges: [], truncated: false, totalNodeCount: 0 }`。与现有 `icijMatches`、`icijOfficerLinks`、`fraudAlerts` 的条件调用模式一致（见 page.tsx line 762-768）。

---

## Code Examples

### NetworkGraph 组件骨架（完整结构）
```typescript
// Source: 基于 Context7 /xyflow/react-flow 官方示例 + 项目 FraudAlertsPanel 模式
'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from '@dagrejs/dagre'

interface NetworkNode {
  id: string
  type: 'root' | 'company' | 'vessel' | 'person' | 'icij'
  label: string        // 截断后 ≤20 chars
  fullName: string
  etlKey: string | null
  nodeColor: 'sanctioned' | 'fraud' | 'icij' | 'normal' | 'root'
}

interface NetworkEdge {
  id: string
  source: string
  target: string
  edgeType: 'eti' | 'icij'
  label?: string       // 关系类型如 "director of"
}

interface Props {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  truncated: boolean
  totalNodeCount: number
}

export default function NetworkGraph({ nodes, edges, truncated, totalNodeCount }: Props) {
  // 1. 空状态处理
  if (nodes.length <= 1) {
    return (
      <div style={{ /* card 样式 */ }}>
        <p style={{ /* sectionTitle */ }}>Network Graph</p>
        <div style={{ height: 640, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              No network connections found
            </p>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: '20px', marginTop: 8 }}>
              This entity has no director records, vessel associations, or ICIJ offshore matches on file.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // 2. 转换为 React Flow 格式并执行 Dagre 布局
  const { layoutedNodes, rfEdges } = useMemo(() => {
    const rfNodes: Node[] = nodes.map(n => ({
      id: n.id,
      type: n.type,
      data: { label: n.label, fullName: n.fullName, etlKey: n.etlKey, nodeColor: n.nodeColor },
      position: { x: 0, y: 0 },  // Dagre 会覆盖
    }))
    const rfEdges: Edge[] = edges.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      style: e.edgeType === 'icij'
        ? { stroke: 'rgba(138,143,152,0.25)', strokeDasharray: '4 4', strokeWidth: 1 }
        : { stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1.5 },
    }))
    const layoutedNodes = applyDagreLayout(rfNodes, rfEdges)
    return { layoutedNodes, rfEdges }
  }, [nodes, edges])

  const [rfNodes, , onNodesChange] = useNodesState(layoutedNodes)
  const [rfEdges, , onEdgesChange] = useEdgesState(rfEdges)

  // 3. 渲染
  return (
    <div style={{ /* card 样式 */ }}>
      <p style={{ /* sectionTitle */ }}>Network Graph</p>
      <div style={{ position: 'relative', height: 640, borderRadius: 10, overflow: 'hidden' }}>
        {truncated && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
            background: 'rgba(245,158,11,0.1)', borderBottom: '1px solid rgba(245,158,11,0.2)',
            padding: '8px 16px', fontSize: 12, color: '#f59e0b',
          }}>
            Showing 100 of {totalNodeCount} network nodes — graph truncated for performance.
          </div>
        )}
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          maxZoom={2.0}
          proOptions={{ hideAttribution: false }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            color="rgba(255,255,255,0.04)"
            gap={20}
            size={1}
          />
          <Controls position="bottom-left" />
        </ReactFlow>
        <style>{`
          .react-flow__background { background-color: var(--bg-surface); }
          .react-flow__controls { background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 6px; }
          .react-flow__controls-button { background: transparent; border-bottom: 1px solid var(--border-subtle); color: var(--text-muted); }
          .react-flow__controls-button:hover { background: var(--bg-subtle); color: var(--text-primary); }
          .react-flow__edge-path { stroke-linecap: round; }
        `}</style>
      </div>
    </div>
  )
}
```

### page.tsx 中的 tab 插入位置
```typescript
// Source: 基于 src/app/company/[slug]/page.tsx 现有模式（line 791-834）
// 在现有 tabs 数组的 'offshore' 后插入 'network'（index 7）

const tabs = [
  { id: 'registration',      label: 'Registration' },
  { id: 'directors',         label: 'Directors' },
  { id: 'beneficial-owners', label: 'Beneficial Owners' },
  { id: 'vessels',           label: 'Vessels' },
  { id: 'flags',             label: 'Risk Flags' },
  { id: 'fraud-alerts',      label: 'Fraud Alerts' },
  { id: 'offshore',          label: 'Offshore Leaks' },
  { id: 'network',           label: 'Network' },     // 新增，index 7
  { id: 'intelligence',      label: 'Intelligence' },
  { id: 'domain',            label: 'Domain' },
  { id: 'sources',           label: 'Sources' },
]

// 数据获取（与现有 Promise.all 合并）
const networkGraph = f3Unlocked
  ? await getNetworkGraph(company.id)
  : { nodes: [], edges: [], truncated: false, totalNodeCount: 0 }

// panels 数组（在 offshore 和 intelligence 之间插入）
<ContentLock key="network" unlocked={f3Unlocked} reason={lockReason}>
  <NetworkGraph
    nodes={networkGraph.nodes}
    edges={networkGraph.edges}
    truncated={networkGraph.truncated}
    totalNodeCount={networkGraph.totalNodeCount}
  />
</ContentLock>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `reactflow` 包名 | `@xyflow/react` | 2023年底 (v11→v12) | 旧包停止主动维护；新包 API 基本相同但 TypeScript 类型更好 |
| `dagre` 包 | `@dagrejs/dagre` | 2021年后 | 原 `dagre` 包停止维护；`@dagrejs/dagre` 是维护 fork，API 完全兼容 |
| React Flow v11 `reactflow` API | v12 `@xyflow/react` Node/Edge 类型 | v12.0.0 | `useNodesState`/`useEdgesState` 接口和 TypeScript 泛型有微调 |

**Deprecated/outdated:**
- `reactflow` 包：不再主动维护，但仍可用；新项目应使用 `@xyflow/react`
- `dagre`（原包）：已停止更新，使用 `@dagrejs/dagre` 代替

---

## Open Questions

1. **WITH RECURSIVE CTE 在 ICIJ 数据集上的性能**
   - What we know：`icij_entities` 有 `idx_icij_linked`（按 linked_entity_id 索引）和 `idx_icij_name_trgm`；`icij_relationships` 有 `idx_icij_rel_from`、`idx_icij_rel_to` 索引
   - What's unclear：ICIJ 数据量大小（production 环境有多少 icij_entities/icij_relationships 记录）；3跳查询在数据量大时的实际耗时
   - Recommendation：实现时在 CTE 中加 `depth < 3` 和 `LIMIT 100` 双重终止；Phase 10 作为首次引入，若出现超时（>2s）可在 Wave 验证时评估是否需要添加物化中间结果

2. **getNetworkGraph() 是否应该使用单一 SQL 查询还是分多次查询**
   - What we know：现有 ICIJ 查询（`getIcijMatches`、`getIcijOfficerNetwork`）是独立函数；D-07 要求单个 `getNetworkGraph()` 函数
   - What's unclear：合并成单次 SQL（多个 CTE）还是分 3 次独立查询更易维护
   - Recommendation：分 3 次独立查询（ETI directors、ETI vessels、ICIJ CTE）在 TypeScript 层合并为 nodes/edges，比超长单一 SQL 更易调试和测试

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | npm install | ✓ | v22.22.2 | — |
| npm | 包管理 | ✓ | 10.9.7 | — |
| `@xyflow/react` | NetworkGraph 渲染 | ✗ (需安装) | 12.10.2 可用 | — |
| `@dagrejs/dagre` | Dagre 自动布局 | ✗ (需安装) | 3.0.0 可用 | — |
| PostgreSQL 16 | WITH RECURSIVE CTE | ✓ (docker-compose) | 16 | — |
| `pg_trgm` extension | icij_entities 全文搜索索引 | ✓ (migration 011) | — | — |

**Missing dependencies with no fallback:**
- `@xyflow/react`：Wave 0 必须先执行 `npm install @xyflow/react @dagrejs/dagre`

**Missing dependencies with fallback:**
- 无

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | 无（项目无 Vitest/Jest 配置，STATE.md 明确记录为技术债务） |
| Config file | 无 |
| Quick run command | `npm run type-check`（TypeScript 严格检查作为验证替代） |
| Full suite command | `npm run build`（构建通过 = 无类型/编译错误） |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRAPH-01 | 公司详情页显示 Network tab 和图谱 | 手动验证 | `npm run build` (编译无误) | ✅ 构建验证 |
| GRAPH-02 | 点击节点导航到对应 ETI 实体页 | 手动验证 | `npm run type-check` | ❌ Wave 0 需创建类型定义 |
| GRAPH-03 | WITH RECURSIVE CTE 返回正确节点数 | 手动验证（DB查询） | `npm run type-check` | ❌ Wave 0 需创建函数 |
| GRAPH-04 | 颜色编码正确映射到节点状态 | 手动验证 | `npm run type-check` | ❌ Wave 0 需创建组件 |

> 注：项目无自动化测试框架（STATE.md 记录为技术债务）。验证依赖 TypeScript 类型检查 + 构建通过 + 手动 UI 验证。

### Sampling Rate
- **Per task commit:** `npm run type-check`
- **Per wave merge:** `npm run build`
- **Phase gate:** `npm run build` 绿色 + 手动验证图谱渲染、点击导航、颜色编码

### Wave 0 Gaps
- [ ] `NetworkNode` / `NetworkEdge` 接口类型定义（添加到 `src/lib/types.ts` 或 repository.ts）
- [ ] `@xyflow/react` 和 `@dagrejs/dagre` 安装：`npm install @xyflow/react @dagrejs/dagre`
- [ ] 无测试框架：接受现状（STATE.md 技术债务），使用 `type-check` + `build` 作为自动验证门控

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | F3 内容锁：`f3Unlocked = !!session?.user && plan !== 'free'`（现有模式，不变） |
| V5 Input Validation | yes（间接） | `entityId` 通过 `getEntityByKey()` 验证，传给 CTE 时使用参数化查询（`$1`），无 SQL 注入风险 |
| V6 Cryptography | no | — |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL 注入（WITH RECURSIVE 参数） | Tampering | 使用 `pg` 参数化查询（`$1` 占位符）——现有 repository.ts 全部采用此模式 |
| 未授权访问 F3 内容 | Elevation of Privilege | Server Component 中条件获取（`f3Unlocked ? await getNetworkGraph(...) : {}`）+ ContentLock 渲染层双重保护 |
| 性能 DoS（无限 CTE 递归） | Denial of Service | `depth < 3` 递归终止 + `LIMIT 100` 行数限制 + `visited[]` 防环 |

---

## Sources

### Primary (HIGH confidence)
- `npm view @xyflow/react version` — 版本 12.10.2，发布日期确认 [VERIFIED: npm registry, 2026-04-17]
- `npm view @dagrejs/dagre version` — 版本 3.0.0 [VERIFIED: npm registry, 2026-04-17]
- Context7 `/xyflow/react-flow` — React Flow 自定义节点、Dagre 布局集成示例 [VERIFIED: Context7]
- Context7 `/xyflow/web` — Dagre + React Flow 完整集成模式（`getLayoutedElements` 函数签名）[VERIFIED: Context7]
- `src/app/company/[slug]/page.tsx` — 现有 tab 结构、数据获取模式 [VERIFIED: codebase]
- `src/lib/server/repository.ts` (lines 1014-1192) — 现有 ICIJ 查询模式 [VERIFIED: codebase]
- `db/migrations/014_icij_relationships.sql` — icij_relationships 表 schema + 索引 [VERIFIED: codebase]
- `db/migrations/036_icij_sanctions_linkage.sql` — is_sanctioned/sanctions_match 字段确认 [VERIFIED: codebase]

### Secondary (MEDIUM confidence)
- `@xyflow/react` peer dependencies (`react >= 17`) — 项目使用 React 19，满足条件 [VERIFIED: npm view]
- `@dagrejs/dagre` TypeScript 类型路径 (`./dist/types/index.d.ts`) — 无需额外 @types 包 [VERIFIED: npm view fields]

### Tertiary (LOW confidence)
- 无

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getNetworkGraph()` 分 3 次查询（ETI directors、ETI vessels、ICIJ CTE）比单一 SQL 更易维护 | Architecture Patterns / Open Questions | 如果 3 次查询在并发时有竞态或效率问题，可能需要合并为单一事务查询；影响实现复杂度但不影响功能 |
| A2 | ICIJ production 数据量下 WITH RECURSIVE 3跳查询 <2 秒 | Open Questions | 若查询超时，需要添加物化 CTE（MATERIALIZED）或其他优化；不影响架构方向 |

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — npm registry 验证版本；@xyflow/react 和 @dagrejs/dagre 均为活跃维护包
- Architecture: HIGH — 基于 CONTEXT.md 锁定决策 + 现有 codebase 模式（FraudAlertsPanel、page.tsx）分析
- Pitfalls: HIGH — 基于 React Flow Next.js 集成已知问题 + PostgreSQL WITH RECURSIVE 已知边界情况

**Research date:** 2026-04-17
**Valid until:** 2026-05-17（@xyflow/react 版本稳定期 30 天）

# Phase 9: Data Enrichment Foundations - Research

**Researched:** 2026-04-16
**Domain:** PostgreSQL pg_trgm fuzzy matching, Next.js 15 Server Component panels, database migration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** ICIJ→sanctions 匹配嵌入 ICIJ sync job 中自动执行，无需单独 admin 触发。upsert icij_entities 之后立即执行 UPDATE。
- **D-02:** 每次 sync 做 **全量重匹配**（非增量）。确保新增/删除的制裁条目能反映到所有 icij_entities 行，包括历史存量数据。
- **D-03:** ICIJ→sanctions 匹配阈值沿用 `sanctions.ts` 中的 `word_similarity > 0.72`，保持代码库一致性。
- **D-04:** 船舶页面 FraudAlertsPanel 通过 `vessel.operator OR vessel.manager` 匹配 fraud_alerts（按 ROADMAP "via operator/manager name"）。vessel owner 排除在外。
- **D-05:** 船舶匹配同样使用 `SIMILARITY_THRESHOLD = 0.45`，与 `fraud-check.ts` 中的现有欺诈查询保持一致。
- **D-06:** Panel **展示全部匹配记录**，不设上限。实践中单实体最多 5-10 条，无需分页。
- **D-07:** Tab 始终显示（无匹配时亦然），空状态文案在 UI-SPEC 中已锁定："No fraud alerts on record for this entity."

### Claude's Discretion

- ICIJ→sanctions UPDATE 的精确 SQL（WITH 子查询或 subquery，实现最简洁模式）
- FraudAlertsPanel 条目排序（黑名单优先，再按 source name；Claude 决定）
- `getCompanyFraudAlerts()` 和 `getVesselFraudAlerts()` 的 repository 函数签名（匹配 repository.ts 现有模式）
- 当 operator 和 manager 同时命中同一条 fraud_alerts 行时是否去重

### Deferred Ideas (OUT OF SCOPE)

无——讨论未超出 Phase 9 范围。

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NETDATA-01 | 同步 ICIJ 数据时，自动将 icij_entities 与制裁数据库做模糊匹配，为匹配的 ICIJ 实体打上 `is_sanctioned=true` 标签（需 migration 036：添加 `is_sanctioned BOOLEAN` 和 `sanctions_match TEXT` 字段） | pg_trgm word_similarity 已验证可用，sanctions_entries.search_text 为 GIN 索引列，ICIJ sync 为脚本 `scripts/sync-icij-offshore.mjs`（非运行时 sync），见下 Open Question |
| NETDATA-02 | 在网络图中，`is_sanctioned=true` 的 ICIJ 离岸节点显示为红色（与直接制裁实体相同颜色） | Phase 9 仅做数据标记；Phase 10 负责图渲染。本 phase 需在 `getIcijMatches()` 返回 `isSanctioned` + `sanctionsMatch` 字段，并在 OffshoreLeaksPanel 行渲染 inline 红色 badge |
| NETDATA-03 | 公司详情页新增 FraudAlertsPanel，展示来自 `fraud_alerts` 表的匹配预警 | `fraud_alerts` 表已存在（migration 028），`checkFraudAlerts()` 模板可直接复用；Server Component 模式参考 company 页同步数据加载 |
| NETDATA-04 | 船舶详情页新增 FraudAlertsPanel，通过船舶运营商/船管公司名称匹配 `fraud_alerts` 表中的欺诈预警 | `Vessel` 类型现有 `currentOperator` 字段，无 `manager` 字段——见 Open Question Q-1 |

</phase_requirements>

---

## Summary

Phase 9 交付两个独立能力：（1）ICIJ↔制裁联动标记，（2）公司/船舶详情页的 FraudAlertsPanel。两个能力均建立在已有基础设施之上，无需引入新 npm 包。

**ICIJ→sanctions 匹配**的核心挑战是：确定"ICIJ sync"在代码库中的触发位置。经审计，ICIJ 数据导入是通过独立 Node.js 脚本 `scripts/sync-icij-offshore.mjs` 完成的（CSV 批量导入），而非运行时 API 触发的 sync job。`src/lib/server/sync/index.ts` 中目前没有 ICIJ 相关入口。这意味着 D-01 所要求的"upsert 后立即执行 UPDATE"需要嵌入到该脚本内，或通过另一个可单独调用的 UPDATE 脚本/数据库函数实现。

**FraudAlertsPanel**的技术实现是直接的 Server Component 模式，与现有 OffshoreLeaksPanel（内联于 company/[slug]/page.tsx）相同。`checkFraudAlerts()` 函数已封装了完整的模糊匹配逻辑，只需提取为 repository 层函数、删除对外的 `checkFraudAlerts` 封装逻辑并直接返回 `FraudAlert[]`。

**主要建议：** 将 ICIJ→sanctions 匹配实现为数据库层 UPDATE 语句（在 migration 036 运行后，或作为可单独调用的 admin 脚本），同时在 `scripts/sync-icij-offshore.mjs` 末尾自动触发一次全量重匹配。

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Migration 036（添加 is_sanctioned / sanctions_match 列） | Database / Storage | — | 纯 schema 变更，无业务逻辑 |
| ICIJ→sanctions 模糊匹配 UPDATE | Database / Storage（SQL）| API/Backend（触发点） | word_similarity 运算在 PG 层执行；Node 脚本仅发送 SQL |
| getIcijMatches() 字段扩展 | API / Backend | — | repository 层，server-only |
| getCompanyFraudAlerts() | API / Backend | — | repository 层，server-only |
| getVesselFraudAlerts() | API / Backend | — | repository 层，server-only |
| FraudAlertsPanel（company） | Frontend Server (SSR) | — | Server Component；数据在 page.tsx server 端预取 |
| FraudAlertsPanel（vessel） | Frontend Server (SSR) | — | 同上 |
| ICIJ Sanctioned badge（OffshoreLeaksPanel 行内） | Frontend Server (SSR) | — | 依赖 getIcijMatches 返回的新字段；OffshoreLeaksPanel 为内联组件 |

---

## Standard Stack

### Core（已有，无需新增）

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` (node-postgres) | 已安装 | 原生 SQL 查询 | 项目唯一数据库客户端 [VERIFIED: CLAUDE.md] |
| `pg_trgm` extension | PostgreSQL 内置 | word_similarity() 模糊匹配 | migration 011 已启用 [VERIFIED: db/migrations/011_ports_psc_icij.sql] |
| Next.js 15 App Router | 已安装 | Server Component 渲染 | 项目框架 [VERIFIED: CLAUDE.md] |
| React 19 | 已安装 | 组件层 | 项目框架 [VERIFIED: CLAUDE.md] |
| TypeScript (strict) | 已安装 | 类型安全 | 项目强制要求 [VERIFIED: CLAUDE.md] |

### 无需新增 npm 包

UI-SPEC 明确确认："No new npm packages required for Phase 9 UI." [VERIFIED: 09-UI-SPEC.md]

---

## Architecture Patterns

### System Architecture Diagram

```
Admin / Script Trigger
        │
        ▼
sync-icij-offshore.mjs
  [Batch CSV upsert → icij_entities]
        │
        ▼
  UPDATE icij_entities                    ← 新增步骤（Phase 9）
  SET is_sanctioned, sanctions_match
  FROM sanctions_entries
  WHERE word_similarity > 0.72
        │
        ▼
  PostgreSQL: icij_entities
  (node_id, name, ..., is_sanctioned, sanctions_match)
        │
        ├──────────────────────────────────┐
        ▼                                  ▼
getIcijMatches(entityId)          getCompanyFraudAlerts(name)
  [+ isSanctioned, sanctionsMatch]  [query fraud_alerts via pg_trgm]
        │                                  │
        ▼                                  ▼
company/[slug]/page.tsx (Server)
  ├── OffshoreLeaksPanel        ← 每行渲染 "Sanctioned Entity" badge（如 is_sanctioned=true）
  └── FraudAlertsPanel          ← 展示 FraudAlert[] 列表
        │
        ▼
  <ContentLock f3Unlocked>      ← 两个 panel 均为 F3 付费内容

vessel/[imo]/page.tsx (Server)
  └── FraudAlertsPanel          ← getVesselFraudAlerts(operator, manager?)
        │
        ▼
  <ContentLock f3Unlocked>
```

### Recommended Project Structure

```
db/migrations/
└── 036_icij_sanctions_linkage.sql    # 新增：ALTER TABLE icij_entities + UPDATE 匹配

src/lib/server/
├── repository.ts                     # 修改：IcijMatch 接口 + getIcijMatches() + 两个新函数
│   ├── interface IcijMatch           # 新增 isSanctioned? + sanctionsMatch?
│   ├── getIcijMatches()              # 修改：SELECT is_sanctioned, sanctions_match
│   ├── getCompanyFraudAlerts(name)   # 新增
│   └── getVesselFraudAlerts(op, mgr) # 新增

src/app/company/[slug]/page.tsx       # 修改：引入 FraudAlertsPanel，新增 tab，调用新 repo 函数
src/app/vessel/[imo]/page.tsx         # 修改：引入 FraudAlertsPanel，新增 tab，调用新 repo 函数

src/components/entity/
└── FraudAlertsPanel.tsx              # 新增 Server Component（纯 props-fed，无 use client）

scripts/
└── sync-icij-offshore.mjs            # 修改（可选）：脚本末尾追加全量制裁重匹配 step
```

### Pattern 1: pg_trgm word_similarity UPDATE（ICIJ→sanctions 匹配）

**What:** 批量 UPDATE icij_entities，通过 word_similarity 与 sanctions_entries.search_text 做模糊匹配
**When to use:** 每次 ICIJ 数据 upsert 后立即执行（D-01/D-02）

```sql
-- Source: [VERIFIED: sanctions.ts word_similarity pattern + migration 010 schema]
-- 放在 migration 036 之后，或作为可单独调用的函数

UPDATE icij_entities ie
SET
  is_sanctioned  = TRUE,
  sanctions_match = se.name
FROM (
  SELECT DISTINCT ON (ie2.node_id)
    ie2.node_id,
    se2.name
  FROM icij_entities ie2
  CROSS JOIN LATERAL (
    SELECT name
    FROM sanctions_entries
    WHERE word_similarity(lower(ie2.name), search_text) > 0.72
      AND sanctions IS NOT NULL
    ORDER BY word_similarity(lower(ie2.name), search_text) DESC
    LIMIT 1
  ) se2
) AS matched(node_id, name) JOIN sanctions_entries se ON se.name = matched.name
WHERE ie.node_id = matched.node_id;

-- 同时重置未匹配行（D-02 全量重匹配要求）：
UPDATE icij_entities
SET is_sanctioned = FALSE, sanctions_match = NULL
WHERE node_id NOT IN (
  SELECT DISTINCT ie2.node_id
  FROM icij_entities ie2
  CROSS JOIN LATERAL (
    SELECT 1
    FROM sanctions_entries
    WHERE word_similarity(lower(ie2.name), search_text) > 0.72
      AND sanctions IS NOT NULL
    LIMIT 1
  ) _
);
```

**更简洁替代方案（推荐，Claude 可选）：**

```sql
-- Source: [ASSUMED - cleaner single-pass pattern]
UPDATE icij_entities
SET
  is_sanctioned  = (match.name IS NOT NULL),
  sanctions_match = match.name
FROM icij_entities ie2
LEFT JOIN LATERAL (
  SELECT se.name
  FROM sanctions_entries se
  WHERE word_similarity(lower(ie2.name), se.search_text) > 0.72
    AND se.sanctions IS NOT NULL
  ORDER BY word_similarity(lower(ie2.name), se.search_text) DESC
  LIMIT 1
) match ON TRUE
WHERE icij_entities.node_id = ie2.node_id;
```

注意：`icij_entities` 行数可能达到数百万。全量 LATERAL CROSS JOIN 可能耗时较长。建议加超时或分批执行。

### Pattern 2: Server Component 面板（FraudAlertsPanel）

**What:** 纯 props-fed 的 Server Component，数据在 page.tsx server 端预取后通过 props 注入
**When to use:** 所有基于数据库查询的实体详情面板（与 IntelligencePanel 的 Client Component + fetch 模式不同）

```typescript
// Source: [VERIFIED: company/[slug]/page.tsx inline panel pattern]
// FraudAlertsPanel.tsx — 无 'use client' 指令

import type { FraudAlert } from '@/lib/server/fraud-check'

interface Props {
  alerts: FraudAlert[]
}

export default function FraudAlertsPanel({ alerts }: Props) {
  // 纯 Server Component：直接渲染，无 useEffect/useState/fetch
  // ...
}

// 在 page.tsx 中调用：
const fraudAlerts = f3Unlocked
  ? await getCompanyFraudAlerts(company.name)
  : []
```

**注意：** `IntelligencePanel` 是 `'use client'` 组件（使用 `useEffect` + `fetch`），FraudAlertsPanel 不应复制这个模式。正确模板是 `OffshoreLeaksPanel`（内联于 company/[slug]/page.tsx，props-fed）。

### Pattern 3: IcijMatch 类型扩展

```typescript
// Source: [VERIFIED: src/lib/server/repository.ts L998-L1010]

// 修改前：
export interface IcijMatch {
  nodeId: string
  name: string
  // ... 其他字段
  matchConfidence: number
}

// 修改后（Phase 9 新增）：
export interface IcijMatch {
  nodeId: string
  name: string
  // ... 其他字段
  matchConfidence: number
  isSanctioned?: boolean          // 新增
  sanctionsMatch?: string | null  // 新增
}

// getIcijMatches() SQL 扩展：
// SELECT ..., is_sanctioned, sanctions_match
// FROM icij_entities
// WHERE linked_entity_id = $1
```

### Pattern 4: getCompanyFraudAlerts / getVesselFraudAlerts

```typescript
// Source: [VERIFIED: src/lib/server/fraud-check.ts - checkFraudAlerts() 模板]
// 放入 repository.ts（保持数据访问集中）

import { normalizeEntityName } from '@/lib/server/normalize'

const FRAUD_SIMILARITY_THRESHOLD = 0.45  // [VERIFIED: fraud-check.ts L37]

export async function getCompanyFraudAlerts(name: string): Promise<FraudAlert[]> {
  if (!name || name.trim().length < 2) return []
  const normalized = normalizeEntityName(name, true)
  if (!normalized || normalized.length < 2) return []

  const { rows } = await db.query<FraudAlert & { sim: number }>(
    `SELECT
       source, source_name, source_url, company_name,
       list_type, fraud_type, description, scam_url,
       synced_at,
       GREATEST(
         similarity(normalized_name, $1),
         word_similarity($1, normalized_name)
       ) AS sim
     FROM fraud_alerts
     WHERE normalized_name % $1 OR $1 %> normalized_name
     ORDER BY
       CASE list_type WHEN 'blacklist' THEN 0 ELSE 1 END,
       synced_at DESC
     LIMIT 50`,
    [normalized]
  )
  return rows
    .filter((r) => r.sim >= FRAUD_SIMILARITY_THRESHOLD)
    .map(({ sim: _sim, ...r }) => r)
}

// FraudAlert 接口需加 synced_at 字段（UI-SPEC 要求展示 "Reported {date}"）
```

### Pattern 5: Tab 插入（公司页面）

```typescript
// Source: [VERIFIED: src/app/company/[slug]/page.tsx L769-L779 现有 tabs 数组]
// 当前 tabs 顺序：Registration | Directors | Beneficial Owners | Vessels | Risk Flags | Offshore Leaks | Intelligence | Domain | Sources
// Phase 9 目标（UI-SPEC L344）：
// Registration | Directors | Beneficial Owners | Vessels | Risk Flags | Fraud Alerts | Offshore Leaks | Intelligence | Domain | Sources

const tabs = [
  { id: 'registration',      label: 'Registration' },
  { id: 'directors',         label: 'Directors' },
  { id: 'beneficial-owners', label: 'Beneficial Owners' },
  { id: 'vessels',           label: 'Vessels' },
  { id: 'flags',             label: 'Risk Flags' },
  { id: 'fraud-alerts',      label: 'Fraud Alerts' },   // 新增：在 Risk Flags 后
  { id: 'offshore',          label: 'Offshore Leaks' },
  { id: 'intelligence',      label: 'Intelligence' },
  { id: 'domain',            label: 'Domain' },
  { id: 'sources',           label: 'Sources' },
]
```

### Pattern 6: Tab 插入（船舶页面）

```typescript
// Source: [VERIFIED: src/app/vessel/[imo]/page.tsx L465-L473 现有 tabs 数组]
// 当前：Vessel Details | AIS Tracking | Draft Risk | Risk Flags | PSC History | Intelligence | Sources
// Phase 9 目标（UI-SPEC L348）：
// Vessel Details | AIS Tracking | Draft Risk | Risk Flags | Fraud Alerts | PSC History | Intelligence | Sources

const tabs = [
  { id: 'details',       label: 'Vessel Details' },
  { id: 'ais',           label: 'AIS Tracking' },
  { id: 'draft',         label: 'Draft Risk' },
  { id: 'flags',         label: 'Risk Flags' },
  { id: 'fraud-alerts',  label: 'Fraud Alerts' },    // 新增：在 Risk Flags 后
  { id: 'history',       label: 'PSC History' },
  { id: 'intelligence',  label: 'Intelligence' },
  { id: 'sources',       label: 'Sources' },
]
```

### Anti-Patterns to Avoid

- **复制 IntelligencePanel 模式：** IntelligencePanel 是 `'use client'`（useEffect + fetch）。FraudAlertsPanel 必须是 Server Component——数据在 page.tsx 服务器端预取，通过 props 传入，无需 API route。
- **在 FraudAlertsPanel 中直接调用 db：** repository 函数应集中在 `repository.ts`，与现有模式保持一致（`getIcijMatches` 等均在此文件）。
- **遗漏 synced_at 字段：** UI-SPEC 要求展示 "Reported {date}"，`FraudAlert` 接口目前无 `synced_at`，需在查询中加入。
- **ICIJ 匹配使用 `normalizeQuery()`（来自 sanctions.ts）而非 `normalizeEntityName()`：** 两者逻辑相似但 `normalizeEntityName` 是代码库规范函数。对 ICIJ name 做 `lower()` 处理即可，与 `icij_entities` GIN index 一致。

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| 模糊名称匹配 | 自定义编辑距离算法 | `pg_trgm` `word_similarity()` | 已安装，GIN 索引已建，阈值已校准 [VERIFIED: migration 011] |
| 名称规范化 | 自定义 strip 逻辑 | `normalizeEntityName(name, true)` | 规范函数，write-time 与 query-time 保持一致 [VERIFIED: normalize.ts] |
| F3 内容锁 | 自定义 blur/overlay | `<ContentLock unlocked={f3Unlocked} reason={lockReason}>` | 现有组件，一致的 SEO 安全 aria-hidden 实现 [VERIFIED: ContentLock.tsx] |
| 欺诈警报查询 | 全量扫描后 JS 过滤 | `fraud_alerts.normalized_name % $1` GIN 索引 | idx_fraud_normalized GIN 索引已就位 [VERIFIED: migration 028] |

---

## Common Pitfalls

### Pitfall 1: icij_entities 全量 LATERAL JOIN 性能

**What goes wrong:** `UPDATE icij_entities ... CROSS JOIN LATERAL (SELECT FROM sanctions_entries WHERE word_similarity(...) > 0.72)` 在 icij_entities 行数大时可能运行数分钟甚至超时。
**Why it happens:** pg_trgm word_similarity 需要对每行计算，LATERAL 可利用 GIN index 但对大表仍然慢。
**How to avoid:** migration 036 在 ALTER TABLE 后不直接运行 UPDATE；将 UPDATE 提取到独立步骤（或 admin API endpoint），允许异步运行。或在 `sync-icij-offshore.mjs` 脚本最后追加，脚本本身已是离线批处理。
**Warning signs:** UPDATE 语句无限期挂起；需要预先在测试数据库上用 `EXPLAIN ANALYZE` 验证计划。

### Pitfall 2: FraudAlert 接口缺少 synced_at

**What goes wrong:** `checkFraudAlerts()` 中的 `FraudAlert` 接口（fraud-check.ts L17-L26）没有 `synced_at` 字段，但 UI-SPEC 要求展示 "Reported {date}"。
**Why it happens:** 现有接口为 `checkFraudAlerts()` 设计，未考虑 UI 展示需求。
**How to avoid:** `getCompanyFraudAlerts()` 和 `getVesselFraudAlerts()` 返回包含 `synced_at: Date` 的扩展接口（可重新定义一个 `FraudAlertWithDate` 或在 repository 层用 `FraudAlertRow`）。

### Pitfall 3: vessel.manager 字段不存在

**What goes wrong:** D-04 说通过 `vessel.operator OR vessel.manager` 匹配，但 `Vessel` 类型只有 `currentOperator`（无 `manager`），数据库 entities 表 metadata 中也无 manager 字段。
**Why it happens:** CONTEXT.md 中的"manager"参照 IMO 船舶管理公司概念，但 ETI 数据模型尚未引入此字段。
**How to avoid:** 初期 `getVesselFraudAlerts()` 仅使用 `currentOperator`；或在 Vessel 类型和 metadata 中先添加可选 `manager?: string`（需协调数据源）。见 Open Question Q-1。

### Pitfall 4: OffshoreLeaksPanel 中 is_sanctioned badge 的渲染位置

**What goes wrong:** UI-SPEC 要求 badge 在"match confidence 和 ICIJ link 之间"，但 OffshoreLeaksPanel 当前 JSX 结构是右列 `<div>` 内的 confidence → ICIJ link，需要在二者之间插入 badge。
**Why it happens:** OffshoreLeaksPanel 是内联于 company/[slug]/page.tsx 的函数组件（L462），修改需要精确定位插入点。
**How to avoid:** 在 `<p style={{ fontSize: '12px', fontWeight: 600... }}>{Math.round(m.matchConfidence * 100)}% match</p>` 之后、`{m.sourceUrl && ...}` 之前插入 badge。

### Pitfall 5: tab id 与 panels 数组顺序必须严格对应

**What goes wrong:** TabNav 组件通过数组索引将 `tabs[i]` 对应 `panels[i]`，插入新 tab 时若 panels 插入位置错误，会导致内容渲染错位。
**Why it happens:** `tabs` 和 `panels` 是平行数组，无 key-to-panel 映射，顺序必须完全对应。
**How to avoid:** 在 tabs 插入 `{ id: 'fraud-alerts', ... }` 的同时，在 panels 的对应位置插入 FraudAlertsPanel JSX 元素（两处修改必须同步）。

---

## Code Examples

### ICIJ→sanctions 匹配的简洁 UPDATE（推荐）

```sql
-- Source: [VERIFIED: sanctions.ts word_similarity pattern, migration 010 schema]
-- 文件：db/migrations/036_icij_sanctions_linkage.sql

ALTER TABLE icij_entities
  ADD COLUMN IF NOT EXISTS is_sanctioned  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sanctions_match TEXT;

CREATE INDEX IF NOT EXISTS idx_icij_sanctioned
  ON icij_entities (is_sanctioned)
  WHERE is_sanctioned = TRUE;

-- 全量重匹配（迁移时运行一次，后续可通过脚本重跑）
UPDATE icij_entities ie
SET
  is_sanctioned  = (m.matched_name IS NOT NULL),
  sanctions_match = m.matched_name
FROM (
  SELECT
    ie2.node_id,
    (
      SELECT se.name
      FROM sanctions_entries se
      WHERE se.sanctions IS NOT NULL
        AND word_similarity(lower(ie2.name), se.search_text) > 0.72
      ORDER BY word_similarity(lower(ie2.name), se.search_text) DESC
      LIMIT 1
    ) AS matched_name
  FROM icij_entities ie2
) m
WHERE ie.node_id = m.node_id;
```

### getCompanyFraudAlerts（repository.ts 中的位置）

```typescript
// Source: [VERIFIED: fraud-check.ts checkFraudAlerts() - 直接衍生]
// synced_at 为新增字段（UI 展示需要）

export interface FraudAlertRow {
  source: string
  source_name: string
  source_url: string
  company_name: string
  list_type: 'blacklist' | 'whitelist'
  fraud_type: string | null
  description: string | null
  scam_url: string | null
  synced_at: Date
}

export async function getCompanyFraudAlerts(name: string): Promise<FraudAlertRow[]> {
  if (!name || name.trim().length < 2) return []
  const normalized = normalizeEntityName(name, true)
  if (!normalized || normalized.length < 2) return []

  const { rows } = await db.query<FraudAlertRow & { sim: number }>(
    `SELECT
       source, source_name, source_url, company_name,
       list_type, fraud_type, description, scam_url, synced_at,
       GREATEST(
         similarity(normalized_name, $1),
         word_similarity($1, normalized_name)
       ) AS sim
     FROM fraud_alerts
     WHERE normalized_name % $1 OR $1 %> normalized_name
     ORDER BY
       CASE list_type WHEN 'blacklist' THEN 0 ELSE 1 END,
       synced_at DESC`,
    [normalized]
  )
  return rows
    .filter((r) => r.sim >= 0.45)
    .map(({ sim: _sim, ...r }) => r)
}
```

### ICIJ Sanctioned Badge（OffshoreLeaksPanel 内）

```tsx
// Source: [VERIFIED: 09-UI-SPEC.md §2 ICIJ Sanctioned Node Indicator]
// 插入位置：右列 match confidence 之后、ICIJ link 之前

{m.isSanctioned && (
  <span
    title={m.sanctionsMatch ? `Matched: ${m.sanctionsMatch}` : undefined}
    style={{
      display: 'inline-block',
      fontSize: '10px',
      fontWeight: 600,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      color: 'var(--status-listed)',
      backgroundColor: 'rgba(239,68,68,0.12)',
      border: '1px solid rgba(239,68,68,0.2)',
      padding: '2px 6px',
      borderRadius: '4px',
      marginLeft: 'var(--space-2)',
    }}
  >
    Sanctioned Entity
  </span>
)}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ICIJ 数据无制裁关联 | is_sanctioned 标记 + Phase 10 红节点 | Phase 9 引入 | ICIJ 离岸实体的制裁穿透可见性 |
| 欺诈警报仅用于 screen/trade 路径 | 实体详情页直接展示 FraudAlertsPanel | Phase 9 引入 | 用户在查看实体时即可看到欺诈情报 |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ICIJ→sanctions UPDATE 的 LATERAL 子查询能在可接受时间内完成（取决于 icij_entities 行数） | Common Pitfalls #1 | 需要在脚本中分批或异步执行 |
| A2 | `fraud_alerts` 表中的行数足够小（< 几千），ORDER BY 不需要额外索引 | Code Examples | 若数据量大，需在 `(list_type, synced_at)` 上建复合索引 |

---

## Open Questions

### Q-1: vessel.manager 字段不存在

**What we know:** D-04 要求通过 `vessel.operator OR vessel.manager` 匹配。`Vessel` TypeScript 类型（types.ts L93-L103）只有 `currentOperator?: string`，无 `manager`。数据库 entities 表的 metadata JSONB 中也未见 manager 字段（经 grep 所有 migrations 和 repository.ts 确认）。

**What's unclear:** "manager"指的是 AIS 数据来源的 technical manager / ship manager（如 Equasis 数据）还是 ETI 尚未建模的字段？

**Recommendation:** 实施时先仅用 `vessel.currentOperator`（一个 name 参数），同时在 `Vessel` 类型中预留 `manager?: string`（可选字段，初始 undefined）。`getVesselFraudAlerts()` 签名设计为接受 `(operator: string | null | undefined, manager: string | null | undefined)` 以便未来扩展。这样 Phase 9 可以交付，Phase 11（NETCOV-01 vessel ICIJ）可以同步补充 manager 数据源。

### Q-2: ICIJ sync 的触发时机（D-01 的解释）

**What we know:** `src/lib/server/sync/index.ts` 目前没有 ICIJ sync 入口。ICIJ 数据通过离线脚本 `scripts/sync-icij-offshore.mjs` 导入（CSV 文件，非 API 触发）。D-01 说"嵌入 ICIJ sync job"，但这个 job 是脚本而非运行时任务。

**What's unclear:** "嵌入"意味着修改脚本末尾追加 UPDATE，还是在 sync/index.ts 中增加一个可 API 触发的 `icij` 任务入口？

**Recommendation:** 最小路径是在 `scripts/sync-icij-offshore.mjs` 末尾追加制裁匹配 UPDATE SQL（已有 DB 连接，脚本结束前执行）。同时在 migration 036 中执行一次 UPDATE 初始化存量数据。这样两个触发路径都覆盖，无需改动 sync/index.ts。

---

## Environment Availability

Step 2.6: 无需检查外部依赖。Phase 9 的所有操作均基于已有数据库、已有 `pg_trgm` 扩展、已有 npm 包。无新外部服务、CLI 工具或运行时依赖。

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | 无（项目明确标注"No automated tests — Vitest recommended — explicit tech debt"） |
| Config file | 无 |
| Quick run command | `npm run type-check` + `npm run lint` |
| Full suite command | `npm run build` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NETDATA-01 | is_sanctioned 列在 migration 036 后存在 | manual | `psql $DATABASE_URL -c "\d icij_entities"` | ❌ Wave 0 不适用 |
| NETDATA-01 | 制裁匹配 UPDATE 对已知制裁实体名称返回 is_sanctioned=true | manual | `psql $DATABASE_URL -c "SELECT name, is_sanctioned FROM icij_entities WHERE is_sanctioned=TRUE LIMIT 5"` | ❌ 手动验证 |
| NETDATA-02 | OffshoreLeaksPanel 行内 badge 在 is_sanctioned=true 时渲染 | visual | `npm run dev` → 人工检查 | ❌ 手动 |
| NETDATA-03 | FraudAlertsPanel 在公司页面 tab 中显示 | visual | `npm run dev` → 访问任一公司详情页 | ❌ 手动 |
| NETDATA-04 | FraudAlertsPanel 在船舶页面 tab 中显示 | visual | `npm run dev` → 访问任一船舶详情页 | ❌ 手动 |
| 类型安全 | TypeScript 编译通过（IcijMatch 新字段不破坏现有用法） | automated | `npm run type-check` | ✅ |
| Lint | FraudAlertsPanel 无 lint 错误 | automated | `npm run lint` | ✅ |

### Sampling Rate

- **Per task commit:** `npm run type-check && npm run lint`
- **Per wave merge:** `npm run build`
- **Phase gate:** `npm run build` 绿灯 + 手动检查 FraudAlertsPanel 渲染和 ICIJ badge

### Wave 0 Gaps

无需新测试文件——项目当前无测试基础设施，验证通过 type-check + build + 手动检查完成。

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (间接) | 现有 NextAuth v5 session 检查（f3Unlocked 来自 session.user.plan） |
| V3 Session Management | no | 无新 session 逻辑 |
| V4 Access Control | yes | ContentLock F3 gating（现有组件）；getCompanyFraudAlerts 仅在 f3Unlocked 时调用 |
| V5 Input Validation | yes | `normalizeEntityName()` 规范化所有 DB 查询参数；参数化查询（pg `$1`） |
| V6 Cryptography | no | 无新加密需求 |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via entity name | Tampering | 参数化查询 `$1`（已用，全部遵循） [VERIFIED: fraud-check.ts L51] |
| F3 内容绕过（直接调用 getCompanyFraudAlerts） | Elevation of Privilege | 调用方（page.tsx）在 `f3Unlocked` 条件下调用；数据库无行级权限，由应用层保证 |
| 无限查询（fraud_alerts 无 LIMIT） | DoS | 需在 `getCompanyFraudAlerts()` 查询加 `LIMIT 50`（实际匹配数 < 10，但防御性 LIMIT 必须） |

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: db/migrations/010_opensanctions_schema.sql] — sanctions_entries schema（search_text 列、word_similarity 索引）
- [VERIFIED: db/migrations/011_ports_psc_icij.sql] — icij_entities 当前 schema
- [VERIFIED: db/migrations/028_fraud_alerts.sql] — fraud_alerts 表 schema
- [VERIFIED: src/lib/server/sync/sanctions.ts] — word_similarity > 0.72 阈值和 normalizeQuery() 模式
- [VERIFIED: src/lib/server/fraud-check.ts] — SIMILARITY_THRESHOLD = 0.45，FraudAlert 接口，查询结构
- [VERIFIED: src/lib/server/repository.ts L998-L1035] — IcijMatch 接口，getIcijMatches() SQL
- [VERIFIED: src/app/company/[slug]/page.tsx L769-L808] — tabs 数组和 panels 数组当前结构
- [VERIFIED: src/app/vessel/[imo]/page.tsx L465-L496] — 船舶页 tabs 和 panels 结构
- [VERIFIED: src/components/entity/ContentLock.tsx] — F3 lock 实现
- [VERIFIED: src/lib/types.ts L93-L103] — Vessel 类型（无 manager 字段确认）
- [VERIFIED: src/lib/server/normalize.ts] — normalizeEntityName() 规范函数
- [VERIFIED: scripts/sync-icij-offshore.mjs] — ICIJ sync 为离线脚本，不在 sync/index.ts 中
- [VERIFIED: .planning/phases/09-data-enrichment-foundations/09-UI-SPEC.md] — 完整 UI 规格

### Secondary (MEDIUM confidence)
- [VERIFIED: src/components/entity/IntelligencePanel.tsx] — 确认其为 'use client'（FraudAlertsPanel 不应复制此模式）

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 全部已有依赖，无新引入
- Architecture: HIGH — 代码库已有清晰模式，直接复用
- Pitfalls: HIGH — 通过审计实际代码发现（manager 字段缺失、LATERAL 性能、tabs 索引对应）
- Open Questions: 需执行前与用户确认 Q-1（vessel manager 字段策略）

**Research date:** 2026-04-16
**Valid until:** 2026-05-16（稳定依赖，无外部 API）

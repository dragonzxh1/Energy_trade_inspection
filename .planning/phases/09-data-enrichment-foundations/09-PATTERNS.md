# Phase 9: Data Enrichment Foundations - Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 7 (2 new, 5 modified)
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `db/migrations/036_icij_sanctions_linkage.sql` | migration | batch (ALTER + UPDATE) | `db/migrations/011_ports_psc_icij.sql` | role-match |
| `scripts/sync-icij-offshore.mjs` | utility (batch script) | batch / file-I/O | `scripts/sync-icij-offshore.mjs` 自身（linkToEntities 函数） | exact |
| `src/lib/server/repository.ts` | service / data-access | CRUD | `src/lib/server/fraud-check.ts` + 同文件 `getPscInspections` | exact |
| `src/components/entity/FraudAlertsPanel.tsx` | component (Server) | request-response (props-fed) | `company/[slug]/page.tsx` 内联的 `OffshoreLeaksPanel` 函数 | exact |
| `src/app/company/[slug]/page.tsx` | route (page) | request-response | 自身现有 tabs/panels 数组结构 | exact |
| `src/app/vessel/[imo]/page.tsx` | route (page) | request-response | 自身现有 tabs/panels 数组结构 | exact |
| `src/components/entity/OffshoreLeaksPanel.tsx` | component (Server, inline) | request-response | 自身 `OffshoreLeaksPanel` 内联函数 | exact |

---

## Pattern Assignments

### `db/migrations/036_icij_sanctions_linkage.sql` (migration, batch)

**Analog:** `db/migrations/011_ports_psc_icij.sql` (lines 52-78) — 同样是向 icij_entities 表添加列和索引的迁移文件。

**Schema 变更 pattern** (analog lines 55-78):
```sql
-- 来自 db/migrations/011_ports_psc_icij.sql L52-L78
CREATE TABLE IF NOT EXISTS icij_entities (
  node_id             TEXT PRIMARY KEY,
  ...
  synced_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_icij_name_trgm ON icij_entities
  USING GIN (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_icij_linked    ON icij_entities (linked_entity_id)
  WHERE linked_entity_id IS NOT NULL;   -- ← 稀疏索引模式：WHERE 条件过滤
```

**关键模式：**
1. `ADD COLUMN IF NOT EXISTS` — 所有迁移列变更均使用 IF NOT EXISTS
2. 稀疏索引：`WHERE is_sanctioned = TRUE`（仅对少数标记行建索引，与 `idx_icij_linked` 的 WHERE 子句相同）
3. `CREATE EXTENSION IF NOT EXISTS pg_trgm` — 冪等，可重复运行

**word_similarity UPDATE pattern**（来自 `src/lib/server/sync/sanctions.ts` L41-L48）：
```sql
-- sanctions.ts L43-L49：word_similarity > 0.72 阈值和 search_text 列
SELECT id, name, schema, dataset, sanctions
FROM sanctions_entries
WHERE word_similarity($1, search_text) > 0.72
ORDER BY word_similarity($1, search_text) DESC
LIMIT 5
```
Phase 9 将此 per-row 查询转为批量 UPDATE（见 Shared Patterns 中的 SQL）。

**已有 GIN 索引（无需新建，来自 migration 010）：**
```sql
-- db/migrations/010_opensanctions_schema.sql L23-L24
CREATE INDEX idx_os_search ON sanctions_entries USING GIN (search_text gin_trgm_ops);
CREATE INDEX idx_os_name_trgm ON sanctions_entries USING GIN (lower(name) gin_trgm_ops);
```

---

### `scripts/sync-icij-offshore.mjs` (utility/batch, file-I/O → batch DB write)

**Analog:** 自身 `linkToEntities()` 函数（lines 370-389）— 该函数已展示了脚本内向 icij_entities 发起批量 UPDATE 的完整模式。

**现有 linkToEntities 模式**（lines 370-389，直接复制并扩展）：
```javascript
// scripts/sync-icij-offshore.mjs L370-L389
async function linkToEntities() {
  console.log('\nLinking ICIJ entities to local company database…')
  const client = await pool.connect()
  try {
    const { rowCount } = await client.query(`
      UPDATE icij_entities i
      SET
        linked_entity_id = e.id,
        match_confidence = similarity(lower(i.name), lower(e.name))
      FROM entities e
      WHERE
        i.linked_entity_id IS NULL
        AND e.entity_type = 'company'
        AND similarity(lower(i.name), lower(e.name)) >= 0.7
    `)
    console.log(`Linked ${rowCount} ICIJ entries to local entities.`)
  } finally {
    client.release()
  }
}
```
新增的 `matchSanctions()` 函数复制此结构：`pool.connect()` → `client.query(UPDATE SQL)` → `client.release()`（finally 块）→ 打印 rowCount。

**main() 末尾调用模式**（lines 429-434）：
```javascript
// scripts/sync-icij-offshore.mjs L429-L434
if (!DRY_RUN && total > 0) {
  await linkToEntities()
}

console.log(`\nDone. Total node rows imported: ${total}`)
await pool.end()
```
新增的 `matchSanctions()` 调用紧跟 `linkToEntities()` 之后，在 `pool.end()` 之前，也需守卫 `!DRY_RUN` 条件。

---

### `src/lib/server/repository.ts` (service/data-access, CRUD)

**Analog A — IcijMatch 接口扩展：** 自身现有接口（lines 998-1010）和 `getIcijMatches()` 函数（lines 1012-1035）。

**现有 IcijMatch 接口**（lines 998-1010）：
```typescript
// src/lib/server/repository.ts L998-L1010
export interface IcijMatch {
  nodeId: string
  name: string
  dataset: string
  entityType: string | null
  countries: string | null
  jurisdiction: string | null
  status: string | null
  incorporationDate: string | null
  address: string | null
  sourceUrl: string | null
  matchConfidence: number
  // Phase 9 新增：
  // isSanctioned?: boolean
  // sanctionsMatch?: string | null
}
```

**现有 getIcijMatches() SQL + mapper**（lines 1013-1035）：
```typescript
// src/lib/server/repository.ts L1013-L1035
export async function getIcijMatches(entityId: string): Promise<IcijMatch[]> {
  const { rows } = await db.query(
    `SELECT node_id, name, dataset, entity_type, countries, jurisdiction,
            status, incorporation_date, address, source_url, match_confidence
     FROM icij_entities
     WHERE linked_entity_id = $1
     ORDER BY match_confidence DESC
     LIMIT 20`,
    [entityId]
  )
  return rows.map((r) => ({
    nodeId: r.node_id,
    name: r.name,
    dataset: r.dataset,
    entityType: r.entity_type,
    countries: r.countries,
    jurisdiction: r.jurisdiction,
    status: r.status,
    incorporationDate: r.incorporation_date,
    address: r.address,
    sourceUrl: r.source_url,
    matchConfidence: parseFloat(r.match_confidence ?? '0'),
    // Phase 9 新增：
    // isSanctioned: r.is_sanctioned ?? false,
    // sanctionsMatch: r.sanctions_match ?? null,
  }))
}
```

**Analog B — getCompanyFraudAlerts / getVesselFraudAlerts：** `src/lib/server/fraud-check.ts`（lines 39-85），完整查询结构直接复用。

**checkFraudAlerts 查询结构**（fraud-check.ts lines 49-76）：
```typescript
// src/lib/server/fraud-check.ts L39-L76
const SIMILARITY_THRESHOLD = 0.45  // L37

export async function checkFraudAlerts(name: string): Promise<FraudCheckResult> {
  const empty: FraudCheckResult = { flagged: false, whitelisted: false, alerts: [] }
  if (!name || name.trim().length < 2) return empty

  const normalized = normalizeEntityName(name, true)   // L46 — stripGeneric=true
  if (!normalized || normalized.length < 2) return empty

  try {
    const { rows } = await db.query<FraudAlert & { sim: number }>(
      `SELECT
         source, source_name, source_url, company_name,
         list_type, fraud_type, description, scam_url,
         GREATEST(
           similarity(normalized_name, $1),
           word_similarity($1, normalized_name)
         ) AS sim
       FROM fraud_alerts
       WHERE
         normalized_name % $1
         OR $1 %> normalized_name
       ORDER BY sim DESC
       LIMIT 10`,
      [normalized]
    )
    const hits = rows.filter((r) => r.sim >= SIMILARITY_THRESHOLD)
    ...
  } catch {
    return empty   // ← 永不阻塞主流程
  }
}
```

**新函数与 checkFraudAlerts 的三处差异：**
1. SELECT 追加 `synced_at`（UI-SPEC 要求展示 "Reported {date}"）
2. ORDER BY 改为 `CASE list_type WHEN 'blacklist' THEN 0 ELSE 1 END, synced_at DESC`（黑名单优先）
3. LIMIT 改为 50（防御性上限，D-06 不设业务上限但需防止 DoS）

**Analog C — repository 函数签名 pattern：** `getPscInspections`（lines 969-994）展示了带参数化查询的标准 repository 函数。

```typescript
// src/lib/server/repository.ts L969-L994
export async function getPscInspections(imo: string, limit = 10): Promise<PscInspection[]> {
  const { rows } = await db.query(
    `SELECT ...
     FROM psc_inspections
     WHERE imo = $1
     ORDER BY inspection_date DESC
     LIMIT $2`,
    [imo, limit]
  )
  return rows.map((r) => ({ ... }))
}
```

**imports 需追加**（参照 repository.ts L4 + fraud-check.ts L15）：
```typescript
// 已有（repository.ts L4）：
import { normalizeEntityName } from './normalize'
// 已有（repository.ts L3）：
import { db } from './db'
// 不需要新 import — normalizeEntityName 和 db 已在 repository.ts 顶部引入
```

---

### `src/components/entity/FraudAlertsPanel.tsx` (component/Server, props-fed)

**Analog：** `company/[slug]/page.tsx` 内的 `OffshoreLeaksPanel` 函数组件（lines 462-533）— 这是项目中唯一的 props-fed Server Component panel 模式。

**OffshoreLeaksPanel 完整结构**（lines 462-533）：
```tsx
// src/app/company/[slug]/page.tsx L462-L533
function OffshoreLeaksPanel({ matches }: { matches: IcijMatch[] }) {
  if (matches.length === 0) {
    return (
      <div style={card}>
        <p style={sectionTitle}>Offshore Leaks</p>
        <p style={emptyState}>No matches found in ICIJ offshore leaks datasets.</p>
        ...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={card}>
        <p style={sectionTitle}>Offshore Leaks ({matches.length} match{matches.length !== 1 ? 'es' : ''})</p>
        {matches.map((m) => (
          <div key={m.nodeId} className="data-row" style={{ padding: 'var(--space-3) 0', borderBottom: '1px solid var(--border-subtle)' }}>
            ...
          </div>
        ))}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: '16px' }}>
        Data from the ICIJ Offshore Leaks Database...
      </p>
    </div>
  )
}
```

**FraudAlertsPanel 复制此模式，关键差异：**
- Props: `{ alerts: FraudAlertRow[] }` 替代 `{ matches: IcijMatch[] }`
- 空状态文案：`"No fraud alerts on record for this entity."` (UI-SPEC §1 locked copy)
- 无 `'use client'` 指令（纯 Server Component，与 OffshoreLeaksPanel 相同）
- 每行展示：source_name、list_type badge、fraud_type、description、scam_url、synced_at
- 独立文件（`src/components/entity/FraudAlertsPanel.tsx`），不内联于 page.tsx

**card / sectionTitle / emptyState 样式**（复制自 company page 顶部 shared styles）：
```tsx
// src/app/company/[slug]/page.tsx L53-L58, L60-L67
const card: React.CSSProperties = {
  backgroundColor: 'var(--bg-surface)',
  borderRadius: '10px',
  padding: 'var(--space-5)',
  border: '1px solid var(--border-subtle)',
}

const sectionTitle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '11px',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: 'var(--space-4)',
}
```

---

### `src/app/company/[slug]/page.tsx` (route/page, request-response — MODIFY)

**Analog：** 自身现有 tabs + panels 数组 + Promise.all 数据预取模式。

**数据预取 pattern**（lines 741-746）：
```typescript
// src/app/company/[slug]/page.tsx L741-L746
const [watchlistRows, icijMatches, icijOfficerLinks] = await Promise.all([
  session?.user && (plan === 'professional' || plan === 'enterprise')
    ? getEntityWatchState(session.user.id, company.id)
    : Promise.resolve(false),
  f3Unlocked ? getIcijMatches(company.id) : Promise.resolve([]),
  f3Unlocked ? getIcijOfficerNetwork(company.id) : Promise.resolve([]),
])
```
新增 `getCompanyFraudAlerts(company.name)` 追加到 Promise.all 或单独 await（需在 f3Unlocked 守卫下调用）。

**现有 tabs 数组**（lines 769-779）：
```typescript
// src/app/company/[slug]/page.tsx L769-L779
const tabs = [
  { id: 'registration',       label: 'Registration' },
  { id: 'directors',          label: 'Directors' },
  { id: 'beneficial-owners',  label: 'Beneficial Owners' },
  { id: 'vessels',            label: 'Vessels' },
  { id: 'flags',              label: 'Risk Flags' },
  // ← Phase 9 在此插入 { id: 'fraud-alerts', label: 'Fraud Alerts' }
  { id: 'offshore',           label: 'Offshore Leaks' },
  { id: 'intelligence',       label: 'Intelligence' },
  { id: 'domain',             label: 'Domain' },
  { id: 'sources',            label: 'Sources' },
]
```

**现有 panels 数组**（lines 781-808）：
```tsx
// src/app/company/[slug]/page.tsx L781-L808
const panels = [
  <RegistrationPanel key="registration" company={company} />,
  <ContentLock key="directors" unlocked={f3Unlocked} reason={lockReason}>
    <DirectorsPanel company={company} />
  </ContentLock>,
  ...
  <ContentLock key="flags" unlocked={f3Unlocked} reason={lockReason}>
    <RiskFlagsPanel company={company} />
  </ContentLock>,
  // ← Phase 9 在此插入（对应 tabs 插入位置）：
  // <ContentLock key="fraud-alerts" unlocked={f3Unlocked} reason={lockReason}>
  //   <FraudAlertsPanel alerts={fraudAlerts} />
  // </ContentLock>,
  <ContentLock key="offshore" unlocked={f3Unlocked} reason={lockReason}>
    ...
  </ContentLock>,
  ...
]
```

**关键约束：** tabs[i] 与 panels[i] 必须严格按索引对应（TabNav 无 key-to-panel 映射）。两处插入必须同步。

---

### `src/app/vessel/[imo]/page.tsx` (route/page, request-response — MODIFY)

**Analog：** 自身现有 tabs + panels 数组结构，与 company page 完全对称。

**现有 tabs 数组**（lines 465-473）：
```typescript
// src/app/vessel/[imo]/page.tsx L465-L473
const tabs = [
  { id: 'details',       label: 'Vessel Details' },
  { id: 'ais',           label: 'AIS Tracking' },
  { id: 'draft',         label: 'Draft Risk' },
  { id: 'flags',         label: 'Risk Flags' },
  // ← Phase 9 在此插入 { id: 'fraud-alerts', label: 'Fraud Alerts' }
  { id: 'history',       label: 'PSC History' },
  { id: 'intelligence',  label: 'Intelligence' },
  { id: 'sources',       label: 'Sources' },
]
```

**现有 panels 数组**（lines 475-496）：
```tsx
// src/app/vessel/[imo]/page.tsx L475-L496
const panels = [
  <VesselDetailsPanel key="details" vessel={vessel} />,
  <ContentLock key="ais" unlocked={f3Unlocked} reason={lockReason}>
    <AisPanel imo={vessel.imo} />
  </ContentLock>,
  <ContentLock key="draft" unlocked={f3Unlocked} reason={lockReason}>
    <DraftCheckPanel imo={vessel.imo} />
  </ContentLock>,
  <ContentLock key="flags" unlocked={f3Unlocked} reason={lockReason}>
    <RiskFlagsPanel vessel={vessel} />
  </ContentLock>,
  // ← Phase 9 在此插入（对应 tabs 插入位置）：
  // <ContentLock key="fraud-alerts" unlocked={f3Unlocked} reason={lockReason}>
  //   <FraudAlertsPanel alerts={vesselFraudAlerts} />
  // </ContentLock>,
  <div key="history" ...>
    <PscSummaryPanel summary={pscSummary} />
    ...
  </div>,
  ...
]
```

**数据预取位置**（vessel page 无 Promise.all，在 L452 之后顺序 await）：
```typescript
// src/app/vessel/[imo]/page.tsx L452
const warningHits: WarningHit[] = await getWarningHits(vessel.name, 'vessel')
// Phase 9 在此追加：
// const vesselFraudAlerts = f3Unlocked
//   ? await getVesselFraudAlerts(vessel.currentOperator, vessel.manager)
//   : []
```

---

### `src/components/entity/OffshoreLeaksPanel.tsx` (component/inline, MODIFY)

**注：** OffshoreLeaksPanel 目前是内联于 `company/[slug]/page.tsx` 的函数（L462），RESEARCH.md 中未要求提取为独立文件，Phase 9 仅在原位修改。

**Badge 插入位置**（analog: 右列 confidence 之后、ICIJ link 之前，L505-L521）：
```tsx
// src/app/company/[slug]/page.tsx L505-L521 (OffshoreLeaksPanel 右列)
<div style={{ textAlign: 'right', flexShrink: 0 }}>
  <p style={{
    fontSize: '12px', fontWeight: 600,
    color: m.matchConfidence >= 0.8 ? 'var(--status-listed)' : 'var(--text-muted)',
  }}>
    {Math.round(m.matchConfidence * 100)}% match
  </p>
  {/* ← Phase 9 在此插入 is_sanctioned badge */}
  {m.sourceUrl && (
    <a href={m.sourceUrl} ...>ICIJ</a>
  )}
</div>
```

**SanctionBadge inline 样式 pattern**（来自 UI-SPEC，与现有 dataset badge 对称）：
```tsx
// src/app/company/[slug]/page.tsx L485-L492 (dataset badge 模式)
<span style={{
  fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: '#fff', backgroundColor: DATASET_COLOR[m.dataset] ?? 'var(--text-muted)',
  padding: '1px 6px', borderRadius: '4px',
}}>
  {DATASET_LABEL[m.dataset] ?? m.dataset}
</span>
```
is_sanctioned badge 使用相同的 span 样式 skeleton，颜色替换为 `var(--status-listed)` 和红色背景。

---

## Shared Patterns

### F3 Content Lock
**Source:** `src/components/entity/ContentLock.tsx` (lines 15-133)
**Apply to:** FraudAlertsPanel 在 company page 和 vessel page 的 panels 入口处

```tsx
// src/components/entity/ContentLock.tsx L15-L20
export default function ContentLock({
  children,
  unlocked = false,
  reason = 'guest',
}: ContentLockProps) {
  if (unlocked) return <>{children}</>
  // else renders blur + CTA overlay
}
```
用法：`<ContentLock key="fraud-alerts" unlocked={f3Unlocked} reason={lockReason}>`

### normalizeEntityName (query-time normalization)
**Source:** `src/lib/server/normalize.ts` (lines 23-38)
**Apply to:** `getCompanyFraudAlerts()` 和 `getVesselFraudAlerts()` 中对 name 参数的规范化

```typescript
// src/lib/server/normalize.ts L23-L38
export function normalizeEntityName(text: string, stripGeneric = false): string {
  let s = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(LEGAL_SUFFIXES, ' ')

  if (stripGeneric) {
    s = s.replace(GENERIC_WORDS, ' ')
  }

  return s
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
```
调用方式：`normalizeEntityName(name, true)`（stripGeneric=true，与 fraud-check.ts L46 一致）。

### pg_trgm 欺诈警报查询 (GIN index + similarity filter)
**Source:** `src/lib/server/fraud-check.ts` (lines 50-76)
**Apply to:** `getCompanyFraudAlerts()` 和 `getVesselFraudAlerts()` 中的 SQL

```typescript
// src/lib/server/fraud-check.ts L50-L73
const { rows } = await db.query<FraudAlert & { sim: number }>(
  `SELECT
     source, source_name, source_url, company_name,
     list_type, fraud_type, description, scam_url,
     GREATEST(
       similarity(normalized_name, $1),
       word_similarity($1, normalized_name)
     ) AS sim
   FROM fraud_alerts
   WHERE
     normalized_name % $1
     OR $1 %> normalized_name
   ORDER BY sim DESC
   LIMIT 10`,
  [normalized]
)
const hits = rows.filter((r) => r.sim >= SIMILARITY_THRESHOLD)  // SIMILARITY_THRESHOLD = 0.45
```
Phase 9 版本变更：
- 追加 `synced_at` 到 SELECT
- ORDER BY 改为 `CASE list_type WHEN 'blacklist' THEN 0 ELSE 1 END, synced_at DESC`
- LIMIT 改为 50

### pg_trgm word_similarity 批量 UPDATE (ICIJ→sanctions)
**Source pattern 合成：** `sanctions.ts` L43-L49（阈值）+ `sync-icij-offshore.mjs` L374-L387（UPDATE 结构）
**Apply to:** `db/migrations/036_icij_sanctions_linkage.sql` + `scripts/sync-icij-offshore.mjs` 新增函数

```sql
-- 推荐的单次 LEFT JOIN LATERAL 全量重匹配 SQL
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
注意：全量 UPDATE 可能耗时数分钟。migration 中执行一次初始化；后续通过 sync 脚本重跑。

### Server 端条件预取模式
**Source:** `src/app/company/[slug]/page.tsx` (lines 741-746)
**Apply to:** 两个页面文件中新增的 fraudAlerts 预取调用

```typescript
// 现有 Promise.all 模式（company/[slug]/page.tsx L741-L746）
const [watchlistRows, icijMatches, icijOfficerLinks] = await Promise.all([
  ...,
  f3Unlocked ? getIcijMatches(company.id) : Promise.resolve([]),
  ...
])
// Phase 9 扩展：在 Promise.all 中追加 getCompanyFraudAlerts
// f3Unlocked ? getCompanyFraudAlerts(company.name) : Promise.resolve([])
```

### db.query 参数化查询 (防 SQL 注入)
**Source:** `src/lib/server/fraud-check.ts` (line 51) + `src/lib/server/repository.ts` (line 1013)
**Apply to:** 所有新 repository 函数

```typescript
// 统一模式：await db.query(SQL, [param])
// 参数永远通过 $1/$2 传递，绝不字符串拼接
const { rows } = await db.query<TypedRow>(
  `SELECT ... WHERE col = $1`,
  [value]
)
```

---

## No Analog Found

所有 7 个文件均找到对应 analog，无需回退到 RESEARCH.md 参考实现。

---

## Critical Anti-Patterns (from RESEARCH.md)

| Anti-Pattern | Correct Pattern | Source |
|-------------|-----------------|--------|
| 复制 IntelligencePanel（`'use client'` + useEffect + fetch） | Server Component + props-fed（OffshoreLeaksPanel 模式） | `src/components/entity/DomainIntelPanel.tsx` L1 确认为 'use client' |
| FraudAlertsPanel 内直接 `import { db }` | repository 函数集中在 `repository.ts` | `fraud-check.ts` 和 `repository.ts` 分离 pattern |
| 遗漏 `synced_at` 字段 | SELECT + interface 中均包含 `synced_at: Date` | `db/migrations/028_fraud_alerts.sql` L27 |
| `tabs` 插入位置与 `panels` 插入位置不同步 | 两者索引必须严格对应 | `company/[slug]/page.tsx` L769-L808 |
| vessel 匹配使用不存在的 `vessel.manager` | 使用 `vessel.currentOperator`；函数签名预留 `manager?` 参数 | `src/lib/types.ts` 确认无 manager 字段 |

---

## Metadata

**Analog search scope:** `src/lib/server/`, `src/app/company/`, `src/app/vessel/`, `src/components/entity/`, `scripts/`, `db/migrations/`
**Files scanned:** 14 (10 read in full or partial)
**Pattern extraction date:** 2026-04-16

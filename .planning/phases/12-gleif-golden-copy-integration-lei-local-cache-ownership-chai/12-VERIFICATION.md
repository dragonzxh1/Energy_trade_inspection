---
phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai
verified: 2026-04-17T06:30:00Z
status: human_needed
score: 10/10
overrides_applied: 0
human_verification:
  - test: "触发 POST /api/admin/sync { source: 'gleif:full' } 并确认后台子进程已启动"
    expected: "返回 { success: true, pid: <number>, message: 'GLEIF full Level 1 import started in background...' }"
    why_human: "需要运行中的 Next.js 服务器和有效 Bearer token，无法在静态代码检查中验证 HTTP 响应"
  - test: "触发 GET /api/cron/gleif-delta（不带 token）"
    expected: "返回 HTTP 401 { error: 'Unauthorized.' }"
    why_human: "需要运行中的服务器"
  - test: "触发 GET /api/cron/gleif-delta（带 Authorization: Bearer <ADMIN_SECRET>）"
    expected: "调用三个 delta sync 函数，返回 { ok: true, counts: { delta: N, level2: N, exceptions: N }, durationMs: N }"
    why_human: "需要 GLEIF 网络可达和实际 lei_cache 数据库表已创建"
  - test: "验证 lei_cache 表在 PostgreSQL 中成功创建"
    expected: "\\d lei_cache 显示 15 列 + 3 个索引（lei_cache_legal_name_trgm、lei_cache_registration_authority_entity_id、lei_cache_jurisdiction）"
    why_human: "需要 PostgreSQL 实例运行并执行迁移"
  - test: "触发 delta sync 后，queryLeiCache 返回 reporting_exception_type='NON_PUBLIC' 的实体时，company.riskFlags 含 { category: 'reporting_exception', severity: 'medium' }"
    expected: "riskFlags 数组中包含 gleif-exception-non_public 条目"
    why_human: "需要 lei_cache 中有真实数据，端到端数据流覆盖网络、数据库、应用层"
---

# Phase 12: GLEIF Golden Copy Integration — Verification Report

**Phase Goal:** 将 GLEIF 实时 API 调用替换为本地缓存（lei_cache 表），通过 Golden Copy 批量导入实现 LEI 数据本地化，并将所有权链（Level 2 RR）和报告豁免（REPEX）数据转化为风险信号
**Verified:** 2026-04-17T06:30:00Z
**Status:** human_needed
**Re-verification:** No — 初次验证

## Goal Achievement

所有可程序化验证的 must-have 均已 VERIFIED。自动化检查覆盖数据库层、同步模块、缓存优先集成、风险信号注入和触发层。以下需要人工运行时验证。

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Migration 037_lei_cache.sql 存在且包含完整 DDL（lei_cache 表 + 3 个索引） | ✓ VERIFIED | `db/migrations/037_lei_cache.sql` 存在，含 CREATE TABLE IF NOT EXISTS lei_cache（15 列）+ 3 个 CREATE INDEX（lei_cache_legal_name_trgm GIN、lei_cache_registration_authority_entity_id B-tree、lei_cache_jurisdiction B-tree） |
| 2 | npm 包 unzipper 和 stream-json 已安装可用 | ✓ VERIFIED | `node -e "require('unzipper')"` → ok；`node -e "require('stream-json/streamers/stream-array.js')"` → ok；package.json dependencies 中均有声明 |
| 3 | SyncSource 联合类型包含 gleif、gleif:full、gleif:delta、gleif:level2、gleif:exceptions | ✓ VERIFIED | `src/lib/server/sync/index.ts` 第 17-21 行含全部 5 个 gleif 子源 |
| 4 | gleif-golden-copy.ts 导出四个 sync 函数：syncLeiFull、syncLeiDelta、syncLeiLevel2、syncLeiExceptions | ✓ VERIFIED | 四个 `export async function` 均在文件中，行 130/148/247/308 |
| 5 | syncLeiDelta/syncLeiLevel2/syncLeiExceptions 使用 v2 API delta URL（含 ?delta=LastDay） | ✓ VERIFIED | URLS 常量（第 46-53 行）含 `/latest.json?delta=LastDay` 模式 |
| 6 | syncLeiFull 不在进程内运行（通过 spawn 子进程） | ✓ VERIFIED | syncLeiFull 仅含 spawn() 调用，函数体无 INSERT INTO lei_cache；gleif-golden-copy.ts 第 167 行的 INSERT 在 syncLeiDelta 函数内 |
| 7 | scripts/sync-gleif-full.mjs 存在且包含 unzipper + stream-json 流式管道 | ✓ VERIFIED | 文件存在，`node --check` 通过；含 unzipper.Parse()、withParser()、ON CONFLICT (lei) DO UPDATE、status !== 'ACTIVE' 过滤、10_000 分段 COMMIT、100_000 进度日志 |
| 8 | resolveGleifRecord() 缓存优先：先查 lei_cache，命中直接返回，未命中调用实时 API 并写回 | ✓ VERIFIED | repository.ts 第 639/652 行有 getLeiCacheRecord/writeLeiCacheRecord helper；第 908/978 行各有 lei- 和 gleif: 前缀缓存命中路径 |
| 9 | searchEntities() GLEIF 路径先查 lei_cache 相似度（阈值 0.45），命中时跳过 searchGleifMultiple() | ✓ VERIFIED | 第 469-488 行：SIMILARITY(legal_name, $1) > 0.45 AND entity_status = 'ACTIVE' LIMIT 5；cachedGleifRows.length > 0 时 searchGleifMultiple 替换为 Promise.resolve([]) |
| 10 | getGleifUltimateParentJurisdiction() 从 lei_cache 读取 ultimate_parent_lei，缓存命中时不发实时 API 调用 | ✓ VERIFIED | gleif.ts 第 271-286 行：嵌套 try-catch，先查 entity 的 ultimate_parent_lei，再查 parent 的 jurisdiction，两者均命中则返回缓存值 |
| 11 | ScoringInputs 接口包含可选字段 reportingExceptionFlag: boolean | ✓ VERIFIED | scoring.ts 第 52 行：`reportingExceptionFlag?: boolean` |
| 12 | scoreCompany() 在 reportingExceptionFlag 为 true 时从 communityReputation 扣除 3 分（最小值 0） | ✓ VERIFIED | scoring.ts 第 181-182 行：`if (inputs.reportingExceptionFlag) { C = Math.max(0, C - 3) }` |
| 13 | gleif.ts OPACITY_EXCEPTION_TYPES 模块级常量含三种 opacity 类型 | ✓ VERIFIED | gleif.ts 第 191 行：`new Set(['NON_CONSOLIDATING', 'NON_PUBLIC', 'NO_LEI'])`；NATURAL_PERSONS 仅在注释中出现（第 188 行），不在集合内 |
| 14 | buildGleifCompany() 在 opacity exception 时直接对 communityReputation 和 authenticityScore 应用 3 分扣减 | ✓ VERIFIED | gleif.ts 第 207/249-253/263 行：第三参数 reportingExceptionType、communityReputationFinal 计算逻辑 |
| 15 | repository.ts 缓存命中路径注入 reporting_exception RiskFlag | ✓ VERIFIED | 第 921-927/950-956 行（lei- 前缀）和第 991-997/1020-1026 行（gleif: 前缀）：4 处注入点，NATURAL_PERSONS 不在 OPACITY_EXCEPTION_TYPES 中 |
| 16 | POST /api/admin/sync { source: 'gleif:full' } 触发子进程 | ✓ VERIFIED | admin/sync/route.ts 第 133-149 行：spawn sync-gleif-full.mjs detached + child.unref()，返回 pid 和成功消息 |
| 17 | POST /api/admin/sync { source: 'gleif:delta' } 调用 runSync('gleif:delta') | ✓ VERIFIED | admin/sync/route.ts 第 154-160 行：gleif delta in-process dispatch |
| 18 | GET /api/cron/gleif-delta 无 Bearer token 时返回 401 | ✓ VERIFIED（静态）| cron/gleif-delta/route.ts 第 33-34 行：`if (!isAuthorized(req)) return { status: 401 }` |
| 19 | GET /api/cron/gleif-delta 调用三个 delta sync 函数 | ✓ VERIFIED | 第 41-44 行：Promise.allSettled([syncLeiDelta(), syncLeiLevel2(), syncLeiExceptions()]) |
| 20 | runSync() 新增 gleif:delta / gleif:level2 / gleif:exceptions dispatch 块 | ✓ VERIFIED | sync/index.ts 第 101-127 行：3 个独立 if 块，复用 ofac/fraud/warninglists 的 try/catch + result.push 模式 |

**Score:** 10/10 truths verified（按 must_haves 合并后统计）

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `db/migrations/037_lei_cache.sql` | lei_cache 表 DDL + 3 个索引 | ✓ VERIFIED | 文件存在，含完整 DDL 和 3 个索引 |
| `src/lib/server/sync/gleif-golden-copy.ts` | 四个 sync 函数 + LeiCacheRow 接口 + val() helper | ✓ VERIFIED | 355 行，4 个导出函数 + 接口 + val() |
| `scripts/sync-gleif-full.mjs` | 独立子进程：流式下载 ZIP + 批量 UPSERT | ✓ VERIFIED | 187 行，`node --check` 通过 |
| `src/lib/server/repository.ts` | getLeiCacheRecord() + writeLeiCacheRecord() + 缓存优先调用点 + SIMILARITY 查询 | ✓ VERIFIED | 4 处缓存命中点，2 个 helper，SIMILARITY 查询 |
| `src/lib/server/gleif.ts` | getGleifUltimateParentJurisdiction() 缓存优先 + buildGleifCompany 扣分 | ✓ VERIFIED | Cache-first 路径已插入，OPACITY_EXCEPTION_TYPES 已定义 |
| `src/lib/server/scoring.ts` | ScoringInputs.reportingExceptionFlag + communityReputation 扣分 | ✓ VERIFIED | 字段存在，Math.max(0, C-3) 已实现 |
| `src/app/api/cron/gleif-delta/route.ts` | Bearer 认证 + Promise.allSettled 三路 delta sync | ✓ VERIFIED | 文件存在，认证逻辑完整 |
| `src/app/api/admin/sync/route.ts` | gleif:full child process + gleif:delta in-process | ✓ VERIFIED | 两个 dispatch 块均已添加 |
| `src/lib/server/sync/index.ts` | gleif:delta/level2/exceptions dispatch + import | ✓ VERIFIED | import 第 10 行，dispatch 第 101-127 行 |
| `next.config.ts` | unzipper 加入 serverExternalPackages | ✓ VERIFIED | 第 38 行已添加 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `gleif-golden-copy.ts syncLeiDelta` | `lei_cache 表` | `INSERT ... ON CONFLICT (lei) DO UPDATE` | ✓ WIRED | 第 167-181 行批量 UPSERT |
| `gleif-golden-copy.ts syncLeiLevel2` | `lei_cache 表` | `UPDATE lei_cache SET direct_parent_lei / ultimate_parent_lei` | ✓ WIRED | IS_DIRECTLY / IS_ULTIMATELY_CONSOLIDATED_BY 处理 |
| `gleif-golden-copy.ts syncLeiExceptions` | `lei_cache 表` | `UPDATE lei_cache SET reporting_exception_type` | ✓ WIRED | ExceptionCategory 映射 |
| `scripts/sync-gleif-full.mjs` | `lei_cache 表` | `INSERT INTO lei_cache ... ON CONFLICT DO UPDATE` | ✓ WIRED | 第 75-88 行，ACTIVE 过滤 |
| `repository.ts resolveGleifRecord()` | `lei_cache 表` | `SELECT * FROM lei_cache WHERE lei = $1 LIMIT 1` | ✓ WIRED | 第 642 行 getLeiCacheRecord |
| `repository.ts searchEntities()` | `lei_cache 表` | `SIMILARITY(legal_name, $1) > 0.45 AND entity_status = 'ACTIVE'` | ✓ WIRED | 第 469-477 行 |
| `gleif.ts getGleifUltimateParentJurisdiction()` | `lei_cache 表` | `SELECT ultimate_parent_lei / jurisdiction FROM lei_cache WHERE lei = $1` | ✓ WIRED | 第 274-281 行 |
| `/api/admin/sync POST` | `scripts/sync-gleif-full.mjs` | `child_process.spawn() with detached: true` | ✓ WIRED | 第 134-143 行 |
| `/api/cron/gleif-delta GET` | `syncLeiDelta + syncLeiLevel2 + syncLeiExceptions` | `import from @/lib/server/sync/gleif-golden-copy` | ✓ WIRED | 第 21 行 import，第 41-44 行调用 |
| `sync/index.ts runSync()` | `syncLeiDelta/Level2/Exceptions` | `import './gleif-golden-copy'` | ✓ WIRED | 第 10 行 import，第 101-127 行 dispatch |
| `repository.ts OPACITY_EXCEPTION_TYPES` | `RiskFlag 注入` | `OPACITY_EXCEPTION_TYPES.has(cachedLei.reporting_exception_type)` | ✓ WIRED | 4 处注入点（lei-/gleif: × 命中/miss） |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `repository.ts getLeiCacheRecord()` | `rows[0]` | `SELECT * FROM lei_cache WHERE lei = $1` | 是（DB 参数化查询） | ✓ FLOWING |
| `gleif.ts getGleifUltimateParentJurisdiction()` | `entityRows[0]?.ultimate_parent_lei` | `SELECT ultimate_parent_lei FROM lei_cache` | 是（缓存命中时）；否则降级到实时 API | ✓ FLOWING |
| `repository.ts searchEntities()` | `cachedGleifRows` | `SELECT * FROM lei_cache WHERE SIMILARITY(...)` | 是（GIN 索引支持） | ✓ FLOWING |
| `scoring.ts scoreCompany()` | `C`（communityReputation） | `inputs.reportingExceptionFlag` | 是（来自 repository 层注入） | ✓ FLOWING |
| `gleif.ts buildGleifCompany()` | `communityReputationFinal` | `reportingExceptionType` 参数 | 是（来自 lei_cache 行） | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| sync-gleif-full.mjs 语法正确 | `node --check scripts/sync-gleif-full.mjs` | syntax ok | ✓ PASS |
| unzipper 可加载 | `node -e "require('unzipper')"` | ok | ✓ PASS |
| stream-json 可加载 | `node -e "require('stream-json/streamers/stream-array.js')"` | ok | ✓ PASS |
| TypeScript 类型检查 | `npm run type-check` | 0 错误（无输出） | ✓ PASS |
| cron 路由导出 GET | grep `export async function GET` route.ts | 第 32 行命中 | ✓ PASS |
| HTTP 401 path（静态） | grep `status: 401` cron/gleif-delta/route.ts | 第 34 行命中 | ✓ PASS |
| ACTIVE 过滤（script） | grep `status !== 'ACTIVE'` sync-gleif-full.mjs | 第 123 行命中 | ✓ PASS |
| 分段 COMMIT（script） | grep `10_000` sync-gleif-full.mjs | 第 96 行命中 | ✓ PASS |
| NATURAL_PERSONS 排除 | grep `NATURAL_PERSONS` repository.ts | 无命中（正确） | ✓ PASS |
| unzipper 在 serverExternalPackages | grep `unzipper` next.config.ts | 第 38 行命中 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|------------|-------------|--------|---------|
| D-01 | Plan 01 | lei_cache 表 DDL（单一反范式化表，15 列，3 个索引） | ✓ SATISFIED | 037_lei_cache.sql 完整实现，字段与 CONTEXT.md D-01 规范一致 |
| D-02 | Plan 02 | Level 1 全量导入仅含 ACTIVE 实体 | ✓ SATISFIED | sync-gleif-full.mjs 第 123 行：`if (status !== 'ACTIVE') return` |
| D-03 | Plan 02 | 流式 JSON + 1000 行 UPSERT 批次，每 100K 记录记录进度 | ✓ SATISFIED | sync-gleif-full.mjs：chain([withParser()]) 流式解析，1000 行批次，100_000 进度日志 |
| D-04 | Plan 02 | gleif-golden-copy.ts 导出四个 sync 函数 | ✓ SATISFIED | 四个 export async function 均已实现 |
| D-05 | Plan 03 | cache-first 集成（resolveGleifRecord + searchEntities + getGleifUltimateParentJurisdiction） | ✓ SATISFIED | repository.ts 两处调用点；gleif.ts 嵌套缓存查询 |
| D-06 | Plan 02/03 | Level 2 所有权链（GLEIF 预计算的直接父级和终极父级） | ✓ SATISFIED | syncLeiLevel2 处理 IS_DIRECTLY/IS_ULTIMATELY_CONSOLIDATED_BY；gleif.ts 读取 ultimate_parent_lei |
| D-07 | Plan 04 | reporting_exception → 风险信号（3 分扣减 + RiskFlag 注入，NATURAL_PERSONS 排除） | ✓ SATISFIED | scoring.ts Math.max(0,C-3)；gleif.ts OPACITY_EXCEPTION_TYPES；repository.ts 4 处注入点 |
| D-08 | Plan 01 | 迁移编号 037_lei_cache.sql | ✓ SATISFIED | 文件路径正确 |
| D-09 | Plan 01/05 | SyncSource 类型扩展 + admin sync 路由集成 | ✓ SATISFIED | index.ts 5 个 gleif 子源；admin/sync 两个 dispatch 块 |
| D-10 | Plan 05 | 每日 delta cron 路由（/api/cron/gleif-delta，Bearer 认证） | ✓ SATISFIED | cron/gleif-delta/route.ts 完整实现，isAuthorized() 与 cleanup cron 一致 |

所有 10 个需求 D-01 至 D-10 均已满足。

**关于 D-07 集成点的偏差说明：** CONTEXT.md D-07 原指定集成点为 `intelligence.ts`。Plan 04 记录了一个架构决策：`buildGleifCompany()` 使用硬编码内联评分，不经过 `computeScore()`，因此必须在 `repository.ts`（缓存命中路径）和 `gleif.ts`（buildGleifCompany 直接扣分）中实现。`intelligence.ts` 的检查（0 次命中）确认未使用 intelligence.ts 路径，但功能已通过等效路径完整实现。此偏差是有意设计的，效果一致。

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| （无） | — | — | — | 未发现 blocker 级别的反模式 |

扫描了以下文件：`gleif-golden-copy.ts`、`sync-gleif-full.mjs`、`cron/gleif-delta/route.ts`、`scoring.ts`，均无 TODO/FIXME/placeholder/return null 等反模式。

### Human Verification Required

#### 1. 数据库迁移执行验证

**Test:** 启动 Next.js 开发服务器（`npm run dev`），检查 instrumentation.ts 是否自动执行 migration 037
**Expected:** `psql -c "\d lei_cache"` 显示 15 列表和 3 个索引
**Why human:** 需要运行中的 PostgreSQL 实例和 Next.js 服务器启动，静态代码分析无法验证迁移是否成功执行

#### 2. GLEIF Full Sync 子进程触发

**Test:** `curl -X POST http://localhost:3000/api/admin/sync -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_SECRET" -d '{"source":"gleif:full"}'`
**Expected:** HTTP 200，响应体含 `{ "success": true, "pid": <number>, "message": "GLEIF full Level 1 import started in background..." }`
**Why human:** 需要运行中的服务器和有效 ADMIN_SECRET

#### 3. Cron Route 401 验证

**Test:** `curl http://localhost:3000/api/cron/gleif-delta`（不带 Authorization header）
**Expected:** HTTP 401，响应体 `{ "error": "Unauthorized." }`
**Why human:** 需要运行中的服务器

#### 4. Delta Cron 端到端调用

**Test:** `curl -H "Authorization: Bearer $ADMIN_SECRET" http://localhost:3000/api/cron/gleif-delta`
**Expected:** HTTP 200，响应含 `{ "ok": true, "counts": { "delta": N, "level2": N, "exceptions": N }, "durationMs": N }`（需要 GLEIF 网络可达；如无网络可验证 401/500 错误处理路径）
**Why human:** 需要 GLEIF 网络访问和运行中的数据库

#### 5. 端到端 RiskFlag 注入验证

**Test:** 在 lei_cache 中手动插入一条含 `reporting_exception_type = 'NON_PUBLIC'` 的记录，然后通过 `/api/entity/lei-<LEI>` 或 `/api/intelligence/company/<ID>` 查询该实体
**Expected:** 响应中 `riskFlags` 数组含一个 `{ category: 'reporting_exception', severity: 'medium', id: 'gleif-exception-non_public' }` 对象
**Why human:** 需要运行中的数据库和应用，依赖 `LeiCacheRow.reporting_exception_type` 值在运行时触发

### Gaps Summary

无代码级 gaps。所有 D-01 至 D-10 需求均通过静态代码验证。未发现 stub、孤立文件或断裂连接。

等待 5 项人工验证确认端到端数据流和运行时行为。

---

_Verified: 2026-04-17T06:30:00Z_
_Verifier: Claude (gsd-verifier)_

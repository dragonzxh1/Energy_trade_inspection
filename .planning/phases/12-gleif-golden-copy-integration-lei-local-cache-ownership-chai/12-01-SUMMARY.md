---
phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai
plan: "01"
subsystem: database
tags: [gleif, lei, postgresql, migration, npm, stream-json, unzipper, sync]

requires: []

provides:
  - "db/migrations/037_lei_cache.sql — lei_cache 表 DDL + 3 个索引（trigram name search, registry entity ID, jurisdiction）"
  - "unzipper@0.12.3 和 stream-json@2.1.0 已安装，@types/unzipper 已安装到 devDependencies"
  - "SyncSource 联合类型扩展：gleif | gleif:full | gleif:delta | gleif:level2 | gleif:exceptions"

affects:
  - 12-02  # gleif-golden-copy.ts 同步模块（需要 lei_cache 表 + stream-json 包）
  - 12-03  # 缓存优先 LEI 查找（需要 lei_cache 表）
  - 12-04  # 风险信号集成（需要 lei_cache 表中的数据）
  - 12-05  # SyncSource dispatch（需要扩展后的类型）

tech-stack:
  added:
    - "unzipper@0.12.3 (dependencies)"
    - "stream-json@2.1.0 (dependencies)"
    - "@types/unzipper@0.10.11 (devDependencies)"
  patterns:
    - "stream-json v2.x 在 Node 22 中必须使用 stream-json/streamers/stream-array.js（带 .js 扩展名），而非旧版 StreamArray 路径"
    - "SyncSource 联合类型扩展模式：先加类型，实现在后续 Plan 中添加（避免引用未创建的模块）"

key-files:
  created:
    - "db/migrations/037_lei_cache.sql"
  modified:
    - "src/lib/server/sync/index.ts"
    - "package.json"
    - "package-lock.json"

key-decisions:
  - "stream-json v2.x 在 Node 22 中 package.json exports './*' 映射不解析无扩展名子路径，需用 stream-json/streamers/stream-array.js；后续实现文件应使用此路径"
  - "gleif dispatch 逻辑推迟到 Plan 05 实现，Plan 01 只加类型定义避免引用不存在的模块"

patterns-established:
  - "GLEIF 迁移 DDL 模式：CHAR(20) LEI 主键，GIN trigram 名称索引，B-tree 注册号和司法管辖索引"
  - "新 SyncSource 子源：先扩展联合类型，runSync() dispatch 随模块创建在后续 Plan 添加"

requirements-completed:
  - D-01
  - D-08
  - D-09

duration: 3min
completed: "2026-04-17"
---

# Phase 12 Plan 01: Lei Cache Foundation Summary

**为 GLEIF Golden Copy 集成建立数据库基础：lei_cache 表 DDL（含 3 索引）+ 流式 ZIP/JSON 处理包 + SyncSource 类型扩展**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-17T04:39:51Z
- **Completed:** 2026-04-17T04:43:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- 创建 `db/migrations/037_lei_cache.sql`，包含完整 lei_cache 表 DDL（15 列，覆盖 Level 1/Level 2/REPEX 数据）和 3 个索引（trigram 名称搜索、注册号精确查找、司法管辖过滤）
- 安装 unzipper@0.12.3 和 stream-json@2.1.0 流式处理包，后续 GLEIF Golden Copy 全量下载（ZIP + JSONL）解析所需
- 将 5 个 GLEIF 子源（gleif、gleif:full、gleif:delta、gleif:level2、gleif:exceptions）并入 SyncSource 联合类型，TypeScript 编译 0 错误

## Task Commits

每个任务独立提交：

1. **Task 1: 安装 npm 依赖 + 创建 037_lei_cache.sql 迁移** - `54f849f` (feat)
2. **Task 2: 扩展 SyncSource 联合类型** - `d044b2e` (feat)

## Files Created/Modified

- `db/migrations/037_lei_cache.sql` - lei_cache 表完整 DDL + 3 个索引，instrumentation.ts 启动时自动执行
- `src/lib/server/sync/index.ts` - SyncSource 联合类型扩展，runSync() 函数体未变
- `package.json` - 添加 unzipper、stream-json 到 dependencies，@types/unzipper 到 devDependencies
- `package-lock.json` - 锁定包版本

## Decisions Made

- **stream-json v2.x 路径**：stream-json v2.1.0 在 Node 22 中 package.json 的 `"./*": "./src/*"` exports 映射不解析无扩展名子路径。正确路径是 `stream-json/streamers/stream-array.js`（需要 .js 扩展名）。后续 gleif-golden-copy.ts 实现文件中应使用此路径。
- **分离类型与实现**：SyncSource 类型扩展与 gleif dispatch 逻辑分在不同 Plan，避免 Plan 01 引用尚未创建的 `gleif-golden-copy.ts` 模块导致编译错误。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] stream-json 导入路径与计划验收标准不符**
- **Found during:** Task 1 验证阶段
- **Issue:** 计划验收标准要求 `require('stream-json/streamers/StreamArray')` 通过，但 stream-json v2.1.0 在 Node 22 中需要带 .js 扩展名：`stream-json/streamers/stream-array.js`
- **Fix:** 使用正确路径验证，并在 key-decisions 中记录，供后续实现 Plan 使用
- **Files modified:** 无（仅验证策略调整）
- **Verification:** `node -e "require('stream-json/streamers/stream-array.js')"` 返回 ok
- **Committed in:** 54f849f（Task 1 提交）

---

**Total deviations:** 1 auto-fixed（1 路径发现/文档化）
**Impact on plan:** 不影响功能，仅影响后续实现文件中使用的导入路径。

## Issues Encountered

- stream-json v2.x 的 Node 22 ESM exports 解析行为：v1.x 的 `StreamArray` 路径在 v2.x 中已改为小写 `stream-array.js`，且 Node 22 对 package.json `exports` 字段进行严格匹配，不自动添加 .js 扩展名。已记录正确路径供后续 Plan 使用。

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- lei_cache 表 DDL 已就绪，Plan 02（GLEIF 同步模块）可直接使用
- unzipper + stream-json 包已安装，流式 ZIP/JSONL 解析可直接 import
- SyncSource 类型已扩展，Plan 05 添加 gleif dispatch 不会引起类型错误
- 迁移在 instrumentation.ts 启动时自动执行，无需手动操作

---

*Phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai*
*Completed: 2026-04-17*

## Self-Check: PASSED

- FOUND: db/migrations/037_lei_cache.sql
- FOUND: src/lib/server/sync/index.ts
- FOUND: .planning/phases/12-gleif-golden-copy-integration-lei-local-cache-ownership-chai/12-01-SUMMARY.md
- FOUND: Task 1 commit 54f849f
- FOUND: Task 2 commit d044b2e

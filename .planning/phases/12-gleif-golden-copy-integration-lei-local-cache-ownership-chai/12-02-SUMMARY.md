---
phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai
plan: "02"
subsystem: sync
tags: [gleif, lei, sync, stream-json, unzipper, postgresql, child-process, upsert]

requires:
  - "12-01: lei_cache 表 DDL + unzipper + stream-json 依赖"

provides:
  - "src/lib/server/sync/gleif-golden-copy.ts — 四个 sync 函数 + LeiCacheRow 接口"
  - "scripts/sync-gleif-full.mjs — Level 1 全量导入子进程脚本"

affects:
  - 12-03  # 缓存优先 LEI 查找（消费 gleif-golden-copy.ts 导出的函数）
  - 12-05  # SyncSource dispatch（添加 gleif:* 分支调用这些函数）

tech-stack:
  added: []
  patterns:
    - "stream-json v2.x 正确路径：stream-json/streamers/stream-array.js（Node 22 需要 .js 扩展名）"
    - "GLEIF child process 模式：syncLeiFull() spawn detached + stdio:ignore + unref()，与 sync-opensanctions.mjs 相同"
    - "分段 COMMIT 模式：每 1000 条 batch UPSERT，每 10K 条 COMMIT（防止 WAL 溢出）"
    - "val() helper：从 GLEIF { dollar: value } XML-to-JSON 包装中提取字符串"

key-files:
  created:
    - "src/lib/server/sync/gleif-golden-copy.ts"
    - "scripts/sync-gleif-full.mjs"
  modified: []

key-decisions:
  - "stream-json/streamers/stream-array.js（.js 扩展名）是 Node 22 + stream-json v2.x 的正确路径——@ts-expect-error 注释不需要，因为 TypeScript moduleResolution:bundler 正确解析了 package.json exports"
  - "syncLeiFull() 只 spawn 子进程不做任何 DB 操作——875 MB ZIP 无法在 Next.js 请求生命周期内运行"
  - "全量导入脚本（sync-gleif-full.mjs）只 UPSERT ACTIVE 实体（status !== ACTIVE 直接 return）——INACTIVE/LAPSED/ANNULLED 不需要缓存"

requirements-completed:
  - D-02
  - D-03
  - D-04
  - D-06

duration: 6min
completed: "2026-04-17"
---

# Phase 12 Plan 02: GLEIF Golden Copy Sync Module Summary

**实现 GLEIF Golden Copy 同步模块写入层：gleif-golden-copy.ts（4 个 delta sync 函数）+ sync-gleif-full.mjs（全量导入子进程脚本），两个文件均使用 GLEIF v2 API URL 和流式 ZIP/JSON 管道**

## Performance

- **Duration:** 6 min
- **Started:** 2026-04-17T04:46:13Z
- **Completed:** 2026-04-17T04:52:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- 创建 `src/lib/server/sync/gleif-golden-copy.ts`：导出 `syncLeiFull`、`syncLeiDelta`、`syncLeiLevel2`、`syncLeiExceptions` 四个函数和 `LeiCacheRow` 接口
  - `syncLeiFull()` spawn detached 子进程，立即返回 PID，不阻塞 Next.js
  - `syncLeiDelta()` 流式下载 LEI2 LastDay delta，UPSERT 到 lei_cache，每 10K 条独立 COMMIT
  - `syncLeiLevel2()` 流式下载 RR delta，更新 direct_parent_lei / ultimate_parent_lei
  - `syncLeiExceptions()` 流式下载 REPEX delta，更新 reporting_exception_type / reason
  - `val()` helper 从 `{ "$": "value" }` XML-to-JSON 包装提取字符串
- 创建 `scripts/sync-gleif-full.mjs`：独立 ESM 子进程脚本
  - 流式下载 875 MB ZIP（不加载到内存）via fetch + Readable.fromWeb()
  - unzipper.Parse() → stream-json StreamArray → 逐条处理 JSON 记录
  - 仅 UPSERT ACTIVE 实体（D-02），每 1000 条批量，每 10K 条 COMMIT（D-03/Pitfall 6）
  - 每 100K 条 progress 日志，完成后写入 sanctions_sync_log
  - process.exit(0/1) 使父进程可检测成功/失败

## Task Commits

每个任务独立提交：

1. **Task 1: 创建 gleif-golden-copy.ts** — `f372432` (feat)
2. **Task 2: 创建 sync-gleif-full.mjs** — `f8bcf1f` (feat)

## Files Created/Modified

- `src/lib/server/sync/gleif-golden-copy.ts` — 同步模块，355 行，4 个导出函数 + LeiCacheRow 接口
- `scripts/sync-gleif-full.mjs` — 全量导入子进程脚本，187 行

## Decisions Made

- **stream-json 导入路径**：`stream-json/streamers/stream-array.js` 是 Node 22 + stream-json v2.x 的正确路径（Plan 01 SUMMARY 已确认）。TypeScript `moduleResolution: bundler` 模式正确解析了 package.json exports，`@ts-expect-error` 注释实际上是不必要的（TypeScript 0 错误）。
- **子进程内存隔离**：875 MB ZIP 全量导入不能在 Next.js 进程内运行（Request 生命周期、内存限制），`syncLeiFull()` 仅 spawn + unref，不做任何 DB 操作。
- **ACTIVE 过滤（D-02）**：全量导入脚本只写入 ACTIVE 实体；delta 同步（`syncLeiDelta`）不过滤（delta 可能包含 INACTIVE 更新，需要更新现有缓存行的状态）。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] 移除不必要的 @ts-expect-error 注释**
- **Found during:** Task 1 验证（TypeScript 类型检查）
- **Issue:** 计划模板中使用了 `@ts-expect-error` 注释，但 TypeScript strict 模式下这些包都有类型定义（@types/unzipper 已安装，stream-json v2.x 自带 .d.ts，stream-chain 自带类型），`@ts-expect-error` 变成错误（TS2578: Unused directive）
- **Fix:** 移除所有三个 `@ts-expect-error` 注释
- **Files modified:** src/lib/server/sync/gleif-golden-copy.ts
- **Commit:** f372432（在 Task 1 提交中包含）

---

**Total deviations:** 1 auto-fixed（移除 unused @ts-expect-error）
**Impact on plan:** 不影响功能，代码更简洁。

## Known Stubs

无。两个文件均实现了完整功能逻辑，无 placeholder 或 hardcoded 空值。

## Threat Flags

实现符合 Plan 的 threat_model 中所有 T-12-02-* 缓解措施：
- T-12-02-01: 硬编码 `goldencopy.gleif.org` 域名 ✓
- T-12-02-02: 流式管道，从不调用 `res.arrayBuffer()` ✓
- T-12-02-03: 每 10K 条独立 COMMIT ✓
- T-12-02-04: 所有 DB 操作使用参数化查询 ($1, $2, ...) ✓
- T-12-02-05: val() 返回 null 而非 undefined/object，插入前校验 lei+legalName 非 null ✓
- T-12-02-06: 子进程只继承 DATABASE_URL ✓

## User Setup Required

None — 模块在 Plan 05 dispatch 集成后可通过 `/api/admin/sync` 路由触发。

## Next Phase Readiness

- gleif-golden-copy.ts 四个函数已就绪，Plan 03（缓存优先集成）可直接 import
- sync-gleif-full.mjs 就绪，由 syncLeiFull() spawn 调用
- Plan 05 需要在 runSync() 中为 gleif:* 源添加 dispatch 分支
- lei_cache 表由 Plan 01 创建，migrations 在启动时自动执行

---

*Phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai*
*Completed: 2026-04-17*

## Self-Check: PASSED

- FOUND: src/lib/server/sync/gleif-golden-copy.ts
- FOUND: scripts/sync-gleif-full.mjs
- FOUND: Task 1 commit f372432
- FOUND: Task 2 commit f8bcf1f
- FOUND: export async function syncLeiFull in gleif-golden-copy.ts
- FOUND: export async function syncLeiDelta in gleif-golden-copy.ts
- FOUND: export async function syncLeiLevel2 in gleif-golden-copy.ts
- FOUND: export async function syncLeiExceptions in gleif-golden-copy.ts
- FOUND: export interface LeiCacheRow in gleif-golden-copy.ts
- FOUND: status !== 'ACTIVE' filter in sync-gleif-full.mjs
- TypeScript type-check: exit code 0
- node --check sync-gleif-full.mjs: exit code 0

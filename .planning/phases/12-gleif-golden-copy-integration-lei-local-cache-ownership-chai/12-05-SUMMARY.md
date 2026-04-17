---
phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai
plan: "05"
subsystem: sync
tags: [gleif, lei, cron, admin-sync, child-process, bearer-auth, next-config]

requires:
  - "12-02: gleif-golden-copy.ts sync functions (syncLeiDelta/Level2/Exceptions)"
  - "12-04: SyncSource type includes gleif:* variants"

provides:
  - "src/lib/server/sync/index.ts — gleif:delta/level2/exceptions dispatch blocks in runSync()"
  - "src/app/api/admin/sync/route.ts — gleif:full child process spawn + gleif delta in-process dispatch"
  - "src/app/api/cron/gleif-delta/route.ts — daily delta cron route with Bearer auth"

affects:
  - "Phase 12 complete — all GLEIF data pipelines now have trigger paths"

tech-stack:
  added: []
  patterns:
    - "gleif:full via child_process.spawn detached (mirrors opensanctions pattern)"
    - "gleif:delta/level2/exceptions via runSync() in-process (small enough for maxDuration=300)"
    - "cron route isAuthorized() copied verbatim from cron/cleanup/route.ts"
    - "Promise.allSettled() for fault-tolerant parallel delta sync in cron route"
    - "unzipper added to serverExternalPackages to avoid Turbopack optional-require resolution failure"

key-files:
  created:
    - "src/app/api/cron/gleif-delta/route.ts"
  modified:
    - "src/lib/server/sync/index.ts"
    - "src/app/api/admin/sync/route.ts"
    - "next.config.ts"

key-decisions:
  - "gleif:full dispatched via child process (not runSync) — 875 MB download cannot run within Next.js request lifecycle"
  - "source === 'gleif' aliased to gleif:delta in admin sync — most common operator trigger action"
  - "Promise.allSettled() in cron route — level2/exceptions can partially succeed even if delta fails"
  - "unzipper added to serverExternalPackages — optional @aws-sdk/client-s3 require breaks Turbopack bundling"

requirements-completed:
  - D-09
  - D-10

duration: 12min
completed: "2026-04-17"
---

# Phase 12 Plan 05: GLEIF Trigger Layer Summary

**将 GLEIF sync 函数连接到 admin sync 路由和每日 cron 路由，完成 Phase 12 最后一块触发层拼图**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-17T05:10:00Z
- **Completed:** 2026-04-17T05:22:00Z
- **Tasks:** 3
- **Files modified:** 4 (3 modified + 1 created)

## Accomplishments

- **Task 1:** 更新 `src/lib/server/sync/index.ts`
  - 导入 `syncLeiDelta`、`syncLeiLevel2`、`syncLeiExceptions` from `./gleif-golden-copy`
  - 在 `runSync()` 中添加 `gleif:delta`、`gleif:level2`、`gleif:exceptions` 三个 dispatch 块
  - 每块均遵循现有 ofac/fraud/warninglists 的 try/catch + SyncResult push 模式
  - `syncLeiFull` 不在 runSync 中（全量导入通过 child process 触发）

- **Task 2:** 更新 `src/app/api/admin/sync/route.ts`
  - `gleif:full` — spawn `sync-gleif-full.mjs` 为 detached 后台进程，立即返回 pid
  - `gleif:delta / gleif:level2 / gleif:exceptions / gleif` — in-process 调用 `runSync(gleifSource)`
  - `source === 'gleif'` 作为 `gleif:delta` 处理（最常用操作符触发动作）
  - 完全遵循 opensanctions child process 模式（`detached: true, stdio: 'ignore', child.unref()`）

- **Task 3:** 创建 `src/app/api/cron/gleif-delta/route.ts`
  - `export const runtime = 'nodejs'`（流式操作不兼容 Edge Runtime）
  - `isAuthorized()` 逐字复制自 `cron/cleanup/route.ts`（`ADMIN_SECRET ?? SYNC_SECRET`，无 secret 时 return false）
  - 无 Bearer token 返回 HTTP 401
  - `Promise.allSettled()` 并行运行三个 delta sync，单一失败不中止其他
  - 响应包含 `{ ok, counts: { delta, level2, exceptions }, durationMs, errors? }`，部分失败返回 HTTP 207

## Task Commits

1. **Task 1: sync/index.ts dispatch blocks** — `c23df2c` (feat)
2. **Task 2: admin/sync/route.ts gleif dispatch** — `c8a305d` (feat)
3. **Task 3: cron/gleif-delta route + unzipper fix** — `184b5fe` (feat)

## Files Created/Modified

- `src/lib/server/sync/index.ts` — 添加 31 行（import + 3 dispatch 块）
- `src/app/api/admin/sync/route.ts` — 添加 34 行（gleif:full child process + gleif delta in-process）
- `src/app/api/cron/gleif-delta/route.ts` — 新建，76 行，Bearer 认证 + Promise.allSettled 三路 sync
- `next.config.ts` — `serverExternalPackages` 添加 `'unzipper'`（Rule 3 修复）

## Decisions Made

- **gleif:full 通过子进程（不通过 runSync）**：875 MB ZIP 下载无法在 Next.js 请求生命周期内完成，与 opensanctions 使用相同子进程模式。
- **source === 'gleif' 别名为 gleif:delta**：管理员最常触发的是 delta sync；无歧义简写。
- **Promise.allSettled() 在 cron 路由**：level2 和 exceptions 在 lei_cache 已有行时可独立运行；delta 失败不应阻止 RR/REPEX 更新。
- **unzipper 加入 serverExternalPackages**：unzipper 有可选 `require('@aws-sdk/client-s3')`，Turbopack 无法解析可选依赖；加入外部包列表后编译通过。

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] unzipper Turbopack 构建失败**
- **Found during:** Task 3 构建验证
- **Issue:** `unzipper` 库内含 `require('@aws-sdk/client-s3')`（可选 S3 支持），Turbopack 无法解析此可选依赖，导致构建失败 (`Module not found: Can't resolve '@aws-sdk/client-s3'`)
- **Fix:** 将 `'unzipper'` 加入 `next.config.ts` 的 `serverExternalPackages` 数组，与 `pdf-parse`、`mammoth` 等具有 Node.js native 或可选依赖的包采用相同处理模式
- **Files modified:** `next.config.ts`
- **Commit:** `184b5fe`（与 Task 3 合并提交）

---

**Total deviations:** 1 auto-fixed (Rule 3 — 构建阻断)
**Impact on plan:** `next.config.ts` 在计划范围之外修改，但修复是必要的——无此修复则构建失败。

## Known Stubs

无。三个文件均实现了完整功能逻辑，无 placeholder 或 hardcoded 空值。

## Threat Flags

实现符合 Plan 的 threat_model 中所有 T-12-05-* 缓解措施：
- T-12-05-01: `isAuthorized()` 检查 `ADMIN_SECRET ?? SYNC_SECRET`；无 token 返回 401；`if (!secret) return false` ✓
- T-12-05-02: admin/sync POST 复用现有双重认证（Bearer token OR admin email session） ✓
- T-12-05-03: gleif:full 幂等（UPSERT ON CONFLICT）；多进程竞争写安全 ✓
- T-12-05-04: 脚本在 Git 版本控制中 ✓
- T-12-05-05: cron 响应仅含 counts/durations，无 LEI 数据 ✓
- T-12-05-06: Bearer 认证保护端点；Nginx 可配置速率限制 ✓

## Next Phase Readiness

Phase 12 完整：
- Plan 01: lei_cache 表 + DB migrations ✓
- Plan 02: gleif-golden-copy.ts sync 函数 + sync-gleif-full.mjs ✓
- Plan 03: 缓存优先 LEI 查找集成 ✓
- Plan 04: 报告异常风险信号 ✓
- Plan 05: admin sync 触发 + 每日 cron 路由 ✓（本计划）

运维人员可通过以下方式触发 GLEIF sync：
- `POST /api/admin/sync { "source": "gleif:full" }` → 后台全量导入
- `POST /api/admin/sync { "source": "gleif:delta" }` → 进程内 delta sync
- `GET /api/cron/gleif-delta -H "Authorization: Bearer $ADMIN_SECRET"` → 每日三路 delta sync

---

*Phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai*
*Completed: 2026-04-17*

## Self-Check: PASSED

- FOUND: src/lib/server/sync/index.ts (contains syncLeiDelta import + gleif:delta dispatch)
- FOUND: src/app/api/admin/sync/route.ts (contains sync-gleif-full.mjs + gleif:full dispatch)
- FOUND: src/app/api/cron/gleif-delta/route.ts (contains isAuthorized + Promise.allSettled)
- FOUND: next.config.ts (unzipper in serverExternalPackages)
- FOUND: Task 1 commit c23df2c
- FOUND: Task 2 commit c8a305d
- FOUND: Task 3 commit 184b5fe
- TypeScript type-check: exit code 0
- Turbopack compilation: Compiled successfully (unzipper module error resolved)
- Build failure cause: DATABASE_URL not set in CI build environment (pre-existing, unrelated to Plan 12-05)

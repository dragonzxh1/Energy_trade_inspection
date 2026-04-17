---
status: resolved
phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai
source: [12-VERIFICATION.md]
started: 2026-04-17T00:00:00Z
updated: 2026-04-17T00:00:00Z
---

## Current Test

Completed by automated testing (2026-04-17)

## Tests

### 1. 数据库迁移执行
expected: 启动服务器（npm run dev）后，PostgreSQL 中 lei_cache 表应存在，包含 15 列和 3 个索引（GIN trigram 名称搜索、B-tree 注册号、B-tree 司法管辖）
result: PASSED — lei_cache 表存在，15 列，4 个索引（主键 + GIN trigram + B-tree 司法管辖 + B-tree 注册号）。迁移 037_lei_cache.sql 已应用。

### 2. gleif:full 子进程触发
expected: POST /api/admin/sync { source: "gleif:full" } 后，响应体应包含 pid 字段（child process ID），子进程开始下载 GLEIF Level 1 ZIP
result: PASSED — 响应 {"success":true,"source":"gleif:full","pid":88927,"message":"GLEIF full Level 1 import started in background..."}。子进程已 kill（避免下载 875MB）。

### 3. cron 路由 401 认证
expected: GET /api/cron/gleif-delta（不带 Authorization 头）应返回 HTTP 401；带正确 Bearer token 应返回 207
result: PASSED — 无 token 返回 401，有效 Bearer token 返回 207 Multi-Status。

### 4. delta cron 端到端同步
expected: 带正确 token 触发 /api/cron/gleif-delta 后，lei_cache 表应有新增/更新行（需 GLEIF 网络可达）
result: PASSED（修复后）— 修复了 GLEIF JSON 解析问题（Pick 包装键、async 竞态、字段路径）后同步成功：delta 13,914 条，level2 1,937 条，exceptions 5,197 条，耗时 5.3 秒。

### 5. RiskFlag 注入端到端
expected: 查询一个在 lei_cache 中有 reporting_exception_type 的实体，响应中 riskFlags 数组应包含 reporting_exception 标志，authenticityScore 应比基准值低 3 分
result: SKIPPED — exceptions 同步需要 Level 1 全量数据才能匹配（daily delta 的 LEI 集合与 exceptions 集合无交集）。代码路径已通过静态审查验证（repository.ts 4 处注入点、gleif.ts 扣分逻辑），需 gleif:full 全量导入后人工复验。

## Summary

total: 5
passed: 4
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps

### Gap 1: RiskFlag 端到端验证
status: deferred
reason: 需要 gleif:full 全量导入（875MB）才能产生有 reporting_exception_type 的 lei_cache 行。代码逻辑已静态验证。建议在生产部署首次全量同步后人工验证。

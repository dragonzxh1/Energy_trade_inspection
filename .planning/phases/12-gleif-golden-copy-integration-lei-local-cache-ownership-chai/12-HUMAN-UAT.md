---
status: partial
phase: 12-gleif-golden-copy-integration-lei-local-cache-ownership-chai
source: [12-VERIFICATION.md]
started: 2026-04-17T00:00:00Z
updated: 2026-04-17T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. 数据库迁移执行
expected: 启动服务器（npm run dev）后，PostgreSQL 中 lei_cache 表应存在，包含 15 列和 3 个索引（GIN trigram 名称搜索、B-tree 注册号、B-tree 司法管辖）
result: [pending]

### 2. gleif:full 子进程触发
expected: POST /api/admin/sync { source: "gleif:full" } 后，响应体应包含 pid 字段（child process ID），子进程开始下载 GLEIF Level 1 ZIP
result: [pending]

### 3. cron 路由 401 认证
expected: GET /api/cron/gleif-delta（不带 Authorization 头）应返回 HTTP 401；带正确 Bearer token 应返回 200
result: [pending]

### 4. delta cron 端到端同步
expected: 带正确 token 触发 /api/cron/gleif-delta 后，lei_cache 表应有新增/更新行（需 GLEIF 网络可达）
result: [pending]

### 5. RiskFlag 注入端到端
expected: 查询一个在 lei_cache 中有 reporting_exception_type 的实体，响应中 riskFlags 数组应包含 reporting_exception 标志，authenticityScore 应比基准值低 3 分
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps

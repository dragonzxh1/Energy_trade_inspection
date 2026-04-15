# Phase 1: Architecture Hardening - Discussion Log

> **仅供审计参考。** 不作为规划、研究或执行Agent的输入。
> 决策记录在 CONTEXT.md — 本日志保留讨论过程中考虑的备选方案。

**Date:** 2026-04-13
**Phase:** 01-architecture-hardening
**Areas discussed:** Middleware路由排除策略, 管理员鉴权机制, 熔断器设计, ARCH-04验证方式

---

## 灰区选择

| Option | Description | Selected |
|--------|-------------|----------|
| Middleware路由排除策略 | middleware.ts保护哪些路由？特殊路由如何排除？迁移后是否保留per-route auth()？ | |
| 管理员鉴权机制 | ARCH-03要求返回403并验证admin角色。当前用邮箱白名单。是否升级为DB role字段？ | |
| 熔断器设计 | ARCH-02要求status:degraded。简单fallback还是完整状态机？ | |
| ARCH-04验证方式 | Python路径已在commit 4cddc7d修复。是否需要额外验证步骤？ | |

**User's choice:** 所有灰区委托 Claude 决定（"你帮我决定"）

---

## ARCH-01: Middleware路由排除策略

| Option | Description | Selected |
|--------|-------------|----------|
| 正向matcher（列出受保护路由） | 明确列出需要保护的路由 matcher，新路由默认不受保护直到手动添加 | |
| 负向matcher（排除公开路由） | 排除特殊路由，其余全部受保护 | |
| 正向matcher + 删除per-route auth() | 干净迁移，删除所有冗余auth()调用 | ✓ |
| 双重防护（保留per-route auth()） | middleware + 各路由保留auth()作为备用 | |

**Claude's choice:** 正向matcher + 完全删除per-route auth()（干净迁移）
**Notes:** 受保护路由：screen/trade/intelligence/ais/watchlist/quota/report/admin。公开排除：search/entity/flags/stripe/auth/cron。

---

## ARCH-03: 管理员鉴权机制

| Option | Description | Selected |
|--------|-------------|----------|
| 保留邮箱白名单 + 修复401→403 | 最小改动，区分401（未认证）vs 403（已认证但无权限） | ✓ |
| 升级为DB role字段 | 需要新migration，添加 is_admin boolean 列 | |
| Bearer token only | 移除session-based admin check，只用ADMIN_SECRET | |

**Claude's choice:** 保留邮箱白名单 + 401/403语义修复
**Notes:** 避免DB schema变更成本。`isAuthorized()` 返回typed结果以区分401 vs 403。生产环境无ADMIN_SECRET时输出启动警告。

---

## ARCH-02: 熔断器设计

| Option | Description | Selected |
|--------|-------------|----------|
| 简单try/catch fallback（现状） | 失败时静默返回 {listed: false}，不透明 | |
| 内存状态机（无库） | 3次失败后开路，60s冷却，status:degraded响应 | ✓ |
| 完整状态机库（opossum等） | 功能全面但引入依赖 | |

**Claude's choice:** 简单内存状态机（无外部库）
**Notes:** 3次连续失败开路，60秒冷却，降级响应 `{status: 'degraded', listed: false, sources: [], reason: 'opensanctions_api_unavailable'}`。screening-service 需处理 degraded 状态。

---

## ARCH-04: Python路径验证

| Option | Description | Selected |
|--------|-------------|----------|
| 仅确认现有修复正确 | commit 4cddc7d已完成，无需额外工作 | |
| 添加启动时existsSync()检测 | 二进制不存在时输出明确错误信息 | ✓ |
| 添加超时和重试逻辑 | 超出本阶段范围 | |

**Claude's choice:** 添加 existsSync() 启动检测 + 明确错误信息
**Notes:** 将隐晦的 ENOENT 运行时错误转为可操作的启动警告。

---

## Claude's Discretion

所有四个实现灰区均由Claude决定，用户完全委托。

## Deferred Ideas

无 — 讨论未触发新需求或超出范围的想法。

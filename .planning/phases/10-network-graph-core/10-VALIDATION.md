---
phase: 10
slug: network-graph-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | 无（项目无 Vitest/Jest 配置，STATE.md 记录为技术债务） |
| **Config file** | none — 使用 TypeScript 类型检查作为自动验证替代 |
| **Quick run command** | `npm run type-check` |
| **Full suite command** | `npm run build` |
| **Estimated runtime** | ~30 seconds (type-check) / ~60 seconds (build) |

---

## Sampling Rate

- **After every task commit:** Run `npm run type-check`
- **After every plan wave:** Run `npm run build`
- **Before `/gsd-verify-work`:** `npm run build` 绿色 + 手动验证图谱渲染、点击导航、颜色编码
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 0 | GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04 | — | 安装依赖无恶意包 | install | `npm install @xyflow/react @dagrejs/dagre` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 0 | GRAPH-03 | T-10-SQL | 参数化查询，无 SQL 注入 | type | `npm run type-check` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 0 | GRAPH-02, GRAPH-04 | — | N/A | type | `npm run type-check` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | GRAPH-03 | T-10-SQL | 参数化查询，无 SQL 注入 | type | `npm run type-check` | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 1 | GRAPH-01, GRAPH-02, GRAPH-04 | T-10-F3 | F3 内容锁保护 | type + manual | `npm run build` | ❌ W0 | ⬜ pending |
| 10-03-02 | 03 | 1 | GRAPH-01 | — | N/A | manual | 手动验证 tab 渲染 | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] 安装 `@xyflow/react` 和 `@dagrejs/dagre`：`npm install @xyflow/react @dagrejs/dagre`
- [ ] 添加 `NetworkNode` / `NetworkEdge` 接口类型到 `src/lib/types.ts`（或新建 `src/lib/graph-types.ts`）
- [ ] 确认 `npm run type-check` 在安装新依赖后通过

*无测试框架：接受现状（STATE.md 记录为技术债务），使用 `type-check` + `build` 作为自动验证门控。*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 公司详情页 Network tab 渲染图谱 | GRAPH-01 | 无 E2E 测试框架 | 访问任意公司详情页，点击 Network tab，确认图谱出现 |
| 点击节点导航到 ETI 实体页 | GRAPH-02 | 需要浏览器交互 | 点击图中蓝色节点，确认导航到对应实体详情页 |
| 3 跳遍历 + 100 节点上限 | GRAPH-03 | 需要真实数据库 | 查询 ICIJ 数据量较大的公司，确认节点数 ≤ 100，无超时 |
| 颜色编码映射 | GRAPH-04 | 需要目视验证 | 确认制裁红色、欺诈橙色、ICIJ 灰色、正常蓝色 |
| F3 内容锁行为 | GRAPH-01 | 需要账户切换 | 免费账户访问时图谱被锁定，付费账户可见 |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

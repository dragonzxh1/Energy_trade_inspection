# Phase 6: Trade Service Integration Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-14
**Phase:** 06-trade-service-integration-hardening
**Areas discussed:** 卖方域名来源, 域名缺失时的处理方式, 制裁降级警告的 UI 样式

---

## 卖方域名来源 (Seller Domain Source)

| Option | Description | Selected |
|--------|-------------|----------|
| 仅 DB website 字段 | Use `sellerFullEntity.website` only — no form changes | |
| 新增表单可选域名/邮箱输入 | Add optional form field — user manually provides domain | |
| 两者结合：表单优先，无则回落 DB website | Form input takes priority; fallback to DB website field | ✓ |

**User's choice:** 两者结合（表单可选输入优先，无则回落到 sellerFullEntity.website）
**Notes:** User asked for a recommendation first; accepted the combined approach after analysis.

---

## 域名缺失时的处理方式 (Missing Domain Handling)

| Option | Description | Selected |
|--------|-------------|----------|
| 静默跳过 | Skip domain check silently, no UI notification | ✓ |
| 在结果页显示信息提示 | Show "domain check skipped" notice in result | |

**User's choice:** 静默跳过
**Notes:** Compliance officer knows the field is optional from the form itself.

| Option | Description | Selected |
|--------|-------------|----------|
| 静默失败，服务端记日志 | RDAP failure: silent, server-side log only | ✓ |
| 在结果中显示「域名检查不可用」 | Show "domain check unavailable" in result | |

**User's choice:** 静默失败，不干扰合规官员流程

---

## 制裁降级警告的 UI 样式 (Degraded Sanction Warning UI)

| Option | Description | Selected |
|--------|-------------|----------|
| 裁决横幅下方独立的橙色警告框 | Standalone amber box below ResultBanner | ✓ |
| 内嵌在裁决横幅中的小字提示 | Inline small text inside ResultBanner | |
| 裁决标签旁的警告图标 | Warning icon next to VerdictLabel only | |

**User's choice:** 裁决横幅下方独立的橙色警告框

---

## sanctionDegraded 覆盖范围 (Degraded Scope)

| Option | Description | Selected |
|--------|-------------|----------|
| 卖方和船只任一降级即为 true | Single boolean, true if any sanction check is degraded | ✓ |
| 分别记录卖方/船只降级状态 | Separate `sellerSanctionDegraded` + `vesselSanctionDegraded` | |

**User's choice:** 任一降级即设为 true（单一 boolean 字段 `sanctionDegraded`）

---

## Claude's Discretion

- Exact CSS styling of the amber warning box
- Label wording for the optional seller domain form field
- Whether `sanctionDegraded` is top-level or nested in `TradeCheckResult`
- Placement of `checkDomain()` in Promise.all() batching

## Deferred Ideas

None.

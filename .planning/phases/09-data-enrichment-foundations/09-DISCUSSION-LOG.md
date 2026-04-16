# Phase 9: Data Enrichment Foundations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 09-data-enrichment-foundations
**Areas discussed:** ICIJ↔制裁匹配运行方式, 船舶欺诈预警匹配字段, FraudAlertsPanel 结果数量上限

---

## ICIJ↔制裁匹配运行方式

| Option | Description | Selected |
|--------|-------------|----------|
| 嵌入 ICIJ sync | 每次 ICIJ sync 完成后自动运行匹配。零手动干预，数据始终保持同步。 | ✓ |
| 独立管理员操作 | 在 /api/admin/sync 中新增独立按钮，手动触发匹配过程。更灵活，但需要手动干预。 | |

**User's choice:** 嵌入 ICIJ sync（推荐）

---

## ICIJ 匹配范围

| Option | Description | Selected |
|--------|-------------|----------|
| 全量重新匹配 | 每次 ICIJ sync 后对所有 icij_entities 重新运行匹配，确保新增实体和删除实体都得到更新。简单可靠。 | ✓ |
| 增量匹配 | 仅匹配新增条目（未标记的）。更快，但如果制裁列表有变动旧条目不会被更新。 | |

**User's choice:** 全量重新匹配（推荐）

---

## 船舶欺诈预警匹配字段

| Option | Description | Selected |
|--------|-------------|----------|
| 运营商 + 船管公司 | vessel.operator OR vessel.manager 匹配。与 ROADMAP 描述一致（"通过船舶运营商/船管公司名称匹配"）。 | ✓ |
| 运营商 + 船管公司 + 船主 | 再加上 vessel.owner 三字段 OR 匹配。更全面但可能引入较多假阳。 | |
| 仅运营商 | 最精确，但会遗漏船管公司的欺诈记录。 | |

**User's choice:** 运营商 + 船管公司（推荐）

**Notes:** 用户初时询问该功能用途（船舶本身不在黑名单，但背后运营商/船管公司可能在欺诈预警中），了解后确认选择 operator + manager OR 匹配。

---

## FraudAlertsPanel 结果数量上限

| Option | Description | Selected |
|--------|-------------|----------|
| 全部显示 | 不设上限，显示所有匹配结果。实际场景中一个实体很少超过 5-10 条，无需分页。 | ✓ |
| 每个来源最多 5 条 | 每个来源（Rotterdam、FuelScamAlert 等）分别最多显示 5 条。遭志记录况旺下页面过长。 | |
| 总数上限 20 条 | 所有来源合计最多 20 条。简单统一上限。 | |

**User's choice:** 全部显示（推荐）

---

## Claude's Discretion

- FraudAlertsPanel 内部排序（黑名单优先于白名单，然后按来源名排序）
- `getCompanyFraudAlerts()` 和 `getVesselFraudAlerts()` 的函数签名
- ICIJ→sanctions UPDATE 的 SQL 实现（子查询或 WITH 子句）
- operator 和 manager 同时匹配同一 fraud_alerts 行时的去重逻辑

## Deferred Ideas

None — discussion stayed within phase scope.

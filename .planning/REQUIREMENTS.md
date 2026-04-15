# Requirements: v1.1 Network Intelligence Graph

Generated: 2026-04-16
Milestone: v1.1

## Overview

升级 ETI 的实体关联展示：从静态文字列表升级为交互式情报网络图谱，同时扩展制裁/欺诈数据的覆盖范围，使 ETI 成为"追踪网络"而非"比对名单"的情报平台。

---

## Requirements

### GRAPH — 网络图谱可视化

- [ ] **GRAPH-01**: 用户可在公司详情页看到交互式节点网络图，展示该公司的董事、股东和关联 ICIJ 离岸实体
- [ ] **GRAPH-02**: 用户可点击网络图中的任意节点，跳转到该实体的 ETI 详情页（若该实体存在于 ETI 数据库中）
- [ ] **GRAPH-03**: 网络图追踪至多 3 跳的所有权/董事关系链（节点上限 100），通过 PostgreSQL WITH RECURSIVE CTE 实现
- [ ] **GRAPH-04**: 网络图使用颜色编码区分节点风险类型：红=制裁实体，橙=欺诈预警实体，灰=ICIJ 离岸实体，蓝=正常实体

### NETDATA — 数据联动与丰富

- [ ] **NETDATA-01**: 同步 ICIJ 数据时，自动将 icij_entities 与制裁数据库做模糊匹配，为匹配的 ICIJ 实体打上 `is_sanctioned=true` 标签（需 migration 036：添加 `is_sanctioned BOOLEAN` 和 `sanctions_match TEXT` 字段）
- [ ] **NETDATA-02**: 在网络图中，`is_sanctioned=true` 的 ICIJ 离岸节点显示为红色（与直接制裁实体相同颜色）
- [ ] **NETDATA-03**: 公司详情页新增 FraudAlertsPanel，展示来自 `fraud_alerts` 表的匹配预警（Rotterdam、FuelScamAlert 等来源）
- [ ] **NETDATA-04**: 船舶详情页新增 FraudAlertsPanel，通过船舶运营商/船管公司名称匹配 `fraud_alerts` 表中的欺诈预警

### NETCOV — ICIJ 覆盖范围扩展

- [ ] **NETCOV-01**: 船舶详情页展示 ICIJ 图谱模块，通过船舶运营商（operator）、船管公司（manager）和船东（owner）名称匹配 ICIJ 实体
- [ ] **NETCOV-02**: 港口/终端详情页展示 ICIJ 图谱模块，通过终端运营商名称匹配 ICIJ 实体

### REPORT — 报告导出

- [ ] **REPORT-01**: 实体 PDF 报告中嵌入该实体网络图的静态 SVG 快照，作为合规报告的可视化证据

---

## Future Requirements (Deferred)

- **WATCHLIST-GRAPH-01**: 跟踪列表页展示被监控实体间的关联关系（共同董事、共同 ICIJ 离岸壳公司）
  - *Context:* 等核心图谱稳定后，跟踪列表页可作为第二期扩展

---

## Out of Scope

- 图谱实时更新（WebSocket）— 静态快照已满足合规报告需求
- 无限深度遍历 — 3跳+节点上限足够，防止组合爆炸
- 自定义图谱布局保存 — 用户会话状态管理增加复杂度
- 外部数据源新增（BIS Entity List、Adverse Media）— 下一个里程碑范围

---

## Traceability

| REQ-ID | Phase | Plan | Status |
|--------|-------|------|--------|
| NETDATA-01 | Phase 9 | — | Pending |
| NETDATA-02 | Phase 9 | — | Pending |
| NETDATA-03 | Phase 9 | — | Pending |
| NETDATA-04 | Phase 9 | — | Pending |
| GRAPH-01 | Phase 10 | — | Pending |
| GRAPH-02 | Phase 10 | — | Pending |
| GRAPH-03 | Phase 10 | — | Pending |
| GRAPH-04 | Phase 10 | — | Pending |
| NETCOV-01 | Phase 11 | — | Pending |
| NETCOV-02 | Phase 11 | — | Pending |
| REPORT-01 | Phase 11 | — | Pending |

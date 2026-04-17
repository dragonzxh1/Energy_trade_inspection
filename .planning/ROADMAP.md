# Roadmap: Energy Trade Inspection — Trade Fraud Decision Engine

## Milestones

- ✅ **v1.0 MVP** — Phases 1–8 (shipped 2026-04-15)
- 🔄 **v1.1 Network Intelligence Graph** — Phases 9–11 (in progress)

## Phases

<details>
<summary>✅ v1.0 MVP (Phases 1–8) — SHIPPED 2026-04-15</summary>

- [x] Phase 1: Architecture Hardening (3/3 plans) — completed 2026-04-13
- [x] Phase 2: Regulatory Warning Lists (2/2 plans) — completed 2026-04-13
- [x] Phase 3: Domain & Email Intelligence (2/2 plans) — completed 2026-04-14
- [x] Phase 4: Scoring Engine Completion (3/3 plans) — completed 2026-04-14
- [x] Phase 5: Decision Engine Upgrade (4/4 plans) — completed 2026-04-14
- [x] Phase 6: Trade Service Integration Hardening (2/2 plans) — completed 2026-04-15
- [x] Phase 7: Entity Sanction Wiring & Admin Sync Fix (2/2 plans) — completed 2026-04-15
- [x] Phase 8: Admin Operations Dashboard (3/3 plans) — completed 2026-04-15

See full details: `.planning/milestones/v1.0-ROADMAP.md`

</details>

### v1.1 Network Intelligence Graph (Phases 9–11)

- [ ] **Phase 9: Data Enrichment Foundations** — ICIJ↔sanctions linkage + fraud alert panels on company and vessel pages
- [x] **Phase 10: Network Graph Core** — React Flow interactive node graph with 3-hop recursive query on company pages (completed 2026-04-16)
- [ ] **Phase 11: Coverage Expansion + PDF Export** — ICIJ panels on vessel/port pages + graph SVG embedded in PDF reports

## Phase Details

### Phase 9: Data Enrichment Foundations
**Goal**: Users can see sanctions↔ICIJ linkage and fraud alert data on entity detail pages
**Depends on**: Phase 8 (v1.0 complete baseline)
**Requirements**: NETDATA-01, NETDATA-02, NETDATA-03, NETDATA-04
**Success Criteria** (what must be TRUE):
  1. After ICIJ sync runs, entities that fuzzy-match a sanctioned entity have `is_sanctioned=true` in the database — visible in admin tools or API response
  2. A company detail page shows a FraudAlertsPanel listing matched fraud alert records (Rotterdam, FuelScamAlert, etc.) when matches exist
  3. A vessel detail page shows a FraudAlertsPanel with fraud alerts matched via operator/manager name
  4. In the network graph (Phase 10 dependency), ICIJ nodes marked `is_sanctioned=true` render as red rather than grey
**Plans**: 3 plans
Plans:
- [x] 09-01-PLAN.md — Migration 036 + ICIJ sync sanctions matching + IcijMatch 扩展 + OffshoreLeaksPanel badge (NETDATA-01, NETDATA-02)
- [x] 09-02-PLAN.md — repository.ts FraudAlertRow 接口 + getCompanyFraudAlerts() + getVesselFraudAlerts() (NETDATA-03, NETDATA-04)
- [x] 09-03-PLAN.md — FraudAlertsPanel 组件 + company/vessel 页面 tab 插入 (NETDATA-03, NETDATA-04)
**UI hint**: yes

### Phase 10: Network Graph Core
**Goal**: Users can explore a company's ownership and director network as an interactive graph with up to 3 hops
**Depends on**: Phase 9
**Requirements**: GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04
**Success Criteria** (what must be TRUE):
  1. A company detail page renders an interactive node graph showing directors, shareholders, and linked ICIJ offshore entities
  2. Clicking any node that corresponds to an ETI entity navigates the user to that entity's detail page
  3. The graph traverses up to 3 hops of ownership/director relationships, capped at 100 nodes, without page timeout
  4. Nodes use color coding: red for sanctioned entities, orange for fraud-alerted entities, grey for ICIJ offshore entities, blue for normal entities
**Plans**: 4 plans
Plans:
- [x] 10-01-PLAN.md — npm 安装 @xyflow/react + @dagrejs/dagre + NetworkNode/NetworkEdge/NetworkGraphResult 接口定义 (GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04)
- [x] 10-02-PLAN.md — getNetworkGraph() WITH RECURSIVE CTE 数据层实现 (GRAPH-03, GRAPH-04)
- [x] 10-03-PLAN.md — NetworkGraph.tsx React Flow 客户端组件 + company page.tsx Network tab 集成 (GRAPH-01, GRAPH-02, GRAPH-04)
- [x] 10-04-PLAN.md — 手动视觉验证 checkpoint (GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04)
**UI hint**: yes

### Phase 11: Coverage Expansion + PDF Export
**Goal**: Users can view ICIJ network panels on vessel and port pages, and export a graph snapshot in entity PDF reports
**Depends on**: Phase 10
**Requirements**: NETCOV-01, NETCOV-02, REPORT-01
**Success Criteria** (what must be TRUE):
  1. A vessel detail page shows an ICIJ network module with entities matched via operator, manager, and owner name fields
  2. A port/terminal detail page shows an ICIJ network module with entities matched via terminal operator name
  3. When a user downloads an entity PDF report, the report contains a static SVG snapshot of that entity's network graph
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Architecture Hardening | v1.0 | 3/3 | Complete | 2026-04-13 |
| 2. Regulatory Warning Lists | v1.0 | 2/2 | Complete | 2026-04-13 |
| 3. Domain & Email Intelligence | v1.0 | 2/2 | Complete | 2026-04-14 |
| 4. Scoring Engine Completion | v1.0 | 3/3 | Complete | 2026-04-14 |
| 5. Decision Engine Upgrade | v1.0 | 4/4 | Complete | 2026-04-14 |
| 6. Trade Service Integration Hardening | v1.0 | 2/2 | Complete | 2026-04-15 |
| 7. Entity Sanction Wiring & Admin Sync Fix | v1.0 | 2/2 | Complete | 2026-04-15 |
| 8. Admin Operations Dashboard | v1.0 | 3/3 | Complete | 2026-04-15 |
| 9. Data Enrichment Foundations | v1.1 | 0/3 | Planned | - |
| 10. Network Graph Core | v1.1 | 4/4 | Complete    | 2026-04-16 |
| 11. Coverage Expansion + PDF Export | v1.1 | 0/? | Not started | - |
| 12. GLEIF Golden Copy Integration | standalone | 4/5 | In Progress|  |

## Backlog

### Phase 999.1: U.S. CSL + BIS Entity List — export_restricted 独立标签 (BACKLOG)

**Goal:** 为出口管制实体打独立的 `export_restricted` 风险标签，区别于 `sanctioned`
**Priority:** P0 缺口（当前仅靠 sanctions.network 聚合数据覆盖，无独立模块）
**Requirements:** TBD
**Plans:** 0 plans

Implementation notes:
- 直接拉取 trade.gov Consolidated Screening List (CSL) API
- 直接拉取 BIS Entity List
- 在 scoring/intelligence 层增加 `export_restricted` 独立标签输出
- 区别现有 `sanctioned` 标签，为能源设备、工业品交易提供更精细风险分类

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

---

### Phase 999.2: SC Malaysia Investor Alert List — 监管警告补全 (BACKLOG)

**Goal:** 接入马来西亚证监会 (SC Malaysia) 投资者警告名单，补全东南亚监管覆盖缺口
**Priority:** P0 缺口（现有 regulatory-warnings.ts 实现的是 MAS 新加坡，非 SC Malaysia）
**Requirements:** TBD
**Plans:** 0 plans

Implementation notes:
- 目标：sc.com.my 投资者警告列表（涵盖非法计划、克隆公司、未授权资本市场活动）
- 捕获字段：entity name, urls/app links/social links, year, remark, category
- 融入现有 `regulatory_warning` 标签体系
- 马来西亚是能源贸易高频地区，与 ACRA/SSM 注册数据联动价值高

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

---

### Phase 999.3: Malaysia SSM 公司注册局接入 (BACKLOG)

**Goal:** 接入马来西亚 SSM (Suruhanjaya Syarikat Malaysia) 公司注册数据
**Priority:** P1（马来西亚是能源贸易高频司法管辖区，当前无注册局覆盖）
**Requirements:** TBD
**Plans:** 0 plans

Implementation notes:
- 评估 SSM API 可用性及访问方式（官方 API / data.gov.my）
- 捕获：公司名、注册号、董事、股东、注册日期、状态
- 与 SC Malaysia 警告名单联动：注册数据 + 警告列表交叉验证
- 参考 ACRA 实现模式（acra.ts）

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

---

### Phase 999.4: 香港公司注册处 (Hong Kong CR) 接入 (BACKLOG)

**Goal:** 接入香港公司注册处 (Companies Registry) 注册数据
**Priority:** P1（香港是能源贸易高频司法管辖区，当前仅有 SFC 警告，无注册局数据）
**Requirements:** TBD
**Plans:** 0 plans

Implementation notes:
- 评估香港 CR 开放 API 可用性（cr.gov.hk）
- 捕获：公司名、注册号、董事、公司秘书、注册日期、状态
- 与 SFC Alert List 联动：注册实体 + 监管警告交叉验证
- 可用 OpenCorporates hk 司法管辖区作为 fallback

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

---

### Phase 999.5: IMO GISIS 船舶身份验证 (BACKLOG)

**Goal:** 接入 IMO GISIS 公开数据，实现船舶身份和船务公司官方验证
**Priority:** P2（能源贸易核心场景，当前 AIS 层没有官方船舶注册交叉验证）
**Requirements:** TBD
**Plans:** 0 plans

Implementation notes:
- GISIS 公开区域：按 IMO 号查询船舶详情、公司 IMO 号
- 捕获：IMO 号、船旗国、船东公司 IMO、船级社、管理公司
- 核心价值：验证 AIS 报告的船舶身份与 IMO 官方登记是否一致
- 检测：船名/IMO/管理公司变更历史异常

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

---

### Phase 999.6: Equasis 船舶安全与管理数据 (BACKLOG)

**Goal:** 接入 Equasis 船舶安全记录，检测船东/管理人/运营人结构异常
**Priority:** P2（补充 AIS 行为数据，提供 PSC 检查/扣押记录）
**Requirements:** TBD
**Plans:** 0 plans

Implementation notes:
- Equasis：免费（需注册），整合 MarineTraffic/VesselTracker/P&I 来源
- 捕获：船东/管理人/运营人、PSC 检查记录、扣押记录、P&I 保险
- 关键先决条件：确认服务条款是否允许服务条款是否允许自动化访问
- 高风险信号：同一管理公司频繁关联高风险船舶

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

---

### Phase 999.7: Global Fishing Watch API — 海事行为异常检测 (BACKLOG)

**Goal:** 接入 Global Fishing Watch 公开 API，为船舶构建行为异常评分层
**Priority:** P2（方法论可迁移至油轮：路线缺口、异常停靠、STS 风险区域）
**Requirements:** TBD
**Plans:** 0 plans

Implementation notes:
- GFW 公开 API：vessel identity, port visits, loitering, encounters, events
- 核心用途：路线 vs 申报贸易路径不符、高风险港口暴露、船对船转货检测
- 注意：GFW 以渔船为主，油轮/散货轮覆盖不完整，需验证覆盖范围
- 与现有 AIS dark period 检测互补，不替代

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

### Phase 12: GLEIF Golden Copy integration — LEI local cache, ownership chain, reporting exceptions

**Goal:** 将 GLEIF 实时 API 调用替换为本地缓存（lei_cache 表），通过 Golden Copy 批量导入实现 LEI 数据本地化，并将所有权链（Level 2 RR）和报告豁免（REPEX）数据转化为风险信号
**Requirements**: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08, D-09, D-10
**Depends on:** Phase 11
**Plans:** 4/5 plans executed

Plans:
- [x] 12-01-PLAN.md — npm 安装 unzipper/stream-json + 迁移 037_lei_cache.sql + SyncSource 类型扩展 (D-01, D-08, D-09)
- [x] 12-02-PLAN.md — gleif-golden-copy.ts sync 模块（四个 sync 函数）+ scripts/sync-gleif-full.mjs 子进程脚本 (D-02, D-03, D-04, D-06)
- [x] 12-03-PLAN.md — repository.ts 缓存优先集成（getLeiCacheRecord + writeLeiCacheRecord + 三处调用点） (D-05, D-06)
- [x] 12-04-PLAN.md — scoring.ts reportingExceptionFlag + repository.ts reporting_exception RiskFlag 注入 (D-07)
- [ ] 12-05-PLAN.md — sync/index.ts dispatch 块 + admin/sync/route.ts gleif:full/delta + cron/gleif-delta/route.ts (D-09, D-10)

---

### Phase 999.8: Open Ownership — 受益所有权 (UBO) 穿透 (BACKLOG)

**Goal:** 接入 Open Ownership 数据，实现 PSC/UBO 层级穿透和壳公司网络发现
**Priority:** P3（当前阶段优先级较低，2026 年各国 UBO 登记公开访问不一致）
**Requirements:** TBD
**Plans:** 0 plans

Implementation notes:
- Open Ownership 采用 BODS 标准，被英国政府采纳为官方开放标准
- 捕获：实际受益人、控制类型、持股比例、来源登记、声明日期
- 现实约束：2026 年全球 UBO 登记公开访问法律基础不统一
- 建议策略：先作为"有数据时的增强层"，而非主动抓取目标
- 与 Phase 10 网络图直接整合：UBO 关系可作为图节点

Plans:
- [ ] TBD (promote with /gsd-review-backlog when ready)

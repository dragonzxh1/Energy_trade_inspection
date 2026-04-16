# Phase 10: Network Graph Core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 10-network-graph-core
**Areas discussed:** 标签位置与布局, 节点数据范围, 数据获取架构, 空状态与边界条件

---

## 标签位置与布局

| Option | Description | Selected |
|--------|-------------|----------|
| 新建独立"Network"标签 | 在 Offshore Leaks 旁新建，保留现有文字列表不受影响 | ✓ |
| 替换现有 Offshore Leaks 标签 | 将 OffshoreLeaksPanel 迁入图谱视图 | |
| 图谱内嵌入 Offshore Leaks 标签顶部 | 保留现有文字列表，图谱作为可折叠区域 | |

**用户选择:** 新建独立 "Network" 标签，位置在 Offshore Leaks 之后  
**Notes:** 用户明确要求独立标签，不希望破坏现有 Offshore Leaks 显示。

---

**画布高度**

| Option | Description | Selected |
|--------|-------------|----------|
| 600px | 足够展示 20-30 节点，不占屏太多 | |
| 800px | 更宽敞，适合节点较多 | |
| Claude 决定 | 根据现有组件比例自行判断 | ✓ |

**用户选择:** Claude 决定  
**Notes:** 委托 Claude 根据现有 AIS 地图等组件比例判断，建议 600–700px。

---

## 节点数据范围

**阶段一：根节点来源**

| Option | Description | Selected |
|--------|-------------|----------|
| ICIJ 匹配实体为根 | 从 icij_entity 开始 WITH RECURSIVE CTE | (初始选项) |
| ETI 实体为根 + 混合节点 | 公司为中心节点，连接 ETI 董事 + ICIJ 实体 | ✓ |

**用户选择:** 经过扩展讨论（见下），最终确认 ETI 公司为根节点 + 三类数据

**用户提问：** "你的建议是什么，ICIJ到底是什么数据源？"  
**Claude 解释：** ICIJ = 国际调查记者同盟的离岸泄露数据库（巴拿马文件、潘多拉文件等）。ETI 的 icij_entities 表通过名称模糊匹配与公司关联。WITH RECURSIVE CTE 在 icij_relationships 图中递归。

**用户提问：** "我们现在公司这一块的数据我记得不止ICIJ一个数据源啊？"  
**Claude 扩展说明：** 对，还有 Companies House (UK), ACRA (Singapore), Zefix (Switzerland), OpenCorporates 的董事/股东数据，以及 metadata.vessels 中的关联船舶。

**最终节点范围（多选确认）:**
- ✓ 董事/股东（来自公司注册处）
- ✓ 关联船舶（来自 company.vessels）
- ✓ ICIJ 匹配实体 + 3 跳递归

---

## 数据获取架构

| Option | Description | Selected |
|--------|-------------|----------|
| Server props 直接传入 | Server Component 调用 getNetworkGraph()，props 传给 NetworkGraph 客户端组件 | ✓ |
| API 路由 + 客户端 fetch | 新建 /api/network-graph/[id]，React Flow 组件自行拉取 | |

**用户选择:** Server props 直接传入  
**Notes:** 与现有 FraudAlertsPanel、OffshoreLeaksPanel 模式一致，无需额外 API 路由。

---

**内容锁定**

| Option | Description | Selected |
|--------|-------------|----------|
| F3 付费锁定 | 与 FraudAlertsPanel、Directors、Offshore Leaks 一致 | ✓ |
| 免费展示 | 作为产品展示面吸引用户升级 | |

**用户选择:** F3 付费锁定

---

## 空状态与边界条件

**用户提问：** "如果ICIJ大部分是空，我们有其他数据支撑嘛"  
**Claude 解释：** 有。ETI 注册处数据（董事/股东）覆盖大部分有注册记录的公司；关联船舶同样可展示。即使没有 ICIJ 数据，也能渲染有意义的星形图谱。

| Option | Description | Selected |
|--------|-------------|----------|
| 常显标签 + 空状态文案 | 无数据时显示空状态信息，始终显示标签 | ✓ |
| 隐藏标签 | 无 ICIJ 匹配时不显示 Network 标签 | |

**用户选择:** 始终显示标签，无数据时显示空状态（与 Fraud Alerts 标签处理方式一致）

---

**节点上限提示**

| Option | Description | Selected |
|--------|-------------|----------|
| 截断并显示提示文案 | "Showing 100 of {N} nodes — network truncated for performance" | (部分确认) |
| Claude 决定 | 根据现有 UI 模式自行判断提示方式 | ✓ |

**用户选择:** Claude 决定

---

## Claude's Discretion

- 画布高度（建议 600–700px）
- 节点尺寸与标签截断策略
- 边标签（关系类型，如 DIRECTOR_OF、SHAREHOLDER_OF）
- Dagre 布局方向
- 超节点上限时的截断提示文案与样式
- 相同节点通过多路径到达时去重逻辑

## Deferred Ideas

- 跨船舶网络（同一公司名下多艘船舶之间的关联）— Phase 11 或后续增强
- 跨公司董事关联（同一董事出现在多家 ETI 公司）— 需要跨实体董事索引，未来里程碑

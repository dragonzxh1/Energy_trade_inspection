# Phase 4: Scoring Engine Completion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-14
**Phase:** 04-scoring-engine-completion
**Areas discussed:** Trading Track Record algorithm, Shell company signal sources, Shell signal penalty model, Score breakdown paywall UX

---

## Trading Track Record Algorithm (SCORE-01)

| Option | Description | Selected |
|--------|-------------|----------|
| 商品多样性 +5 | 不同类型商品（原油+乙烯等）证明多元化贸易商 | |
| 多港口活动 +5 | 在多个LOCODE有记录，说明全球运营 | |
| 交易量阶梯 | 3-9条+5，10条以上+7 | ✓ |
| 对手方已验证 | counterparty_id非null，对手方是已注册实体 | |
| 文件记录支持 | 来自上传筛查文件的trade_event | |
| 交易跨度 | 最早最新记录相距>6个月 | |
| Claude自行决定 | 自行组合以上信号 | |

**User's choice:** 交易量阶梯（推荐）

**Notes:** 用户明确指出：商品多样性和多港口活动未必能证明真实性，核心是确定真实性。用户质疑了"在系统中注册"的含义，以及如何确定交易跨度时间。最终选择交易量阶梯作为最客观的真实性信号。

---

## Shell Company Signal Sources (SCORE-02)

| Option | Description | Selected |
|--------|-------------|----------|
| 域名注册 < 6个月 | Phase 3已有domain_email_cache.age_days | ✓ |
| 无注册号/注册号过短 | registration_number为null或<5位 | ✓ |
| 无网络存在感 | 域名查询失败+无MX记录+无网站元数据 | ✓ |
| 高风险国家/地区注册 | 对应isHighRisk()函数，IR/RU/VE等列表 | 排除 |

**User's choice:** 前三个确定；高风险国家重新讨论

**Follow-up on 高风险国家:**

| Option | Description | Selected |
|--------|-------------|----------|
| 不纳入SCORE-02 | 已在现有维度通过isHighRisk()计入，避免双重惩罚 | ✓ |
| 单独记录但不加指标分权 | 显示在evidence里，不单独减分 | |
| 续入SCORE-02作为多一个信号 | 各维度确实已有高风险扣分 | |

**Notes:** 用户认为高风险国家已在现有scoring维度中处理，双重惩罚逻辑不一致。

---

## Shell Signal Penalty Model

| Option | Description | Selected |
|--------|-------------|----------|
| 定点正向扣分 | 每个信号从具体维度扣固定分，维度最低0 | ✓ |
| 收敛器对总分施加乘数惩罚 | 1个信号×0.9，2个×0.8，3个×0.7 | |
| 独立的空壳指标分（-N分） | 不占用现有维度，直接从合计total扣 | |

**User's choice:** 定点正向扣分（推荐）

**Notes:** 三个信号全部从Entity Existence维度扣（-10/-8/-5），维度floor为0。

---

## Score Breakdown Paywall UX (SCORE-03)

**What free users see:**

| Option | Description | Selected |
|--------|-------------|----------|
| 仅显示总分和tier标签 | 圆弧仪表盘+数字，不显示任何维度条 | ✓ |
| 模糊维度条（类ContentLock） | 维度条模糊+升级CTA覆盖 | |
| 显示维度名称，隐藏具体分数 | 标签可见，分数和条形图替换为'—'或锁头图标 | |

**User's choice:** 仅显示总分和tier标签（推荐）

**Upgrade entry point:**

| Option | Description | Selected |
|--------|-------------|----------|
| ScoreGauge内部小文字提示 | 维度条区域替换为一行：'付费用户可查看5个维度详情 → 查看计划' | ✓ |
| 小块区域（类ContentLock） | 维度条区域用ContentLock包裹，模糊+升级CTA | |

**User's choice:** 在ScoreGauge内部显示小文字提示（推荐）

---

## Claude's Discretion

- Exact wording of the in-gauge upgrade prompt
- Whether to query domain_email_cache inside scoring.ts or pre-fetch in repository.ts (prefer pre-fetch)
- Evidence string phrasing for each shell signal
- Whether computeTradingTrackRecord() stays in repository.ts or moves to scoring.ts (stay in repository.ts)

## Deferred Ideas

- 商品多样性评分 — 不能证明真实性，未来如有外部贸易数据来源可再考虑
- 多司法管辖区/港口活动评分 — 同上
- SCORE-01达到精确25分 — 当前数据最多22分，达到25需要未来外部验证数据来源

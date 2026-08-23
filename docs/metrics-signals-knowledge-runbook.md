# 指标、信号与品种知识卡

## 指标

`analysis_worker` 只读取通过本地质量门的 current facts。所有算术由 Python 执行，版本为 `price-metrics.v1`；缺少窗口数据写入 `insufficient_data`。

```bash
.venv-intelligence/bin/python -m intelligence.market_pipeline.analysis_worker
psql "$DATABASE_URL" -f db/validation/050_metrics_signals_knowledge.sql
```

## 信号

- 权重：`intelligence/config/market_signal_weights.yaml`。
- 版本：`market-signal-score.v1`。
- 每日最多一个 `top_signal`。
- top signal 至少两个独立支持维度。
- 单一报价不能成为主线；无足够信号时落 `low_signal`。

## 品种知识卡

10 张首批卡位于 `intelligence/knowledge/commodity_frameworks/`。它们只提供解释框架，不提供当天事实或新数字。

```bash
.venv-intelligence/bin/python -m intelligence.market_pipeline.knowledge_sync
```

Dify 分析节点的检索规则：

1. 先使用 `commodity_id` 或 aliases 精确选择一张卡。
2. 只发送该卡的传导路径、验证指标、常见误判和失效条件。
3. 禁止从知识卡引入当天数字。
4. 未匹配品种时不做全库混合检索，返回 `knowledge_gap`。

在 Dify 中使用独立知识库 `KB-Commodity-Frameworks`；每份文档 metadata 必须包含 `commodity_id`、`version` 和 `updated_at`。

## 回滚

```bash
pg_dump "$DATABASE_URL" -Fc -f backups/pre_metrics_signals_$(date +%Y%m%d_%H%M%S).dump
psql "$DATABASE_URL" -f db/rollbacks/050_metrics_signals_knowledge.down.sql
```

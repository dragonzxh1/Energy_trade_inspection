# 事实验证、冲突与风险门

## 规则

- 验证版本：`fact-validation.v1`。
- 核对证据原文、数字、单位、方向、market date、benchmark、publisher 和置信度。
- OCR 数字、高/critical 风险、未知来源、无单位数字和未解决冲突一律阻断。
- 高风险事实必须有明确归因，并且必须人工复核和独立交叉来源。
- 规则引擎不改数字、不换算单位、不删除冲突少数方。

## 运行

```bash
.venv-intelligence/bin/python -m intelligence.market_pipeline.validation_worker
```

只有同时满足以下条件的事实可以进入指标与写作层：

```sql
is_current = true
AND verification_status = 'verified'
AND publication_blocked = false
```

## 审核数据

- `fact_validation_results`：逐规则问题。
- `fact_conflicts`：冲突双方与解决状态。
- `fact_review_queue`：待人工处理事实。
- `processing_step_attempts`：Dify 每次尝试的输入、输出、错误和耗时。

## 验证与回滚

```bash
psql "$DATABASE_URL" -f db/validation/049_fact_validation.sql
pg_dump "$DATABASE_URL" -Fc -f backups/pre_fact_validation_$(date +%Y%m%d_%H%M%S).dump
psql "$DATABASE_URL" -f db/rollbacks/049_fact_validation.down.sql
```

## 人工检查命令

列出某日待检查信息：

```bash
python -m intelligence.market_pipeline.fact_review --list --date 2026-07-11
```

拒绝错误信息：

```bash
python -m intelligence.market_pipeline.fact_review --reject FACT-ID \
  --reviewer "name" --notes "拒绝原因"
```

高风险信息只有在问题仅为“需要人工确认”，并提供不同出版方的已核验佐证时才能通过：

```bash
python -m intelligence.market_pipeline.fact_review --approve FACT-ID \
  --corroborating-fact-id OTHER-FACT-ID --reviewer "name" --notes "核验说明"
```

单位错误、数字错误、非能源内容和引用错误不能人工强行通过，必须修正或拒绝。

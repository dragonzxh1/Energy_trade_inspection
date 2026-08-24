# MarketFact 运行手册

## 运行

仅列出待抽取章节，不调用 Dify：

```bash
.venv-intelligence/bin/python -m intelligence.market_pipeline.fact_worker --dry-run --limit 10
```

抽取一个章节用于合同验证：

```bash
.venv-intelligence/bin/python -m intelligence.market_pipeline.fact_worker \
  --section-id <section-id> --limit 1
```

增量抽取：

```bash
.venv-intelligence/bin/python -m intelligence.market_pipeline.fact_worker --limit 10
```

`--force` 只用于固定 fixture 或人工确认后的重跑。事实哈希相同会更新原记录；新版本事实会保留旧记录并标记非 current。

## 环境变量

- `DATABASE_URL`
- `DIFY_BASE_URL`
- `DIFY_WORKFLOW_API_KEY_EXTRACT`
- `MARKET_PIPELINE_MODE`

## 验证与回滚

```bash
psql "$DATABASE_URL" -f db/validation/048_market_facts.sql
pg_dump "$DATABASE_URL" -Fc -f backups/pre_market_facts_$(date +%Y%m%d_%H%M%S).dump
psql "$DATABASE_URL" -f db/rollbacks/048_market_facts.down.sql
```

工作流 HTTP、Schema、证据或数据库错误会把对应 `processing_step` 标记为 `failed`，同一章节不会部分写入事实。

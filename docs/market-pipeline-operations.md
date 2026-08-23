# 结构化市场流水线运维

## 每日运行

```bash
.venv-intelligence/bin/python -m intelligence.market_pipeline.orchestrator --date YYYY-MM-DD
```

默认批次：20 份文档、5 个 Dify 章节；可用 `MARKET_DOCUMENT_BATCH_LIMIT` 和 `MARKET_FACT_BATCH_LIMIT` 调整。任一步失败都会非零退出并保留步骤输出。

## 回归

```bash
.venv-intelligence/bin/python intelligence/run_market_pipeline_regression.py
npm run type-check
npm run build
```

固定 manifest 覆盖 15 类输入风险。单元与集成测试覆盖合同、解析、事实、验证、指标、信号、EditorialView、文章审计和反馈 diff。

## Rollout

每日状态分为三个独立字段：

- `content_ready`：文章或本地市场记录已经生成。
- `quality_gate_passed`：文章事实检查和 Dify 终审都已通过。
- `publish_execution_allowed`：当前模式允许调用微信接口；`shadow` 下始终为 `false`。

```bash
.venv-intelligence/bin/python -m intelligence.market_pipeline.rollout
```

脚本只评估，不自动修改 `.env.local`：

- shadow → review：至少 20 份文档、10 个可发布日。
- review → active：以上条件保持，并有至少 3 个双审通过草稿日。
- 未达标继续 shadow；legacy 始终保留。

## 失败处理

- `pipeline_daily_runs`：每日汇总。
- `pipeline_alerts`：开放告警。
- `processing_runs/steps/attempts`：模型与节点级追踪。
- `editorial_feedback`：人工修改及原因。
- `article_quality_metrics`：可比较质量指标。

回滚顺序按 migration 逆序执行；数据库备份位于 `/var/www/eti/backups/`。旧 `daily_report.py`、旧 Dify 工作流和微信发布器不删除。

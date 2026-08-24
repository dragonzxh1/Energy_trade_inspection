# 按市场日期提取事实：运行手册

## 目的

事实提取必须按文档正文确定的 `market_date` 单独运行。日报任务不能从全库挑选最早积压，也不能让旧日期挤占目标日期的处理机会。PostgreSQL 保存处理状态和重试记录，Dify 只负责从一段正文返回原子事实。

生产环境保持：

```env
MARKET_PIPELINE_MODE=shadow
MARKET_FACT_MAX_SECTIONS=100
MARKET_FACT_MAX_SECTIONS_PER_DOCUMENT=10
MARKET_FACT_MIN_DOCUMENT_COVERAGE=0.8
MARKET_PIPELINE_LOOKBACK_DAYS=2
```

## 状态说明

- `pending`：等待处理。
- `leased`：该章节已被一个任务暂时领取，其他任务不能重复处理。
- `processing`：正在调用 Dify。
- `completed`：处理成功；可以有事实，也可以确认没有可用事实。
- `failed_retryable`：临时失败，可再次处理。
- `failed_terminal`：连续失败达到上限，需要检查原文或 Dify 返回。
- `skipped`：按明确规则跳过，例如重复、过短或非能源内容。
- `needs_review`：不能安全自动判断，需要人工检查。

## 常用命令

处理单个目标日期：

```bash
python -m intelligence.market_pipeline.fact_worker \
  --date 2026-07-07 \
  --max-sections 100 \
  --max-sections-per-document 10
```

只查看待处理数量：

```bash
python -m intelligence.market_pipeline.fact_worker --date 2026-07-07 --dry-run
```

清理超时的处理中标记，不调用 Dify：

```bash
python -m intelligence.market_pipeline.fact_worker \
  --date-from 2026-07-10 --date-to 2026-07-11 --recover-expired-only
```

历史补跑：

```bash
python -m intelligence.market_pipeline.fact_worker \
  --date-from 2026-07-06 --date-to 2026-07-10 \
  --max-sections 500 --max-sections-per-document 20 --retry-failed
```

历史补跑永远不计入自动发布状态，也不得自动群发。

## 选择与公平处理

- 只处理目标日期内已验证、已解析、无需人工复核的文档。
- 先在每份文档内按价格、中断与政策、供需、贸易流、市场摘要等主题轮换，再跨文档轮换。
- 单份大文档不能超过 `max-sections-per-document`，避免挤占其他来源。
- 价格评估、价格表和市场摘要优先；目录、广告、版权说明、页眉页脚默认跳过。
- 同一文档内的完全重复章节和过短章节会记录明确跳过原因。

## 混合表格

报纸市场数据页有时会把债券基准表和能源供需表合并为一个章节。系统只有在同时识别到多个固定收益表特征和明确能源表标题时，才从首个能源表标题开始送入 Dify。

该处理不会改写原文，也不会放宽证据检查：Dify 返回的证据仍必须是送审正文中的连续原句。若表头单位与数据行相隔过远，无法形成合规证据，该章节会保留失败记录或进入人工复核，不会猜测单位。

## Dify 返回要求

- 返回 JSON 对象，且必须包含 `facts` 数组；无事实时返回空数组。
- 一条事实只表达一个主张。
- 价格和价格变化必须拆成两条事实。
- 数字、单位、主体、日期和不确定语气必须来自原文。
- `evidence_text` 必须是正文中的连续原句。
- 不得猜测缺失单位、补写事实或把格式错误伪装为空结果。
- 格式、网络、超时和限流错误最多重试三次；第三次失败后明确记录。

## 日级继续条件

日级流程使用“截至当前的累计文档覆盖”判断，而不是只看本轮新处理了几份文档。这样，已处理完成的文档在幂等复跑时仍计入覆盖。

允许在少量章节明确失败时继续进入核验层，但必须同时满足：

- 合格文档累计覆盖率不低于 `MARKET_FACT_MIN_DOCUMENT_COVERAGE`；
- 本轮有任务时，至少一个章节成功完成；
- 如果仍有待处理章节，本轮不能完全没有执行；
- 所有失败章节保留原因、Dify 原始返回和重试记录。

这只决定是否进入后续分析，不改变信号评分、事实核验或正式发布门槛。

## 并发与防重复

- 数据库使用 `FOR UPDATE SKIP LOCKED`，避免两个任务领取同一章节。
- 处理中标记默认 20 分钟到期，每批任务续期一次。
- Dify 网络请求可并行；事实、价格、日志和最终状态由单一数据库连接顺序写入。
- 重复运行更新已有事实，不增加重复记录。

## 验证

```bash
python -m unittest discover -s intelligence -p 'test_*.py'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f db/validation/053_fact_extraction_scheduling.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f db/validation/054_section_granularity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f db/validation/057_fact_extraction_update_counts.sql
```

## 回滚

先停止日级定时任务，再恢复上一版：

- `fact_worker.py`
- `fact_repository.py`
- `fact_scheduling.py`
- `orchestrator.py`

如需回退数据库结构，按对应编号执行 `db/rollbacks/` 中的 down SQL。回滚调度与审计字段不会删除已生成的 `market_facts`。

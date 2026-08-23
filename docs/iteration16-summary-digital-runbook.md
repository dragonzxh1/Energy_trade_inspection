# 迭代 16：Summary 图片报价与 Digital 三模式运行手册

## 内容边界

- Summary 图片稿：图片标题日期确认、固定布局完整、二维码替换成功即可进入公众号草稿；机器人延迟不阻塞图片稿。
- Summary 结构化价格：仅在 `/eu` 与 `/apag` 同一市场日期完成 18 项校验后开放历史比较和小程序查询。
- Digital：先生成 `SourceDossier`，再按材料选择 `faithful_translation`、`event_brief` 或 `market_analysis`。
- 全部生产任务保持 `MARKET_PIPELINE_MODE=review`，只创建草稿，不自动群发。

## Summary 状态

`release_state.json` 需分别观察：

- `image_quote_ready` / `image_quote_status`
- `image_draft_created` / `image_draft_media_id`
- `bot_confirmation_received`
- `structured_price_verified`
- `historical_comparison_ready`
- `blocking_reasons`

公众号图片稿幂等键为 `summary-image:<market_date>`。结构化价格只能融合市场日期相同的图片与机器人快照。

## Digital 文章模式

- `faithful_translation`：权威长文，至少 4 段忠实摘译，目标 1800–3500 字。
- `event_brief`：明确事件，至少 1 段来源摘译，目标 900–1800 字。
- `market_analysis`：唯一主线和至少两个支持维度，目标 1200–2500 字。

## Digital 事件隔离

- 报纸整期 PDF 必须先按 `document_section` 隔离候选；同一期刊、同一日期或同一品种不代表同一事件。
- `event_brief` 只能包含一个 `primary_event`，其他章节的事实即使已经验证也不得自动拼入。
- 相邻候选只有在来源和主题均高度相关时才允许合并；不再把多个薄主题强制合并成“每日简报”。
- Writer 输入必须包含 `primary_event` 与 `evidence_policy`；Reviewer 将跨文章、跨主体或跨事件拼接视为阻断项。

写作输入包含已验证事实、摘译和文档级 `SourceDossier`；不发送完整 PDF。三种模式使用独立的写作模板 ID和审校合同。

## 本地验证

```bash
.venv-intelligence/bin/python -m unittest discover -s intelligence -p 'test_*.py'
.venv-intelligence/bin/python -m py_compile \
  intelligence/daily_prices.py \
  intelligence/wechat_publish.py \
  intelligence/market_pipeline/source_dossier.py \
  intelligence/market_pipeline/article.py \
  intelligence/market_pipeline/article_review.py \
  intelligence/market_pipeline/publication_worker.py
```

迁移后执行：

```bash
psql "$DATABASE_URL" -f db/validation/062_summary_image_and_source_dossiers.sql
```

所有计数应为 0。

## 生产验证

```bash
MARKET_PIPELINE_MODE=review DAILY_PRICE_MODE=append \
  scripts/cron-runner.sh summary-publish

MARKET_PIPELINE_MODE=review \
  scripts/cron-runner.sh digit-publish
```

先使用历史日期和 `ETI_PUBLISH_DRY_RUN=1` 运行；确认本地终稿、微信预检和通知正常后，再取消 dry-run 创建草稿。不得把模式改为 `active`。

## 回滚

1. 停止新的 Summary / Digital 定时任务。
2. 将代码回退到部署前版本。
3. 仅在确认无新流程需要的数据后执行 `db/rollbacks/062_summary_image_and_source_dossiers.down.sql`。
4. 保持 `MARKET_PIPELINE_MODE=review` 或临时切回 `shadow`，不得因回滚自动群发。
## 生产验证补充（2026-07-25）

- Summary 图片接收日期与市场日期分离：市场日期仅由图片标题 OCR 确认；生产样本 `2026-07-16` 收取的图片实际归档到市场日期 `2026-07-13`。
- 图片标题识别依赖 `pytesseract` 与系统 Tesseract；图片高度允许最多 6 像素的安全底边差异，宽度仍严格校验。
- Digital 每日最多选择两篇，第三个独立主题记录在 `omitted_due_to_cap`，不进入写作调用。
- 通用章节名和粗体章节名在本地按 `article_mode` 转为三种文章合同，不消耗模型修订次数。
- `11 percent` 与 `11%` 按同一数字处理；限定词只绑定其邻近数字，`over the last 35 years` 不再误判为“超过35年”。
- 模型自带的“忠实摘译”区会被本地规范摘译卡替换，避免重复段落。
- Dify 首审若精确指出无证据或虚构整句，本地只删除被引用的整句并复审，不调用第二次模型重写；其他类型问题仍按原质量门拒绝。
- `2026-07-17` 历史干跑结果为 `partial_success`：一篇 `faithful_translation` 得分 99 并通过微信预检；一篇 `event_brief` 因剩余来源证据不足被拒绝。干跑未创建公众号草稿。

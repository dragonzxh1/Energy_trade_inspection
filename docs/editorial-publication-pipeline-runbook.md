# 编辑判断、文章与发布运行手册

## 输入边界

写作节点只接收：

- 已通过本地审计的 `EditorialView`；
- 主线与反向信号的代表性已验证事实；
- 能由这些事实完整追溯的少量指标；
- `source_id` 到产品或刊物标题的映射；
- 最多三段忠实摘译候选。

禁止发送完整 PDF、Telegram 评论、未验证事实、低置信度 OCR 数字、历史完整日报以及与主线无关的信号列表。

## Dify 应用隔离

- `DIFY_WORKFLOW_API_KEY_EXTRACT`：章节事实提取。
- `DIFY_WORKFLOW_API_KEY_WRITER`：证据约束下的中文文章写作。
- `DIFY_WORKFLOW_API_KEY_REVIEW`：独立终审与一次修订。
- `DIFY_WORKFLOW_API_KEY_AGGREGATE`：仅供 legacy 日报使用。

写作应用不得复用提取应用的系统角色。三条链路可以使用同一底层模型，但提示词、密钥和调用记录必须隔离。

## 运行

```bash
.venv-intelligence/bin/python \
  -m intelligence.market_pipeline.publication_worker \
  --date 2026-07-10
```

- `shadow`：保存到 `reports/digit/<market_date>/`，不创建微信草稿。
- `review`：质量门通过后只创建草稿。
- `active`：进入现有微信自动发布状态机。
- `--historical`：只保存本地稿，不计入上线观察天数，也不自动群发。
- 无唯一主线：只保存中文本地记录，不调用写作、终审或微信接口。

日期目录包含 `index.json`、`daily-index.md`、`daily-index_wechat.html` 和最多三组
`<ordinal>-<slug>.md` / `<ordinal>-<slug>_wechat.html`。`index.json` 只允许本地审计和
Dify 审校均为 `pass` 的主题进入发布；worker 逐篇调用
`wechat_publish --stream digit --article-slug <slug>`，单篇失败记录为 `publish_failed`，
后续主题仍继续处理。

## 独立定时任务

```bash
scripts/cron-runner.sh digit-publish
```

- 默认市场日期为新加坡时间昨日；补跑用 `ETI_MARKET_DATE=2026-07-10` 覆盖。
- 使用 `/tmp/eti-digit-publish.lock` 和 `/var/log/eti/digit-publish.log`。
- 日志逐篇包含 `stream=digit`、`market_date`、`article_slug`、`action`、`result`。
- `MARKET_PIPELINE_MODE=shadow` 只生成/检查 index；`review` 逐篇建草稿；`active` 逐篇进入现有 `auto` rollout。
- `MARKET_PIPELINE_MODE=off` 时 cron 成功跳过，不生成或发布 Digit。
- `ETI_PUBLISH_DRY_RUN=1` 会向 worker 传递 `--dry-run`；无论 `review`、`active` 或 `ETI_HISTORICAL=1`，有效动作均固定为 `draft`，逐稿只调用 `wechat_publish --dry-run`，绝不访问微信 API、写草稿状态或更新 rollout。
- 非 dry-run 的历史任务在 `review` / `active` 下固定为草稿；在 `shadow` 下仍只保存 `shadow_saved`，日志不会误写成草稿动作。
- Summary 使用独立任务、锁和日志；Digit 失败不会阻断 Summary，反之亦然。

日志固定区分 `pipeline_mode`、`requested_action`、`effective_action`、`dry_run` 和逐稿 `result`。
本地无数据库凭据时，使用受控 fixture E2E；产物明确标识为非生产事实：

```powershell
$env:ETI_FIXTURE_E2E_OUTPUT='reports/fixture-e2e'
python -m unittest `
  intelligence.test_cron_publication_tasks.DigitFixtureE2ETests.test_fixture_repository_writes_real_digit_artifacts_and_dry_run_index -v
```

## 文章生成规则

- 正文只使用主线和反向信号能直接支持的代表性事实。
- 原文摘译必须逐字引用 1–3 段输入原文，再给出忠实中文翻译。
- 数字表达保持原样，不换算、不四舍五入：`40 million` 不改为 `4,000万`，`67,000 b/d` 不改为 `6.7万桶/日`。
- 必须保留英语句子的主体、宾语和因果关系。
- 文章包含：今日结论、原文摘译、市场传导、反向信号与风险、下一交易日验证、资料。
- 仓库统一补齐文章标题并把栏目改为二级标题，Dify 不控制最终 HTML。
- “资料”只列产品或刊物标题，不列附件文件名和路径。

## 双重质量门

1. 判断卡必须具有唯一主线、反向信号、失效条件和至少三个验证指标。
2. 本地审计拒绝新数字、文件名、内部 ID、`<think>`、AI 相关措辞、栏目缺失和未逐字引用原文。
3. Dify 终审总分必须不低于 85，且 `blocking_issues` 为空。
4. 全链路最多自动修订一次；再次发现问题时保留本地稿并拒绝发布。
5. HTML 始终由 `markdown_to_report_html` 生成。

## 审校证据大小

Dify 单个 `extractions` 输入上限为 100,000 字符。仓库会生成少于 98,000 字符的审校证据，只保留：

- 判断卡核心字段；
- 文章实际可引用的事实与证据原句；
- 原文摘录；
- 相关来源标题。

不会截断证据原句，也不会为了满足长度限制丢弃文章已引用的事实。

## 验证

```bash
python -m unittest intelligence.test_editorial_article
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f db/validation/051_editorial_articles.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f db/validation/056_pipeline_readiness_states.sql
```

## 审校口径：事实硬门与观点披露

- 日期、数字、单位、事实证据、来源归属、实质性误译、危险 HTML 与内部文件泄露仍为阻断项。
- 缺少逐字原文摘录、反向信号、主题失效条件或三项验证指标不再单独拒稿；文章必须以来源标题归因，并在“反向信号与风险”或“下一交易日验证”说明证据缺口。
- Dify 审校工作流必须把上述观点完整度项目作为 `advisory_only`，不得写入 `blocking_issues`；模型不得以此补造反向事实、数字或来源。

## 回滚

优先设置 `MARKET_PIPELINE_MODE=shadow`，并从 `WECHAT_CONTENT_STREAMS` 移除 `digit`。
调度回滚不依赖恢复旧 installer，也不手工猜测 marker；必须使用部署前 crontab 快照：

```bash
crontab /absolute/backup/path/crontab.before
```

生产调度必须通过 `ETI_CRON_RUNNER=/usr/local/lib/eti-cron/cron-runner.sh` 指向 root 管理、目录不可被
其他用户写入的 runner 安全副本。若 `sudo -n install` 无法创建该副本，应恢复 `crontab.before`，不保留
新增 Digit cron。

历史补跑使用：

```bash
ETI_MARKET_DATE=2026-07-10 ETI_HISTORICAL=1 \
  scripts/cron-runner.sh digit-publish
```

历史模式在非 shadow、非 dry-run 时最多创建草稿且不计入 rollout；加
`ETI_PUBLISH_DRY_RUN=1` 时只写预览。禁止自动群发。只有业务实现本身需要回退时才恢复上一版
`article.py`、`article_review.py`、`editorial.py` 和 `publication_worker.py`。当前版本要求独立配置
`DIFY_WORKFLOW_API_KEY_WRITER`；缺失时直接失败，不会复用提取应用。

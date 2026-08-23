# 每日价格融合与公众号发布运行手册

## 运行原则

- `market_date` 来自 FuelSight 回复标题或 Platts Summary 图片标题，不使用请求时间、Telegram 消息时间或文件名替代。
- 机器人回复可能晚到数日；系统按标题日期归档，并只与相同 `market_date` 的图片结果融合。
- 日报允许等待至下一个交易日新加坡时间 18:00。截止前为 `waiting_for_prices`，不创建草稿且不更新 rollout；截止后仍无价格则以 `ready_without_prices` 发布正文，不显示空价格区块。
- 价格附录在 Dify 终审完成后由本地代码确定性追加，不再发送给 Dify 修改。
- weekly、monthly 不运行价格链路；历史任务只允许草稿，不计入 rollout，也不自动群发。

## 配置

生产默认设置：

```bash
DAILY_PRICE_MODE=shadow
DAILY_PRICE_ROOT=/var/www/eti/obsidian-vault/reports/prices
WECHAT_CONTENT_STREAMS=summary,digit
```

Summary 协调命令必须显式传入 `--reports-root "$OBSIDIAN_VAULT/reports"`。`summary-publish`
会在调用任何 Python 步骤前规范化路径，并校验 `DAILY_PRICE_ROOT.parent` 与
`OBSIDIAN_VAULT/reports` 相同；不一致时任务非零退出，且不生成预览或调用发布器。

可选模式：

- `off`：完全不读取或创建价格目录。
- `shadow`：生成候选、融合、选择和放行状态，但不修改日报正文。
- `append`：仅在 `ready_with_prices` 时追加价格区块并重渲染 WeChat HTML；`ready_without_prices` 时保持正文版。

Telegram 采集还需要 `TELEGRAM_API_ID`、`TELEGRAM_API_HASH`、`TELEGRAM_SESSION_FILE`。采集器复制 SQLite session 后读取，禁止直接占用长期 collector 的 session。

## 三个采集窗口

工作日使用 `Asia/Singapore` 时区：

```text
10:30 morning
14:30 afternoon
18:30 evening
18:40 reconcile pending
18:45 summary reconcile + publish task
```

18:40 的 `price-reconcile` 只协调最近 7 日价格状态，绝不调用微信发布器。
18:45 的 `summary-publish` 是当天 Summary 唯一自动发布入口；先 reconcile 当天，再进入
Summary 质量门和发布器。`pending_wechat_publish` CLI 仅保留给人工补偿，不进入任何 cron。

`summary-publish` 使用 `/tmp/eti-summary-publish.lock`，先对当天新加坡市场日期执行
`daily_prices reconcile`，再调用 `wechat_publish --stream summary`。`DAILY_PRICE_MODE=shadow`
或 `ETI_PUBLISH_DRY_RUN=1` 时强制 `draft --dry-run`，只写预览；`append` 才读取
`WECHAT_MP_AUTO_MODE`。该任务与 Digit 使用不同 cron、锁和日志，任一失败不阻断另一条流。

- `DAILY_PRICE_MODE=off`：价格采集、协调和 Summary 自动发布均跳过。
- `ETI_HISTORICAL=1`：Summary 有效动作固定为 `draft`；如同时 dry-run，则只写本地预览。
- 人工补偿命令必须单独执行并避开 18:40–18:45 自动窗口：

```bash
python -m intelligence.pending_wechat_publish --lookback-days 7 --action draft
```

手动采集示例：

```bash
python -m intelligence.fuelsight_prices fetch \
  --slot morning \
  --requested-at 2026-07-14T10:30:00+08:00
```

FuelSight 的 capture、snapshot、`bot_candidates.json`，OCR 晋级结果、融合产物和公众号等待门必须共用同一个 `DAILY_PRICE_ROOT`。不得让机器人写仓库 `reports/prices`、日报却读取 Obsidian 目录。

每次 cron 采集成功后，会先把相同市场日期最新的 `/eu` 与 `/apag` snapshot 原子物化为 `bot_candidates.json`，立即执行该日期 reconcile，再执行最近 7 日待办协调：

```bash
python -m intelligence.daily_prices reconcile-pending --lookback-days 7
```

- 本轮两个命令都没有形成有效 snapshot 时，FuelSight 命令返回非零，cron 写失败日志且不报告完成。
- `/eu` 或 `/apag` 只有一个成功时允许降级物化该单源，等待后续窗口补齐另一来源。
- `reconcile-pending` 严格读取 `DAILY_PRICE_MODE`：`off` 不运行协调，`shadow` 只刷新价格产物，只有 `append` 可以改写未发布 Markdown/HTML。
- `append + ready_without_prices` 会删除旧价格附录并重新渲染正文版 HTML。

已正式发布的日期只更新 `reports/prices/<market_date>/` 本地档案，不改写已发布 Markdown/HTML。未发布文章在获得同日期价格后可被补全。

## 日报命令

```bash
python -m intelligence.daily_report --date 2026-07-10 --price-mode off
python -m intelligence.daily_report --date 2026-07-10 --price-mode shadow
python -m intelligence.daily_report --date 2026-07-10 --price-mode append
```

手动重新物化机器人候选：

```bash
python -m intelligence.daily_prices materialize-bot --date 2026-07-10
python -m intelligence.daily_prices reconcile --date 2026-07-10 \
  --reports-root "$OBSIDIAN_VAULT/reports"
```

OCR 不会自动寻找 `latest` 或扫描试验目录。只有人工确认过的 trial result 才能显式晋级：

```bash
python -m intelligence.daily_prices promote-image \
  --date 2026-07-10 \
  --trial-result /absolute/path/to/approved-trial-result.json \
  --source-image /absolute/path/to/immutable-source.jpg
python -m intelligence.daily_prices reconcile --date 2026-07-10 \
  --reports-root "$OBSIDIAN_VAULT/reports"
```

trial result 的 `market_date_source` 必须是 `image_title`，日期必须与 `--date` 完全一致，原图 SHA-256 必须与 trial result 一致。即使 OCR 没有形成可公开数字，也会写入空 `image_candidates.json` 表示 Summary 已到达，并允许同日完整 `/eu`、`/apag` 作为 `bot_only` 兜底；日期、哈希或结构错误仍失败关闭。

价格产物位于：

```text
reports/prices/<market_date>/image_candidates.json
reports/prices/<market_date>/bot_candidates.json
reports/prices/<market_date>/fusion.json
reports/prices/<market_date>/selected_prices.json
reports/prices/<market_date>/release_state.json
reports/prices/<market_date>/review.json
reports/prices/<market_date>/public_reference.png
reports/summary/<market_date>.md
reports/summary/<market_date>_wechat.html
reports/summary/quality/<market_date>.json
```

Summary 正文只能包含按区域分组的价格表；质量门检查市场日期、公开 benchmark、数字可解析性、
涨跌颜色和禁用分析栏目。它不读取 Digit 的本地审计或 Dify 审校文件。

`release_state.json` 的主要状态：

- `waiting_for_prices`：正常等待，不是失败。
- `ready_with_prices`：正文和价格均可用。
- `ready_without_prices`：等待截止，允许正文版发布。
- `published`：已经完成发布，只保留归档补全。

## 二维码与正文图片

- 官方二维码固定为仓库根目录 `qrcode_for_gh_f8b242c5263e_344.jpg`。
- 原始 Platts 图片不可修改；公开图只覆盖配置的宣传 ROI，输出无损 `public_reference.png`。
- 服务器需安装 `fonts-noto-cjk`，否则公开图中文字体校验会失败关闭。
- 发布前通过微信 `/cgi-bin/media/uploadimg` 上传正文图片，最终 HTML 只允许使用微信返回的 HTTPS URL；禁止本地路径、base64 和占位 token。

## 发布等待门

```bash
python -m intelligence.wechat_publish \
  --stream summary --date 2026-07-10 --action draft --dry-run
```

- `waiting_for_prices`：普通非 `--preflight` 调用成功返回 `skipped=true`，不建草稿、不清零或增加 rollout；`summary-publish` cron 在 `shadow`/dry-run 下固定传入 `--preflight`，同一状态必须非零退出并记录 `failed`，表示“预检尚未放行”，不是已创建草稿。
- “无可发布新闻”优先于价格附录：即使 `ready_with_prices`，仍只保存本地价格版文章，不创建公众号草稿。不得为了验证图片上传而强行绕过此门。
- `ready_with_prices`：继续现有本地审计与 Dify 终审双质量门。
- `ready_without_prices`：继续正文版发布，不生成空价格区块。
- `--historical --action draft`：显式绕过等待门，但仍不增加 rollout，且不得正式发布。
- 历史模式即使误传 `--action publish` 或 `--action auto` 也会强制归一为 `draft`。
- 当 `DAILY_PRICE_MODE` 为 `shadow` 或 `append` 且缺少 `release_state.json` 时，普通非 `--preflight` 调用以 `price_release_state_missing` 成功跳过，不绕过等待门；cron 的 shadow/dry-run `--preflight` 对该状态非零退出并记录 `failed`。只有显式 `off` 允许无状态继续。
- 已成功 publish 的终态复用不再重复写 rollout `published` history。
- weekly/monthly 不检查、不上传且不注入 daily `public_reference.png`。

## 故障恢复

1. 采集超时或锁冲突：查看 `/var/log/eti/fuelsight-prices-<slot>.log`，下一窗口会重试；不要删除长期 Telegram session。
2. 协调失败：查看 `/var/log/eti/price-reconcile.log`，手动运行 `python -m intelligence.daily_prices reconcile-pending --lookback-days 7`。
3. 候选文件缺失：`release_state.json` 和 `review.json` 会记录 `image_artifact_missing` 或 `bot_artifact_missing`；reconcile 不会伪造空的正式候选文件。
4. 日期不一致：保留各自归档，不跨日期融合；等待对应日期另一来源。
5. 图片上传失败：结构化价格区块保留，参考图省略并记录 warning。
6. Summary cron 非零：先区分 `--preflight` 的未放行（`waiting_for_prices`、`price_release_state_missing` 或 preview issues）与真实微信 API 失败；前者应修复/等待 release state 后重跑，不能按“普通跳过成功”消警。查看 `/var/log/eti/summary-publish.log` 中的 `stream`、`market_date`、`article_slug`、`action`、`result`；Digit cron 不受影响。
7. 需要立即停用：设置 `DAILY_PRICE_MODE=off`，并从 `WECHAT_CONTENT_STREAMS` 移除 `summary`；不删除价格根目录中的审计证据。

`setup-crontab.sh` 只替换末尾 `# BEGIN ETI MANAGED TASKS` / `# END ETI MANAGED TASKS`
完整块。块外所有非 ETI 行、`CRON_TZ` 顺序及重复行保持不变。部署回滚必须使用部署前保存的
`crontab.before`：

```bash
crontab /absolute/backup/path/crontab.before
```

生产 crontab 不得执行位于可被非 root 用户改写目录中的脚本。先安装 root 管理的安全副本，再用
`ETI_CRON_RUNNER` 生成 ETI block：

```bash
sudo -n install -d -o root -g root -m 0755 /usr/local/lib/eti-cron
sudo -n install -o root -g root -m 0755 scripts/cron-runner.sh scripts/setup-crontab.sh /usr/local/lib/eti-cron/
ETI_CRON_RUNNER=/usr/local/lib/eti-cron/cron-runner.sh bash scripts/setup-crontab.sh
namei -l /usr/local/lib/eti-cron/cron-runner.sh
```

若无法建立不可被其他用户写入的安全路径，恢复 `crontab.before`，不要保留新增 ETI cron。

## 历史回放

```bash
python -m intelligence.daily_report \
  --date 2026-07-10 --skip-extract --skip-translate \
  --local-only --skip-review --price-mode append

python -m intelligence.wechat_publish \
  --stream summary --date 2026-07-10 --action draft --historical

ETI_MARKET_DATE=2026-07-10 ETI_HISTORICAL=1 \
  scripts/cron-runner.sh summary-publish
```

历史回放必须核对市场日期、价格单位、正负号、公开图二维码和 `draft/get` 回读结果；禁止调用正式发布接口。

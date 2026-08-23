# Summary 与 Digital 独立采集及每日多图文编组

## 内容流边界

- `summary` 只采集 `@quotes_summary` 图片，使用独立服务、Telegram 会话副本、游标和健康状态。
- `digital` 只采集 `@platts_digits` 文档，使用独立服务、Telegram 会话副本、游标和健康状态。
- 群组没有在某一天发布内容属于正常状态，不构成采集异常。
- 健康检查只判断采集器是否持续成功轮询，不使用“当天是否收到消息”作为健康标准。

## systemd 服务

```bash
systemctl status eti-telegram-ingest-summary.service
systemctl status eti-telegram-ingest-digital.service
systemctl status eti-telegram-collector-health.timer

journalctl -u eti-telegram-ingest-summary.service -f
journalctl -u eti-telegram-ingest-digital.service -f
```

旧的 `eti-telegram-ingest.service` 在安装脚本执行后保持禁用。

健康检查：

```bash
.venv-intelligence/bin/python -m intelligence.telegram_collector_health
```

只在轮询超过十分钟未更新或连续三次失败时告警。Summary 没有新图、Digital 没有新 PDF 均不会告警。

## 游标与失败恢复

- Summary 游标：`tmp/telegram/state_quotes-summary.json`
- Digital 游标：`tmp/telegram/state_platts-digits.json`
- 单条消息处理失败时不推进该消息游标。
- 两条内容流分别重启；一条异常不会停止另一条。
- 安装时从已有授权会话复制两个独立 SQLite 会话文件，避免并发锁冲突。

## 每日多图文发送

Summary 与 Digital 始终独立成稿和审校。`wechat_bundle` 只在最后发布准备阶段读取已经通过微信草稿回读的组件：

```bash
python -m intelligence.wechat_bundle --date 2026-07-24 --action draft
```

规则：

- Digital 文章排在前面，Summary 价格图片排在最后。
- 任一内容流缺席时，另一条仍可独立形成发送候选。
- 没有合格文章时返回 `no_components`，不创建空草稿。
- 最多编组八篇。
- `review` 模式只创建草稿，不群发。
- `active` 模式仍默认只创建草稿；只有显式设置 `WECHAT_BUNDLE_AUTO_PUBLISH=1` 才允许提交发布。
- 每天新加坡时间 `09:15` 编组前一市场日内容。

微信官方接口不支持一次提交多个独立草稿 `media_id`。系统会在发布准备阶段把独立文章复制到一个临时 `articles[]` 发布包，获得一个新的 `media_id`，再以一次发布调用发送；这不会改变各文章独立的事实、审校和归档状态。

## 安装与回滚

安装：

```bash
sudo bash scripts/install-telegram-collectors.sh
sudo install -m 0755 scripts/cron-runner.sh /usr/local/lib/eti-cron/cron-runner.sh
sudo env ETI_CRON_RUNNER=/usr/local/lib/eti-cron/cron-runner.sh bash scripts/setup-crontab.sh
```

回滚：

```bash
sudo systemctl disable --now eti-telegram-ingest-summary.service
sudo systemctl disable --now eti-telegram-ingest-digital.service
sudo systemctl disable --now eti-telegram-collector-health.timer
sudo systemctl enable --now eti-telegram-ingest.service
```

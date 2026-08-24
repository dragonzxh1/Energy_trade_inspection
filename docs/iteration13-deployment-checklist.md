# 迭代 13 部署清单

## 部署前

- 记录 `git rev-parse HEAD` 和工作区变更摘要。
- 确认 `MARKET_PIPELINE_MODE=review`，不得为 `active`。
- 确认 `DAILY_PRICE_MODE=append`，并确认 `/eu`、`/apag` 三个采集时段存在。
- 备份生产脚本、相关 Python 模块及 7 月 15–17 日报告目录。
- 记录已应用数据库迁移版本；本迭代不新增迁移。

## 验证

- 使用 `scripts/test-intelligence.sh` 执行完整回归；该入口会隔离 Obsidian 目录并关闭真实通知。
- 运行 `bash -n scripts/cron-runner.sh` 和 `bash -n scripts/setup-crontab.sh`。
- 回放 7 月 15–17 日，记录主题数、合并结果、翻译审校、草稿ID和拒绝原因。
- 检查 `pipeline_status.json` 的 `complete|partial_success|failed|archive_only`。
- 检查 Summary `release_state.json` 的缺失基准、最后采集和下次重试时间。
- 重复回放一次，确认不增加重复草稿。

## 回滚

- 恢复部署前 Python 和 shell 脚本备份。
- 恢复原 systemd/cron 配置并执行 `systemctl daemon-reload`。
- 保持 `MARKET_PIPELINE_MODE=review`；不删除已生成的事实、审校记录和草稿追溯文件。

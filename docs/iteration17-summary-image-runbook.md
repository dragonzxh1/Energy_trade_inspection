# 迭代 17：Summary 图片草稿运行手册

## 目标

Summary 与 Digital 为两条独立内容流。Summary 只读取图片顶部标题中的市场日期，不解析价格表，不依赖 FuelSight 机器人，不调用 Dify。

```text
Telegram 图片 → 标题日期共识识别 → 固定 ROI 替换二维码
→ 上传微信正文图片 → 创建草稿 → draft/get 回读
```

生产保持：

```text
MARKET_PIPELINE_MODE=review
```

该模式只创建公众号草稿，不自动群发。

## 调度

时区固定为 `Asia/Singapore`：

| 时间 | 任务 |
| --- | --- |
| 04:00 | 结构化日级流水线 |
| 06:30 | Digital 待发布日期扫描与写稿 |
| 08:30 | Telegram 第一轮采集 |
| 13:00 | Telegram 第二轮采集 |
| 18:30 | Telegram 第三轮采集 |
| 18:45 | Summary 图片待办处理 |

文章解析与写作不会在 `09:00–12:00` 或 `14:00–18:00` 启动。
多图文合并任务不自动运行，避免与两条独立草稿流重复建稿。

常驻 Telegram collector 必须停用，避免与三轮 `--once` 采集重复：

```bash
sudo systemctl disable --now eti-telegram-ingest-digital.service
sudo systemctl disable --now eti-telegram-ingest-summary.service
sudo systemctl disable --now eti-telegram-collector-health.timer
```

## 手工命令

本地单图验证，不调用微信：

```bash
python -m intelligence.summary_image_worker \
  --source /path/to/summary.jpg \
  --dry-run \
  --action draft
```

处理最近 14 天待办并创建草稿：

```bash
python -m intelligence.summary_image_worker \
  --pending \
  --lookback-days 14 \
  --max-images 20 \
  --action draft
```

停止历史回放时可设置市场日期下限：

```text
SUMMARY_IMAGE_START_DATE=2026-07-25
DIGIT_PUBLISH_START_DATE=2026-07-25
```

该限制按图片或文档中的市场日期判断，不使用下载日期替代。

Digital 独立扫描所有待建稿日期：

```bash
python -m intelligence.market_pipeline.digit_publication_scheduler \
  --through-date 2026-07-27 \
  --lookback-days 14 \
  --max-dates 10
```

## 日期识别

- 仅裁剪图片顶部 12%。
- 使用灰度、二值化两种图像和 `PSM 7/6/11`。
- 只接受 `PLATTS SUMMARY <Month> <Day>, <Year>`。
- 至少两次识别为同一合法日期才通过。
- 不使用 Telegram 时间、文件名或下载日期回退。
- 日志只保存匹配后的标题短句，不保存价格表 OCR 文本。

失败原因：

```text
IMAGE_DECODE_FAILED
MARKET_DATE_NOT_FOUND
MARKET_DATE_CONFLICT
MARKET_DATE_INVALID
```

## 图片与微信校验

- 固定修改区域为 `(932, 344, 1280, 524)`。
- ROI 外像素必须完全一致。
- 替换后的二维码必须能解码为配置的公众号地址。
- 正文图片必须通过微信正文图片接口上传。
- `thumb_media_id` 只作为封面，不能替代正文 `<img>`。
- `draft/get` 必须核对标题、作者、市场日期、正文图片和正文哈希。

幂等键：

```text
summary-image:<market_date>
```

同日同图直接复用；同日不同图进入人工复核，不自动覆盖。

## 通知

只通知：

- 草稿回读成功；
- 日期需要人工确认；
- 同日出现不同图片；
- 微信上传、建稿或回读失败。

正常采集、正常排队、重复图片和普通重试不通知。Dry-run 不发送草稿成功通知。

## 回滚

1. 恢复上一版 `cron-runner.sh` 和 `setup-crontab.sh`。
2. 执行 `db/rollbacks/063_summary_image_draft_closure.down.sql`。
3. 如需临时恢复旧 collector，仅启动一个调度体系，禁止 cron 与常驻服务并行。
4. 保持 `MARKET_PIPELINE_MODE=review`，回滚期间不得切换为 `active`。

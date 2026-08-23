# ETI 微信公众号自动发布 Runbook

## 目标

在日报生成完成后，自动产出适合微信公众号的正文 HTML，并在配置齐全时自动创建草稿或直接发布。

当前链路已经具备以下能力：

- 每日 cron 先生成日报正文与 WeChat HTML
- 将“今日价格速览”渲染为适合移动端的分地区块级卡片，不使用表格、外部样式或脚本
- 在参考图存在时，通过微信公众号正文图片接口上传后再注入微信托管的 HTTPS 地址
- 自动输出发布预览文件与公众号 API payload
- 发布前自动检查质量审计结果
- 配置齐全后可使用 `auto` 完成三天影子草稿验证，再自动进入正式发布

## 配置文件

本地或服务器上使用：

- `intelligence/wechat_publish.json`

示例内容：

```json
{
  "account_id": "",
  "appid": "",
  "appsecret": "",
  "author": "ETI",
  "content_source_url": "",
  "default_thumb_media_id": "",
  "thumb_image_path": "",
  "auto_generate_thumb": true,
  "thumb_upload_type": "image",
  "need_open_comment": 0,
  "only_fans_can_comment": 0,
  "auto_mode": "auto",
  "shadow_publish_days": 3,
  "publish_poll_seconds": 8,
  "publish_poll_attempts": 15
}
```

说明：

- `account_id`：公众号原始 ID（例如 `gh_...`），用于预检时确认目标账号，不参与 API 鉴权
- `appid`：微信公众号 AppID
- `appsecret`：微信公众号 AppSecret
- `default_thumb_media_id`：已上传封面的永久素材 ID
- `thumb_image_path`：本地封面图路径；如果不填 `default_thumb_media_id`，可以改填这个
- `auto_generate_thumb`：没有指定封面时，按日期自动生成 ETI 日报封面
- `thumb_upload_type`：封面素材上传类型，默认使用永久图片素材 `image`
- `auto_mode`：`off` / `auto` / `draft` / `publish`
- `shadow_publish_days`：自动模式下只建草稿的连续可发布日数量，默认 `3`

在没有真实凭据前，保持空字符串即可，脚本会停在预检阶段，不会误发。

## 环境变量

也可以用 `.env.local` 覆盖：

```bash
WECHAT_MP_CONFIG=intelligence/wechat_publish.json
WECHAT_MP_ACCOUNT_ID=
WECHAT_MP_APP_ID=
WECHAT_MP_APP_SECRET=
WECHAT_MP_AUTHOR=ETI
WECHAT_MP_CONTENT_SOURCE_URL=
WECHAT_MP_DEFAULT_THUMB_MEDIA_ID=
WECHAT_MP_THUMB_IMAGE_PATH=
WECHAT_MP_AUTO_GENERATE_THUMB=1
WECHAT_MP_THUMB_UPLOAD_TYPE=image
WECHAT_MP_NEED_OPEN_COMMENT=0
WECHAT_MP_ONLY_FANS_CAN_COMMENT=0
WECHAT_MP_AUTO_MODE=auto
WECHAT_MP_SHADOW_PUBLISH_DAYS=3
WECHAT_MP_PUBLISH_POLL_SECONDS=8
WECHAT_MP_PUBLISH_POLL_ATTEMPTS=15
WECHAT_CONTENT_STREAMS=summary,digit
```

推荐做法：

- 默认把敏感信息放 `.env.local`
- `intelligence/wechat_publish.json` 只保留结构和默认值

## 每日产物

双流执行后会生成：

- `reports/summary/<date>.md`
- `reports/summary/<date>_wechat.html`
- `reports/summary/quality/<date>.json`
- `reports/digit/<date>/index.json`
- `reports/digit/<date>/<slug>.md`
- `reports/digit/<date>/<slug>_wechat.html`
- `reports/digit/<date>/quality/<slug>.json`
- `reports/digit/<date>/quality/<slug>_llm_review.json`
- `reports/wechat_publish/summary/<date>_draft_{preview.html,payload.json}`
- `reports/wechat_publish/digit/<date>_<slug>_draft_{preview.html,payload.json}`

如果真实调用成功，还会额外写入：

- `reports/wechat_publish/summary/<date>_<action>.json`
- `reports/wechat_publish/digit/<date>_<slug>_<action>.json`

## 手动检查

只做预演，不访问公众号接口：

```bash
python -m intelligence.wechat_publish \
  --stream summary --date 2026-07-10 --action draft --dry-run

python -m intelligence.wechat_publish \
  --stream digit --date 2026-07-10 --article-slug 01-crude-supply \
  --action draft --dry-run
```

做完整预检，检查配置缺口：

```bash
python intelligence/wechat_publish.py --date 2026-07-05 --action draft --preflight
```

查看单日报健康状态：

```bash
python scripts/report-pipeline-health.py --date 2026-07-05 --format markdown
```

## 自动发布模式

新内容使用两个互不串联的任务：

```bash
scripts/cron-runner.sh summary-publish
scripts/cron-runner.sh digit-publish
```

`summary-publish` 在工作日 18:45 运行，先 reconcile 同一市场日期，再发布纯表格稿；
`digit-publish` 每日 08:45 运行 publication worker，并按 `index.json` 逐篇处理通过主题。
两者分别使用 `/tmp/eti-summary-publish.lock`、`/tmp/eti-digit-publish.lock`，日志分别为
`/var/log/eti/summary-publish.log`、`/var/log/eti/digit-publish.log`。

行为规则：

- `off`：任务成功跳过，不生成预览、payload、草稿或发布。
- Summary 在 `DAILY_PRICE_MODE=shadow` 时强制 dry-run，只生成预览和 payload；显式
  `ETI_PUBLISH_DRY_RUN=1` 具有相同的无 API 语义。
- Digit 在 `MARKET_PIPELINE_MODE=shadow` 且未显式 dry-run 时只保存本地产物，状态保持
  `shadow_saved`；显式 `ETI_PUBLISH_DRY_RUN=1` 时才逐篇生成微信预览和 payload。
- `auto`：前三个连续通过的可发布日只建草稿，第 4 个通过日开始正式发布
- `draft`：自动进公众号草稿箱
- `publish`：自动发起发布
- 当质量文件标记 `publishable=false` 时，仅保留本地日报记录，公众号步骤正常跳过
- 无新闻日不计入也不打断影子计数；任一可发布日审校失败会把计数清零
- 历史补跑必须加 `--historical`：在 `shadow` 下只保存本地产物；在 `review` / `active` 下有效动作
  强制为 `draft`；与 dry-run 同时使用时仅生成预览和 payload。所有历史任务都不改变影子计数。
- `WECHAT_CONTENT_STREAMS` 可单独关闭 `summary` 或 `digit`，不删除产物和状态。
- 生产默认 `WECHAT_CONTENT_STREAMS=summary,digit`，不包含 `legacy`；此时 06:30
  `daily-intelligence` 不调用任何 legacy 微信入口。
- 只有显式加入 `legacy` 才允许旧入口；只要 `DAILY_PRICE_MODE=shadow` 或
  `MARKET_PIPELINE_MODE=shadow`，legacy 有效动作强制为 `draft --dry-run`，无真实 API 调用。
- `price-reconcile` 只协调价格，不调用 pending publisher；当天 Summary 只由 18:45 任务发布。
- Summary 只检查自己的确定性质量文件；Digit 每篇同时要求本地审计和 Dify 审校通过。
- 任一任务失败只返回自己的非零状态；Digit 单篇失败不会停止同日其他通过主题。

安全 dry-run：

```bash
ETI_MARKET_DATE=2026-07-10 ETI_PUBLISH_DRY_RUN=1 \
  scripts/cron-runner.sh summary-publish
ETI_MARKET_DATE=2026-07-10 ETI_PUBLISH_DRY_RUN=1 \
  scripts/cron-runner.sh digit-publish
```

Digit dry-run 在任意 pipeline mode 和 historical 组合下都把有效动作固定为 `draft` 并向每篇
`wechat_publish` 透传 `--dry-run`；日志同时记录 `pipeline_mode`、`requested_action`、
`effective_action` 与 `dry_run=true`。`MARKET_PIPELINE_MODE=off` 或流未启用时直接跳过。

历史价格稿建议显式执行：

```bash
python -m intelligence.wechat_publish \
  --stream summary --date 2026-07-10 --historical --action draft
```

## 价格与正文参考图

- 结构化价格 Markdown 固定插入 `参考资料` 或 `参考范围` 之前；重复处理不会生成第二个价格区块
- 涨跌值始终显示正负号，微信正文按地区分组，并用“涨跌”文字与符号共同表达方向
- 正文参考图使用 `/cgi-bin/media/uploadimg` 上传，草稿 payload 只接受接口返回的 HTTPS 地址
- 正文图上传失败时仅省略参考图并记录 warning，结构化价格与其余正文继续创建草稿
- 创建草稿前会解析全部 `<img src>`：预期无图时禁止任何图片，预期有图时每个 `src` 都必须精确等于本次上传返回的 HTTPS 地址
- 短正文 fallback、dry-run payload 和 `draft/get` 回读使用同一图片来源检查，拒绝相对路径、本地路径、HTTP、base64 和未授权 HTTPS 地址
- 草稿指纹使用源参考图是否存在及其 SHA-256，不使用微信返回的易变 URL；源图变化会使旧草稿失效
- 上传失败草稿记录 `upload_failed`，下次运行必须重试；只有 `uploaded_verified` 且源图状态一致的草稿可以复用
- 上传失败但已经成功正式发布的结果属于终态；非 `--force` 重跑只返回 skipped，不再创建草稿或重复发布
- `--verify-existing` 从持久化结果恢复图片 URL、源图 SHA-256 和验证状态；预期有图但缺少已验证 URL 时直接失败

## 结构化流水线状态回写

- `shadow` 不调用微信接口，文章状态保持 `shadow_saved` 或 `archive_only`。
- `review` 创建并回读草稿成功后，`published_articles.publication_status` 必须更新为 `draft_created`，并保存 `media_id`。
- `active` 正式发布成功后，状态更新为 `published`，并保存 `publish_id`。
- 微信调用、草稿回读、输出解析或数据库回写任一步失败，状态更新为 `publish_failed`，任务非零退出。
- `is_historical=true` 的草稿不进入 shadow/review 上线计数。
- 本地审计与 `quality/<date>_llm_review.json` 均通过后才允许创建草稿或发布
- `draft` / `publish` 模式下，只要微信接口或流水线健康检查失败，cron 任务会返回非零状态，不会误记为成功

成稿结构采用“核心判断—关键事实—深度拆解—市场传导—情景推演—验证清单—参考资料”。正文不展示附件文件名或逐条来源，文末仅列刊物或数据产品名称。

## 上线前检查清单

切到真实发布前，至少确认：

- 已填写 `appid` 与 `appsecret`
- 已配置 `default_thumb_media_id` 或 `thumb_image_path`
- 公众号后台已放行服务器出口 IP
- 对应日期本地质量文件和 LLM 审校文件均为 `pass`
- 先用 `--preflight` 跑通一次
- 先把 `auto_mode` 设成 `draft`，不要直接上 `publish`

## 推荐上线顺序

1. 填入真实配置后执行一次 `--preflight`
2. 把 `auto_mode` 设为 `auto`
3. 连续三个可发布日检查草稿内容与回读结果
4. 第四个通过日由状态机自动调用正式发布接口

## 失败时怎么看

优先检查：

- `/var/log/eti/daily-intelligence.log`
- `/var/log/eti/summary-publish.log`
- `/var/log/eti/digit-publish.log`
- `reports/quality/<date>_health.md`
- `reports/wechat_publish/<date>_draft_payload.json`
- `reports/wechat_publish/<date>_draft_preview.html`

常见失败原因：

- `appid` / `appsecret` 未填
- 没有封面素材
- 微信公众平台 IP 白名单未放行
- 质量审计未通过
- 内容已发过且指纹未变化

## 双流回滚

回滚只能选择以下一种策略，不能混用不同时间点的 crontab、环境或文件快照。

### 安全停用新调度（推荐）

只恢复 Task 5 部署前的 crontab；保留当前代码、shadow 配置和 root 安全 runner，作为不再被调度引用的
审计副本：

```bash
PRE_TASK5=/var/www/eti/backups/task5-20260714T050141
crontab "$PRE_TASK5/crontab.before"
crontab -l
```

此策略不得恢复 `.env.local` 或 `files/`，也不得删除 `/usr/local/lib/eti-cron`。确认恢复后的 crontab
不再包含 `summary-publish`、`digit-publish` 或本轮 ETI managed block。

### 完整回滚

crontab、`.env.local` 和原有文件必须全部来自同一个 `PRE_TASK5` 快照；随后严格按同一快照中的
`files-not-present.txt` 删除部署前不存在的新增文件：

```bash
APP=/var/www/eti/Energy_trade_inspection
PRE_TASK5=/var/www/eti/backups/task5-20260714T050141

test -f "$PRE_TASK5/crontab.before"
test -f "$PRE_TASK5/.env.local"
test -d "$PRE_TASK5/files"
test -f "$PRE_TASK5/files-not-present.txt"

crontab "$PRE_TASK5/crontab.before"
cp -p "$PRE_TASK5/.env.local" "$APP/.env.local"
cp -a "$PRE_TASK5/files/." "$APP/"

python3 - "$APP" "$PRE_TASK5/files-not-present.txt" <<'PY'
import os
import sys
from pathlib import Path

root = Path(sys.argv[1]).absolute()
for line in Path(sys.argv[2]).read_text().splitlines():
    relative = line.strip()
    if not relative:
        continue
    target = Path(os.path.abspath(root / relative))
    if root != target and root not in target.parents:
        raise SystemExit(f"refusing path outside app: {relative}")
    if target.is_dir() and not target.is_symlink():
        raise SystemExit(f"refusing directory entry: {relative}")
    target.unlink(missing_ok=True)
PY

crontab -l
```

不得从审查前或修复中途备份恢复任何一项，也不要运行旧 `setup-crontab.sh`。root 安全目录可以保留为
不被引用的审计副本。默认保留 `reports/summary`、`reports/digit` 和 `reports/wechat_publish` 审计产物。

生产 ETI block 必须通过 `ETI_CRON_RUNNER` 指向 root 管理且父目录不可写的安全副本；不能安全安装时，
以 `crontab.before` 恢复完整调度，不得让 crontab 执行工作区中的 world/group-writable 路径。

# 迭代 18：外部验证与原文风格成稿运行手册

## 边界

- Firecrawl 的首要用途是验证内部材料，补充事实仅是次要用途。
- 搜索摘要、聚合页、社交媒体和 `tier_3` 内容只能提供线索。
- 可发布外部事实必须保存原始 URL、抓取正文中的连续证据段、事件日期、发布时间和抓取时间，并重新通过 `MarketFact` 校验。
- `shadow` 只保存研究结果；只有 `review` 才允许经验证事实进入编辑层。
- `MARKET_PIPELINE_MODE` 保持 `review`，系统只建公众号草稿。

## 必需配置

在生产 `.env.local` 中配置，真实密钥不得进入仓库或 Obsidian：

```text
FIRECRAWL_API_KEY=
FIRECRAWL_AGENT_BASE_URL=http://127.0.0.1:4318
DEEPSEEK_FLASH_AGENT_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_FLASH_MODEL=deepseek-v4-flash
DIFY_FLASH_MODEL_NAME=deepseek-v4-flash
DIFY_WORKFLOW_API_KEY_REVIEW_REPAIR=
EXTERNAL_RESEARCH_MODE=shadow
EXTERNAL_RESEARCH_MAX_QUERIES=4
EXTERNAL_RESEARCH_MAX_PAGES=8
```

服务只监听 `127.0.0.1:4318`，不向公网开放。若后续从另一台 ETI 主机调用，改为 WireGuard 地址并仅放行该私网来源。

## 安装

```bash
cd /var/www/eti/Energy_trade_inspection
sudo ETI_REPO_ROOT="$PWD" bash scripts/install-web-research-agent.sh
sudo systemctl status eti-web-research-agent.service
curl --fail http://127.0.0.1:4318/healthz
```

安装脚本固定使用 Firecrawl `web-agent` 提交 `f023adf1cd1f731e27fdc844af62996f6c2a41c4`，构建本地 `@firecrawl/agent-core` 目录依赖，再编译 ETI 服务；不使用跨机器哈希不稳定的临时 tarball。

## 数据库

Next.js 启动时自动应用 `064_external_research_editorial_style.sql`。验证：

```bash
psql "$DATABASE_URL" -f db/validation/064_external_research_editorial_style.sql
```

所有查询应返回 `0`。回滚前先将 `EXTERNAL_RESEARCH_MODE=off`，停止服务并执行 `db/rollbacks/064_external_research_editorial_style.down.sql`。

## Dify 工作流

```bash
python scripts/deploy_dify_workflows_v2.py --app writer --app review
python scripts/deploy_dify_workflows_v2.py --verify-only
```

- Writer 使用 Pro、非思考、JSON、`temperature=0.4`。
- Reviewer 使用 `DIFY_FLASH_MODEL_NAME`、思考模式和 JSON。
- `DIFY_WORKFLOW_API_KEY_REVIEW_REPAIR` 指向相同输入输出合同的非思考 Reviewer；首个 Reviewer 返回非法 JSON 或字段类型错误时只重试一次。未配置时保持失败关闭。
- Writer 按 `StoryBrief` 选择文章结构；Reviewer 检查语义覆盖，不检查固定栏目。
- 上线前必须在 Dify 模型供应商中确认 `DIFY_FLASH_MODEL_NAME` 对应的模型已存在；若不存在，不得激活新 Reviewer。

## 运行模式

1. `EXTERNAL_RESEARCH_MODE=off`：完全使用内部证据。
2. `shadow`：运行研究并保存候选，不进入文章事实。
3. `review`：只有验证通过的 `tier_1` 或获独立佐证的 `tier_2` 事实可进入编辑层；高风险事实仍进入人工审核。

Firecrawl 不可用时，内部证据充分的文章继续按原路径生成；关键事实依赖外部确认时保持等待或归档，禁止使用模型记忆补全。

## 风格基线

认可稿和负面样本清单存放在 `intelligence/fixtures/editorial_style/`。上线前由编辑人工确认 15–20 篇认可稿及 10 篇负面样本，不得由模型自行标注“认可”。

每篇稿件本地检查最近 10 篇：

- 完全或高度相似的长段落形成阻断项。
- 高度相似的标题序列形成编辑警告。
- 无具体对象的空泛句和通用航运、保险、绕行、波动段落形成阻断项。

## 影子验收

- 先运行 10 个有效 Digital 日期，只保存研究结果。
- 人工检查全部新增事实、来源等级、证据段和冲突。
- 对旧稿、原文风格稿、外部验证稿及 Pro/Flash 输出做盲审。
- 达到计划准确率、追溯率、结构重复率和盲审偏好率后，才把 `EXTERNAL_RESEARCH_MODE` 切到 `review`。
- 自动群发仍禁止，切换 `active` 需单独审批。

## 停用与回滚

```bash
sudo systemctl disable --now eti-web-research-agent.service
```

将 `EXTERNAL_RESEARCH_MODE=off` 后，Digital 管线立即回到内部证据链；已有研究记录保留审计，不删除、不进入新文章。

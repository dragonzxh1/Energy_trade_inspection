# Telegram Input Adapter Runbook

## 范围

本迭代只标准化 Telegram 消息和附件，不解析正文、不抽取市场事实、不修改文章或公众号发布流程。

生产默认配置：

```bash
MARKET_PIPELINE_MODE=shadow
MARKET_PIPELINE_VERSION=telegram-input.v1
```

`intelligence/telegram_ingest.py` 继续调用现有 Dify 工作流，同时把标准化输入写入 PostgreSQL。完整原始 Telegram payload 保存为附件旁的 `*.telegram.json`。

## 合同

- Pydantic 模型：`intelligence/market_pipeline/contracts.py`
- 兼容适配器：`intelligence/market_pipeline/telegram_adapter.py`
- Dify JSON Schema：`intelligence/schemas/telegram_input.schema.json`
- Schema 版本：`telegram-input.v1`

重新生成 Schema：

```bash
python -m intelligence.market_pipeline.export_schemas
```

## API 兼容

原接口保持不变：

```text
POST /api/internal/content/ingest
```

旧字段 `source_message_id`、`media_type`、`file_name`、`file_hash`、`message_timestamp` 和 `storage_path` 继续支持。新 Collector 同时发送标准字段。

成功响应：

```json
{
  "item": {},
  "message_id": "uuid",
  "attachment_id": "uuid",
  "processing_run_id": "uuid"
}
```

## 数据库

Migration：`db/migrations/046_telegram_input_adapter.sql`

新增：

- `telegram_messages`
- `telegram_attachments`
- `telegram_message_attachments`
- `processing_runs`

旧 `content_ingestion_queue` 继续写入，供现有管理页和 Dify 回写使用。

### 上线前备份

```bash
pg_dump "$DATABASE_URL" \
  --table=content_ingestion_queue \
  --table=seo_content \
  --data-only \
  --file="backup_telegram_adapter_$(date +%Y%m%d_%H%M%S).sql"
```

Migration 由现有启动迁移器自动执行，也可在隔离数据库中先验证：

```bash
psql "$DATABASE_URL" -f db/migrations/046_telegram_input_adapter.sql
psql "$DATABASE_URL" -f db/validation/046_telegram_input_adapter.sql
```

验证 SQL 的所有 `failures` 必须为 `0`。

### 回滚

先将 Collector 切回旧版本，再执行：

```bash
psql "$DATABASE_URL" -f db/rollbacks/046_telegram_input_adapter.down.sql
```

回滚只删除本迭代新增表，不修改 `content_ingestion_queue`、`seo_content`、日报或公众号产物。

## 测试

```bash
python -m unittest intelligence.test_telegram_adapter
python -m py_compile intelligence/telegram_ingest.py
npm run type-check
```

幂等集成验收：

1. 同一 payload 连续提交两次，三个 UUID 保持一致。
2. 同一消息提交两个不同附件，`telegram_messages` 增加 1，附件和关联各增加 2。
3. 不同消息提交相同文件哈希，附件只保留 1 条，消息关联保留 2 条。
4. 无时区日期、非法 SHA-256 或负文件大小返回 HTTP 400。

## 已知限制

- `content_ingestion_queue` 仍是消息级兼容表，多附件精确关系只存在新表中。
- `processing_runs` 当前只记录 `telegram_adapter`，后续迭代再扩展解析和事实抽取步骤。
- `MARKET_PIPELINE_MODE` 本轮只记录运行模式，不改变 legacy Dify 和发布行为。
- Dify 中现存的重复 App 和静态 Bearer 凭据不在本迭代代码变更范围内；静态凭据必须独立轮换。

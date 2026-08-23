# SourceDocument 解析运行手册

## 合同

- 输入：`TelegramInput`（`telegram-input.v1`）。
- 输出：`SourceDocument`（`source-document.v1`）、`DocumentSection`、`ParsedTable`。
- PostgreSQL 是结构化记录源；解析后的纯文本可同时写入 `MARKET_PARSED_TEXT_DIR`。
- 图片和低文本 PDF 只标记 `needs_review`，生产路径不调用 OCR。

## 解析顺序

1. PDF 原生文本与可识别表格。
2. DOCX、HTML、TXT、Markdown。
3. 已验证的固定 Platts 表格解析器作为独立可选路径。
4. 图片、扫描件或不支持格式进入人工审核。

日期优先级固定为 assessment date、标题日期、正文日期、published_at、文件名日期、Telegram 日期。所有候选值和选择理由保存在 `source_documents.date_candidates` 与合同 JSON 中。

## 运行

```bash
.venv-intelligence/bin/python -m intelligence.market_pipeline.document_worker --dry-run --limit 5
.venv-intelligence/bin/python -m intelligence.market_pipeline.document_worker --limit 20
```

指定附件重跑：

```bash
.venv-intelligence/bin/python -m intelligence.market_pipeline.document_worker \
  --attachment-id <uuid> --limit 1
```

按当前 parser 版本批量重建现有记录：

```bash
.venv-intelligence/bin/python -m intelligence.market_pipeline.document_worker --reparse --limit 50
```

## 验证与回滚

```bash
psql "$DATABASE_URL" -f db/validation/047_source_documents.sql
pg_dump "$DATABASE_URL" -Fc -f backups/source_documents_$(date +%Y%m%d_%H%M%S).dump
psql "$DATABASE_URL" -f db/rollbacks/047_source_documents.down.sql
```

回滚会删除 `source_documents`、`document_sections` 和 `parsed_tables`，必须先备份。旧日报和 Telegram 采集不受影响。

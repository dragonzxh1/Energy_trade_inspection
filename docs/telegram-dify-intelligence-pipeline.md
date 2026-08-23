# Telegram → Dify → ETI intelligence pipeline

This repo now exposes internal content-ingestion endpoints so a Telegram attachment collector or Dify workflow can feed ETI's intelligence hub without writing directly to the public database tables.

## 1. Recommended architecture

1. A personal-account Telegram collector reads attachment-only groups and downloads new `PDF`, `DOCX`, and `XLSX` files.
2. The collector posts raw file metadata to `POST /api/internal/content/ingest`.
3. Dify parses the file, classifies the commodity, extracts facts, and drafts:
   - English website copy
   - Chinese WeChat long-form copy
4. Dify posts the structured article payload to `POST /api/internal/content/upsert`.
5. Editors review drafts inside ETI Admin → `Content Ops`.

## 2. Auth

Both internal endpoints accept the same bearer token used by admin utilities:

- `Authorization: Bearer ${ADMIN_SECRET}`
- fallback: `SYNC_SECRET`

Do not expose these endpoints publicly without a secret.

## 2.5 Telegram collector

The repo now includes a personal-account collector:

`python intelligence/telegram_ingest.py --once`

Recommended runtime:

- Run it on your Dify or workflow server
- Keep the Telegram session file outside public web roots
- Use `ETI_INGEST_ENDPOINT` + `ETI_ADMIN_BEARER` to push metadata into ETI
- If Dify should run automatically, also configure `DIFY_BASE_URL` plus the relevant workflow keys

Required env vars for the collector:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SOURCE_CHAT`
- `ETI_INGEST_ENDPOINT`
- `ETI_ADMIN_BEARER`

Useful optional env vars:

- `DIFY_BASE_URL`
- `DIFY_WORKFLOW_API_KEY`
- `DIFY_WORKFLOW_API_KEY_EXTRACT`
- `DIFY_WORKFLOW_API_KEY_AGGREGATE`
- `DIFY_WORKFLOW_API_KEY_REVIEW`
- `DIFY_WORKFLOW_USER`
- `DIFY_WORKFLOW_RESPONSE_MODE`
- `DIFY_WORKFLOW_FILE_TYPE`
- `TELEGRAM_SESSION_FILE`
- `TELEGRAM_DOWNLOAD_DIR`
- `TELEGRAM_STATE_FILE`
- `TELEGRAM_POLL_LIMIT`
- `TELEGRAM_POLL_INTERVAL`

Collector behavior:

- Reads new Telegram messages after the last saved message ID
- Downloads supported attachments (`PDF`, `DOCX`, `XLSX`)
- Computes `sha256` file hash
- Saves files into a dated raw-materials folder
- Posts file metadata into ETI's raw ingestion queue
- Optionally uploads the downloaded file to Dify Service API via `POST /v1/files/upload`
- Optionally triggers the Dify workflow app via `POST /v1/workflows/run`
- Updates a local cursor state file for resumable polling

## 2.6 Dify trigger pattern

When `DIFY_BASE_URL` and `DIFY_WORKFLOW_API_KEY` are configured, the collector can call Dify directly:

1. Upload the local Telegram attachment to Dify:

```bash
POST {DIFY_BASE_URL}/v1/files/upload
Authorization: Bearer {DIFY_WORKFLOW_API_KEY}
Content-Type: multipart/form-data
```

Form fields:

- `user=telegram-ingest`
- `file=@middle-east-crude-brief.pdf`

2. Trigger the workflow app:

```json
POST {DIFY_BASE_URL}/v1/workflows/run
Authorization: Bearer {DIFY_WORKFLOW_API_KEY}
{
  "inputs": {
    "ingestion_queue_id": "uuid-from-eti",
    "source_channel": "telegram:platts-digits",
    "source_message_id": "184552",
    "file_name": "middle-east-crude-brief.pdf",
    "file_hash": "sha256...",
    "media_type": "application/pdf",
    "message_timestamp": "2026-06-30T08:30:00Z",
    "storage_path": "/srv/telegram/raw/platts-digits/20260630/middle-east-crude-brief.pdf",
    "source_url": "telegram://message/@platts_digits/184552",
    "caption": "Daily note caption"
  },
  "files": [
    {
      "type": "document",
      "transfer_method": "local_file",
      "url": "",
      "upload_file_id": "uuid-from-dify-upload"
    }
  ],
  "user": "telegram-ingest",
  "response_mode": "blocking"
}
```

Recommended Dify workflow variables:

- File input variable: `source_file`
- Text inputs: `ingestion_queue_id`, `source_channel`, `source_message_id`, `file_name`, `file_hash`, `media_type`, `message_timestamp`, `storage_path`, `source_url`, `caption`

Recommended Dify workflow steps:

1. `Start` node receives the file plus metadata
2. `Document Extractor / File Parser` node extracts raw text
3. `LLM` node classifies commodity / region / risk / entities
4. `LLM` node drafts the English ETI article
5. `LLM` node drafts the Chinese WeChat article
6. `HTTP Request` node calls `POST /api/internal/content/upsert` on ETI

## 2.7 Daily report workflows

For the ETI daily intelligence report pipeline, keep extraction and aggregation as two separate Dify workflow apps:

- `DIFY_WORKFLOW_API_KEY_EXTRACT` for per-document structured extraction
- `DIFY_WORKFLOW_API_KEY_AGGREGATE` for daily/weekly/monthly report synthesis

### Aggregate workflow inputs

Create a `Start` node with these text inputs:

- `mode`
- `report_type`
- `date`
- `extractions`

`extractions` should be a long text / paragraph field because `intelligence/daily_report.py` sends the full JSON array as a string.

### Aggregate workflow nodes

Recommended shape:

1. `Start`
2. `LLM` node that turns all extractions into one report
3. Optional `Code` node that converts markdown to WeChat HTML
4. `End`

### Important variable rule

Do not hand-type local placeholders like `{{#date#}}` or `{{#extractions#}}` in the LLM prompt.

In Dify, use the variable picker from the `Start` node so the prompt contains direct start-node references in this form:

- `{{#<start-node-id>.report_type#}}`
- `{{#<start-node-id>.date#}}`
- `{{#<start-node-id>.extractions#}}`

If these placeholders are wrong, Dify may pass them as literal text or resolve them as empty strings, which causes the model to hallucinate a generic report instead of using the extracted data.

### Aggregate LLM prompt

Use a single LLM node with a strict output contract.

System prompt:

```text
你是 ETI（Energy Trade Inspection）的资深能源情报编辑。你的任务是把多份结构化提取结果整合成一份专业、克制、可发布的能源行业报告。

硬性要求：
1. 只能使用用户提供的提取结果，不得补造新闻、公司、价格、航次或事件。
2. 如果某条信息在提取结果中不存在，就不要写。
3. 必须优先保留原始提取中的数字、单位、时间、地区、公司名、船名和风险点。
4. 不要输出思考过程，不要输出 <think> 标签。
5. 输出必须是合法 JSON。

写作要求：
1. 生成中文专业报告，语气像能源贸易研究团队，不要营销腔。
2. 先给总览，再给分主题分析，最后给风险提示。
3. 总结共识，也点出不确定性和信息缺口。
4. 如果输入是日报，就聚焦当天；如果是周报/月报，就概括趋势和重复出现的主题。
```

User prompt:

```text
报告类型：{{#<start-node-id>.report_type#}}
报告日期：{{#<start-node-id>.date#}}
模式：{{#<start-node-id>.mode#}}

以下是已经完成结构化提取的原始结果 JSON。你必须完整阅读并只基于这些内容生成报告：

{{#<start-node-id>.extractions#}}

请返回合法 JSON，字段如下：
{
  "report_markdown": "完整 Markdown 报告",
  "report_wechat_html": "适合微信公众号排版的 HTML，如果你不能稳定生成 HTML，就返回空字符串",
  "summary": "100-200字中文摘要"
}
```

### Optional Code node: Markdown to WeChat HTML

If the LLM is more stable at writing Markdown than HTML, add a `Code` node between `LLM` and `End`.

Inputs:

- `report_markdown` from the LLM node
- `summary` from the LLM node

Outputs:

- `report_markdown`
- `report_wechat_html`
- `summary`

Python code:

```python
import html
import re


def inline_format(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\*(.+?)\*", r"<em>\1</em>", text)
    text = re.sub(r"`([^`]+?)`", r"<code>\1</code>", text)
    return text


def markdown_to_wechat_html(markdown_text: str) -> str:
    lines = (markdown_text or "").replace("\r\n", "\n").split("\n")
    blocks = []
    in_list = False

    def close_list():
        nonlocal in_list
        if in_list:
            blocks.append("</ul>")
            in_list = False

    for raw_line in lines:
        line = raw_line.strip()

        if not line:
            close_list()
            continue

        if line.startswith("### "):
            close_list()
            blocks.append(
                f'<h3 style="margin:24px 0 12px;font-size:18px;line-height:1.5;color:#1f2937;">{inline_format(line[4:])}</h3>'
            )
            continue

        if line.startswith("## "):
            close_list()
            blocks.append(
                f'<h2 style="margin:28px 0 14px;font-size:22px;line-height:1.45;color:#111827;border-left:4px solid #0f766e;padding-left:12px;">{inline_format(line[3:])}</h2>'
            )
            continue

        if line.startswith("# "):
            close_list()
            blocks.append(
                f'<h1 style="margin:0 0 18px;font-size:28px;line-height:1.35;color:#111827;">{inline_format(line[2:])}</h1>'
            )
            continue

        if line.startswith("- ") or line.startswith("* "):
            if not in_list:
                blocks.append('<ul style="margin:12px 0 16px;padding-left:22px;color:#374151;">')
                in_list = True
            blocks.append(
                f'<li style="margin:8px 0;line-height:1.8;">{inline_format(line[2:])}</li>'
            )
            continue

        close_list()
        blocks.append(
            f'<p style="margin:0 0 16px;font-size:16px;line-height:1.9;color:#374151;text-align:justify;">{inline_format(line)}</p>'
        )

    close_list()

    body = "\n".join(blocks)
    return (
        '<section style="max-width:720px;margin:0 auto;padding:24px 20px;'
        'font-family:PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif;'
        'background:#fffdf8;">'
        f"{body}"
        "</section>"
    )


def main(report_markdown: str, summary: str = "") -> dict:
    cleaned_markdown = re.sub(
        r"<think\\b[^>]*>.*?</think>",
        "",
        report_markdown or "",
        flags=re.IGNORECASE | re.DOTALL,
    ).strip()
    wechat_html = markdown_to_wechat_html(cleaned_markdown)
    return {
        "report_markdown": cleaned_markdown,
        "report_wechat_html": wechat_html,
        "summary": (summary or "").strip(),
    }
```

Notes:

- This node deliberately strips any leaked `<think>` block again, even if the app already cleans outputs upstream.
- It only supports headings, paragraphs, bullet lists, bold, italic, and inline code, which is usually enough for ETI reports.
- If the LLM returns tables or deeply nested markdown, keep the markdown as the source of truth and let the HTML stay simple.

### End node outputs

Map these outputs from the LLM or final `Code` node into the `End` node:

- `report_markdown`
- `report_wechat_html`
- `summary`

`intelligence/daily_report.py` also tolerates fallback field names such as `report_md` and `wechat_html`, but keeping the workflow output names exactly as above is the safest option.

### Daily report runbook

Required env vars for the report generator:

- `OBSIDIAN_VAULT`
- `DIFY_BASE_URL`
- `DIFY_WORKFLOW_API_KEY_EXTRACT`
- `DIFY_WORKFLOW_API_KEY_AGGREGATE`

Workflow key purpose:

- `DIFY_WORKFLOW_API_KEY_EXTRACT`: single-document structured extraction
- `DIFY_WORKFLOW_API_KEY_AGGREGATE`: daily, weekly, or monthly report synthesis
- `DIFY_WORKFLOW_API_KEY_REVIEW`: final Markdown review and one-shot revision

Expected outputs under `${OBSIDIAN_VAULT}/reports`:

- `<date>_extractions.json`
- `<date>.md`
- `<date>_wechat.html`
- `<date>_summary.txt`
- `quality/<date>.json`
- `quality/<date>_llm_review.json`
- `quality/index.jsonl`
- `quality/<date>_health.md`
- `wechat_publish/<date>_draft.json` or `wechat_publish/<date>_publish.json`
- `wechat_publish/<date>_draft_preview.html`
- `wechat_publish/<date>_draft_payload.json`

Quick quality review:

```bash
python scripts/report-daily-quality.py --limit 7
python scripts/report-daily-quality.py --warn-only
python scripts/report-daily-quality.py --limit 7 --format markdown --output /var/www/eti/obsidian-vault/reports/quality/latest.md
python scripts/report-pipeline-health.py --date 2026-07-05
python scripts/report-pipeline-health.py --date 2026-07-05 --format markdown --output /var/www/eti/obsidian-vault/reports/quality/2026-07-05_health.md
```

WeChat publishing dry-run:

```bash
python intelligence/wechat_publish.py --date 2026-07-05 --action draft --dry-run
python intelligence/wechat_publish.py --date 2026-07-05 --action draft --preflight
```

Daily automation on the ETI server uses the existing cron wrapper:

```bash
bash scripts/setup-crontab.sh
crontab -l
```

The installed daily report job is:

```bash
30 6 * * * /var/www/eti/Energy_trade_inspection/scripts/cron-runner.sh daily-intelligence
```

Operational details:

- cron task name: `daily-intelligence`
- default target date: yesterday in `Asia/Singapore`
- lock file: `/tmp/eti-daily-intelligence.lock`
- log file: `/var/log/eti/daily-intelligence.log`
- image-only or low-text PDFs are skipped locally; the pipeline does not OCR them
- if a target day has no matched files, the script still writes an "观察版" Markdown + WeChat HTML instead of exiting empty
- if `WECHAT_MP_AUTO_MODE=auto|draft|publish`, the same cron task will also call `intelligence/wechat_publish.py`
- WeChat credentials can live in `.env.local` or `intelligence/wechat_publish.json`
- if WeChat publishing fails, the cron wrapper keeps the generated report files and writes a warning to the log instead of discarding the day
- WeChat publishing is dual-gated: both `quality/<date>.json` and `quality/<date>_llm_review.json` must pass
- `auto` creates drafts for the first three consecutive publishable days and submits the fourth; no-news days do not count or reset the streak
- a failed publishable day resets the streak; historical runs always create drafts and never change rollout state
- even when auto-publish is `off`, the daily cron task still generates a `draft --dry-run` preview and payload so the full日报→待发稿链路 can run every day
- manual override date:

```bash
ETI_REPORT_DATE=2026-07-05 /var/www/eti/Energy_trade_inspection/scripts/cron-runner.sh daily-intelligence
```

Fastest rerun path after extraction is cached:

```bash
python intelligence/daily_report.py --date 2026-07-05 --skip-extract
python intelligence/wechat_publish.py --date 2026-07-05 --action auto --dry-run
```

### WeChat publishing config

The repo already includes two files:

- `intelligence/wechat_publish.example.json`: committed example
- `intelligence/wechat_publish.json`: local editable config placeholder
- `docs/wechat-publish-runbook.md`: operator runbook for preflight, cron, and go-live steps

Fill the blanks in `intelligence/wechat_publish.json` only when you are ready to enable real publishing:

```bash
vim intelligence/wechat_publish.json
```

Config fields:

- `appid`: 公众号 `AppID`
- `appsecret`: 公众号 `AppSecret`
- `author`: article author shown in the draft
- `content_source_url`: optional original-link field for the article
- `default_thumb_media_id`: preferred existing cover-media id
- `thumb_image_path`: local cover image path; used only when `default_thumb_media_id` is empty
- `need_open_comment`: `0` or `1`
- `only_fans_can_comment`: `0` or `1`
- `auto_mode`: `off`, `auto`, `draft`, or `publish`
- `shadow_publish_days`: number of successful draft-only publishable days before automatic submission; default `3`

Equivalent `.env.local` variables are also supported:

- `WECHAT_MP_CONFIG`
- `WECHAT_MP_APP_ID`
- `WECHAT_MP_APP_SECRET`
- `WECHAT_MP_AUTHOR`
- `WECHAT_MP_CONTENT_SOURCE_URL`
- `WECHAT_MP_DEFAULT_THUMB_MEDIA_ID`
- `WECHAT_MP_THUMB_IMAGE_PATH`
- `WECHAT_MP_NEED_OPEN_COMMENT`
- `WECHAT_MP_ONLY_FANS_CAN_COMMENT`
- `WECHAT_MP_AUTO_MODE`
- `WECHAT_MP_SHADOW_PUBLISH_DAYS`

Manual commands:

```bash
python intelligence/wechat_publish.py --date 2026-07-05 --action draft
python intelligence/wechat_publish.py --date 2026-07-05 --action publish
python intelligence/wechat_publish.py --date 2026-07-05 --action auto
python intelligence/wechat_publish.py --date 2026-07-05 --action auto --historical
python intelligence/wechat_publish.py --date 2026-07-05 --action draft --preflight
python intelligence/wechat_publish.py --date 2026-07-05 --action draft --force
python scripts/report-pipeline-health.py --date 2026-07-05
```

The publisher uses the official-account API flow:

- get access token
- create draft
- optionally submit the draft for publish
- write the API result JSON under `reports/wechat_publish/`
- skip duplicate reruns automatically when the same article fingerprint has already been submitted, unless `--force` is used

Recommended validation sequence:

```bash
python intelligence/daily_report.py --date 2026-07-05 --dry-run
python intelligence/daily_report.py --date 2026-07-05 --skip-extract
python intelligence/daily_report.py --date 2026-07-05
```

## 3. Raw ingestion endpoint

`POST /api/internal/content/ingest`

Required fields:

```json
{
  "source_channel": "telegram:oil-desk-feed",
  "source_message_id": "184552",
  "media_type": "application/pdf",
  "file_name": "middle-east-crude-brief.pdf",
  "message_timestamp": "2026-06-30T08:30:00Z"
}
```

Useful optional fields:

- `sender_label`
- `file_hash`
- `file_size_bytes`
- `storage_path`
- `source_url`
- `processing_status`
- `parser_confidence`
- `commodity`
- `region`
- `extracted_title`
- `extracted_summary`
- `raw_payload_json`

## 4. Draft upsert endpoint

`POST /api/internal/content/upsert`

Minimum payload:

```json
{
  "title": "Asian diesel balances tighten as prompt cargoes thin",
  "content_type": "commodity_update",
  "commodity": "diesel-gasoil",
  "content_subtype": "pricing_signal",
  "source_channel": "telegram:oil-desk-feed",
  "source_message_id": "184552",
  "source_file_name": "asian-diesel-note.pdf",
  "source_published_at": "2026-06-30T08:30:00Z",
  "parser_confidence": 0.92,
  "review_status": "draft",
  "distribution_status": "draft",
  "verified_facts": [
    { "fact": "Prompt diesel cargoes were reported tighter in Asia." }
  ],
  "risk_types": ["pricing risk", "trade flow"],
  "entities": ["Singapore"],
  "meta_description": "Prompt Asian diesel balances tightened amid thinner cargo availability.",
  "narrative": "English website draft...",
  "why_it_matters": "Prompt middle-distillate tightness can change short-haul procurement and freight behavior.",
  "language_variants": {
    "website_en": {
      "title": "Asian diesel balances tighten as prompt cargoes thin",
      "summary": "English web summary"
    },
    "wechat_zh": {
      "title": "亚洲柴油现货趋紧，近月货源收缩",
      "summary": "中文公众号摘要",
      "article": "中文长文稿"
    }
  }
}
```

## 5. Commodity slugs

Supported commodity slugs:

- `crude-oil`
- `diesel-gasoil`
- `gasoline`
- `fuel-oil`
- `lng`
- `lpg`
- `naphtha`
- `petrochemicals`
- `shipping-freight`
- `sanctions-compliance`

## 6. Review lifecycle

Article lifecycle:

- `draft`
- `reviewed`
- `published`
- `rejected`

Distribution lifecycle:

- `draft`
- `queued`
- `distributed`
- `manual_only`

Recommended first-phase rule:

- Website article stays `draft` until an editor approves it.
- WeChat draft remains `manual_only` until the public-account API path is ready.

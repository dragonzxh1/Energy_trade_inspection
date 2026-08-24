#!/usr/bin/env bash
# cron-runner.sh - wrapper for ETI scheduled tasks
# Usage: scripts/cron-runner.sh <task> [slot]
#   tasks: cleanup | sync-sanctions | sync-fraud | gleif-delta | daily-intelligence
#          telegram-collect morning|midday|afternoon
#          fuelsight-prices morning|afternoon|evening | price-reconcile
#          summary-publish | digit-publish | wechat-bundle

set -euo pipefail

APP_DIR="/var/www/eti/Energy_trade_inspection"
ENV_FILE="$APP_DIR/.env.local"
LOG_DIR="/var/log/eti"
TASK="${1:-}"
SLOT="${2:-}"

if [ "$TASK" = "fuelsight-prices" ]; then
  case "$SLOT" in
    morning|afternoon|evening) ;;
    *)
      echo "Usage: $0 fuelsight-prices <morning|afternoon|evening>" >&2
      exit 1
      ;;
  esac
  TASK_LABEL="${TASK}-${SLOT}"
elif [ "$TASK" = "telegram-collect" ]; then
  case "$SLOT" in
    morning|midday|afternoon) ;;
    *)
      echo "Usage: $0 telegram-collect <morning|midday|afternoon>" >&2
      exit 1
      ;;
  esac
  TASK_LABEL="${TASK}-${SLOT}"
else
  TASK_LABEL="$TASK"
fi

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/${TASK_LABEL}.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
trap 'STATUS=$?; echo "[$(date "+%Y-%m-%d %H:%M:%S")] ERROR: task failed with exit $STATUS" >> "$LOG_FILE"; notify_task_failure; exit $STATUS' ERR

echo "[$TIMESTAMP] Starting task: $TASK" >> "$LOG_FILE"

# Load environment variables from .env.local
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "[$TIMESTAMP] ERROR: $ENV_FILE not found" >> "$LOG_FILE"
  exit 1
fi

APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"
if [ -z "${PYTHON_BIN:-}" ] && [ -x "$APP_DIR/.venv-intelligence/bin/python" ]; then
  PYTHON_BIN="$APP_DIR/.venv-intelligence/bin/python"
else
  PYTHON_BIN="${PYTHON_BIN:-python3}"
fi
WECHAT_CONFIG_PATH="${WECHAT_MP_CONFIG:-$APP_DIR/intelligence/wechat_publish.json}"

resolve_wechat_auto_mode() {
  local mode="${WECHAT_MP_AUTO_MODE:-}"
  if [ -z "$mode" ] && [ -f "$WECHAT_CONFIG_PATH" ]; then
    mode=$("$PYTHON_BIN" - <<PY
import json
from pathlib import Path
path = Path(r"$WECHAT_CONFIG_PATH")
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    data = {}
print(data.get("auto_mode", "off"))
PY
)
  fi
  printf '%s' "${mode:-off}"
}

content_stream_enabled() {
  local stream="$1"
  local configured=",${WECHAT_CONTENT_STREAMS:-},"
  configured="${configured// /}"
  [[ "$configured" == *",${stream},"* ]]
}

log_publication_context() {
  local stream="$1"
  local market_date="$2"
  local article_slug="$3"
  local pipeline_mode="$4"
  local requested_action="$5"
  local effective_action="$6"
  local dry_run="$7"
  local result="$8"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] stream=$stream market_date=$market_date article_slug=$article_slug pipeline_mode=$pipeline_mode requested_action=$requested_action effective_action=$effective_action dry_run=$dry_run result=$result" >> "$LOG_FILE"
}

notify_telegram() {
  local message="$1"
  "$PYTHON_BIN" -m intelligence.telegram_notify "$message" >> "$LOG_FILE" 2>&1 || true
}

notify_task_failure() {
  case "$TASK" in
    cleanup|sync-sanctions|sync-fraud|gleif-delta|daily-intelligence|summary-publish|digit-publish|wechat-bundle|telegram-collect)
      "$PYTHON_BIN" - "$TASK_LABEL" "$LOG_FILE" <<'PY' >> "$LOG_FILE" 2>&1 || true
import sys
from datetime import datetime
from zoneinfo import ZoneInfo
from intelligence.telegram_notify import NotificationEvent, emit_event

task, log_file = sys.argv[1:3]
today = datetime.now(ZoneInfo("Asia/Singapore")).date().isoformat()
emit_event(NotificationEvent(
    market_date=today, stream="system", severity="critical", status_code="CRON_TASK_FAILED",
    title="ETI 定时任务失败", impact=f"任务 {task} 异常退出。", action_required=True,
    recommended_action=f"检查日志：{log_file}", next_action="等待人工检查后由下一轮定时任务重试。",
    details=[f"任务：{task}"], source_run_id=task,
))
PY
      ;;
  esac
}

notify_task_success() {
  case "$TASK" in
    cleanup|sync-sanctions|sync-fraud|gleif-delta|daily-intelligence|summary-publish|digit-publish|wechat-bundle|telegram-collect)
      "$PYTHON_BIN" - "$TASK_LABEL" <<'PY' >> "$LOG_FILE" 2>&1 || true
import json
import sys
from intelligence.telegram_notify import recover_task_failure

print(json.dumps(recover_task_failure(sys.argv[1]), ensure_ascii=False))
PY
      ;;
  esac
}

assert_http_json_success() {
  local label="$1"
  local http_status="$2"
  local body="$3"
  if [[ ! "$http_status" =~ ^2[0-9][0-9]$ ]]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $label returned HTTP $http_status" >> "$LOG_FILE"
    return 1
  fi
  if ! printf '%s' "$body" | "$PYTHON_BIN" -c '
import json
import sys

try:
    payload = json.load(sys.stdin)
except Exception as exc:
    print(f"invalid JSON response: {exc}", file=sys.stderr)
    raise SystemExit(1)
if payload.get("ok") is not True:
    print(f"response reported failure: {payload}", file=sys.stderr)
    raise SystemExit(1)
' >> "$LOG_FILE" 2>&1; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $label response failed validation" >> "$LOG_FILE"
    return 1
  fi
}

case "$TASK" in
  cleanup)
    RESULT=$(curl --silent --show-error --connect-timeout 15 --max-time 300 -w "\nHTTP_STATUS:%{http_code}" \
      -H "Authorization: Bearer $ADMIN_SECRET" \
      "$APP_URL/api/cron/cleanup")
    HTTP_STATUS=$(echo "$RESULT" | grep "HTTP_STATUS:" | cut -d: -f2)
    BODY=$(echo "$RESULT" | grep -v "HTTP_STATUS:")
    echo "[$TIMESTAMP] cleanup -> HTTP $HTTP_STATUS: $BODY" >> "$LOG_FILE"
    assert_http_json_success cleanup "$HTTP_STATUS" "$BODY"
    ;;

  sync-sanctions)
    cd "$APP_DIR"
    exec 13>/tmp/eti-sync-sanctions.lock
    if ! flock -xn 13; then
      echo "[$TIMESTAMP] sync-sanctions skipped: lock busy" >> "$LOG_FILE"
      exit 0
    fi
    node scripts/sync-opensanctions.mjs >> "$LOG_FILE" 2>&1
    echo "[$TIMESTAMP] sync-sanctions done" >> "$LOG_FILE"
    ;;

  sync-fraud)
    cd "$APP_DIR"
    node scripts/sync-fraud-alerts.mjs >> "$LOG_FILE" 2>&1
    echo "[$TIMESTAMP] sync-fraud done" >> "$LOG_FILE"
    ;;

  gleif-delta)
    RESULT=$(curl --silent --show-error --connect-timeout 15 --max-time 1200 -w "\nHTTP_STATUS:%{http_code}" \
      -H "Authorization: Bearer $ADMIN_SECRET" \
      "$APP_URL/api/cron/gleif-delta")
    HTTP_STATUS=$(echo "$RESULT" | grep "HTTP_STATUS:" | cut -d: -f2)
    BODY=$(echo "$RESULT" | grep -v "HTTP_STATUS:")
    echo "[$TIMESTAMP] gleif-delta -> HTTP $HTTP_STATUS: $BODY" >> "$LOG_FILE"
    assert_http_json_success gleif-delta "$HTTP_STATUS" "$BODY"
    ;;

  daily-intelligence)
    cd "$APP_DIR"
    TASK_FAILED=0
    TARGET_DATE="${ETI_REPORT_DATE:-$(TZ=Asia/Singapore date -d 'yesterday' +%F)}"
    echo "[$TIMESTAMP] daily-intelligence -> target date: $TARGET_DATE" >> "$LOG_FILE"
    if ! timeout 30m flock -x /tmp/eti-fact-backfill.lock \
      flock -xn /tmp/eti-daily-intelligence.lock \
      timeout 120m "$PYTHON_BIN" -u -m intelligence.market_pipeline.daily_scheduler --date "$TARGET_DATE" \
      >> "$LOG_FILE" 2>&1; then
      TASK_FAILED=1
      echo "[$TIMESTAMP] ERROR: structured daily pipeline failed" >> "$LOG_FILE"
    fi
    "$PYTHON_BIN" scripts/report-daily-quality.py --limit 14 --format markdown \
      --output "$OBSIDIAN_VAULT/reports/quality/latest.md" >> "$LOG_FILE" 2>&1 || true
    log_publication_context legacy "$TARGET_DATE" - legacy disabled disabled false decoupled
    if [ "$TASK_FAILED" -ne 0 ]; then
      echo "[$TIMESTAMP] daily-intelligence failed" >> "$LOG_FILE"
      exit 1
    fi
    echo "[$TIMESTAMP] daily-intelligence done" >> "$LOG_FILE"
    ;;

  telegram-collect)
    cd "$APP_DIR"
    exec 6>/tmp/eti-telegram-collect.lock
    if ! flock -xn 6; then
      echo "[$TIMESTAMP] telegram-collect $SLOT skipped: collector lock busy" >> "$LOG_FILE"
      exit 0
    fi
    DIGITAL_SESSION="${TELEGRAM_DIGITAL_SESSION:-$APP_DIR/tmp/telegram/eti_telegram_digital}"
    DIGITAL_STATE="${TELEGRAM_DIGITAL_STATE:-$APP_DIR/tmp/telegram/state_platts-digits.json}"
    SUMMARY_SESSION="${TELEGRAM_SUMMARY_SESSION:-$APP_DIR/tmp/telegram/eti_telegram_summary}"
    SUMMARY_STATE="${TELEGRAM_SUMMARY_STATE:-$APP_DIR/tmp/telegram/state_quotes-summary.json}"
    timeout 20m "$PYTHON_BIN" -u -m intelligence.telegram_ingest \
      --once --chat "${TELEGRAM_DIGITAL_CHAT:-@platts_digits}" \
      --content-type documents \
      --session-file "$DIGITAL_SESSION" --state-file "$DIGITAL_STATE" \
      >> "$LOG_FILE" 2>&1
    timeout 20m "$PYTHON_BIN" -u -m intelligence.telegram_ingest \
      --once --chat "${TELEGRAM_SUMMARY_CHAT:-@quotes_summary}" \
      --content-type images \
      --session-file "$SUMMARY_SESSION" --state-file "$SUMMARY_STATE" \
      >> "$LOG_FILE" 2>&1
    echo "[$TIMESTAMP] telegram-collect $SLOT done; downstream work remains queued" >> "$LOG_FILE"
    ;;

  fuelsight-prices)
    cd "$APP_DIR"
    if [ "${DAILY_PRICE_MODE:-shadow}" = "off" ]; then
      echo "[$TIMESTAMP] fuelsight-prices skipped: DAILY_PRICE_MODE=off" >> "$LOG_FILE"
      exit 0
    fi
    case "$SLOT" in
      morning) LOCK_FILE="/tmp/eti-fuelsight-prices-morning.lock" ;;
      afternoon) LOCK_FILE="/tmp/eti-fuelsight-prices-afternoon.lock" ;;
      evening) LOCK_FILE="/tmp/eti-fuelsight-prices-evening.lock" ;;
    esac
    REQUESTED_AT=$(TZ=Asia/Singapore date --iso-8601=seconds)
    exec 11>"$LOCK_FILE"
    if ! flock -xn 11; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] fuelsight-prices $SLOT skipped: lock busy" >> "$LOG_FILE"
      exit 0
    fi
    timeout 5m bash -c '
      set -euo pipefail
      "$1" -m intelligence.fuelsight_prices fetch --slot "$2" --requested-at "$3"
      "$1" -m intelligence.daily_prices reconcile-pending --lookback-days 7
      if [ "${DAILY_PRICE_MODE:-shadow}" = "append" ]; then
        "$1" -m intelligence.pending_wechat_publish --lookback-days 7 --action draft
      fi
    ' _ "$PYTHON_BIN" "$SLOT" "$REQUESTED_AT" >> "$LOG_FILE" 2>&1
    echo "[$TIMESTAMP] fuelsight-prices $SLOT done; reconcile-pending completed" >> "$LOG_FILE"
    ;;

  price-reconcile)
    cd "$APP_DIR"
    if [ "${DAILY_PRICE_MODE:-shadow}" = "off" ]; then
      echo "[$TIMESTAMP] price-reconcile skipped: DAILY_PRICE_MODE=off" >> "$LOG_FILE"
      exit 0
    fi
    exec 12>/tmp/eti-price-reconcile.lock
    if ! flock -xn 12; then
      echo "[$(date '+%Y-%m-%d %H:%M:%S')] price-reconcile skipped: lock busy" >> "$LOG_FILE"
      exit 0
    fi
    timeout 5m "$PYTHON_BIN" -m intelligence.daily_prices reconcile-pending --lookback-days 7 \
        >> "$LOG_FILE" 2>&1
    if [ "${DAILY_PRICE_MODE:-shadow}" = "append" ]; then
      "$PYTHON_BIN" -m intelligence.pending_wechat_publish --lookback-days 7 --action draft \
        >> "$LOG_FILE" 2>&1
    fi
    echo "[$TIMESTAMP] price-reconcile done" >> "$LOG_FILE"
    ;;

  summary-publish)
    cd "$APP_DIR"
    PIPELINE_MODE="${MARKET_PIPELINE_MODE:-shadow}"
    SUMMARY_ACTION=draft
    SUMMARY_DRY_RUN=false
    if ! content_stream_enabled summary; then
      log_publication_context summary pending - "$PIPELINE_MODE" disabled disabled false stream_disabled
      exit 0
    fi
    case "$PIPELINE_MODE" in
      shadow)
        SUMMARY_DRY_RUN=true
        ;;
      review|historical)
        SUMMARY_ACTION=draft
        ;;
      active)
        SUMMARY_ACTION=publish
        ;;
      off)
        log_publication_context summary pending - "$PIPELINE_MODE" disabled disabled false skipped
        exit 0
        ;;
      *)
        log_publication_context summary pending - "$PIPELINE_MODE" invalid invalid false invalid_mode
        exit 1
        ;;
    esac
    if [ "${ETI_PUBLISH_DRY_RUN:-0}" = "1" ]; then
      SUMMARY_DRY_RUN=true
      SUMMARY_ACTION=draft
    fi
    SUMMARY_ARGS=(--pending --lookback-days "${SUMMARY_IMAGE_LOOKBACK_DAYS:-14}" --max-images "${SUMMARY_IMAGE_MAX_IMAGES:-20}" --action "$SUMMARY_ACTION")
    if [ -n "${SUMMARY_IMAGE_START_DATE:-}" ]; then
      SUMMARY_ARGS+=(--market-date-from "$SUMMARY_IMAGE_START_DATE")
    fi
    if [ "$SUMMARY_DRY_RUN" = "true" ]; then
      SUMMARY_ARGS+=(--dry-run)
    fi
    exec 9>/tmp/eti-summary-publish.lock
    if ! flock -xn 9; then
      log_publication_context summary pending - "$PIPELINE_MODE" "$SUMMARY_ACTION" "$SUMMARY_ACTION" "$SUMMARY_DRY_RUN" lock_busy
      exit 0
    fi
    log_publication_context summary pending - "$PIPELINE_MODE" "$SUMMARY_ACTION" "$SUMMARY_ACTION" "$SUMMARY_DRY_RUN" started
    timeout 30m "$PYTHON_BIN" -u -m intelligence.summary_image_worker "${SUMMARY_ARGS[@]}" \
      >> "$LOG_FILE" 2>&1
    "$PYTHON_BIN" -m intelligence.telegram_notify flush >> "$LOG_FILE" 2>&1 || true
    log_publication_context summary pending - "$PIPELINE_MODE" "$SUMMARY_ACTION" "$SUMMARY_ACTION" "$SUMMARY_DRY_RUN" success
    ;;

  summary-publish-legacy-disabled)
    cd "$APP_DIR"
    TARGET_DATE="${ETI_MARKET_DATE:-${ETI_REPORT_DATE:-$(TZ=Asia/Singapore date +%F)}}"
    PRICE_MODE="${DAILY_PRICE_MODE:-shadow}"
    SUMMARY_REQUESTED_ACTION=$(resolve_wechat_auto_mode)
    SUMMARY_EFFECTIVE_ACTION="$SUMMARY_REQUESTED_ACTION"
    SUMMARY_DRY_RUN=false
    if ! content_stream_enabled summary; then
      log_publication_context summary "$TARGET_DATE" - "$PRICE_MODE" disabled disabled false stream_disabled
      exit 0
    fi
    if [ "$PRICE_MODE" = "off" ]; then
      log_publication_context summary "$TARGET_DATE" - "$PRICE_MODE" "$SUMMARY_REQUESTED_ACTION" disabled false skipped
      exit 0
    fi
    if [ "${ETI_HISTORICAL:-0}" = "1" ]; then
      SUMMARY_EFFECTIVE_ACTION=draft
    fi
    if [ "$PRICE_MODE" = "shadow" ] || [ "${ETI_PUBLISH_DRY_RUN:-0}" = "1" ]; then
      SUMMARY_EFFECTIVE_ACTION=draft
      SUMMARY_DRY_RUN=true
    elif [ "$SUMMARY_REQUESTED_ACTION" != "auto" ] && [ "$SUMMARY_REQUESTED_ACTION" != "draft" ] && [ "$SUMMARY_REQUESTED_ACTION" != "publish" ]; then
      log_publication_context summary "$TARGET_DATE" - "$PRICE_MODE" "$SUMMARY_REQUESTED_ACTION" disabled false skipped
      exit 0
    fi
    log_publication_context summary "$TARGET_DATE" - "$PRICE_MODE" "$SUMMARY_REQUESTED_ACTION" "$SUMMARY_EFFECTIVE_ACTION" "$SUMMARY_DRY_RUN" started
    exec 9>/tmp/eti-summary-publish.lock
    if ! flock -xn 9; then
      log_publication_context summary "$TARGET_DATE" - "$PRICE_MODE" "$SUMMARY_REQUESTED_ACTION" "$SUMMARY_EFFECTIVE_ACTION" "$SUMMARY_DRY_RUN" lock_busy
      exit 75
    fi
    # Build platts_image_publish arguments: find Platts image → QR swap → upload → draft
    IMAGE_ARGS=(--date "$TARGET_DATE" --action "$SUMMARY_EFFECTIVE_ACTION")
    if [ "$SUMMARY_DRY_RUN" = "true" ]; then
      IMAGE_ARGS+=(--dry-run)
    fi
    if ! timeout 10m "$PYTHON_BIN" -m intelligence.platts_image_publish "${IMAGE_ARGS[@]}" \
      >> "$LOG_FILE" 2>&1; then
      log_publication_context summary "$TARGET_DATE" - "$PRICE_MODE" "$SUMMARY_REQUESTED_ACTION" "$SUMMARY_EFFECTIVE_ACTION" "$SUMMARY_DRY_RUN" failed
      exit 1
    fi
    "$PYTHON_BIN" - "$TARGET_DATE" "$SUMMARY_EFFECTIVE_ACTION" "$SUMMARY_DRY_RUN" <<'PY' >> "$LOG_FILE" 2>&1 || true
import sys
from intelligence.telegram_notify import NotificationEvent, emit_event

market_date, action, dry_run = sys.argv[1:4]
emit_event(NotificationEvent(
    market_date=market_date,
    stream="summary",
    severity="success",
    status_code="SUMMARY_DRAFT_READY",
    title="ETI Summary 图片报价草稿已就绪",
    impact="图片已完成QR替换并创建公众号草稿；机器人价格仅作为后续校正与历史记录。",
    action_required=False,
    next_action="无需操作；可在公众号后台预览草稿。",
    details=[
        "内容：每日普氏价格图片报价",
        f"执行动作：{action}",
    ],
    dry_run=dry_run == "true",
))
PY
    "$PYTHON_BIN" -m intelligence.telegram_notify flush >> "$LOG_FILE" 2>&1 || true
    log_publication_context summary "$TARGET_DATE" - "$PRICE_MODE" "$SUMMARY_REQUESTED_ACTION" "$SUMMARY_EFFECTIVE_ACTION" "$SUMMARY_DRY_RUN" success
    ;;

  digit-publish)
    cd "$APP_DIR"
    PIPELINE_MODE="${MARKET_PIPELINE_MODE:-shadow}"
    THROUGH_DATE="${ETI_MARKET_DATE:-${ETI_REPORT_DATE:-$(TZ=Asia/Singapore date -d 'yesterday' +%F)}}"
    DIGIT_DRY_RUN=false
    if ! content_stream_enabled digit; then
      log_publication_context digit "$THROUGH_DATE" - "$PIPELINE_MODE" disabled disabled false stream_disabled
      exit 0
    fi
    case "$PIPELINE_MODE" in
      shadow)
        DIGIT_DRY_RUN=true
        DIGIT_ACTION=draft
        ;;
      review|historical)
        DIGIT_ACTION=draft
        ;;
      active)
        DIGIT_ACTION=publish
        ;;
      off)
        log_publication_context digit "$THROUGH_DATE" - "$PIPELINE_MODE" disabled disabled false skipped
        exit 0
        ;;
      *)
        log_publication_context digit "$THROUGH_DATE" - "$PIPELINE_MODE" invalid invalid false invalid_mode
        exit 1
        ;;
    esac
    if [ "${ETI_PUBLISH_DRY_RUN:-0}" = "1" ]; then
      DIGIT_DRY_RUN=true
    fi
    DIGIT_ARGS=(--through-date "$THROUGH_DATE" --lookback-days "${DIGIT_PUBLISH_LOOKBACK_DAYS:-14}" --max-dates "${DIGIT_PUBLISH_MAX_DATES:-10}")
    if [ -n "${DIGIT_PUBLISH_START_DATE:-}" ]; then
      DIGIT_ARGS+=(--date-from "$DIGIT_PUBLISH_START_DATE")
    fi
    if [ "$DIGIT_DRY_RUN" = "true" ]; then
      DIGIT_ARGS+=(--dry-run)
    fi
    exec 10>/tmp/eti-daily-intelligence.lock
    if ! timeout 30m flock -x 10; then
      log_publication_context digit "$THROUGH_DATE" - "$PIPELINE_MODE" "$DIGIT_ACTION" "$DIGIT_ACTION" "$DIGIT_DRY_RUN" daily_pipeline_lock_timeout
      exit 1
    fi
    exec 8>/tmp/eti-digit-publish.lock
    if ! flock -xn 8; then
      log_publication_context digit "$THROUGH_DATE" - "$PIPELINE_MODE" "$DIGIT_ACTION" "$DIGIT_ACTION" "$DIGIT_DRY_RUN" lock_busy
      exit 0
    fi
    log_publication_context digit "$THROUGH_DATE" - "$PIPELINE_MODE" "$DIGIT_ACTION" "$DIGIT_ACTION" "$DIGIT_DRY_RUN" started
    timeout 120m "$PYTHON_BIN" -u -m intelligence.market_pipeline.digit_publication_scheduler "${DIGIT_ARGS[@]}" \
      >> "$LOG_FILE" 2>&1
    "$PYTHON_BIN" -m intelligence.telegram_notify flush >> "$LOG_FILE" 2>&1 || true
    log_publication_context digit "$THROUGH_DATE" - "$PIPELINE_MODE" "$DIGIT_ACTION" "$DIGIT_ACTION" "$DIGIT_DRY_RUN" success
    ;;

  digit-publish-legacy-disabled)
    cd "$APP_DIR"
    TARGET_DATE="${ETI_MARKET_DATE:-${ETI_REPORT_DATE:-$(TZ=Asia/Singapore date -d 'yesterday' +%F)}}"
    PIPELINE_MODE="${MARKET_PIPELINE_MODE:-shadow}"
    DIGIT_DRY_RUN=false
    DIGIT_ARGS=(--date "$TARGET_DATE")
    if ! content_stream_enabled digit; then
      log_publication_context digit "$TARGET_DATE" - "$PIPELINE_MODE" disabled disabled false stream_disabled
      exit 0
    fi
    if [ "$PIPELINE_MODE" = "off" ]; then
      log_publication_context digit "$TARGET_DATE" - "$PIPELINE_MODE" off off false skipped
      exit 0
    fi
    case "$PIPELINE_MODE" in
      shadow) DIGIT_REQUESTED_ACTION=shadow ;;
      review) DIGIT_REQUESTED_ACTION=draft ;;
      active) DIGIT_REQUESTED_ACTION=auto ;;
      *)
        log_publication_context digit "$TARGET_DATE" - "$PIPELINE_MODE" invalid invalid false invalid_mode
        exit 1
        ;;
    esac
    DIGIT_EFFECTIVE_ACTION="$DIGIT_REQUESTED_ACTION"
    if [ "${ETI_HISTORICAL:-0}" = "1" ]; then
      DIGIT_ARGS+=(--historical)
      if [ "$PIPELINE_MODE" != "shadow" ]; then
        DIGIT_EFFECTIVE_ACTION=draft
      fi
    fi
    if [ "${ETI_PUBLISH_DRY_RUN:-0}" = "1" ]; then
      DIGIT_DRY_RUN=true
      DIGIT_EFFECTIVE_ACTION=draft
      DIGIT_ARGS+=(--dry-run)
    fi
    DIGIT_INDEX="${OBSIDIAN_VAULT}/reports/digit/${TARGET_DATE}/index.json"
    if [ -f "$DIGIT_INDEX" ] && [ "${ETI_HISTORICAL:-0}" != "1" ] && [ "${ETI_PUBLISH_DRY_RUN:-0}" != "1" ]; then
      EXISTING_STATUS=$("$PYTHON_BIN" -c "
import json
from pathlib import Path
payload = json.loads(Path('$DIGIT_INDEX').read_text(encoding='utf-8'))
print(payload.get('status', ''))
" 2>/dev/null || echo "")
      if [ "$EXISTING_STATUS" = "complete" ]; then
        log_publication_context digit "$TARGET_DATE" - "$PIPELINE_MODE" "$DIGIT_REQUESTED_ACTION" "$DIGIT_EFFECTIVE_ACTION" "$DIGIT_DRY_RUN" skipped_already_complete
        exit 0
      fi
    fi
    log_publication_context digit "$TARGET_DATE" - "$PIPELINE_MODE" "$DIGIT_REQUESTED_ACTION" "$DIGIT_EFFECTIVE_ACTION" "$DIGIT_DRY_RUN" started
    exec 8>/tmp/eti-digit-publish.lock
    if ! flock -xn 8; then
      log_publication_context digit "$TARGET_DATE" - "$PIPELINE_MODE" "$DIGIT_REQUESTED_ACTION" "$DIGIT_EFFECTIVE_ACTION" "$DIGIT_DRY_RUN" lock_busy
      exit 75
    fi
    if ! timeout 120m "$PYTHON_BIN" -m intelligence.market_pipeline.publication_worker "${DIGIT_ARGS[@]}" \
      >> "$LOG_FILE" 2>&1; then
      log_publication_context digit "$TARGET_DATE" - "$PIPELINE_MODE" "$DIGIT_REQUESTED_ACTION" "$DIGIT_EFFECTIVE_ACTION" "$DIGIT_DRY_RUN" worker_failed
      exit 1
    fi
    DIGIT_INDEX="${OBSIDIAN_VAULT}/reports/digit/${TARGET_DATE}/index.json"
    if ! "$PYTHON_BIN" - "$DIGIT_INDEX" "$PIPELINE_MODE" "$DIGIT_REQUESTED_ACTION" "$DIGIT_EFFECTIVE_ACTION" "$DIGIT_DRY_RUN" <<'PY' >> "$LOG_FILE" 2>&1
import json
import sys
from datetime import datetime
from pathlib import Path

index_path = Path(sys.argv[1])
pipeline_mode, requested_action, effective_action, dry_run = sys.argv[2:6]
payload = json.loads(index_path.read_text(encoding="utf-8"))
market_date = payload.get("market_date", "unknown")
articles = payload.get("articles") or []
timestamp = datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
if not articles:
    print(f"[{timestamp}] stream=digit market_date={market_date} article_slug=- pipeline_mode={pipeline_mode} requested_action={requested_action} effective_action={effective_action} dry_run={dry_run} result={payload.get('status', 'archive_only')}")
dry_run_failed = False
for article in articles:
    slug = article.get("article_slug") or "unknown"
    dry_run_status = article.get("dry_run_status")
    result = f"dry_run_{dry_run_status}" if dry_run_status else (article.get("publication_status") or "unknown")
    article_requested = article.get("requested_action") or requested_action
    article_effective = article.get("effective_action") or effective_action
    print(f"[{timestamp}] stream=digit market_date={market_date} article_slug={slug} pipeline_mode={pipeline_mode} requested_action={article_requested} effective_action={article_effective} dry_run={dry_run} result={result}")
    dry_run_failed = dry_run_failed or dry_run_status == "failed"
successful = [article for article in articles if article.get("publication_status") in {"draft_created", "published", "shadow_saved"}]
rejected = [article for article in articles if article.get("publication_status") in {"generation_failed", "review_rejected", "publish_failed"}]
if payload.get("status") == "failed" or dry_run_failed:
    raise SystemExit(1)
PY
    then
      log_publication_context digit "$TARGET_DATE" - "$PIPELINE_MODE" "$DIGIT_REQUESTED_ACTION" "$DIGIT_EFFECTIVE_ACTION" "$DIGIT_DRY_RUN" index_failed
      exit 1
    fi
    log_publication_context digit "$TARGET_DATE" - "$PIPELINE_MODE" "$DIGIT_REQUESTED_ACTION" "$DIGIT_EFFECTIVE_ACTION" "$DIGIT_DRY_RUN" success
    ;;

  wechat-bundle)
    cd "$APP_DIR"
    TARGET_DATE="${ETI_MARKET_DATE:-${ETI_REPORT_DATE:-$(TZ=Asia/Singapore date -d 'yesterday' +%F)}}"
    PIPELINE_MODE="${MARKET_PIPELINE_MODE:-shadow}"
    if [ "$PIPELINE_MODE" = "shadow" ] || [ "$PIPELINE_MODE" = "off" ]; then
      log_publication_context bundle "$TARGET_DATE" - "$PIPELINE_MODE" disabled disabled false skipped
      exit 0
    fi
    BUNDLE_ACTION=draft
    if [ "$PIPELINE_MODE" = "active" ] && [ "${WECHAT_BUNDLE_AUTO_PUBLISH:-0}" = "1" ]; then
      BUNDLE_ACTION=publish
    fi
    exec 7>/tmp/eti-wechat-bundle.lock
    if ! flock -xn 7; then
      log_publication_context bundle "$TARGET_DATE" - "$PIPELINE_MODE" "$BUNDLE_ACTION" "$BUNDLE_ACTION" false lock_busy
      exit 75
    fi
    log_publication_context bundle "$TARGET_DATE" - "$PIPELINE_MODE" "$BUNDLE_ACTION" "$BUNDLE_ACTION" false started
    timeout 30m "$PYTHON_BIN" -m intelligence.wechat_bundle \
      --date "$TARGET_DATE" --action "$BUNDLE_ACTION" \
      >> "$LOG_FILE" 2>&1
    "$PYTHON_BIN" -m intelligence.telegram_notify flush >> "$LOG_FILE" 2>&1 || true
    log_publication_context bundle "$TARGET_DATE" - "$PIPELINE_MODE" "$BUNDLE_ACTION" "$BUNDLE_ACTION" false success
    ;;

  cleanup-telegram-files)
    cd "$APP_DIR"
    DOWNLOAD_DIR="${TELEGRAM_DOWNLOAD_DIR:-$APP_DIR/tmp/telegram/raw}"
    RETENTION_DAYS="${TELEGRAM_FILE_RETENTION_DAYS:-14}"
    echo "[$TIMESTAMP] cleanup-telegram-files: scanning $DOWNLOAD_DIR, retention=$RETENTION_DAYS days" >> "$LOG_FILE"
    if [ ! -d "$DOWNLOAD_DIR" ]; then
      echo "[$TIMESTAMP] cleanup-telegram-files: download dir not found, skipped" >> "$LOG_FILE"
      exit 0
    fi
    CUTOFF_DATE=$(date -d "$RETENTION_DAYS days ago" +%Y%m%d)
    DELETED_COUNT=0
    DELETED_SIZE=0
    for chat_dir in "$DOWNLOAD_DIR"/*/; do
      [ -d "$chat_dir" ] || continue
      for date_dir in "$chat_dir"*/; do
        [ -d "$date_dir" ] || continue
        DIR_DATE=$(basename "$date_dir")
        # Date dirs must be exactly 8 digits YYYYMMDD
        if [[ ! "$DIR_DATE" =~ ^[0-9]{8}$ ]]; then
          continue
        fi
        if [ "$DIR_DATE" -lt "$CUTOFF_DATE" ]; then
          DIR_SIZE=$(du -sk "$date_dir" 2>/dev/null | cut -f1)
          rm -rf "$date_dir"
          DELETED_COUNT=$((DELETED_COUNT + 1))
          DELETED_SIZE=$((DELETED_SIZE + ${DIR_SIZE:-0}))
          echo "[$TIMESTAMP] cleanup-telegram-files: deleted $(basename "$chat_dir")/$DIR_DATE (${DIR_SIZE:-0} KB)" >> "$LOG_FILE"
        fi
      done
    done
    # Clean up empty chat dirs
    find "$DOWNLOAD_DIR" -type d -empty -delete 2>/dev/null || true
    echo "[$TIMESTAMP] cleanup-telegram-files: removed $DELETED_COUNT date dirs, freed ~$((DELETED_SIZE / 1024)) MB" >> "$LOG_FILE"
    ;;

  *)
    echo "[$TIMESTAMP] ERROR: unknown task '$TASK'" >> "$LOG_FILE"
    echo "Usage: $0 <cleanup|sync-sanctions|sync-fraud|gleif-delta|daily-intelligence|telegram-collect|fuelsight-prices|price-reconcile|summary-publish|digit-publish|wechat-bundle|cleanup-telegram-files>" >&2
    exit 1
    ;;
esac

notify_task_success
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Task '$TASK' completed" >> "$LOG_FILE"

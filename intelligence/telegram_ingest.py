"""
Telegram attachment collector for ETI intelligence ingestion.

Supports two modes:
  --content-type documents  鈫?PDF, DOCX, XLSX (for Platts consultation group)
  --content-type images     鈫?JPG, PNG, WebP (for Quotes pricing group, OCR pipeline)

Single chat:
  python intelligence/telegram_ingest.py --chat @platts_digits --content-type documents --once
  python intelligence/telegram_ingest.py --chat @quotes_summary --content-type images --once

Dual chat (run both in one process):
  python intelligence/telegram_ingest.py --chats @platts_digits,@quotes_summary --once

Env vars:
  TELEGRAM_API_ID, TELEGRAM_API_HASH
  ETI_INGEST_ENDPOINT, ETI_ADMIN_BEARER
  TELEGRAM_SESSION_FILE, TELEGRAM_DOWNLOAD_DIR

The collector stops after durable ingestion. Dify, OCR, article generation,
and publishing are downstream worker responsibilities.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import mimetypes
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, time, timezone
from pathlib import Path
from typing import Any

import httpx
from telethon import TelegramClient
from telethon.tl.custom.message import Message

try:
    import socks
except ImportError:
    socks = None

try:
    from market_pipeline import (
        MARKET_PIPELINE_SCHEMA_VERSION,
        MARKET_FACT_SCHEMA_VERSION,
        adapt_legacy_payload,
    )
except ImportError:
    from intelligence.market_pipeline import (
        MARKET_PIPELINE_SCHEMA_VERSION,
        MARKET_FACT_SCHEMA_VERSION,
        adapt_legacy_payload,
    )

import hmac
from urllib.parse import quote

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent.parent / ".env.local")
    load_dotenv(Path(__file__).parent.parent / ".env")
except Exception:
    pass


# ---- Supported file types ----

DOCUMENT_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

DOCUMENT_SUFFIXES = {".pdf", ".docx", ".xlsx"}

IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/bmp",
    "image/tiff",
}

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif"}


# ---- Config ----

@dataclass
class CollectorConfig:
    api_id: int = 0
    api_hash: str = ""
    chat: str = ""
    endpoint: str = ""
    bearer: str = ""
    session_file: Path = field(default_factory=lambda: Path("tmp/telegram/eti_telegram"))
    download_dir: Path = field(default_factory=lambda: Path("tmp/telegram/raw"))
    state_file: Path = field(default_factory=lambda: Path("tmp/telegram/state.json"))
    limit: int = 100
    poll_interval_s: int = 120
    once: bool = False
    content_type: str = "documents"  # "documents" or "images"
    dify_base_url: str = ""
    dify_api_key: str = ""
    dify_user: str = "telegram-ingest"
    dify_response_mode: str = "blocking"
    dify_file_type: str = "document"
    telegram_proxy_scheme: str = ""
    telegram_proxy_host: str = ""
    telegram_proxy_port: int = 0
    telegram_proxy_username: str = ""
    telegram_proxy_password: str = ""
    pipeline_mode: str = "shadow"
    pipeline_version: str = MARKET_PIPELINE_SCHEMA_VERSION
    history_before: datetime | None = None
    history_after: datetime | None = None
    professional_energy_only: bool = False


# ---- Utilities ----

def slugify(value: str) -> str:
    value = value.strip().lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "telegram"


PROFESSIONAL_ENERGY_FILENAME_PATTERN = re.compile(
    r"(marketscan|oilgram|lng\s*daily|lpgaswire|bunkerwire|tankerwire|"
    r"argus|platts|morning\s*report|shipping\s*daily|\bopr\b|"
    r"\bapag\b|\beum\b|\biea\b|\bigu\b)",
    re.IGNORECASE,
)


def is_professional_energy_file(file_name: str) -> bool:
    return bool(PROFESSIONAL_ENERGY_FILENAME_PATTERN.search(file_name))


def telegram_message_storage_date(message: Message) -> str:
    message_date = message.date or datetime.now(timezone.utc)
    if message_date.tzinfo is None:
        message_date = message_date.replace(tzinfo=timezone.utc)
    return message_date.astimezone(timezone.utc).strftime("%Y%m%d")


def compute_sha256(path: Path) -> str:
    sha256 = hashlib.sha256()
    with path.open("rb") as file_obj:
        for chunk in iter(lambda: file_obj.read(1024 * 1024), b""):
            sha256.update(chunk)
    return sha256.hexdigest()


def get_telegram_file_id(message: Message) -> str | None:
    media = getattr(message, "document", None) or getattr(message, "photo", None)
    media_id = getattr(media, "id", None)
    return str(media_id) if media_id is not None else None


def get_forwarded_from(message: Message) -> str | None:
    forward = getattr(message, "forward", None)
    if not forward:
        return None
    for attribute in ("from_name", "chat_id", "sender_id"):
        value = getattr(forward, attribute, None)
        if value:
            return str(value)
    return None


def save_raw_message_payload(message: Message, attachment_path: Path) -> tuple[Path, dict[str, Any]]:
    raw_payload = json.loads(json.dumps(message.to_dict(), ensure_ascii=False, default=str))
    payload_path = attachment_path.with_suffix(attachment_path.suffix + ".telegram.json")
    payload_path.write_text(
        json.dumps(raw_payload, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )
    return payload_path, raw_payload


_TENCENT_OCR_ENDPOINT = "ocr.tencentcloudapi.com"
_TENCENT_OCR_ACTION = "RecognizeTableAccurateOCR"
_TENCENT_OCR_VERSION = "2018-11-19"
_TENCENT_OCR_SERVICE = "ocr"


class _TCOcrCredential:
    def __init__(self, secret_id: str, secret_key: str, region: str = "ap-guangzhou"):
        self.secret_id = secret_id
        self.secret_key = secret_key
        self.region = region


def _tc_sign(secret_key: bytes, msg: str) -> bytes:
    return hmac.new(secret_key, msg.encode("utf-8"), hashlib.sha256).digest()


def _tc_sha256_hex(msg: str) -> str:
    return hashlib.sha256(msg.encode("utf-8")).hexdigest()


async def tencent_ocr(image_path: Path, cred: "_TCOcrCredential", timeout: float = 30.0) -> str:
    """Call Tencent Cloud RecognizeTableAccurateOCR and return structured table text. Each line is formatted as: [R{row}C{col}] {cell_text}"""
    import base64

    with image_path.open("rb") as f:
        img_b64 = base64.b64encode(f.read()).decode()

    if len(img_b64) > 7 * 1024 * 1024:
        return ""

    payload = json.dumps({"ImageBase64": img_b64})
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))
    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    canonical_headers = f"content-type:application/json\nhost:{_TENCENT_OCR_ENDPOINT}\nx-tc-action:{_TENCENT_OCR_ACTION.lower()}\n"
    signed_headers = "content-type;host;x-tc-action"
    hashed_payload = _tc_sha256_hex(payload)

    canonical_request = f"POST\n/\n\n{canonical_headers}\n{signed_headers}\n{hashed_payload}"

    algorithm = "TC3-HMAC-SHA256"
    credential_scope = f"{date_str}/{_TENCENT_OCR_SERVICE}/tc3_request"
    string_to_sign = f"{algorithm}\n{timestamp}\n{credential_scope}\n{_tc_sha256_hex(canonical_request)}"

    secret_date = _tc_sign(("TC3" + cred.secret_key).encode("utf-8"), date_str)
    secret_service = _tc_sign(secret_date, _TENCENT_OCR_SERVICE)
    secret_signing = _tc_sign(secret_service, "tc3_request")
    signature = _tc_sign(secret_signing, string_to_sign).hex()

    authorization = (
        f"{algorithm} Credential={cred.secret_id}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )

    headers = {
        "Authorization": authorization,
        "Content-Type": "application/json",
        "Host": _TENCENT_OCR_ENDPOINT,
        "X-TC-Action": _TENCENT_OCR_ACTION,
        "X-TC-Timestamp": timestamp,
        "X-TC-Version": _TENCENT_OCR_VERSION,
        "X-TC-Region": cred.region,
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://{_TENCENT_OCR_ENDPOINT}/",
            headers=headers,
            content=payload,
            timeout=timeout,
        )

    if resp.status_code != 200:
        return ""

    data = resp.json()
    if "Response" not in data or "Error" in data["Response"]:
        return ""

    # Parse table detection response
    table_detections = data["Response"].get("TableDetections", [])
    if not table_detections:
        return ""

    lines = []
    for tidx, detection in enumerate(table_detections):
        cells = detection.get("Cells", [])
        for cell in cells:
            row = cell.get("RowTl", 0)
            col = cell.get("ColTl", 0)
            text = cell.get("Text", "").strip()
            if text:
                lines.append(f"[T{tidx}R{row}C{col}] {text}")

    return "\n".join(lines)


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"last_message_id": 0}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"last_message_id": 0}


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def detect_media_type(file_name: str, file_mime: str | None = None) -> str:
    """Detect MIME type from file metadata or name extension."""
    if file_mime:
        return file_mime
    guessed, _ = mimetypes.guess_type(file_name)
    return guessed or "application/octet-stream"


def get_supported_mime_types(content_type: str) -> set[str]:
    if content_type == "images":
        return IMAGE_MIME_TYPES
    return DOCUMENT_MIME_TYPES


def get_supported_suffixes(content_type: str) -> set[str]:
    if content_type == "images":
        return IMAGE_SUFFIXES
    return DOCUMENT_SUFFIXES


def is_supported_attachment(file_name: str, media_type: str, content_type: str) -> bool:
    suffix = Path(file_name).suffix.lower()
    return suffix in get_supported_suffixes(content_type) or media_type in get_supported_mime_types(content_type)


# ---- CLI parsing ----

def build_config_for_chat(chat: str, args: argparse.Namespace, env_overrides: dict[str, str] | None = None) -> CollectorConfig:
    """Build a CollectorConfig for a specific chat."""
    dify_file_type = args.dify_file_type
    if args.content_type == "images":
        dify_file_type = "image"
    elif args.content_type == "documents":
        dify_file_type = "document"
    return CollectorConfig(
        api_id=args.api_id,
        api_hash=args.api_hash,
        chat=chat,
        endpoint=args.endpoint,
        bearer=args.bearer,
        session_file=Path(args.session_file),
        download_dir=Path(args.download_dir),
        state_file=Path(args.state_file) if args.state_file else Path(f"tmp/telegram/state_{slugify(chat)}.json"),
        limit=args.limit,
        poll_interval_s=args.poll_interval,
        once=args.once,
        content_type=args.content_type,
        dify_base_url=args.dify_base_url,
        dify_api_key=args.dify_api_key,
        dify_user=args.dify_user,
        dify_response_mode=args.dify_response_mode,
        dify_file_type=dify_file_type,
        telegram_proxy_scheme=args.telegram_proxy_scheme,
        telegram_proxy_host=args.telegram_proxy_host,
        telegram_proxy_port=args.telegram_proxy_port,
        telegram_proxy_username=args.telegram_proxy_username,
        telegram_proxy_password=args.telegram_proxy_password,
        pipeline_mode=args.pipeline_mode,
        pipeline_version=args.pipeline_version,
        history_before=datetime.combine(args.history_before, time.min, tzinfo=timezone.utc) if args.history_before else None,
        history_after=datetime.combine(args.history_after, time.min, tzinfo=timezone.utc) if args.history_after else None,
        professional_energy_only=args.professional_energy_only,
    )


def parse_args() -> tuple[argparse.Namespace, list[CollectorConfig]]:
    parser = argparse.ArgumentParser(description="Collect Telegram attachments into ETI intelligence queue")

    # Telegram auth
    parser.add_argument("--api-id", type=int, default=int(os.getenv("TELEGRAM_API_ID", "0")))
    parser.add_argument("--api-hash", default=os.getenv("TELEGRAM_API_HASH", ""))

    # Chat selection: single --chat or dual --chats (comma-separated)
    parser.add_argument("--chat", default=os.getenv("TELEGRAM_SOURCE_CHAT", ""))
    parser.add_argument("--chats", default="", help="Comma-separated list of chats: @platts_digits,@quotes_summary")

    # Content type: documents (PDF/DOCX/XLSX) or images (JPG/PNG/WebP for OCR)
    parser.add_argument("--content-type", default="documents", choices=["documents", "images"],
                        help="Attachment type to collect (default: documents)")

    # ETI ingest endpoint
    parser.add_argument("--endpoint", default=os.getenv("ETI_INGEST_ENDPOINT", ""))
    parser.add_argument("--bearer", default=os.getenv("ETI_ADMIN_BEARER", ""))

    # State & storage
    parser.add_argument("--session-file", default=os.getenv("TELEGRAM_SESSION_FILE", "tmp/telegram/eti_telegram"))
    parser.add_argument("--download-dir", default=os.getenv("TELEGRAM_DOWNLOAD_DIR", "tmp/telegram/raw"))
    parser.add_argument("--state-file", default=os.getenv("TELEGRAM_STATE_FILE", ""))

    # Polling
    parser.add_argument("--limit", type=int, default=int(os.getenv("TELEGRAM_POLL_LIMIT", "100")))
    parser.add_argument("--poll-interval", type=int, default=int(os.getenv("TELEGRAM_POLL_INTERVAL", "120")))
    parser.add_argument("--once", action="store_true", help="Process the latest batch once and exit")
    parser.add_argument("--history-before", type=datetime.fromisoformat,
                        help="Backfill messages older than this date without changing the live cursor")
    parser.add_argument("--history-after", type=datetime.fromisoformat,
                        help="Stop historical backfill before messages older than this date")
    parser.add_argument("--professional-energy-only", action="store_true",
                        help="Download only recognized professional energy publications")

    # Dify
    parser.add_argument("--dify-base-url", default=os.getenv("DIFY_BASE_URL", ""))
    parser.add_argument("--dify-api-key", default=os.getenv("DIFY_WORKFLOW_API_KEY", ""))
    parser.add_argument("--dify-api-key-quotes", default=os.getenv("DIFY_WORKFLOW_API_KEY_QUOTES", ""))
    parser.add_argument("--dify-user", default=os.getenv("DIFY_WORKFLOW_USER", "telegram-ingest"))
    parser.add_argument("--dify-response-mode", default=os.getenv("DIFY_WORKFLOW_RESPONSE_MODE", "blocking"))
    parser.add_argument("--dify-file-type", default=os.getenv("DIFY_WORKFLOW_FILE_TYPE", "document"))

    parser.add_argument(
        "--pipeline-mode",
        default=os.getenv("MARKET_PIPELINE_MODE", "shadow"),
        choices=["legacy", "shadow", "review", "active"],
    )
    parser.add_argument(
        "--pipeline-version",
        default=os.getenv("MARKET_PIPELINE_VERSION", MARKET_PIPELINE_SCHEMA_VERSION),
    )

    # Proxy
    parser.add_argument("--telegram-proxy-scheme", default=os.getenv("TELEGRAM_PROXY_SCHEME", ""))
    parser.add_argument("--telegram-proxy-host", default=os.getenv("TELEGRAM_PROXY_HOST", ""))
    parser.add_argument("--telegram-proxy-port", type=int, default=int(os.getenv("TELEGRAM_PROXY_PORT", "0")))
    parser.add_argument("--telegram-proxy-username", default=os.getenv("TELEGRAM_PROXY_USERNAME", ""))
    parser.add_argument("--telegram-proxy-password", default=os.getenv("TELEGRAM_PROXY_PASSWORD", ""))

    args = parser.parse_args()
    if args.history_after and not args.history_before:
        parser.error("--history-after requires --history-before")
    if args.history_before and not args.once:
        parser.error("historical backfill requires --once")
    if args.history_before and args.history_after and args.history_after >= args.history_before:
        parser.error("--history-after must be earlier than --history-before")

    # Build configs
    configs: list[CollectorConfig] = []
    if args.chats:
        chat_list = [c.strip() for c in args.chats.split(",") if c.strip()]
        for chat in chat_list:
            cfg = build_config_for_chat(chat, args)
            # Auto-detect content_type from chat name
            if "quotes" in chat.lower():
                cfg.content_type = "images"
                cfg.dify_api_key = args.dify_api_key_quotes or args.dify_api_key
                cfg.dify_file_type = "image"
            elif "platts" in chat.lower():
                cfg.content_type = "documents"
                cfg.dify_file_type = "document"
            configs.append(cfg)
    elif args.chat:
        configs.append(build_config_for_chat(args.chat, args))

    return args, configs


# ---- Dify helpers ----

def is_dify_enabled(config: CollectorConfig) -> bool:
    return bool(config.dify_base_url and config.dify_api_key)


def should_trigger_legacy_dify(config: CollectorConfig) -> bool:
    del config
    return False


def build_telegram_proxy(config: CollectorConfig) -> tuple[Any, ...] | None:
    if not config.telegram_proxy_host or not config.telegram_proxy_port:
        return None
    if socks is None:
        raise RuntimeError("PySocks is required when a Telegram proxy is configured")

    scheme_map = {
        "socks5": socks.SOCKS5,
        "socks4": socks.SOCKS4,
        "http": socks.HTTP,
    }
    proxy_type = scheme_map.get(config.telegram_proxy_scheme or "socks5")
    if proxy_type is None:
        raise ValueError("TELEGRAM_PROXY_SCHEME must be one of: socks5, socks4, http")

    return (
        proxy_type,
        config.telegram_proxy_host,
        config.telegram_proxy_port,
        True,
        config.telegram_proxy_username or None,
        config.telegram_proxy_password or None,
    )


async def post_ingestion_item(
    http: httpx.AsyncClient,
    payload: dict[str, Any],
    endpoint: str,
    bearer: str,
) -> dict[str, Any]:
    response = await http.post(
        endpoint,
        headers={"Authorization": f"Bearer {bearer}"},
        json=payload,
        timeout=30.0,
    )
    if response.status_code >= 400:
        body = response.text
        print(f"[telegram-ingest] Dify workflow error {response.status_code}: {body[:500]}", file=sys.stderr)
    if response.status_code >= 400:
        body = response.text
        print(f"[telegram-ingest] error {response.status_code}: {body[:400]}", file=sys.stderr)
    response.raise_for_status()
    return response.json()


async def upload_file_to_dify(
    http: httpx.AsyncClient,
    config: CollectorConfig,
    file_path: Path,
    media_type: str,
) -> dict[str, Any]:
    with file_path.open("rb") as file_obj:
        response = await http.post(
            f"{config.dify_base_url}/v1/files/upload",
            headers={"Authorization": f"Bearer {config.dify_api_key}"},
            data={"user": config.dify_user},
            files={"file": (file_path.name, file_obj, media_type)},
            timeout=120.0,
        )
    if response.status_code >= 400:
        body = response.text
        print(f"[telegram-ingest] error {response.status_code}: {body[:400]}", file=sys.stderr)
    response.raise_for_status()
    return response.json()


SUMMARY_TEMPLATE_TASK = (
    "Extract structured market intelligence from the provided Telegram source. "
    "Return concise, factual output consistent with the template schema."
)
SUMMARY_TEMPLATE_SCHEMA = json.dumps(
    {
        "type": "object",
        "properties": {
            "facts": {"type": "array"},
            "summary": {"type": "string"},
            "entities": {"type": "array"},
        },
        "required": ["facts"],
    },
    ensure_ascii=False,
)


def _parse_dify_date(message_timestamp: Any) -> str:
    """Extract YYYY-MM-DD from an ISO-8601 timestamp for Dify workflow inputs."""
    if not message_timestamp:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        parsed = datetime.fromisoformat(str(message_timestamp).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def build_dify_workflow_request(
    config: CollectorConfig,
    payload: dict[str, Any],
    queue_item: dict[str, Any],
    uploaded_file: dict[str, Any],
    raw_text: str = "",
) -> dict[str, Any]:
    """Build the frozen downstream Dify request contract.

    The Telegram collector no longer invokes this request directly. It remains
    here as the compatibility contract for a queued downstream workflow worker.
    """
    file_reference = {
        "transfer_method": "local_file",
        "upload_file_id": uploaded_file["id"],
        "type": config.dify_file_type,
    }
    inputs: dict[str, Any] = {
        "mode": "summary" if config.content_type == "images" else "digital",
        "source_file": file_reference,
        "ingestion_queue_id": queue_item.get("id"),
        "content_type": config.content_type,
        "ocr_text": raw_text,
        "raw_text": raw_text,
        "template_id": MARKET_FACT_SCHEMA_VERSION,
        "template_task": SUMMARY_TEMPLATE_TASK,
        "template_schema": SUMMARY_TEMPLATE_SCHEMA,
        "source_channel": payload["source_channel"],
        "source_message_id": payload["source_message_id"],
        "sender_label": payload.get("sender_label"),
        "media_type": payload["media_type"],
        "file_name": payload["file_name"],
        "filename": payload["file_name"],
        "file_hash": payload.get("file_hash"),
        "file_size_bytes": payload.get("file_size_bytes"),
        "message_timestamp": payload["message_timestamp"],
        "date": _parse_dify_date(payload.get("message_timestamp")),
        "storage_path": payload.get("storage_path"),
        "source_url": payload.get("source_url"),
        "caption": (payload.get("raw_payload_json") or {}).get("caption", ""),
        "document_text": (payload.get("raw_payload_json") or {}).get("caption", ""),
    }
    return {
        "inputs": inputs,
        "files": [file_reference],
        "user": config.dify_user,
        "response_mode": config.dify_response_mode,
    }


async def trigger_dify_workflow(
    http: httpx.AsyncClient,
    config: CollectorConfig,
    payload: dict[str, Any],
    queue_item: dict[str, Any],
    uploaded_file: dict[str, Any],
    ocr_text: str = "",
) -> dict[str, Any]:
    request_body = build_dify_workflow_request(
        config,
        payload,
        queue_item,
        uploaded_file,
        raw_text=ocr_text,
    )
    response = await http.post(
        f"{config.dify_base_url}/v1/workflows/run",
        headers={"Authorization": f"Bearer {config.dify_api_key}"},
        json=request_body,
        timeout=180.0,
    )
    if response.status_code >= 400:
        body = response.text
        payload_summary = json.dumps(
            {
                "inputs_keys": list(request_body["inputs"].keys()),
                "files": request_body.get("files"),
                "user": request_body.get("user"),
                "response_mode": request_body.get("response_mode"),
            },
            ensure_ascii=False,
        )
        print(
            f"[telegram-ingest] Dify workflow error {response.status_code}: {body[:400]} "
            f"| payload summary: {payload_summary}",
            file=sys.stderr,
        )
    response.raise_for_status()
    return response.json()


# ---- Message processing ----

def get_file_info_from_message(message: Message, content_type: str) -> tuple[str | None, str | None]:
    """Extract file name and MIME type from a Telegram message.

    For documents: uses message.file (DocumentAttributeFilename)
    For images:    uses message.photo, generates a name from message ID + timestamp
    """
    # Documents / files with explicit file metadata
    if message.file and not message.photo:
        file_name = message.file.name or f"telegram-{message.id}"
        file_mime = getattr(message.file, "mime_type", None)
        if file_mime:
            return file_name, file_mime
        # Fallback: guess from filename
        _, ext_mime = mimetypes.guess_type(file_name)
        return file_name, ext_mime or "application/octet-stream"

    # Photos (Telegram compresses them, we download the largest available)
    if message.photo and content_type == "images":
        ts = message.date.strftime("%Y%m%d_%H%M%S") if message.date else datetime.now().strftime("%Y%m%d_%H%M%S")
        file_name = f"photo_{message.id}_{ts}.jpg"
        return file_name, "image/jpeg"

    return None, None


async def process_message(
    message: Message,
    config: CollectorConfig,
    http: httpx.AsyncClient,
) -> bool:
    file_name, media_type = get_file_info_from_message(message, config.content_type)
    if not file_name or not media_type:
        return False

    if not is_supported_attachment(file_name, media_type, config.content_type):
        return False
    if config.professional_energy_only and not is_professional_energy_file(file_name):
        return False

    config.download_dir.mkdir(parents=True, exist_ok=True)
    chat_slug = slugify(config.chat)
    dated_dir = config.download_dir / chat_slug / telegram_message_storage_date(message)
    dated_dir.mkdir(parents=True, exist_ok=True)

    target_path = dated_dir / file_name
    if not target_path.exists():
        partial_path = target_path.with_name(f"{target_path.name}.part")
        partial_path.unlink(missing_ok=True)
        try:
            await message.download_media(file=str(partial_path))
            partial_path.replace(target_path)
        finally:
            partial_path.unlink(missing_ok=True)

    if not target_path.exists():
        print(f"[telegram-ingest:{chat_slug}] download failed for message {message.id}", file=sys.stderr)
        return False

    file_hash = compute_sha256(target_path)
    raw_payload_path, raw_message_payload = save_raw_message_payload(message, target_path)
    raw_message_payload.update({
        "chat": config.chat,
        "content_type": config.content_type,
        "caption": message.message or "",
    })
    raw_payload_path.write_text(
        json.dumps(raw_message_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    source_url = None
    if getattr(message, "id", None):
        source_url = f"telegram://message/{config.chat}/{message.id}"

    legacy_payload = {
        "source_channel": f"telegram:{chat_slug}",
        "source_message_id": str(message.id),
        "sender_label": getattr(message.sender, "username", None) or getattr(message.sender, "first_name", None),
        "media_type": media_type,
        "file_name": file_name,
        "file_hash": file_hash,
        "file_size_bytes": target_path.stat().st_size,
        "message_timestamp": message.date.astimezone(timezone.utc).isoformat() if message.date else datetime.now(timezone.utc).isoformat(),
        "storage_path": str(target_path.resolve()),
        "source_url": source_url,
        "processing_status": "queued",
        "telegram_chat_id": str(getattr(message, "chat_id", None) or config.chat),
        "telegram_file_id": get_telegram_file_id(message),
        "forwarded_from": get_forwarded_from(message),
        "reply_to_message_id": getattr(message, "reply_to_msg_id", None),
        "message_text": message.message or "",
        "message_type": "image" if config.content_type == "images" else "document",
        "raw_payload_path": str(raw_payload_path.resolve()),
        "raw_payload_json": raw_message_payload,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
        "pipeline_mode": config.pipeline_mode,
        "pipeline_version": config.pipeline_version,
    }

    telegram_input = adapt_legacy_payload(
        legacy_payload,
        pipeline_mode=config.pipeline_mode,
        pipeline_version=config.pipeline_version,
    )
    contract = telegram_input.model_dump(mode="json")
    payload = {
        **legacy_payload,
        "schema_version": contract["schema_version"],
        "pipeline_mode": contract["pipeline_mode"],
        "pipeline_version": contract["pipeline_version"],
        **contract["message"],
        **contract["attachment"],
    }

    ingestion_response = await post_ingestion_item(http, payload, config.endpoint, config.bearer)
    queue_item = ingestion_response.get("item", {})
    print(
        json.dumps(
            {
                "chat": config.chat,
                "content_type": config.content_type,
                "source_message_id": str(message.id),
                "ingestion_queue_id": queue_item.get("id"),
                "message_id": ingestion_response.get("message_id"),
                "attachment_id": ingestion_response.get("attachment_id"),
                "processing_run_id": ingestion_response.get("processing_run_id"),
                "downstream_status": "queued",
            },
            ensure_ascii=False,
        )
    )
    return True


# ---- Runners ----

async def run_once(client: TelegramClient, config: CollectorConfig) -> int:
    state = load_state(config.state_file)
    last_message_id = int(state.get("last_message_id", 0))
    processed = 0
    max_seen = last_message_id
    chat_slug = slugify(config.chat)
    poll_started_at = datetime.now(timezone.utc)
    processing_error: str | None = None

    try:
        async with httpx.AsyncClient() as http:
            messages: list[Message] = []
            async for message in client.iter_messages(
                config.chat, limit=config.limit, offset_date=config.history_before,
            ):
                if config.history_after and message.date and message.date < config.history_after:
                    break
                if not config.history_before and message.id and message.id <= last_message_id:
                    break
                messages.append(message)

            for message in reversed(messages):
                try:
                    accepted = await process_message(message, config, http)
                    if accepted:
                        processed += 1
                except Exception as exc:
                    processing_error = f"message {message.id}: {type(exc).__name__}: {exc}"
                    print(f"[telegram-ingest:{chat_slug}] error on {processing_error}", file=sys.stderr)
                    break
                if message.id and message.id > max_seen:
                    max_seen = message.id
    except Exception as exc:
        failure_state = dict(state)
        failure_state.update({
            "last_message_id": last_message_id,
            "last_poll_started_at": poll_started_at.isoformat(),
            "last_poll_at": datetime.now(timezone.utc).isoformat(),
            "last_error": f"{type(exc).__name__}: {exc}",
            "consecutive_failures": int(state.get("consecutive_failures", 0)) + 1,
        })
        save_state(config.state_file, failure_state)
        raise

    if not config.history_before:
        next_state = dict(state)
        next_state.update({
            "last_message_id": max_seen,
            "last_poll_started_at": poll_started_at.isoformat(),
            "last_poll_at": datetime.now(timezone.utc).isoformat(),
            "last_processed_count": processed,
        })
        if processing_error:
            next_state["last_error"] = processing_error
            next_state["consecutive_failures"] = int(state.get("consecutive_failures", 0)) + 1
        else:
            next_state["last_success_at"] = datetime.now(timezone.utc).isoformat()
            next_state["last_error"] = None
            next_state["consecutive_failures"] = 0
        save_state(config.state_file, next_state)

    return processed


async def run_forever(client: TelegramClient, config: CollectorConfig) -> None:
    chat_slug = slugify(config.chat)
    while True:
        processed = await run_once(client, config)
        print(f"[telegram-ingest:{chat_slug}] processed {processed} new attachment(s)")
        await asyncio.sleep(config.poll_interval_s)


async def run_all_chats(client: TelegramClient, configs: list[CollectorConfig]) -> None:
    """Run multiple chat collectors. In --once mode, run sequentially; otherwise
    all chats share the same poll loop (one pass per chat each interval)."""
    chat_slugs = [slugify(c.chat) for c in configs]
    print(f"[telegram-ingest] watching {len(configs)} chat(s): {', '.join(chat_slugs)}")

    if configs[0].once:
        total = 0
        for cfg in configs:
            n = await run_once(client, cfg)
            total += n
        print(json.dumps({"total_processed": total}, ensure_ascii=False))
        return

    # Forever loop: process each chat each interval
    while True:
        total = 0
        for cfg in configs:
            try:
                n = await run_once(client, cfg)
                total += n
            except Exception as exc:
                print(
                    f"[telegram-ingest:{slugify(cfg.chat)}] poll failed: "
                    f"{type(exc).__name__}: {exc}",
                    file=sys.stderr,
                )
        print(f"[telegram-ingest] processed {total} new attachment(s) across {len(configs)} chat(s)")
        await asyncio.sleep(configs[0].poll_interval_s)


# ---- Main ----

async def async_main() -> None:
    _, configs = parse_args()
    if not configs:
        print("[telegram-ingest] No chats configured. Use --chat or --chats.", file=sys.stderr)
        sys.exit(1)

    first = configs[0]
    first.session_file.parent.mkdir(parents=True, exist_ok=True)

    client = TelegramClient(
        str(first.session_file),
        first.api_id,
        first.api_hash,
        proxy=build_telegram_proxy(first),
    )
    phone = os.getenv("TELEGRAM_PHONE", "")
    code = os.getenv("TELEGRAM_CODE", "")
    password = os.getenv("TELEGRAM_PASSWORD", "")

    if phone and code:
        await client.start(phone=phone, code_callback=lambda: code)
    elif phone and password:
        await client.start(phone=phone, password=password)
    elif phone:
        await client.start(phone=phone)
    else:
        await client.start()

    try:
        if len(configs) > 1:
            await run_all_chats(client, configs)
        elif first.once:
            processed = await run_once(client, first)
            print(json.dumps({"processed": processed, "chat": first.chat}, ensure_ascii=False))
        else:
            await run_forever(client, first)
    finally:
        await client.disconnect()


if __name__ == "__main__":
    if sys.platform.startswith("win") and hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    asyncio.run(async_main())

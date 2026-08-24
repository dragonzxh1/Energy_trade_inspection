'''
Publish Platts Summary image to WeChat Official Account as a draft.

Usage:
  python -m intelligence.platts_image_publish --date 2026-07-21
  python -m intelligence.platts_image_publish --date 2026-07-21 --source /path/to/image.jpg --action draft
  python -m intelligence.platts_image_publish --date 2026-07-21 --action publish
'''
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
VAULT = Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault"))
DAILY_PRICE_ROOT = Path(os.getenv("DAILY_PRICE_ROOT", VAULT / "reports" / "prices"))
WECHAT_CONFIG_PATH = Path(os.getenv("WECHAT_MP_CONFIG", ROOT_DIR / "intelligence" / "wechat_publish.json"))
QR_PATH = Path(os.getenv("WECHAT_OFFICIAL_QR_PATH", ROOT_DIR / "qrcode_for_gh_f8b242c5263e_344.jpg"))

DRAFT_ADD_URL = "https://api.weixin.qq.com/cgi-bin/draft/add"
MATERIAL_ADD_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material"
TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token"
FREEPUBLISH_SUBMIT_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/submit"


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="." + path.name + ".", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(Path(tmp), path)
    finally:
        Path(tmp).unlink(missing_ok=True)


def http_post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def http_post_multipart(url: str, field_name: str, file_path: Path) -> dict[str, Any]:
    boundary = "----WebKitFormBoundary" + hashlib.md5(str(file_path).encode()).hexdigest()[:16]
    mime_type = "image/png" if file_path.suffix.lower() == ".png" else "image/jpeg"

    header1 = "--" + boundary + "\r\n"
    header1 += "Content-Disposition: form-data; name=\"" + field_name + "\"; filename=\"" + file_path.name + "\"\r\n"
    header1 += "Content-Type: " + mime_type + "\r\n\r\n"
    footer = "\r\n--" + boundary + "--\r\n"

    body = header1.encode() + file_path.read_bytes() + footer.encode()

    req = urllib.request.Request(url, data=body,
        headers={"Content-Type": "multipart/form-data; boundary=" + boundary})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read())


def ensure_wechat_ok(response: dict[str, Any], operation: str) -> dict[str, Any]:
    errcode = response.get("errcode", 0)
    if errcode != 0:
        errmsg = response.get("errmsg", "")
        raise RuntimeError("WeChat " + operation + " failed: errcode=" + str(errcode) + " errmsg=" + str(errmsg))
    return response


def get_access_token(config: dict[str, Any]) -> str:
    cache_path = VAULT / "reports" / "wechat_publish" / "access_token.json"
    cached = load_json(cache_path)
    if cached.get("expires_at", 0) > datetime.now(timezone.utc).timestamp() + 120:
        return cached["access_token"]

    appid = config.get("appid", "")
    appsecret = config.get("appsecret", "")
    if not appid or not appsecret:
        raise RuntimeError("WeChat appid/appsecret not configured")

    url = TOKEN_URL + "?grant_type=client_credential&appid=" + appid + "&secret=" + appsecret
    with urllib.request.urlopen(url, timeout=30) as resp:
        data = json.loads(resp.read())

    if "access_token" not in data:
        raise RuntimeError("Failed to get WeChat access token: " + str(data))

    data["expires_at"] = datetime.now(timezone.utc).timestamp() + data.get("expires_in", 7200)
    save_json(cache_path, data)
    return data["access_token"]


def upload_image_material(access_token: str, image_path: Path) -> str:
    params = {"access_token": access_token, "type": "image"}
    url = MATERIAL_ADD_URL + "?" + urllib.parse.urlencode(params)
    response = ensure_wechat_ok(http_post_multipart(url, "media", image_path), "upload image material")
    media_id = clean_text(response.get("media_id"))
    if not media_id:
        raise RuntimeError("WeChat upload succeeded but media_id missing")
    return media_id


def create_image_draft(access_token: str, title: str, image_media_id: str,
                       digest: str = "", author: str = "ETI") -> dict[str, Any]:
    content = "<section><p>" + title + "</p></section>"
    payload = {
        "articles": [{
            "title": title,
            "author": author,
            "digest": digest or title,
            "content": content,
            "content_source_url": "",
            "thumb_media_id": image_media_id,
            "need_open_comment": 0,
            "only_fans_can_comment": 0,
        }]
    }
    url = DRAFT_ADD_URL + "?" + urllib.parse.urlencode({"access_token": access_token})
    response = ensure_wechat_ok(http_post_json(url, payload), "create draft")
    if not clean_text(response.get("media_id")):
        raise RuntimeError("WeChat create draft succeeded but media_id missing")
    return response


def publish_draft(access_token: str, draft_media_id: str) -> dict[str, Any]:
    url = FREEPUBLISH_SUBMIT_URL + "?" + urllib.parse.urlencode({"access_token": access_token})
    payload = {"media_id": draft_media_id}
    return ensure_wechat_ok(http_post_json(url, payload), "free publish")


def process_platts_image(
    source_path: Path,
    target_date: str,
    config: dict[str, Any],
    action: str = "draft",
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "ok": False,
        "date": target_date,
        "action": action,
        "source": str(source_path),
        "started_at": datetime.now(timezone.utc).isoformat(),
    }
    if dry_run:
        result["dry_run"] = True

    # Step 1: QR replacement (always runs, even in dry-run)
    try:
        from intelligence.public_price_image import create_public_price_image
        import yaml

        prices_config = yaml.safe_load(
            (ROOT_DIR / "intelligence" / "config" / "daily_prices.yaml").read_text(encoding="utf-8")
        )
        pref = prices_config["public_reference_image"]

        qr_path = QR_PATH if QR_PATH.is_absolute() else ROOT_DIR / QR_PATH
        if not qr_path.is_file():
            raise FileNotFoundError("QR image not found: " + str(qr_path))

        output_dir = DAILY_PRICE_ROOT / target_date
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "public_reference.png"

        image_result = create_public_price_image(source_path, qr_path, output_path, pref)
        result["qr_replace"] = {
            "output_path": str(image_result.output_path),
            "source_sha256": image_result.source_sha256,
            "output_sha256": image_result.output_sha256,
        }
        print("QR replaced: " + str(image_result.output_path))
    except Exception as e:
        result["error"] = "QR replace: " + str(e)
        print("ERROR: QR replace failed: " + str(e))
        return result

    if dry_run:
        result["ok"] = True
        result["completed_at"] = datetime.now(timezone.utc).isoformat()
        result["publication_stage"] = "dry_run_qr_only"
        state_path = DAILY_PRICE_ROOT / target_date / "platts_publish_state.json"
        save_json(state_path, result)
        print("Dry-run: QR replaced, skipping WeChat API calls")
        return result

    # Step 2: Upload image to WeChat
    try:
        access_token = get_access_token(config)
        processed_path = Path(image_result.output_path)
        image_media_id = upload_image_material(access_token, processed_path)
        result["image_media_id"] = image_media_id
        print("Image uploaded: media_id=" + image_media_id)
    except Exception as e:
        result["error"] = "Upload: " + str(e)
        print("ERROR: Upload failed: " + str(e))
        return result

    # Step 3: Create draft
    title = "能源市场报价 | " + target_date
    try:
        draft_response = create_image_draft(
            access_token, title, image_media_id,
            digest="Platts Summary 每日能源报价 | " + target_date
        )
        draft_media_id = clean_text(draft_response.get("media_id"))
        result["draft_media_id"] = draft_media_id
        result["publication_stage"] = "draft_created"
        print("Draft created: media_id=" + draft_media_id)
    except Exception as e:
        result["error"] = "Draft: " + str(e)
        print("ERROR: Draft creation failed: " + str(e))
        return result

    # Step 4: Optionally publish
    if action == "publish":
        try:
            publish_response = publish_draft(access_token, result["draft_media_id"])
            publish_id = clean_text(publish_response.get("publish_id"))
            result["publish_id"] = publish_id
            result["publication_stage"] = "publish_submitted"
            print("Published: publish_id=" + publish_id)
        except Exception as e:
            result["error"] = "Publish: " + str(e)
            print("ERROR: Publish failed: " + str(e))
            return result

    result["ok"] = True
    result["completed_at"] = datetime.now(timezone.utc).isoformat()

    # Save state
    state_path = DAILY_PRICE_ROOT / target_date / "platts_publish_state.json"
    save_json(state_path, result)

    return result


def find_source_image(target_date: str) -> Path | None:
    captures_dir = DAILY_PRICE_ROOT / "captures" / target_date
    if captures_dir.is_dir():
        for slot_dir in sorted(captures_dir.iterdir(), reverse=True):
            source = slot_dir / "platts_summary.jpg"
            if source.is_file():
                return source
            for ext in (".jpg", ".jpeg", ".png"):
                candidates = list(slot_dir.glob("*" + ext))
                if candidates:
                    return candidates[0]

    input_dir = DAILY_PRICE_ROOT / "input" / target_date
    if input_dir.is_dir():
        for ext in (".jpg", ".jpeg", ".png"):
            candidates = list(input_dir.glob("*" + ext))
            if candidates:
                return candidates[0]

    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish Platts Summary image to WeChat")
    parser.add_argument("--date", required=True, help="Target date (YYYY-MM-DD)")
    parser.add_argument("--source", type=Path, help="Source Platts image path")
    parser.add_argument("--action", choices=("draft", "publish"), default="draft")
    parser.add_argument("--dry-run", action="store_true", help="Stop after QR replacement, skip WeChat API")
    parser.add_argument("--config", type=Path, default=WECHAT_CONFIG_PATH)
    args = parser.parse_args(argv)

    config = load_json(args.config)
    if not config.get("appid") and not args.dry_run:
        print("ERROR: WeChat config not found", file=sys.stderr)
        return 1

    source = args.source
    if not source:
        source = find_source_image(args.date)
    if not source or not source.is_file():
        print("ERROR: No source image found for " + args.date, file=sys.stderr)
        return 1

    result = process_platts_image(source, args.date, config, args.action, dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))

    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())

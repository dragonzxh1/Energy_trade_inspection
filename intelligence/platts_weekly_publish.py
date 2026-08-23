'''
Weekly Platts Summary image roundup for WeChat Official Account.

Every Saturday, collects the past week (Mon-Fri) Platts images,
replaces QR codes, and creates a multi-article WeChat draft.

Usage:
  python -m intelligence.platts_weekly_publish --date 2026-07-25
  python -m intelligence.platts_weekly_publish --date 2026-07-25 --action publish
'''
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import tempfile
import urllib.parse
import urllib.request
import urllib.error
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
VAULT = Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault"))
DAILY_PRICE_ROOT = Path(os.getenv("DAILY_PRICE_ROOT", VAULT / "reports" / "prices"))
WECHAT_CONFIG_PATH = Path(os.getenv("WECHAT_MP_CONFIG", ROOT_DIR / "intelligence" / "wechat_publish.json"))
QR_PATH = Path(os.getenv("WECHAT_OFFICIAL_QR_PATH", ROOT_DIR / "qrcode_for_gh_f8b242c5263e_344.jpg"))

ARTICLE_IMAGE_UPLOAD_URL = "https://api.weixin.qq.com/cgi-bin/media/uploadimg"
DRAFT_ADD_URL = "https://api.weixin.qq.com/cgi-bin/draft/add"
TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("platts_weekly")


def clean_text(value):
    if value is None:
        return ""
    return str(value).strip()


def load_json(path):
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path, data):
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


def http_post_multipart(url, field_name, file_path):
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


def http_post_json(url, payload):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())


def ensure_wechat_ok(response, operation):
    errcode = response.get("errcode", 0)
    if errcode != 0:
        errmsg = response.get("errmsg", "")
        raise RuntimeError("WeChat " + operation + " failed: errcode=" + str(errcode) + " errmsg=" + str(errmsg))
    return response


def get_access_token(config):
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


def upload_article_image(access_token, image_path):
    url = ARTICLE_IMAGE_UPLOAD_URL + "?" + urllib.parse.urlencode({"access_token": access_token})
    response = ensure_wechat_ok(http_post_multipart(url, "media", image_path), "upload article image")
    image_url = clean_text(response.get("url"))
    if not image_url:
        raise RuntimeError("WeChat article image upload succeeded but url missing")
    return image_url


def weekdays_before(saturday):
    # Find the Monday of the week containing this Saturday
    monday = saturday - timedelta(days=5)
    return [monday + timedelta(days=i) for i in range(5)]


def find_image_for_date(target_date):
    input_dir = DAILY_PRICE_ROOT / "input" / target_date
    if input_dir.is_dir():
        for ext in (".jpg", ".jpeg", ".png"):
            candidates = list(input_dir.glob("*" + ext))
            if candidates:
                return candidates[0]

    daily_dir = DAILY_PRICE_ROOT / target_date
    if daily_dir.is_dir():
        ref = daily_dir / "public_reference.png"
        if ref.is_file():
            return ref

    return None


def process_image(source_path, target_date, force=False):
    from intelligence.public_price_image import create_public_price_image
    import yaml

    output_dir = DAILY_PRICE_ROOT / target_date
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / "public_reference.png"

    if output_path.is_file() and not force:
        log.info("QR already exists for %s, reusing", target_date)
        return output_path

    prices_config = yaml.safe_load(
        (ROOT_DIR / "intelligence" / "config" / "daily_prices.yaml").read_text(encoding="utf-8")
    )
    pref = prices_config["public_reference_image"]

    qr_path = QR_PATH if QR_PATH.is_absolute() else ROOT_DIR / QR_PATH
    if not qr_path.is_file():
        raise FileNotFoundError("QR image not found: " + str(qr_path))

    result = create_public_price_image(source_path, qr_path, output_path, pref)
    log.info("QR replaced for %s: %s", target_date, result.output_path)
    return Path(result.output_path)


def publish_weekly(saturday_date, config, action="draft"):
    days = weekdays_before(saturday_date)
    day_range = days[0].isoformat() + " to " + days[-1].isoformat()
    log.info("Week ending %s: %s", saturday_date, day_range)

    result = {
        "ok": False,
        "saturday": saturday_date.isoformat(),
        "action": action,
        "days_processed": [],
        "days_missing": [],
        "started_at": datetime.now(timezone.utc).isoformat(),
    }

    articles = []
    access_token = get_access_token(config)

    for day in days:
        day_str = day.isoformat()
        source = find_image_for_date(day_str)

        if not source:
            result["days_missing"].append(day_str)
            log.info("No image for %s, skipping", day_str)
            continue

        try:
            processed = process_image(source, day_str)
            image_url = upload_article_image(access_token, processed)

            weekday_name = ["??", "??", "??", "??", "??", "??", "??"][day.weekday()]
            title = "???? | " + day_str + " " + weekday_name

            content = (
                '<section style="padding:10px 0;">'
                + '<p style="text-align:center;color:#007f6f;font-size:18px;font-weight:bold;margin:10px 0;">'
                + title + "</p>"
                + '<img data-src="' + image_url + '" '
                + 'style="width:100%%;display:block;margin:0 auto;" />'
                + "</section>"
            )

            articles.append({
                "title": title,
                "author": "ETI",
                "digest": "Platts Summary | " + day_str,
                "content": content,
                "content_source_url": "",
                "need_open_comment": 0,
                "only_fans_can_comment": 0,
            })
            result["days_processed"].append(day_str)
            log.info("Processed %s", day_str)

        except Exception as e:
            result["days_missing"].append(day_str)
            log.warning("Failed %s: %s", day_str, e)

    if not articles:
        result["error"] = "No images found for this week"
        log.warning("No images to publish")
        return result

    # Upload first image as thumb material
    first_day = result["days_processed"][0]
    first_processed = DAILY_PRICE_ROOT / first_day / "public_reference.png"

    from intelligence.platts_image_publish import upload_image_material
    thumb_media_id = upload_image_material(access_token, first_processed)

    for article in articles:
        article["thumb_media_id"] = thumb_media_id

    # Create multi-article draft
    try:
        payload = {"articles": articles}
        url = DRAFT_ADD_URL + "?" + urllib.parse.urlencode({"access_token": access_token})
        draft_response = ensure_wechat_ok(http_post_json(url, payload), "create weekly draft")
        draft_media_id = clean_text(draft_response.get("media_id"))
        result["draft_media_id"] = draft_media_id
        result["article_count"] = len(articles)
        result["ok"] = True
        log.info("Weekly draft created: %s (%d articles)", draft_media_id, len(articles))
    except Exception as e:
        result["error"] = "Draft: " + str(e)
        log.error("Draft failed: %s", e)
        return result

    result["completed_at"] = datetime.now(timezone.utc).isoformat()

    state_dir = DAILY_PRICE_ROOT / "weekly" / saturday_date.isoformat()
    state_dir.mkdir(parents=True, exist_ok=True)
    save_json(state_dir / "weekly_publish_state.json", result)

    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description="Weekly Platts image roundup for WeChat")
    parser.add_argument("--date", required=True, help="Saturday date (YYYY-MM-DD)")
    parser.add_argument("--action", choices=("draft", "publish"), default="draft")
    parser.add_argument("--config", type=Path, default=WECHAT_CONFIG_PATH)
    args = parser.parse_args(argv)

    config = load_json(args.config)
    if not config.get("appid"):
        print("ERROR: WeChat config not found", file=sys.stderr)
        return 1

    saturday = date.fromisoformat(args.date)
    result = publish_weekly(saturday, config, args.action)
    print(json.dumps(result, ensure_ascii=False, indent=2))

    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())

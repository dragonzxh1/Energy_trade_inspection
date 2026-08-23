"""
ETI WeChat Official Account publisher.
"""
import argparse
import hashlib
import html
import json
import mimetypes
import os
import re
import struct
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error
import zlib
from datetime import date, datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Literal, cast

from intelligence.content_streams import (
    ArticleLocator,
    artifact_identity_issues,
    resolve_article_paths,
)
from intelligence.daily_prices import resolve_daily_price_root

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    def load_dotenv(*_args: Any, **_kwargs: Any) -> bool:
        return False


def load_project_env(path: Path) -> bool:
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return load_dotenv(path, encoding=encoding)
        except UnicodeDecodeError:
            continue
    return False


load_project_env(Path(__file__).parent.parent / ".env.local")

ROOT_DIR = Path(__file__).resolve().parent.parent
VAULT = Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault"))
REPORTS_DIR = VAULT / "reports"
STATE_DIR = REPORTS_DIR / "wechat_publish"
QUALITY_DIR = REPORTS_DIR / "quality"
DEFAULT_CONFIG_PATH = Path(os.getenv("WECHAT_MP_CONFIG", ROOT_DIR / "intelligence" / "wechat_publish.json"))
TOKEN_CACHE_PATH = STATE_DIR / "access_token.json"
ROLLOUT_STATE_PATH = STATE_DIR / "rollout_state.json"
DAILY_PRICE_ROOT = resolve_daily_price_root()

TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token"
DRAFT_ADD_URL = "https://api.weixin.qq.com/cgi-bin/draft/add"
DRAFT_GET_URL = "https://api.weixin.qq.com/cgi-bin/draft/get"
DRAFT_BATCHGET_URL = "https://api.weixin.qq.com/cgi-bin/draft/batchget"
FREEPUBLISH_SUBMIT_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/submit"
FREEPUBLISH_GET_URL = "https://api.weixin.qq.com/cgi-bin/freepublish/get"
MATERIAL_ADD_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material"
ARTICLE_IMAGE_UPLOAD_URL = "https://api.weixin.qq.com/cgi-bin/media/uploadimg"
ARTICLE_IMAGE_TOKEN = "%%ETI_PRICE_REFERENCE_IMAGE%%"
ARTICLE_IMAGE_SECTION_PATTERN = re.compile(
    r'<section\b[^>]*\bdata-eti-price-reference=["\']true["\'][^>]*>.*?</section>',
    re.IGNORECASE | re.DOTALL,
)
PUBLICATION_LEAK_PATTERNS = {
    "local filename": r"public_reference\.png|文件名",
    "local image URL": r"file\s*://|data\s*:\s*image/[^;]+;\s*base64",
    "internal messaging channel": r"(?<![A-Za-z])Telegram(?![A-Za-z])",
    "internal extraction wording": r"(?<![A-Za-z])OCR(?![A-Za-z])|(?<![A-Za-z])bot(?![A-Za-z])",
    "AI wording": r"AI(?:生成|撰写|工具|模型|助手)|由AI|人工智能生成|自动生成|大语言模型|作为AI|作为一个AI",
}

PUBLICATION_DISCLAIMER = (
    "本文仅供能源市场信息交流，不构成投资、交易、法律或其他专业建议。"
    "市场信息可能随时更新，请以原始来源及最新公告为准。"
)
SUMMARY_PUBLICATION_DISCLAIMER = (
    "本图片报价仅供能源市场信息参考，不构成投资或交易建议。"
    "具体价格、单位及使用条件以原始图片和相关数据产品说明为准。"
)


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as temporary_file:
            temporary_file.write(json.dumps(data, ensure_ascii=False, indent=2))
            temporary_file.write("\n")
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def load_price_release_state(target_date: str) -> dict[str, Any]:
    return load_json(DAILY_PRICE_ROOT / target_date / "release_state.json")


def price_release_gate(
    release_state: dict[str, Any],
    *,
    mode: str,
    historical: bool,
    price_mode: str = "shadow",
    stream: str = "legacy",
) -> str | None:
    if mode != "daily" or historical:
        return None
    if not release_state:
        return None if price_mode == "off" else "price_release_state_missing"
    if stream == "summary":
        if release_state.get("image_quote_ready") is True:
            return None
        reasons = release_state.get("blocking_reasons") or []
        return clean_text(reasons[0]) if reasons else "summary_image_quote_not_ready"
    status = clean_text(release_state.get("status"))
    if status == "waiting_for_prices":
        return status
    if status in {"ready_with_prices", "ready_without_prices", "published"}:
        return None
    raise RuntimeError(f"Unknown daily price release status: {status or 'missing'}")


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).replace("\r\n", "\n").replace("\r", "\n").strip()


def publication_leaks(*values: Any) -> list[str]:
    combined = "\n".join(clean_text(value) for value in values)
    return [
        label for label, pattern in PUBLICATION_LEAK_PATTERNS.items()
        if re.search(pattern, combined, re.IGNORECASE | re.DOTALL)
    ]


class ArticleImageSourceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.sources: list[str | None] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "img":
            return
        source_values = [
            value for name, value in attrs
            if name.lower() in {"src", "data-src"}
        ]
        self.sources.append(source_values[0] if len(source_values) == 1 else None)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)


def article_image_sources(content: str) -> list[str | None]:
    parser = ArticleImageSourceParser()
    parser.feed(content)
    parser.close()
    return parser.sources


def wechat_image_urls_match(expected_url: str, actual_url: str | None) -> bool:
    if not actual_url:
        return False
    if expected_url == actual_url:
        return True
    expected = urllib.parse.urlparse(expected_url)
    actual = urllib.parse.urlparse(actual_url)
    expected_host = (expected.hostname or "").lower()
    actual_host = (actual.hostname or "").lower()
    if not (
        expected.scheme.lower() == actual.scheme.lower() == "https"
        and expected_host == actual_host
        and expected_host.endswith("mmbiz.qpic.cn")
    ):
        return False
    def image_identity(path: str) -> str:
        return re.sub(r"/\d+$", "", path.rstrip("/"))
    return image_identity(expected.path) == image_identity(actual.path)


def ensure_final_article_content(content: str, article_image_url: str = "") -> None:
    if ARTICLE_IMAGE_TOKEN in content:
        raise RuntimeError("Article image token cannot enter the final payload")
    leaks = publication_leaks(content)
    if leaks:
        raise RuntimeError("Article contains forbidden publication artifacts: " + ", ".join(leaks))
    expected_url = clean_text(article_image_url)
    sources = article_image_sources(content)
    if not expected_url:
        if sources:
            raise RuntimeError("Article without an uploaded image cannot contain img tags")
        return
    parsed_url = urllib.parse.urlparse(expected_url)
    if parsed_url.scheme.lower() != "https" or not parsed_url.netloc:
        raise RuntimeError("Authorized article image URL must use HTTPS")
    if not sources:
        raise RuntimeError("Authorized article image URL is missing from img src")
    if any(not wechat_image_urls_match(expected_url, source) for source in sources):
        raise RuntimeError("Article contains an unauthorized img src")


def as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return clean_text(value).lower() in {"1", "true", "yes", "on"}


def compute_text_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compute_file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


BITMAP_FONT = {
    "A": "01110100011000111111100011000110001",
    "B": "11110100011000111110100011000111110",
    "C": "01111100001000010000100001000001111",
    "D": "11110100011000110001100011000111110",
    "E": "11111100001000011110100001000011111",
    "F": "11111100001000011110100001000010000",
    "G": "01111100001000010111100011000101111",
    "H": "10001100011000111111100011000110001",
    "I": "11111001000010000100001000010011111",
    "J": "00111000100001000010100101001001100",
    "K": "10001100101010011000101001001010001",
    "L": "10000100001000010000100001000011111",
    "M": "10001110111010110101100011000110001",
    "N": "10001110011010110011100011000110001",
    "O": "01110100011000110001100011000101110",
    "P": "11110100011000111110100001000010000",
    "Q": "01110100011000110001101011001001101",
    "R": "11110100011000111110101001001010001",
    "S": "01111100001000001110000010000111110",
    "T": "11111001000010000100001000010000100",
    "U": "10001100011000110001100011000101110",
    "V": "10001100011000110001100010101000100",
    "W": "10001100011000110101101011101110001",
    "X": "10001100010101000100010101000110001",
    "Y": "10001100010101000100001000010000100",
    "Z": "11111000010001000100010001000011111",
    "0": "01110100011001110101110011000101110",
    "1": "00100011000010000100001000010001110",
    "2": "01110100010000100010001000100011111",
    "3": "11110000010000101110000010000111110",
    "4": "00010001100101010010111110001000010",
    "5": "11111100001000011110000010000111110",
    "6": "01110100001000011110100011000101110",
    "7": "11111000010001000100010000100001000",
    "8": "01110100011000101110100011000101110",
    "9": "01110100011000101111000010000101110",
    "-": "00000000000000011111000000000000000",
    ".": "00000000000000000000000000110001100",
    " ": "00000000000000000000000000000000000",
}


def draw_rect(pixels: bytearray, width: int, height: int, x: int, y: int, rect_width: int, rect_height: int, color: tuple[int, int, int]) -> None:
    left = max(0, x)
    top = max(0, y)
    right = min(width, x + rect_width)
    bottom = min(height, y + rect_height)
    row = bytes(color) * max(0, right - left)
    for py in range(top, bottom):
        start = (py * width + left) * 3
        pixels[start:start + len(row)] = row


def draw_bitmap_text(pixels: bytearray, width: int, height: int, text: str, x: int, y: int, scale: int, color: tuple[int, int, int]) -> None:
    cursor = x
    for character in text.upper():
        glyph = BITMAP_FONT.get(character, BITMAP_FONT[" "])
        for row in range(7):
            for column in range(5):
                if glyph[row * 5 + column] == "1":
                    draw_rect(pixels, width, height, cursor + column * scale, y + row * scale, scale, scale, color)
        cursor += 6 * scale


def write_rgb_png(path: Path, width: int, height: int, pixels: bytearray) -> None:
    def chunk(chunk_type: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)

    scanlines = b"".join(b"\x00" + bytes(pixels[row * width * 3:(row + 1) * width * 3]) for row in range(height))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(scanlines, 9))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def generate_daily_cover(target_date: str) -> Path:
    cover_path = STATE_DIR / "covers" / f"{target_date}.png"
    width, height = 900, 383
    pixels = bytearray(bytes((10, 24, 42)) * width * height)
    draw_rect(pixels, width, height, 0, 0, width, 10, (20, 184, 166))
    draw_rect(pixels, width, height, 54, 62, 8, 260, (242, 153, 74))
    draw_rect(pixels, width, height, 650, 58, 194, 2, (50, 76, 101))
    draw_rect(pixels, width, height, 650, 320, 194, 2, (50, 76, 101))
    for x in range(650, 845, 32):
        draw_rect(pixels, width, height, x, 58, 1, 264, (31, 54, 77))
    draw_bitmap_text(pixels, width, height, "ETI", 92, 68, 9, (20, 184, 166))
    draw_bitmap_text(pixels, width, height, "ENERGY", 92, 166, 8, (242, 245, 247))
    draw_bitmap_text(pixels, width, height, "MARKET BRIEF", 92, 246, 6, (183, 198, 211))
    draw_bitmap_text(pixels, width, height, target_date.replace("-", "."), 665, 278, 4, (242, 153, 74))
    write_rgb_png(cover_path, width, height, pixels)
    return cover_path


def resolve_report_dir(mode: str) -> Path:
    if mode == "weekly":
        return REPORTS_DIR / "weekly"
    if mode == "monthly":
        return REPORTS_DIR / "monthly"
    return REPORTS_DIR


def load_quality_audit(
    locator: ArticleLocator | None,
    target_date: str = "",
) -> dict[str, Any]:
    path = (
        QUALITY_DIR / f"{target_date}.json"
        if locator is None
        else resolve_article_paths(locator, REPORTS_DIR).quality_audit
    )
    return load_json(path) if path.exists() else {}


def load_llm_review(
    locator: ArticleLocator | None,
    target_date: str = "",
) -> dict[str, Any]:
    path = (
        QUALITY_DIR / f"{target_date}_llm_review.json"
        if locator is None
        else resolve_article_paths(locator, REPORTS_DIR).llm_review
    )
    return load_json(path) if path.exists() else {}


def read_report_bundle(
    locator: ArticleLocator | None,
    mode: str,
    target_date: str = "",
) -> dict[str, Any]:
    if locator is None:
        base_dir = resolve_report_dir(mode)
        md_path = base_dir / f"{target_date}.md"
        html_path = base_dir / f"{target_date}_wechat.html"
        summary_path = base_dir / f"{target_date}_summary.txt"
    else:
        paths = resolve_article_paths(locator, REPORTS_DIR)
        base_dir = paths.markdown.parent
        md_path = paths.markdown
        html_path = paths.wechat_html
        summary_path = paths.summary
    if not md_path.exists():
        raise FileNotFoundError(f"Markdown report not found: {md_path}")
    return {
        "base_dir": str(base_dir),
        "md_path": md_path,
        "html_path": html_path,
        "summary_path": summary_path,
        "markdown": md_path.read_text(encoding="utf-8"),
        "html": html_path.read_text(encoding="utf-8") if html_path.exists() else "",
        "summary": summary_path.read_text(encoding="utf-8") if summary_path.exists() else "",
    }


def parse_markdown_title(markdown: str, fallback_date: str) -> str:
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return f"能源市场日报｜{fallback_date}"


def parse_markdown_digest(markdown: str, summary: str) -> str:
    if clean_text(summary):
        return clean_text(summary)[:120]
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped.startswith("> "):
            return stripped[2:].strip()[:120]
    for line in markdown.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and not stripped.startswith("- "):
            return stripped[:120]
    return ""


def parse_markdown_sections(markdown: str) -> tuple[str, list[dict[str, Any]]]:
    lead = ""
    sections: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for raw_line in markdown.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("# "):
            continue
        if line.startswith("## "):
            current = {"title": line[3:].strip(), "items": [], "paragraphs": []}
            sections.append(current)
            continue
        if line.startswith("> "):
            if current is None and not lead:
                lead = line[2:].strip()
            else:
                if current is None:
                    current = {"title": "正文", "items": [], "paragraphs": []}
                    sections.append(current)
                current["paragraphs"].append(line)
            continue
        if current is None:
            if not lead:
                lead = line
                continue
            current = {"title": "正文", "items": [], "paragraphs": []}
            sections.append(current)
        if line.startswith("- "):
            current["items"].append(line[2:].strip())
        else:
            current["paragraphs"].append(line)
    return lead, sections


def render_inline_markdown(text: str) -> str:
    escaped = html.escape(clean_text(text))
    escaped = re.sub(r"\*\*(.+?)\*\*：", r"<strong>\1</strong>：", escaped)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
    return escaped


def split_item_source(item: str) -> tuple[str, str]:
    text = clean_text(item)
    if "；来源：" in text:
        body, source = text.rsplit("；来源：", 1)
        return body.strip(), source.strip()
    return text, ""


def item_key(item: str) -> str:
    body, _ = split_item_source(item)
    title = body.split("：", 1)[0].strip()
    return title or body


def dedupe_sections_for_wechat(sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for index, section in enumerate(sections):
        new_items: list[str] = []
        for item in section.get("items", []):
            key = item_key(item)
            if key in seen and index > 0:
                continue
            seen.add(key)
            new_items.append(item)
        deduped.append({
            "title": section["title"],
            "items": new_items,
            "paragraphs": section.get("paragraphs", []),
        })
    return deduped


def source_titles_from_sections(sections: list[dict[str, Any]]) -> list[str]:
    titles: list[str] = []
    for section in sections:
        if clean_text(section.get("title")) not in {"参考资料", "资料", "资料来源"}:
            continue
        for value in [*section.get("items", []), *section.get("paragraphs", [])]:
            title = clean_text(value).lstrip("- ").strip()
            if title and title not in titles:
                titles.append(title)
    return titles


def append_publication_footer(
    content: str,
    *,
    source_titles: list[str] | None = None,
    stream: str = "digit",
) -> str:
    """Append one visible, deterministic source and disclaimer footer."""
    if 'data-eti-publication-footer="true"' in content:
        return content
    normalized_titles = [
        clean_text(title) for title in (source_titles or []) if clean_text(title)
    ]
    normalized_titles = list(dict.fromkeys(normalized_titles))
    if stream == "summary":
        source_text = "、".join(normalized_titles) or "Platts Summary 报价图片"
        disclaimer = SUMMARY_PUBLICATION_DISCLAIMER
    else:
        source_text = "、".join(normalized_titles) or "正文“参考资料”所列刊物与公开资料"
        disclaimer = PUBLICATION_DISCLAIMER
    footer = (
        '<section data-eti-publication-footer="true" style="margin-top:32px;padding:16px 0 0;'
        'border-top:1px solid #e5e7eb;font-size:12px;line-height:1.8;color:#6b7280;">'
        f'<p style="margin:0;"><strong>资料来源：</strong>{html.escape(source_text)}</p>'
        f'<p style="margin:8px 0 0;"><strong>免责声明：</strong>{html.escape(disclaimer)}</p>'
        "</section>"
    )
    if "</article>" in content:
        before, after = content.rsplit("</article>", 1)
        return f"{before}{footer}</article>{after}"
    return f"{content}{footer}"


def render_item_html(item: str) -> str:
    body, source = split_item_source(item)
    analysis_match = re.fullmatch(
        r"\*\*(.+?)\*\*：事实：(.*?)机制：(.*?)传导：(.*?)失效条件：(.*)",
        body,
        re.DOTALL,
    )
    if analysis_match:
        title, evidence, mechanism, transmission, invalidation = [clean_text(value) for value in analysis_match.groups()]
        rows = [
            ("事实", evidence),
            ("机制", mechanism),
            ("传导", transmission),
            ("失效条件", invalidation),
        ]
        row_html = "".join(
            '<p style="margin:8px 0 0;font-size:15px;line-height:1.9;color:#374151;">'
            f'<strong style="color:#0f766e;">{html.escape(label)}｜</strong>{html.escape(value)}</p>'
            for label, value in rows
        )
        return (
            '<section style="margin:0 0 16px;padding:16px 16px 14px;border-left:4px solid #0f766e;'
            'background:#f8fafc;">'
            f'<h3 style="margin:0 0 8px;font-size:18px;line-height:1.55;color:#111827;">{html.escape(title)}</h3>'
            f'{row_html}</section>'
        )
    scenario_match = re.fullmatch(r"\*\*(基准情景|强化情景|反转情景)\*\*：(.*)", body, re.DOTALL)
    if scenario_match:
        label, scenario_text = [clean_text(value) for value in scenario_match.groups()]
        return (
            '<section style="margin:0 0 12px;padding:14px 15px;border:1px solid #e5e7eb;'
            'border-radius:12px;background:#fff;">'
            f'<p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#0f766e;">{html.escape(label)}</p>'
            f'<p style="margin:0;font-size:15px;line-height:1.9;color:#374151;">{html.escape(scenario_text)}</p></section>'
        )
    main = render_inline_markdown(body)
    source_html = ""
    if source:
        source_html = (
            f'<p style="margin:8px 0 0;font-size:12px;line-height:1.7;color:#9ca3af;">'
            f'来源：{html.escape(source)}</p>'
        )
    return (
        '<section style="margin:0 0 12px;padding:14px 14px 12px;border:1px solid #e5e7eb;'
        f'border-radius:12px;background:#fff;"><p style="margin:0;font-size:15px;line-height:1.9;color:#1f2937;">{main}</p>{source_html}</section>'
    )


def render_price_overview_section(
    section: dict[str, Any],
    *,
    include_reference_image: bool,
) -> str:
    groups: dict[str, list[tuple[str, str, str, str]]] = {}
    for item in section.get("items", []):
        fields = [clean_text(field) for field in item.split("｜")]
        if len(fields) != 5:
            continue
        region, product, location, price, change = fields
        groups.setdefault(region, []).append((product, location, price, change))
    parts = [
        '<h2 style="margin:32px 0 12px;padding-left:10px;border-left:4px solid #0f766e;'
        'font-size:22px;line-height:1.45;color:#111827;">今日价格速览</h2>'
    ]
    for paragraph in section.get("paragraphs", []):
        parts.append(
            '<p style="margin:0 0 16px;font-size:13px;line-height:1.8;color:#6b7280;">'
            f'{html.escape(clean_text(paragraph))}</p>'
        )
    for region, rows in groups.items():
        parts.append(
            '<section style="margin:0 0 16px;padding:14px;border:1px solid #e5e7eb;'
            'border-radius:12px;background:#ffffff;">'
            f'<h3 style="margin:0 0 10px;font-size:16px;line-height:1.5;color:#111827;">{html.escape(region)}</h3>'
        )
        for product, location, price, change in rows:
            try:
                change_value = float(change.replace(",", ""))
            except ValueError:
                change_value = 0.0
            change_color = "#047857" if change_value > 0 else "#b91c1c" if change_value < 0 else "#374151"
            parts.append(
                '<section style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;'
                'padding:10px 0;border-top:1px solid #f1f5f9;">'
                '<p style="min-width:0;margin:0;font-size:14px;line-height:1.65;color:#1f2937;">'
                f'<strong>{html.escape(product)}</strong><br><span style="font-size:12px;color:#6b7280;">{html.escape(location)}</span></p>'
                '<p style="flex:0 0 116px;margin:0;text-align:right;font-size:14px;line-height:1.65;color:#111827;">'
                f'<strong>{html.escape(price)}</strong><br><span aria-label="涨跌 {html.escape(change)}" '
                f'style="font-size:12px;color:{change_color};">涨跌 {html.escape(change)}</span></p></section>'
            )
        parts.append("</section>")
    if include_reference_image:
        parts.append(
            '<section data-eti-price-reference="true" style="margin:18px 0 0;padding:12px;'
            'border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;">'
            '<p style="margin:0 0 8px;font-size:12px;line-height:1.7;color:#6b7280;">市场价格参考图</p>'
            f'{ARTICLE_IMAGE_TOKEN}</section>'
        )
    return "".join(parts)


def render_wechat_body(
    title: str,
    digest: str,
    lead: str,
    sections: list[dict[str, Any]],
    target_date: str,
    *,
    preview: bool,
    include_price_reference: bool = False,
) -> str:
    parts = [
        '<article style="max-width:760px;margin:0 auto;background:#ffffff;color:#1f2937;'
        "font-family:PingFang SC,Microsoft YaHei,sans-serif;\">",
    ]
    if preview:
        parts.append(
            '<p style="margin:0 0 8px;font-size:12px;letter-spacing:.08em;color:#0f766e;'
            'font-weight:700;text-transform:uppercase;">ETI WeChat Preview</p>'
        )
    parts.append(
        f'<h1 style="margin:0 0 12px;font-size:30px;line-height:1.35;color:#111827;">{html.escape(title)}</h1>'
    )
    if preview:
        parts.append(
            f'<p style="margin:0 0 22px;font-size:13px;color:#6b7280;">{html.escape(target_date)} · 自动发布预览稿</p>'
        )
    lead_text = lead or digest
    if lead_text:
        parts.append(
            '<section style="margin:0 0 26px;padding:16px 16px 14px;border-left:4px solid #14b8a6;'
            f'background:#f8fafc;"><p style="margin:0;font-size:16px;line-height:1.9;color:#1f2937;">{html.escape(lead_text)}</p></section>'
        )
    for section in dedupe_sections_for_wechat(sections):
        items = section.get("items", [])
        paragraphs = section.get("paragraphs", [])
        if not items and not paragraphs:
            continue
        if section["title"] == "今日价格速览":
            parts.append(render_price_overview_section(
                section,
                include_reference_image=include_price_reference,
            ))
            continue
        parts.append(
            f'<h2 style="margin:32px 0 12px;padding-left:10px;border-left:4px solid #0f766e;'
            f'font-size:22px;line-height:1.45;color:#111827;">{html.escape(section["title"])}</h2>'
        )
        if section["title"] == "参考资料":
            for item in items:
                parts.append(
                    f'<p style="margin:0 0 6px;font-size:13px;line-height:1.8;color:#6b7280;">'
                    f'{render_inline_markdown(item)}</p>'
                )
            continue
        for paragraph in paragraphs:
            paragraph_text = clean_text(paragraph)
            if paragraph_text.startswith("> "):
                parts.append(
                    '<blockquote style="margin:0 0 14px;padding:12px 14px;border-left:3px solid #94a3b8;'
                    'background:#f8fafc;font-size:15px;line-height:1.95;color:#334155;">'
                    f'{render_inline_markdown(paragraph_text[2:])}</blockquote>'
                )
            else:
                parts.append(
                    f'<p style="margin:0 0 14px;font-size:15px;line-height:1.95;color:#374151;">'
                    f'{render_inline_markdown(paragraph_text)}</p>'
                )
        for item in items:
            parts.append(render_item_html(item))
    if preview:
        parts.append(
            '<section style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;'
            'font-size:12px;line-height:1.8;color:#9ca3af;">'
            '<p style="margin:0;">此文件为公众号发布前预览，用于检查排版、语言强度与段落完整性。</p>'
            '<p style="margin:6px 0 0;">真正调用公众号接口时，脚本会提交同一份正文 HTML 到草稿箱或发布接口。</p>'
            "</section>"
        )
    parts.append("</article>")
    return append_publication_footer(
        "".join(parts),
        source_titles=source_titles_from_sections(sections),
    )


def render_preview_html(
    title: str,
    digest: str,
    lead: str,
    sections: list[dict[str, Any]],
    target_date: str,
    *,
    include_price_reference: bool = False,
) -> str:
    body = render_wechat_body(
        title, digest, lead, sections, target_date,
        preview=True,
        include_price_reference=include_price_reference,
    )
    return (
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">"
        f"<title>{html.escape(title)}</title>"
        "<style>body{margin:0;background:#f5f7fb;padding:20px 14px 48px;}</style>"
        f"</head><body>{body}</body></html>"
    )


def build_wechat_content(
    markdown: str,
    html_text: str,
    digest: str,
    target_date: str,
    *,
    include_price_reference: bool = False,
) -> tuple[str, str]:
    lead, sections = parse_markdown_sections(markdown)
    title = parse_markdown_title(markdown, target_date)
    content = render_wechat_body(
        title, digest, lead, sections, target_date,
        preview=False,
        include_price_reference=include_price_reference,
    )
    preview_html = render_preview_html(
        title, digest, lead, sections, target_date,
        include_price_reference=include_price_reference,
    )
    if len(clean_text(content)) < 120 and html_text:
        fallback = clean_text(html_text)
        body_match = re.search(r"<body\b[^>]*>(.*)</body>", fallback, re.IGNORECASE | re.DOTALL)
        content = body_match.group(1).strip() if body_match else fallback
        ensure_final_article_content(content, "")
    return content, preview_html


def markdown_to_report_html(markdown: str, summary: str, target_date: str) -> str:
    """Render canonical report Markdown into a standalone WeChat-compatible HTML document."""
    digest = parse_markdown_digest(markdown, summary)
    lead, sections = parse_markdown_sections(markdown)
    title = parse_markdown_title(markdown, target_date)
    body = render_wechat_body(title, digest, lead, sections, target_date, preview=False)
    return (
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
        f'<title>{html.escape(title)}</title>'
        '<style>body{margin:0;background:#ffffff;padding:20px 14px 48px;}</style>'
        f'</head><body>{body}</body></html>'
    )


def read_publish_config(config_path: Path) -> dict[str, Any]:
    file_config = load_json(config_path) if config_path.exists() else {}
    env_config = {
        "account_id": os.getenv("WECHAT_MP_ACCOUNT_ID", ""),
        "appid": os.getenv("WECHAT_MP_APP_ID", ""),
        "appsecret": os.getenv("WECHAT_MP_APP_SECRET", ""),
        "author": os.getenv("WECHAT_MP_AUTHOR", "能见社"),
        "content_source_url": os.getenv("WECHAT_MP_CONTENT_SOURCE_URL", ""),
        "default_thumb_media_id": os.getenv("WECHAT_MP_DEFAULT_THUMB_MEDIA_ID", ""),
        "thumb_image_path": os.getenv("WECHAT_MP_THUMB_IMAGE_PATH", ""),
        "auto_generate_thumb": os.getenv("WECHAT_MP_AUTO_GENERATE_THUMB", ""),
        "thumb_upload_type": os.getenv("WECHAT_MP_THUMB_UPLOAD_TYPE", ""),
        "need_open_comment": os.getenv("WECHAT_MP_NEED_OPEN_COMMENT", "0"),
        "only_fans_can_comment": os.getenv("WECHAT_MP_ONLY_FANS_CAN_COMMENT", "0"),
        "auto_mode": os.getenv("WECHAT_MP_AUTO_MODE", "off"),
        "shadow_publish_days": os.getenv("WECHAT_MP_SHADOW_PUBLISH_DAYS", "3"),
        "publish_poll_seconds": os.getenv("WECHAT_MP_PUBLISH_POLL_SECONDS", "8"),
        "publish_poll_attempts": os.getenv("WECHAT_MP_PUBLISH_POLL_ATTEMPTS", "15"),
    }
    merged = {**file_config, **{k: v for k, v in env_config.items() if v not in {"", None}}}
    merged["need_open_comment"] = int(str(merged.get("need_open_comment", "0")))
    merged["only_fans_can_comment"] = int(str(merged.get("only_fans_can_comment", "0")))
    merged["publish_poll_seconds"] = int(str(merged.get("publish_poll_seconds", "8")))
    merged["publish_poll_attempts"] = int(str(merged.get("publish_poll_attempts", "15")))
    merged["shadow_publish_days"] = max(1, int(str(merged.get("shadow_publish_days", "3"))))
    merged["auto_generate_thumb"] = as_bool(merged.get("auto_generate_thumb"), default=True)
    merged["thumb_upload_type"] = clean_text(merged.get("thumb_upload_type")) or "image"
    return merged


def prepare_thumb_image(config: dict[str, Any], target_date: str) -> None:
    if clean_text(config.get("default_thumb_media_id")):
        return
    thumb_image_path = clean_text(config.get("thumb_image_path"))
    if thumb_image_path:
        path = Path(thumb_image_path)
        config["_resolved_thumb_image_path"] = str(path if path.is_absolute() else ROOT_DIR / path)
        return
    if as_bool(config.get("auto_generate_thumb"), default=True):
        config["_resolved_thumb_image_path"] = str(generate_daily_cover(target_date))


def validate_publish_config(config: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    if not clean_text(config.get("appid")):
        issues.append("missing config: appid")
    if not clean_text(config.get("appsecret")):
        issues.append("missing config: appsecret")
    if not clean_text(config.get("default_thumb_media_id")) and not clean_text(config.get("_resolved_thumb_image_path")):
        issues.append("missing cover source: default_thumb_media_id, thumb_image_path, or auto_generate_thumb")
    thumb_image_path = clean_text(config.get("_resolved_thumb_image_path"))
    if thumb_image_path:
        path = Path(thumb_image_path)
        if not path.exists():
            issues.append(f"thumb image not found: {path}")
        elif path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".gif", ".bmp"}:
            issues.append(f"unsupported thumb image format: {path.suffix}")
        elif path.stat().st_size > 10 * 1024 * 1024:
            issues.append(f"thumb image exceeds 10MB: {path}")
    return issues


def ensure_publish_config(config: dict[str, Any]) -> None:
    issues = validate_publish_config(config)
    if issues:
        raise RuntimeError(
            "WeChat preflight failed: " + "; ".join(issues) +
            ". Fill intelligence/wechat_publish.json or .env.local first."
        )


def validate_article_for_publish(article: dict[str, Any], target_date: str) -> tuple[list[str], list[str]]:
    issues: list[str] = []
    warnings: list[str] = []
    title = clean_text(article.get("title"))
    digest = clean_text(article.get("digest"))
    content = clean_text(article.get("content"))
    plain_text = clean_text(html.unescape(re.sub(r"<[^>]+>", " ", content)))
    if not title:
        issues.append("article title missing")
    elif len(title) > 64:
        issues.append(f"article title exceeds 64 characters: {len(title)}")
    if target_date not in title:
        issues.append("article title does not contain target date")
    if not digest:
        issues.append("article digest missing")
    elif len(digest) > 120:
        issues.append(f"article digest exceeds 120 characters: {len(digest)}")
    if len(plain_text) < 500:
        issues.append(f"article body too short: {len(plain_text)}")
    if content.lower().count("<h2") < 2:
        issues.append("article body has fewer than two section headings")
    forbidden_patterns = {
        "think tag": r"<think\b",
        "script tag": r"<script\b",
        "iframe tag": r"<iframe\b",
        "javascript URL": r"javascript\s*:",
        "template placeholder": r"\{\{#?.+?#?\}\}",
    }
    for label, pattern in forbidden_patterns.items():
        if re.search(pattern, content, re.IGNORECASE | re.DOTALL) or re.search(pattern, digest, re.IGNORECASE | re.DOTALL):
            issues.append(f"article contains forbidden {label}")
    for label in publication_leaks(title, digest, content):
        issues.append(f"article contains forbidden {label}")
    if not any(label in plain_text for label in ("来源", "信息口径", "参考范围", "参考资料")):
        warnings.append("article does not visibly identify sources")
    return issues, warnings


def validate_summary_article_for_publish(article: dict[str, Any], target_date: str) -> tuple[list[str], list[str]]:
    issues: list[str] = []
    title = clean_text(article.get("title"))
    digest = clean_text(article.get("digest"))
    content = clean_text(article.get("content"))
    if not title:
        issues.append("article title missing")
    elif len(title) > 64:
        issues.append(f"article title exceeds 64 characters: {len(title)}")
    if target_date not in title:
        issues.append("article title does not contain target date")
    if not digest:
        issues.append("article digest missing")
    elif len(digest) > 120:
        issues.append(f"article digest exceeds 120 characters: {len(digest)}")
    if not content:
        issues.append("article body missing")
    forbidden_patterns = {
        "script tag": r"<script\b",
        "iframe tag": r"<iframe\b",
        "javascript URL": r"javascript\s*:",
        "template placeholder": r"\{\{#?.+?#?\}\}",
    }
    for label, pattern in forbidden_patterns.items():
        if re.search(pattern, content, re.IGNORECASE | re.DOTALL):
            issues.append(f"article contains forbidden {label}")
    for label in publication_leaks(title, digest, content):
        issues.append(f"article contains forbidden {label}")
    return issues, []


def build_preflight_report(
    config: dict[str, Any],
    report_bundle: dict[str, Any],
    article: dict[str, Any],
    target_date: str,
    action: str,
    locator: ArticleLocator | None = None,
) -> dict[str, Any]:
    issues = validate_publish_config(config)
    warnings: list[str] = []
    if locator is not None and locator.stream == "summary":
        article_issues, article_warnings = validate_summary_article_for_publish(article, target_date)
    else:
        article_issues, article_warnings = validate_article_for_publish(article, target_date)
    issues.extend(article_issues)
    warnings.extend(article_warnings)
    quality = load_quality_audit(locator, target_date)
    quality_status = clean_text(quality.get("status"))
    quality_issues = quality.get("issues", []) if isinstance(quality.get("issues"), list) else []
    content = clean_text(article.get("content"))
    digest = clean_text(article.get("digest"))
    if len(content) < 400:
        warnings.append("wechat content looks short")
    if len(digest) < 20:
        warnings.append("digest looks short")
    if quality and quality_status != "pass":
        issues.append(f"quality gate not passed: {quality_status or 'unknown'}")
    if not quality:
        warnings.append("quality audit file missing")
    return {
        "date": target_date,
        "action": action,
        "ready": not issues,
        "issues": issues,
        "warnings": warnings,
        "account_id": clean_text(config.get("account_id")),
        "appid": clean_text(config.get("appid")),
        "title": article.get("title", ""),
        "digest": digest,
        "content_length": len(content),
        "markdown_path": str(report_bundle["md_path"]),
        "html_path": str(report_bundle["html_path"]),
        "summary_path": str(report_bundle["summary_path"]),
        "thumb_media_id_configured": bool(clean_text(config.get("default_thumb_media_id"))),
        "thumb_image_path": clean_text(config.get("_resolved_thumb_image_path")),
        "thumb_auto_generated": as_bool(config.get("auto_generate_thumb"), default=True),
        "thumb_upload_type": clean_text(config.get("thumb_upload_type")) or "image",
        "quality_status": quality_status or "missing",
        "quality_issues": quality_issues,
        "notes": [
            "WeChat official-account API requires the server IP to be allowed on the public-platform side.",
            "If access_token fails with risk/IP controls, confirm IP whitelist and admin approval in mp.weixin.qq.com.",
        ],
    }


def http_get_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def http_post_json(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def http_post_multipart(url: str, field_name: str, file_path: Path) -> dict[str, Any]:
    boundary = f"----ETIWechat{int(time.time() * 1000)}"
    mime_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    content = file_path.read_bytes()
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{file_path.name}"\r\n'
        f"Content-Type: {mime_type}\r\n\r\n"
    ).encode("utf-8") + content + f"\r\n--{boundary}--\r\n".encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def ensure_wechat_ok(response: dict[str, Any], action: str) -> dict[str, Any]:
    errcode = int(response.get("errcode", 0) or 0)
    if errcode != 0:
        raise RuntimeError(f"WeChat {action} failed: errcode={errcode}, errmsg={response.get('errmsg', 'unknown error')}")
    return response


def upload_article_image(access_token: str, path: Path) -> str:
    query = urllib.parse.urlencode({"access_token": access_token})
    response = ensure_wechat_ok(
        http_post_multipart(f"{ARTICLE_IMAGE_UPLOAD_URL}?{query}", "media", path),
        "upload article image",
    )
    image_url = normalize_wechat_article_image_url(clean_text(response.get("url")))
    parsed_url = urllib.parse.urlparse(image_url)
    if parsed_url.scheme.lower() != "https" or not parsed_url.netloc:
        raise RuntimeError("WeChat upload article image failed without a valid HTTPS URL")
    return image_url


def normalize_wechat_article_image_url(image_url: str) -> str:
    """Canonicalize WeChat's legacy HTTP image URL without relaxing external URLs."""
    parsed_url = urllib.parse.urlparse(image_url)
    hostname = (parsed_url.hostname or "").lower()
    if parsed_url.scheme.lower() == "http" and hostname.endswith("mmbiz.qpic.cn"):
        return urllib.parse.urlunparse(parsed_url._replace(scheme="https"))
    return image_url


def inject_article_image(content: str, image_url: str) -> str:
    token_count = content.count(ARTICLE_IMAGE_TOKEN)
    if not image_url:
        without_section = ARTICLE_IMAGE_SECTION_PATTERN.sub("", content)
        return without_section.replace(ARTICLE_IMAGE_TOKEN, "")
    parsed_url = urllib.parse.urlparse(image_url)
    if parsed_url.scheme.lower() != "https" or not parsed_url.netloc:
        raise RuntimeError("Article image URL must use HTTPS")
    if token_count != 1:
        raise RuntimeError(f"Expected one article image token, found {token_count}")
    image_html = (
        f'<img src="{html.escape(image_url, quote=True)}" alt="市场价格参考图" '
        'style="display:block;width:100%;height:auto;margin:0;border:0;">'
    )
    return content.replace(ARTICLE_IMAGE_TOKEN, image_html, 1)


def append_article_reference_image_slot(content: str, label: str = "市场参考图") -> str:
    """Add one deterministic in-body slot for a validated reference image."""
    if ARTICLE_IMAGE_TOKEN in content:
        return content
    slot = (
        '<section data-eti-price-reference="true" style="margin:26px 0 0;padding:12px;'
        'border:1px solid #e5e7eb;border-radius:12px;background:#f8fafc;">'
        f'<p style="margin:0 0 8px;font-size:12px;line-height:1.7;color:#6b7280;">{html.escape(label)}</p>'
        f'{ARTICLE_IMAGE_TOKEN}</section>'
    )
    if "</article>" in content:
        before, after = content.rsplit("</article>", 1)
        return f"{before}{slot}</article>{after}"
    if "</body>" in content:
        before, after = content.rsplit("</body>", 1)
        return f"{before}{slot}</body>{after}"
    return f"{content}{slot}"


def is_intentionally_omitted_article_image(existing: dict[str, Any]) -> bool:
    """Recognize a safe image omission when the rendered content has no image slot."""
    if clean_text(existing.get("article_image_status")) != "omitted_no_slot":
        return False
    if clean_text(existing.get("article_image_url")):
        return False
    return True


def prepare_article_image(article: dict[str, Any], access_token: str, path: Path) -> list[str]:
    content = str(article.get("content", ""))
    preview_html = str(article.get("preview_html", ""))
    if ARTICLE_IMAGE_TOKEN not in content:
        article["content"] = inject_article_image(content, "")
        article["preview_html"] = inject_article_image(preview_html, "")
        article["article_image_url"] = ""
        if article.get("reference_image_present"):
            article["article_image_status"] = "omitted_no_slot"
            return ["article reference image omitted because its content slot was unavailable"]
        article["article_image_status"] = "not_expected"
        return []
    warnings: list[str] = []
    try:
        image_url = upload_article_image(access_token, path)
    except Exception:
        image_url = ""
        warnings.append("article reference image omitted because upload failed")
    article["content"] = inject_article_image(content, image_url)
    article["preview_html"] = inject_article_image(preview_html, image_url)
    article["article_image_url"] = image_url
    article["article_image_status"] = "uploaded" if image_url else "upload_failed"
    if ARTICLE_IMAGE_TOKEN in article["content"] or ARTICLE_IMAGE_TOKEN in article["preview_html"]:
        raise RuntimeError("Article image token remained after image preparation")
    return warnings


def get_access_token(config: dict[str, Any]) -> str:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    now_ts = int(time.time())
    if TOKEN_CACHE_PATH.exists():
        cached = load_json(TOKEN_CACHE_PATH)
        if cached.get("access_token") and int(cached.get("expires_at", 0)) > now_ts + 60:
            return str(cached["access_token"])
    query = urllib.parse.urlencode({
        "grant_type": "client_credential",
        "appid": config["appid"],
        "secret": config["appsecret"],
    })
    try:
        response = http_get_json(f"{TOKEN_URL}?{query}")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"WeChat get access token HTTP {exc.code}") from None
    except urllib.error.URLError as exc:
        reason = clean_text(getattr(exc, "reason", "network error"))
        raise RuntimeError(f"WeChat get access token network error: {reason}") from None
    access_token = response.get("access_token")
    expires_in = int(response.get("expires_in", 0) or 0)
    if not access_token:
        ensure_wechat_ok(response, "get access token")
        raise RuntimeError("WeChat get access token failed without access_token")
    save_json(TOKEN_CACHE_PATH, {
        "access_token": access_token,
        "expires_at": now_ts + max(expires_in - 120, 300),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    try:
        TOKEN_CACHE_PATH.chmod(0o600)
    except OSError:
        pass
    return str(access_token)


def ensure_thumb_media_id(config: dict[str, Any], access_token: str) -> str:
    media_id = clean_text(config.get("default_thumb_media_id"))
    if media_id:
        return media_id
    thumb_image_path = clean_text(config.get("_resolved_thumb_image_path"))
    if not thumb_image_path:
        raise RuntimeError("Missing WeChat cover media. Configure a cover source or enable auto_generate_thumb.")
    path = Path(thumb_image_path)
    if not path.exists():
        raise FileNotFoundError(f"WeChat thumb image not found: {path}")
    upload_type = clean_text(config.get("thumb_upload_type")) or "image"
    url = f"{MATERIAL_ADD_URL}?{urllib.parse.urlencode({'access_token': access_token, 'type': upload_type})}"
    response = ensure_wechat_ok(http_post_multipart(url, "media", path), "upload thumb")
    media_id = clean_text(response.get("media_id"))
    if not media_id:
        raise RuntimeError("WeChat upload thumb succeeded but media_id missing")
    return media_id


def _draft_article_payload(article: dict[str, Any]) -> dict[str, Any]:
    ensure_final_article_content(
        str(article.get("content", "")),
        clean_text(article.get("article_image_url")),
    )
    return {
        "title": article["title"],
        "author": article["author"],
        "digest": article["digest"],
        "content": article["content"],
        "content_source_url": article["content_source_url"],
        "thumb_media_id": article["thumb_media_id"],
        "need_open_comment": article["need_open_comment"],
        "only_fans_can_comment": article["only_fans_can_comment"],
    }


def create_multi_article_draft(
    access_token: str,
    articles: list[dict[str, Any]],
) -> dict[str, Any]:
    if not 1 <= len(articles) <= 8:
        raise ValueError("WeChat multi-article draft requires 1 to 8 articles")
    url = f"{DRAFT_ADD_URL}?{urllib.parse.urlencode({'access_token': access_token})}"
    payload = {"articles": [_draft_article_payload(article) for article in articles]}
    response = ensure_wechat_ok(http_post_json(url, payload), "create draft")
    if not clean_text(response.get("media_id")):
        raise RuntimeError("WeChat create draft succeeded but media_id missing")
    return response


def create_draft(access_token: str, article: dict[str, Any]) -> dict[str, Any]:
    return create_multi_article_draft(access_token, [article])


def get_draft(access_token: str, media_id: str) -> dict[str, Any]:
    url = f"{DRAFT_GET_URL}?{urllib.parse.urlencode({'access_token': access_token})}"
    return ensure_wechat_ok(http_post_json(url, {"media_id": media_id}), "get draft")


def batch_get_drafts(
    access_token: str,
    *,
    offset: int = 0,
    count: int = 20,
) -> dict[str, Any]:
    if offset < 0:
        raise ValueError("WeChat draft offset must be non-negative")
    if not 1 <= count <= 20:
        raise ValueError("WeChat draft count must be between 1 and 20")
    url = f"{DRAFT_BATCHGET_URL}?{urllib.parse.urlencode({'access_token': access_token})}"
    return ensure_wechat_ok(
        http_post_json(url, {"offset": offset, "count": count, "no_content": 0}),
        "batch get drafts",
    )


def verify_created_draft(access_token: str, media_id: str, article: dict[str, Any], target_date: str) -> dict[str, Any]:
    result = verify_created_multi_article_draft(
        access_token,
        media_id,
        [{**article, "market_date": target_date}],
    )
    verified_article = result["articles"][0]
    return {
        **result,
        "title": verified_article["title"],
        "digest": verified_article["digest"],
        "content_length": verified_article["content_length"],
        "article_image_url": clean_text(article.get("article_image_url")),
    }


def verify_created_multi_article_draft(
    access_token: str,
    media_id: str,
    articles: list[dict[str, Any]],
) -> dict[str, Any]:
    response = get_draft(access_token, media_id)
    news_items = response.get("news_item")
    if not isinstance(news_items, list) or len(news_items) != len(articles):
        raise RuntimeError(
            f"WeChat draft verification failed: expected {len(articles)} articles, "
            f"got {len(news_items or [])}"
        )
    verified_items: list[dict[str, Any]] = []
    for index, article in enumerate(articles):
        remote_article = news_items[index] if isinstance(news_items[index], dict) else {}
        remote_title = clean_text(remote_article.get("title"))
        remote_digest = clean_text(remote_article.get("digest"))
        remote_content = clean_text(remote_article.get("content"))
        if remote_title != clean_text(article.get("title")):
            raise RuntimeError(f"WeChat draft verification failed: title mismatch at article {index + 1}")
        if remote_digest != clean_text(article.get("digest")):
            raise RuntimeError(f"WeChat draft verification failed: digest mismatch at article {index + 1}")
        target_date = clean_text(article.get("market_date"))
        if target_date and target_date not in remote_content:
            raise RuntimeError(
                f"WeChat draft verification failed: body missing market date at article {index + 1}"
            )
        if len(remote_content) < 200:
            raise RuntimeError(f"WeChat draft verification failed: body too short at article {index + 1}")
        try:
            ensure_final_article_content(
                remote_content,
                clean_text(article.get("article_image_url")),
            )
        except RuntimeError as exc:
            raise RuntimeError(
                f"WeChat draft verification failed at article {index + 1}: {exc}"
            ) from None
        verified_items.append({
            "title": remote_title,
            "digest": remote_digest,
            "content_length": len(remote_content),
            "market_date": target_date,
        })
    return {
        "verified": True,
        "article_count": len(news_items),
        "articles": verified_items,
    }


def submit_publish(access_token: str, media_id: str) -> dict[str, Any]:
    url = f"{FREEPUBLISH_SUBMIT_URL}?{urllib.parse.urlencode({'access_token': access_token})}"
    response = ensure_wechat_ok(http_post_json(url, {"media_id": media_id}), "submit publish")
    if not clean_text(response.get("publish_id")):
        raise RuntimeError("WeChat submit publish succeeded but publish_id missing")
    return response


def get_publish_status(access_token: str, publish_id: str) -> dict[str, Any]:
    url = f"{FREEPUBLISH_GET_URL}?{urllib.parse.urlencode({'access_token': access_token})}"
    return ensure_wechat_ok(http_post_json(url, {"publish_id": publish_id}), "get publish status")


def wait_publish_result(config: dict[str, Any], access_token: str, publish_id: str) -> dict[str, Any]:
    attempts = int(config.get("publish_poll_attempts", 15))
    sleep_seconds = int(config.get("publish_poll_seconds", 8))
    last_response: dict[str, Any] = {}
    for _ in range(attempts):
        last_response = get_publish_status(access_token, publish_id)
        if int(last_response.get("publish_status", -1)) != 1:
            return last_response
        time.sleep(sleep_seconds)
    return last_response


def build_article_payload(
    config: dict[str, Any],
    report_bundle: dict[str, Any],
    target_date: str,
    mode: str = "daily",
    locator: ArticleLocator | None = None,
) -> dict[str, Any]:
    markdown = report_bundle["markdown"]
    title = parse_markdown_title(markdown, target_date)
    if locator is not None and locator.stream == "summary":
        content = report_bundle["html"]
        if not content:
            raise ValueError("Summary WeChat HTML is required")
        reference_image_path = DAILY_PRICE_ROOT / target_date / "public_reference.png"
        from intelligence.daily_prices import validate_public_reference

        reference_image_present, reference_image_reasons = validate_public_reference(reference_image_path.parent)
        if not reference_image_present:
            raise ValueError("Summary public reference image is required: " + ", ".join(reference_image_reasons))
        content = append_publication_footer(
            append_article_reference_image_slot(content),
            source_titles=["Platts Summary 报价图片"],
            stream="summary",
        )
        return {
            "title": title,
            "author": clean_text(config.get("author")) or "能见社",
            "digest": title,
            "content": content,
            "preview_html": content,
            "content_source_url": clean_text(config.get("content_source_url")),
            "need_open_comment": int(config.get("need_open_comment", 0)),
            "only_fans_can_comment": int(config.get("only_fans_can_comment", 0)),
            "reference_image_present": True,
            "reference_image_sha256": compute_file_sha256(reference_image_path),
            "reference_image_validation_reasons": reference_image_reasons,
            "article_image_url": "",
            "article_image_status": "pending_upload",
        }
    digest = parse_markdown_digest(markdown, report_bundle["summary"])
    reference_image_path = DAILY_PRICE_ROOT / target_date / "public_reference.png"
    reference_image_reasons: list[str] = []
    reference_image_present = False
    if mode == "daily":
        from intelligence.daily_prices import validate_public_reference

        reference_image_present, reference_image_reasons = validate_public_reference(reference_image_path.parent)
    reference_image_sha256 = compute_file_sha256(reference_image_path) if reference_image_present else ""
    content, preview_html = build_wechat_content(
        markdown,
        report_bundle["html"],
        digest,
        target_date,
        include_price_reference=reference_image_present,
    )
    if reference_image_present and locator is not None and locator.stream in {"digit", "summary"}:
        content = append_article_reference_image_slot(content)
        preview_html = append_article_reference_image_slot(preview_html)
    return {
        "title": title,
        "author": clean_text(config.get("author")) or "能见社",
        "digest": digest,
        "content": content,
        "preview_html": preview_html,
        "content_source_url": clean_text(config.get("content_source_url")),
        "need_open_comment": int(config.get("need_open_comment", 0)),
        "only_fans_can_comment": int(config.get("only_fans_can_comment", 0)),
        "reference_image_present": reference_image_present,
        "reference_image_sha256": reference_image_sha256,
        "reference_image_validation_reasons": reference_image_reasons,
        "article_image_url": "",
        "article_image_status": "pending_upload" if reference_image_present else "not_expected",
    }


def build_article_fingerprint(article: dict[str, Any], mode: str, action: str) -> str:
    return compute_text_sha256(json.dumps({
        "title": article["title"],
        "digest": article["digest"],
        "content": article["content"],
        "mode": mode,
        "action": action,
        "reference_image_present": bool(article.get("reference_image_present")),
        "reference_image_sha256": clean_text(article.get("reference_image_sha256")),
    }, ensure_ascii=False, sort_keys=True))


def restore_existing_article_image_state(
    article: dict[str, Any],
    existing: dict[str, Any],
    *,
    require_verified: bool = True,
) -> None:
    expected_present = bool(article.get("reference_image_present"))
    expected_sha256 = clean_text(article.get("reference_image_sha256"))
    existing_present = bool(existing.get("reference_image_present"))
    existing_sha256 = clean_text(existing.get("reference_image_sha256"))
    existing_status = clean_text(existing.get("article_image_status"))
    existing_url = clean_text(existing.get("article_image_url"))
    if existing_present != expected_present or existing_sha256 != expected_sha256:
        raise RuntimeError("Existing draft reference image state does not match the current source image")
    if expected_present:
        if is_intentionally_omitted_article_image(existing):
            article["content"] = inject_article_image(str(article.get("content", "")), "")
            article["preview_html"] = inject_article_image(str(article.get("preview_html", "")), "")
            article["article_image_url"] = ""
            article["article_image_status"] = "omitted_no_slot"
            return
        parsed_url = urllib.parse.urlparse(existing_url)
        allowed_statuses = {"uploaded_verified"} if require_verified else {"uploaded", "uploaded_verified"}
        if existing_status not in allowed_statuses or parsed_url.scheme.lower() != "https" or not parsed_url.netloc:
            raise RuntimeError("Existing draft is missing a verified uploaded reference image URL")
    elif existing_status != "not_expected" or existing_url:
        raise RuntimeError("Existing draft image status does not match an image-free article")
    article["content"] = inject_article_image(str(article.get("content", "")), existing_url)
    article["preview_html"] = inject_article_image(str(article.get("preview_html", "")), existing_url)
    article["article_image_url"] = existing_url
    article["article_image_status"] = existing_status


def build_publish_state_dir(locator: ArticleLocator | None) -> Path:
    if locator is None:
        return STATE_DIR
    return resolve_article_paths(locator, REPORTS_DIR).publish_state_dir


def build_publish_state_path(
    locator: ArticleLocator | None,
    action: str,
    target_date: str = "",
) -> Path:
    if locator is None:
        return STATE_DIR / f"{target_date}_{action}.json"
    return resolve_article_paths(locator, REPORTS_DIR).publish_state_path(action)


def build_preview_html_path(
    locator: ArticleLocator | None,
    action: str,
    target_date: str = "",
) -> Path:
    if locator is None:
        return STATE_DIR / f"{target_date}_{action}_preview.html"
    return resolve_article_paths(locator, REPORTS_DIR).preview_html_path(action)


def build_payload_path(
    locator: ArticleLocator | None,
    action: str,
    target_date: str = "",
) -> Path:
    if locator is None:
        return STATE_DIR / f"{target_date}_{action}_payload.json"
    return resolve_article_paths(locator, REPORTS_DIR).payload_path(action)


def load_existing_result(
    locator: ArticleLocator | None,
    action: str,
    target_date: str = "",
) -> dict[str, Any]:
    return load_json(build_publish_state_path(locator, action, target_date))


def build_rollout_state_path(
    stream: str = "legacy",
    *,
    reports_dir: Path | None = None,
) -> Path:
    if stream == "legacy":
        return ROLLOUT_STATE_PATH
    if stream not in {"summary", "digit"}:
        raise ValueError(f"unsupported rollout stream: {stream}")
    return (reports_dir or REPORTS_DIR) / "wechat_publish" / stream / "rollout_state.json"


def load_rollout_state(
    stream: str = "legacy",
    *,
    reports_dir: Path | None = None,
) -> dict[str, Any]:
    state = load_json(build_rollout_state_path(stream, reports_dir=reports_dir))
    if state:
        return state
    return {
        "consecutive_passes": 0,
        "armed_for_publish": False,
        "counted_dates": [],
        "history": [],
    }


def save_rollout_state(
    state: dict[str, Any],
    stream: str = "legacy",
    *,
    reports_dir: Path | None = None,
) -> None:
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_json(build_rollout_state_path(stream, reports_dir=reports_dir), state)


def reset_rollout_state(
    target_date: str,
    reason: str,
    stream: str = "legacy",
    *,
    reports_dir: Path | None = None,
) -> dict[str, Any]:
    state = load_rollout_state(stream, reports_dir=reports_dir)
    state["consecutive_passes"] = 0
    state["armed_for_publish"] = False
    counted_dates = state.get("counted_dates", []) if isinstance(state.get("counted_dates"), list) else []
    state["counted_dates"] = [item for item in counted_dates if item != target_date][-90:]
    history = state.get("history", []) if isinstance(state.get("history"), list) else []
    history.append({"date": target_date, "event": "reset", "reason": reason})
    state["history"] = history[-30:]
    save_rollout_state(state, stream, reports_dir=reports_dir)
    return state


def resolve_auto_action(
    config: dict[str, Any],
    historical: bool,
    *,
    stream: str = "legacy",
    target_date: str = "",
    reports_dir: Path | None = None,
) -> tuple[str, dict[str, Any]]:
    state = load_rollout_state(stream, reports_dir=reports_dir)
    if historical:
        return "draft", state
    counted_dates = state.get("counted_dates", []) if isinstance(state.get("counted_dates"), list) else []
    if target_date and target_date in counted_dates:
        return "draft", state
    return ("publish" if state.get("armed_for_publish") else "draft"), state


def normalize_historical_action(action: str, historical: bool) -> str:
    return "draft" if historical else action


def record_auto_success(
    target_date: str,
    resolved_action: str,
    state: dict[str, Any],
    threshold: int,
    *,
    stream: str = "legacy",
    reports_dir: Path | None = None,
) -> dict[str, Any]:
    counted_dates = state.get("counted_dates", []) if isinstance(state.get("counted_dates"), list) else []
    history = state.get("history", []) if isinstance(state.get("history"), list) else []
    if resolved_action == "draft" and target_date not in counted_dates:
        counted_dates.append(target_date)
        state["consecutive_passes"] = int(state.get("consecutive_passes", 0)) + 1
        state["armed_for_publish"] = state["consecutive_passes"] >= threshold
        history.append({
            "date": target_date,
            "event": "shadow_pass",
            "consecutive_passes": state["consecutive_passes"],
        })
    elif resolved_action == "publish":
        history.append({"date": target_date, "event": "published"})
    state["counted_dates"] = counted_dates[-90:]
    state["history"] = history[-30:]
    save_rollout_state(state, stream, reports_dir=reports_dir)
    return state


def is_successful_publish_terminal(existing: dict[str, Any], action: str) -> bool:
    if action != "publish":
        return False
    if not clean_text(existing.get("media_id")) or not clean_text(existing.get("publish_id")):
        return False
    status = existing.get("publish_status_response", {}).get("publish_status")
    try:
        return status is not None and int(status) == 0
    except (TypeError, ValueError):
        return False


def _existing_article_state_matches(
    existing: dict[str, Any],
    fingerprint: str,
    *,
    reference_image_present: bool,
    reference_image_sha256: str,
    require_verified: bool = True,
) -> bool:
    if not existing or clean_text(existing.get("fingerprint")) != fingerprint:
        return False
    if bool(existing.get("reference_image_present")) != reference_image_present:
        return False
    if clean_text(existing.get("reference_image_sha256")) != clean_text(reference_image_sha256):
        return False
    image_status = clean_text(existing.get("article_image_status"))
    image_url = clean_text(existing.get("article_image_url"))
    if reference_image_present:
        if is_intentionally_omitted_article_image(existing):
            return True
        parsed_url = urllib.parse.urlparse(image_url)
        allowed_statuses = {"uploaded_verified"} if require_verified else {"uploaded", "uploaded_verified"}
        return (
            image_status in allowed_statuses
            and parsed_url.scheme.lower() == "https"
            and bool(parsed_url.netloc)
        )
    return image_status == "not_expected" and not image_url


def is_existing_result_reusable(
    existing: dict[str, Any],
    fingerprint: str,
    action: str,
    *,
    reference_image_present: bool = False,
    reference_image_sha256: str = "",
) -> bool:
    if is_successful_publish_terminal(existing, action):
        return True
    if not _existing_article_state_matches(
        existing,
        fingerprint,
        reference_image_present=reference_image_present,
        reference_image_sha256=reference_image_sha256,
    ):
        return False
    if existing.get("ok") is False or clean_text(existing.get("error")):
        return False
    if action == "draft":
        return bool(clean_text(existing.get("media_id")))
    return False


def is_existing_result_resumable(
    existing: dict[str, Any],
    fingerprint: str,
    action: str,
    *,
    reference_image_present: bool = False,
    reference_image_sha256: str = "",
) -> bool:
    if action not in {"draft", "publish"} or is_successful_publish_terminal(existing, action):
        return False
    existing_action = clean_text(existing.get("action"))
    if existing_action and existing_action != action:
        return False
    if not clean_text(existing.get("media_id")):
        return False
    if not _existing_article_state_matches(
        existing,
        fingerprint,
        reference_image_present=reference_image_present,
        reference_image_sha256=reference_image_sha256,
        require_verified=False,
    ):
        return False
    if action == "draft":
        return existing.get("ok") is False or bool(clean_text(existing.get("error")))
    return True


def persist_publish_artifacts(
    target_date: str,
    action: str,
    article: dict[str, Any],
    result: dict[str, Any],
    locator: ArticleLocator | None = None,
) -> dict[str, str]:
    result_path = build_publish_state_path(locator, action, target_date)
    checkpoint_fields = (
        "ok",
        "date",
        "mode",
        "action",
        "requested_action",
        "fingerprint",
        "media_id",
        "publish_id",
        "reference_image_present",
        "reference_image_sha256",
        "article_image_url",
        "article_image_status",
        "publication_stage",
        "error",
        "failed_at",
    )
    checkpoint = {
        field: result[field]
        for field in checkpoint_fields
        if field in result
    }
    save_json(result_path, checkpoint)
    ensure_final_article_content(
        str(article.get("content", "")),
        clean_text(article.get("article_image_url")),
    )
    build_publish_state_dir(locator).mkdir(parents=True, exist_ok=True)
    preview_path = build_preview_html_path(locator, action, target_date)
    preview_path.write_text(article.get("preview_html", ""), encoding="utf-8")
    payload_path = build_payload_path(locator, action, target_date)
    payload = {
        "title": article["title"],
        "author": article["author"],
        "digest": article["digest"],
        "content": article["content"],
        "content_source_url": article["content_source_url"],
        "need_open_comment": article["need_open_comment"],
        "only_fans_can_comment": article["only_fans_can_comment"],
        "thumb_media_id": article.get("thumb_media_id", ""),
    }
    save_json(payload_path, payload)
    save_json(result_path, result)
    return {
        "preview_path": str(preview_path),
        "payload_path": str(payload_path),
        "result_path": str(result_path),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish ETI report to WeChat Official Account")
    parser.add_argument("--date", required=True, help="Target report date, e.g. 2026-07-09")
    parser.add_argument("--mode", choices=("daily", "weekly", "monthly"), default="daily")
    parser.add_argument("--stream", choices=("summary", "digit", "legacy"), default="legacy")
    parser.add_argument("--article-slug", default="")
    parser.add_argument("--action", choices=("auto", "draft", "publish"), default="draft")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--preflight", action="store_true")
    parser.add_argument("--verify-existing", action="store_true")
    parser.add_argument("--historical", action="store_true", help="Force draft mode and exclude this run from rollout counters")
    parser.add_argument("--defer-rollout", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    locator: ArticleLocator | None = None
    if args.stream != "legacy":
        locator = ArticleLocator(
            cast(Literal["summary", "digit"], args.stream),
            date.fromisoformat(args.date),
            args.article_slug or None,
        )

    config = read_publish_config(Path(args.config))
    release_state: dict[str, Any] = {}
    release_block: str | None = None
    if locator is None or locator.stream == "summary":
        release_state = load_price_release_state(args.date)
        release_block = price_release_gate(
            release_state,
            mode=args.mode,
            historical=args.historical,
            price_mode=os.getenv("DAILY_PRICE_MODE", "shadow"),
            stream=args.stream,
        )
    if release_block:
        payload = {
            "ok": True,
            "ready": False,
            "issues": [release_block],
            "date": args.date,
            "stream": args.stream,
            "action": args.action,
            "skipped": True,
            "reason": release_block,
            "release_state": release_state,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        if args.preflight:
            raise SystemExit(1)
        return
    prepare_thumb_image(config, args.date)
    report_bundle = read_report_bundle(locator, args.mode, args.date)
    article = build_article_payload(config, report_bundle, args.date, args.mode, locator)
    quality = load_quality_audit(locator, args.date)
    llm_review = (
        {}
        if locator is not None and locator.stream == "summary"
        else load_llm_review(locator, args.date)
    )
    if quality.get("publishable") is False and locator is None:
        print(json.dumps({
            "ok": True,
            "date": args.date,
            "action": args.action,
            "skipped": True,
            "reason": clean_text(quality.get("publish_reason")) or "report marked as archive-only",
            "quality_status": clean_text(quality.get("status")) or "unknown",
        }, ensure_ascii=False, indent=2))
        return

    requested_action = args.action
    action = normalize_historical_action(requested_action, args.historical)
    rollout_state: dict[str, Any] = {}
    quality_status = clean_text(quality.get("status"))
    review_status = clean_text(llm_review.get("status"))
    gate_issues: list[str] = []
    if quality_status != "pass":
        gate_issues.append(f"local quality={quality_status or 'missing'}")
    if quality.get("publishable") is False:
        gate_issues.append("local quality publishable=false")
    if (locator is None or locator.stream != "summary") and review_status != "pass":
        gate_issues.append(f"llm review={review_status or 'missing'}")
    if gate_issues:
        if requested_action == "auto" and not args.historical and not args.defer_rollout:
            reset_rollout_state(args.date, "; ".join(gate_issues), args.stream)
        raise RuntimeError("WeChat publish blocked by dual quality gate: " + "; ".join(gate_issues))
    if locator is not None:
        identity_issues = [
            f"local quality {issue}"
            for issue in artifact_identity_issues(
                locator,
                quality,
                str(report_bundle.get("markdown", "")),
                str(report_bundle.get("html", "")),
                str(report_bundle.get("summary", "")),
            )
        ]
        if locator.stream == "digit":
            identity_issues.extend(
                f"llm review {issue}"
                for issue in artifact_identity_issues(
                    locator,
                    llm_review,
                    str(report_bundle.get("markdown", "")),
                    str(report_bundle.get("html", "")),
                    str(report_bundle.get("summary", "")),
                )
            )
        if identity_issues:
            if requested_action == "auto" and not args.historical and not args.defer_rollout:
                reset_rollout_state(args.date, "; ".join(identity_issues), args.stream)
            raise RuntimeError(
                "WeChat publish blocked by artifact identity: " + "; ".join(identity_issues)
            )
    if requested_action == "auto":
        action, rollout_state = resolve_auto_action(
            config,
            args.historical,
            stream=args.stream,
            target_date=args.date,
        )
    fingerprint = build_article_fingerprint(article, args.mode, action)

    preview = build_preflight_report(config, report_bundle, article, args.date, action, locator)
    preview.update({
        "mode": args.mode,
        "requested_action": requested_action,
        "historical": args.historical,
        "fingerprint": fingerprint,
        "source_markdown": str(report_bundle["md_path"]),
        "source_html": str(report_bundle["html_path"]),
        "preview_html_path": str(build_preview_html_path(locator, action, args.date)),
        "payload_path": str(build_payload_path(locator, action, args.date)),
    })

    if args.dry_run or args.preflight:
        article["content"] = inject_article_image(article["content"], "")
        article["preview_html"] = inject_article_image(article["preview_html"], "")
        ensure_final_article_content(article["content"], "")
        build_publish_state_dir(locator).mkdir(parents=True, exist_ok=True)
        build_preview_html_path(locator, action, args.date).write_text(article["preview_html"], encoding="utf-8")
        save_json(build_payload_path(locator, action, args.date), {
            "title": article["title"],
            "author": article["author"],
            "digest": article["digest"],
            "content": article["content"],
            "content_source_url": article["content_source_url"],
            "need_open_comment": article["need_open_comment"],
            "only_fans_can_comment": article["only_fans_can_comment"],
        })
        print(json.dumps(preview, ensure_ascii=False, indent=2))
        if args.preflight and preview["issues"]:
            raise SystemExit(1)
        return

    if locator is not None and locator.stream == "summary":
        article_issues, _ = validate_summary_article_for_publish(article, args.date)
    else:
        article_issues, _ = validate_article_for_publish(article, args.date)
    if article_issues:
        raise RuntimeError("WeChat publish blocked by article validation: " + "; ".join(article_issues))

    if args.verify_existing:
        ensure_publish_config(config)
        existing = load_existing_result(locator, action, args.date)
        media_id = clean_text(existing.get("media_id"))
        if not media_id:
            raise RuntimeError("No existing WeChat draft media_id found for verification")
        restore_existing_article_image_state(article, existing, require_verified=False)
        access_token = get_access_token(config)
        verification = verify_created_draft(access_token, media_id, article, args.date)
        if article.get("article_image_url"):
            existing["article_image_status"] = "uploaded_verified"
            existing["draft_verification"] = verification
            existing["publication_stage"] = "draft_verified"
            save_json(build_publish_state_path(locator, action, args.date), existing)
        print(json.dumps({
            "ok": True,
            "date": args.date,
            "action": action,
            "verification": verification,
        }, ensure_ascii=False, indent=2))
        return

    existing = load_existing_result(locator, action, args.date)
    terminal_publish = is_successful_publish_terminal(existing, action)
    reference_image_present = bool(article.get("reference_image_present"))
    reference_image_sha256 = clean_text(article.get("reference_image_sha256"))
    if not args.force and is_existing_result_reusable(
        existing,
        fingerprint,
        action,
        reference_image_present=reference_image_present,
        reference_image_sha256=reference_image_sha256,
    ):
        if (
            requested_action == "auto"
            and not args.historical
            and not args.defer_rollout
            and not terminal_publish
        ):
            rollout_state = record_auto_success(
                args.date,
                action,
                rollout_state,
                int(config.get("shadow_publish_days", 3)),
                stream=args.stream,
            )
        print(json.dumps({
            "ok": True,
            "date": args.date,
            "stream": args.stream,
            "action": action,
            "skipped": True,
            "reason": (
                "existing publish already completed successfully"
                if terminal_publish
                else "existing draft state matches current fingerprint and image state"
            ),
            "media_id": existing.get("media_id", ""),
            "publish_id": existing.get("publish_id", ""),
            "result_path": str(build_publish_state_path(locator, action, args.date)),
            "preview_html_path": str(build_preview_html_path(locator, action, args.date)),
            "payload_path": str(build_payload_path(locator, action, args.date)),
            "rollout_state": rollout_state if requested_action == "auto" else {},
        }, ensure_ascii=False, indent=2))
        return

    resume_existing = not args.force and is_existing_result_resumable(
        existing,
        fingerprint,
        action,
        reference_image_present=reference_image_present,
        reference_image_sha256=reference_image_sha256,
    )
    ensure_publish_config(config)
    access_token = get_access_token(config)
    result = dict(existing) if resume_existing else {
        "ok": False,
        "date": args.date,
        "mode": args.mode,
        "action": action,
        "requested_action": requested_action,
        "title": article["title"],
        "digest": article["digest"],
        "fingerprint": fingerprint,
        "reference_image_present": reference_image_present,
        "reference_image_sha256": reference_image_sha256,
        "article_image_url": clean_text(article.get("article_image_url")),
        "article_image_status": clean_text(article.get("article_image_status")),
    }
    paths: dict[str, str] = {}
    try:
        if resume_existing:
            restore_existing_article_image_state(article, existing, require_verified=False)
            result["resumed_at"] = datetime.now(timezone.utc).isoformat()
            image_warnings = result.get("warnings")
            if not isinstance(image_warnings, list):
                image_warnings = []
        else:
            image_warnings = prepare_article_image(
                article,
                access_token,
                DAILY_PRICE_ROOT / args.date / "public_reference.png",
            )
            for warning in image_warnings:
                print(f"WARNING: {warning}", file=sys.stderr)
            article["thumb_media_id"] = ensure_thumb_media_id(config, access_token)
            draft_response = create_draft(access_token, article)
            result.update({
                "media_id": clean_text(draft_response.get("media_id")),
                "draft_response": draft_response,
                "warnings": image_warnings,
                "article_image_url": clean_text(article.get("article_image_url")),
                "article_image_status": clean_text(article.get("article_image_status")),
                "publication_stage": "draft_created",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            paths = persist_publish_artifacts(
                args.date, action, article, result, locator,
            )

        draft_verification = result.get("draft_verification")
        if not isinstance(draft_verification, dict) or draft_verification.get("verified") is not True:
            draft_verification = verify_created_draft(
                access_token,
                clean_text(result.get("media_id")),
                article,
                args.date,
            )
            result["draft_verification"] = draft_verification
            if article.get("article_image_url"):
                article["article_image_status"] = "uploaded_verified"
                result["article_image_status"] = "uploaded_verified"
            result["publication_stage"] = "draft_verified"

        if action == "publish":
            publish_id = clean_text(result.get("publish_id"))
            if not publish_id:
                publish_response = submit_publish(access_token, clean_text(result.get("media_id")))
                result["publish_response"] = publish_response
                publish_id = clean_text(publish_response.get("publish_id"))
                result["publish_id"] = publish_id
                result["publication_stage"] = "publish_submitted"
                paths = persist_publish_artifacts(
                    args.date, action, article, result, locator,
                )
            result["publish_status_response"] = wait_publish_result(
                config,
                access_token,
                publish_id,
            )
            publish_status = int(result["publish_status_response"].get("publish_status", -1))
            if publish_status != 0:
                raise RuntimeError(
                    f"WeChat publish did not complete successfully: publish_status={publish_status}"
                )
            result["publication_stage"] = "published"
        else:
            result["publication_stage"] = "draft_verified"
        result["ok"] = True
        result.pop("error", None)
        result.pop("failed_at", None)
        paths = persist_publish_artifacts(
            args.date, action, article, result, locator,
        )
        if locator is not None and locator.stream == "summary" and action == "draft":
            from intelligence.daily_prices import record_image_draft_verified

            record_image_draft_verified(args.date, clean_text(result.get("media_id")))
    except Exception as error:
        result["ok"] = False
        result["error"] = f"{type(error).__name__}: {error}"
        result["failed_at"] = datetime.now(timezone.utc).isoformat()
        result_path = build_publish_state_path(locator, action, args.date)
        try:
            save_json(result_path, result)
            paths["result_path"] = str(result_path)
        except Exception as checkpoint_error:
            result["checkpoint_error"] = (
                f"{type(checkpoint_error).__name__}: {checkpoint_error}"
            )
            paths["result_path"] = str(result_path)
        print(json.dumps({**result, **paths}, ensure_ascii=False, indent=2))
        raise

    if requested_action == "auto" and not args.historical and not args.defer_rollout:
        rollout_state = record_auto_success(
            args.date,
            action,
            rollout_state,
            int(config.get("shadow_publish_days", 3)),
            stream=args.stream,
        )
    print(json.dumps({
        "ok": True,
        "date": args.date,
        "stream": args.stream,
        "action": action,
        "requested_action": requested_action,
        "media_id": result.get("media_id"),
        "publish_id": result.get("publish_id", ""),
        "rollout_state": rollout_state if requested_action == "auto" else {},
        **paths,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise



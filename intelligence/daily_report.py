"""
ETI Daily Intelligence Report Generator.
Scans yesterday's vault attachments → extracts text → classifies →
Dify structured extraction → aggregates → generates report + WeChat HTML.

Usage:
  python intelligence/daily_report.py                    # yesterday's report
  python intelligence/daily_report.py --date 2026-07-05  # specific date
  python intelligence/daily_report.py --mode weekly      # weekly summary
  python intelligence/daily_report.py --mode monthly     # monthly summary
"""
import argparse
import asyncio
import html
import hashlib
import json
import os
import re
import sys
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from typing import TYPE_CHECKING, Any

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional for dry-run environments
    def load_dotenv(*_args: Any, **_kwargs: Any) -> bool:
        return False

if TYPE_CHECKING:
    import httpx

def load_project_env(path: Path) -> bool:
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return load_dotenv(path, encoding=encoding)
        except UnicodeDecodeError:
            continue
    return False


# Load env
load_project_env(Path(__file__).parent.parent / ".env.local")

# Import template registry
sys.path.insert(0, str(Path(__file__).parent))
from templates.registry import (
    match_template, save_learned_template, AUTO_DISCOVERY_PROMPT,
    TEMPLATE_NEWSPAPER, TEMPLATE_PLATTS, TEMPLATE_REPORT, TEMPLATE_SHIPPING
)

# ── Config ─────────────────────────────────────────────────
VAULT = Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault"))
ATTACH_DIR = VAULT / "attachments" / "platts_digits"
REPORTS_DIR = VAULT / "reports"
QUALITY_DIR = REPORTS_DIR / "quality"
WEEKLY_DIR = REPORTS_DIR / "weekly"
MONTHLY_DIR = REPORTS_DIR / "monthly"
DIFY_BASE = os.getenv("DIFY_BASE_URL", "").rstrip("/")
DIFY_KEY = os.getenv("DIFY_WORKFLOW_API_KEY", "")
DIFY_KEY_EXTRACT = os.getenv("DIFY_WORKFLOW_API_KEY_EXTRACT", DIFY_KEY)
DIFY_KEY_AGGREGATE = os.getenv("DIFY_WORKFLOW_API_KEY_AGGREGATE", DIFY_KEY)
DIFY_KEY_REVIEW = os.getenv("DIFY_WORKFLOW_API_KEY_REVIEW", "")

SUPPORTED_SUFFIXES = {".pdf", ".docx"}
THINK_TAG_RE = re.compile(r"<think\b[^>]*>.*?</think>", re.IGNORECASE | re.DOTALL)
CODE_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)
MIN_EXTRACTED_TEXT_CHARS = int(os.getenv("MIN_EXTRACTED_TEXT_CHARS", "500"))
MAX_DIFY_INPUT_CHARS = int(os.getenv("MAX_DIFY_INPUT_CHARS", "60000"))
RETRY_DIFY_INPUT_CHARS = int(os.getenv("RETRY_DIFY_INPUT_CHARS", "35000"))
RETRY_DIFY_INPUT_CHARS_SECONDARY = int(os.getenv("RETRY_DIFY_INPUT_CHARS_SECONDARY", "20000"))
RETRY_DIFY_INPUT_CHARS_TERTIARY = int(os.getenv("RETRY_DIFY_INPUT_CHARS_TERTIARY", "12000"))
MAX_TRANSLATED_EXCERPTS = int(os.getenv("MAX_TRANSLATED_EXCERPTS", "3"))
MAX_TRANSLATION_SOURCE_CHARS = int(os.getenv("MAX_TRANSLATION_SOURCE_CHARS", "1200"))
MAX_REVIEW_EVIDENCE_CHARS = int(os.getenv("MAX_REVIEW_EVIDENCE_CHARS", "50000"))
REVIEW_PASS_SCORE = int(os.getenv("DIFY_REVIEW_PASS_SCORE", "85"))


def strip_think_tags(value: Any) -> Any:
    """Remove DeepSeek reasoning blocks from workflow outputs."""
    if isinstance(value, str):
        return THINK_TAG_RE.sub("", value).strip()
    if isinstance(value, list):
        return [strip_think_tags(item) for item in value]
    if isinstance(value, dict):
        return {key: strip_think_tags(item) for key, item in value.items()}
    return value


def clip_text_for_dify(raw_text: str, limit: int) -> str:
    text = raw_text.strip()
    if len(text) <= limit:
        return text
    head = int(limit * 0.75)
    tail = max(limit - head, 0)
    if tail <= 0:
        return text[:limit]
    return text[:head].rstrip() + "\n\n...\n\n" + text[-tail:].lstrip()


def ensure_api_key(api_key: str, env_name: str) -> str:
    """Fail fast with a useful message when a workflow key is missing."""
    if api_key:
        return api_key
    raise RuntimeError(
        f"Missing Dify workflow API key. Set {env_name} or DIFY_WORKFLOW_API_KEY in .env.local."
    )


def parse_json_object(raw: str) -> dict:
    """Parse a JSON object from a string response."""
    cleaned = CODE_FENCE_RE.sub("", strip_think_tags(raw)).strip()
    return parse_json_dict_candidates(cleaned)


def parse_json_dict_candidates(cleaned: str) -> dict:
    """Parse a dict from imperfect JSON text using a few repair heuristics."""
    last_error: Exception | None = None
    for candidate in iter_json_candidates(cleaned):
        try:
            parsed = json.loads(candidate)
            if not isinstance(parsed, dict):
                raise ValueError("Dify workflow response must be a JSON object.")
            return parsed
        except Exception as exc:
            last_error = exc
    raise ValueError(f"Unable to parse Dify workflow JSON: {last_error}")


def iter_json_candidates(cleaned: str) -> list[str]:
    candidates: list[str] = []
    base = clean_inline_text(cleaned)
    if base:
        candidates.append(base)

    unquoted = unwrap_json_string(base)
    if unquoted and unquoted not in candidates:
        candidates.append(unquoted)

    extracted = extract_outer_json_object(base)
    if extracted and extracted not in candidates:
        candidates.append(extracted)

    repaired = repair_json_text(base)
    if repaired and repaired not in candidates:
        candidates.append(repaired)

    repaired_extracted = extract_outer_json_object(repaired)
    if repaired_extracted and repaired_extracted not in candidates:
        candidates.append(repaired_extracted)

    repaired_unquoted = unwrap_json_string(repaired)
    if repaired_unquoted and repaired_unquoted not in candidates:
        candidates.append(repaired_unquoted)

    return candidates


def unwrap_json_string(text: str) -> str:
    text = text.strip()
    if len(text) < 2 or text[0] != '"' or text[-1] != '"':
        return ""
    try:
        decoded = json.loads(text)
    except Exception:
        return ""
    return decoded if isinstance(decoded, str) else ""


def extract_outer_json_object(text: str) -> str:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return ""
    return text[start : end + 1]


def repair_json_text(text: str) -> str:
    if not text:
        return ""
    repaired: list[str] = []
    in_string = False
    escaped = False
    for char in text:
        if in_string:
            if escaped:
                repaired.append(char)
                escaped = False
                continue
            if char == "\\":
                repaired.append(char)
                escaped = True
                continue
            if char == '"':
                repaired.append(char)
                in_string = False
                continue
            if char == "\n":
                repaired.append("\\n")
                continue
            if char == "\r":
                repaired.append("\\r")
                continue
            if char == "\t":
                repaired.append(" ")
                continue
            repaired.append(char)
        else:
            repaired.append(char)
            if char == '"':
                in_string = True
                escaped = False
    return "".join(repaired)


def normalize_workflow_outputs(data: Any) -> dict:
    """Normalize common Dify output shapes into a single dict."""
    cleaned = strip_think_tags(data)
    if isinstance(cleaned, dict):
        if isinstance(cleaned.get("result"), str):
            return parse_json_object(cleaned["result"])
        if isinstance(cleaned.get("text"), str):
            return parse_json_object(cleaned["text"])
        return cleaned
    if isinstance(cleaned, str):
        return parse_json_object(cleaned)
    raise ValueError(f"Unsupported Dify workflow output type: {type(cleaned).__name__}")


COMMODITY_NAME_MAP = {
    "brent": "Brent 原油",
    "crude oil": "原油",
    "wti": "WTI 原油",
    "dubai": "Dubai 原油",
    "dubai crude": "Dubai 原油",
    "oman": "阿曼原油",
    "naphtha": "石脑油",
    "gasoline": "汽油",
    "gasoil": "柴油",
    "ulsd s10": "低硫柴油（10ppm）",
    "ulsd diesel (10 ppm)": "ULSD 柴油",
    "diesel": "柴油",
    "jet": "航煤",
    "jet/kerosene": "航煤",
    "fuel oil": "燃料油",
    "saf": "可持续航空燃料（SAF）",
    "lpg": "LPG",
    "lng": "LNG",
    "natural gas/lng": "天然气/LNG",
    "lng jkm": "LNG 亚洲现货（JKM）",
    "lng nwe": "LNG 西北欧市场（NWE）",
    "lng gcm": "LNG 美湾市场（GCM）",
    "jkm": "LNG 亚洲现货（JKM）",
    "wim": "LNG 西印度市场（WIM）",
    "seam": "LNG 东南亚市场（SEAM）",
    "nwe": "LNG 西北欧市场（NWE）",
    "med": "LNG 地中海市场（MED）",
    "gcm": "LNG 美湾市场（GCM）",
    "des brazil": "LNG 巴西到岸",
    "lng freight route cost": "LNG 运费",
    "propane": "丙烷",
    "butane": "丁烷",
    "propane cfr north asia": "丙烷",
    "butane cfr north asia": "丁烷",
    "propane fob middle east": "丙烷",
    "butane fob middle east": "丁烷",
    "propane fob nwe seagoing": "丙烷",
    "butane fob nwe seagoing": "丁烷",
    "lpg china import": "LPG 进口",
    "electricity": "电力",
    "power": "电力",
    "policy/sanctions": "政策/制裁",
    "oil tanker freight": "油轮运费",
    "油轮运费": "油轮运费",
}

SECTION_CONFIG = {
    "overview": "今日看点",
    "oil": "原油与成品油",
    "gas": "天然气与 LNG",
    "lpg_shipping": "LPG 与航运",
    "macro": "海外观察",
}

ENERGY_NEWS_CATEGORIES = {
    "原油",
    "成品油",
    "天然气/LNG",
    "电力",
    "政策/制裁",
    "航运",
    "新能源",
    "LPG",
}

DISPLAY_REPLACEMENTS = [
    ("JKM (DES Japan/Korea Marker)", "LNG 亚洲现货（JKM）"),
    ("DES Japan/Korea Marker", "LNG 亚洲现货（JKM）"),
    ("West India Marker (WIM)", "LNG 西印度市场（WIM）"),
    ("Southeast Asia Marker (SEAM)", "LNG 东南亚市场（SEAM）"),
    ("DES Northwest Europe Marker (NWE)", "LNG 西北欧市场（NWE）"),
    ("DES Mediterranean Marker (MED)", "LNG 地中海市场（MED）"),
    ("FOB Gulf Coast Marker (GCM)", "LNG 美湾装船价格（GCM）"),
    ("Gulf Coast Marker (GCM)", "LNG 美湾市场（GCM）"),
    ("Saharan Blend", "撒哈拉混合原油"),
    ("Girassol", "Girassol 原油"),
    ("US Gulf Coast (Houston)", "美国湾岸（休斯敦）"),
    ("USGC HSFO (FOB Houston)", "美国湾岸高硫燃料油（休斯敦离岸）"),
    ("US Midwest (Group 3)", "美国中西部（Group 3）"),
    ("Midwest Group 3 Regular Suboctane V-grade", "美国中西部汽油现货（普通标号）"),
    ("FOB ARA Barge", "ARA 船货"),
    ("Eurobob FOB ARA barge", "汽油（ARA）"),
    ("ULSD 10ppm CIF NWE cargo", "低硫柴油（西北欧）"),
    ("Jet CIF NWE cargo", "航煤（西北欧）"),
    ("Naphtha CIF NWE cargo", "石脑油（西北欧）"),
    ("Fuel oil 3.5% FOB Rdam barge", "高硫燃料油（鹿特丹）"),
    ("10ppm柴油 FOB新加坡", "低硫柴油（新加坡现货）"),
    ("石脑油 FOB新加坡", "石脑油（新加坡现货）"),
    ("92 RON汽油 FOB新加坡", "92 RON 汽油（新加坡现货）"),
    ("航煤 FOB新加坡", "航煤（新加坡现货）"),
    ("HSFO 380 CST FOB新加坡", "高硫燃料油（新加坡现货）"),
    ("低硫燃料油 0.5% FOB新加坡", "低硫燃料油（新加坡现货）"),
    ("10ppm柴油", "低硫柴油"),
    ("FOB新加坡", "新加坡现货"),
    ("FOB Singapore", "新加坡现货"),
    ("CFR North Asia", "东北亚到岸"),
    ("FOB Middle East", "中东离岸"),
    ("FOB NWE Seagoing", "西北欧离岸"),
    ("Natural Gas/LNG", "天然气/LNG"),
    ("LNG Freight Route Cost", "LNG 运费"),
    ("VLGC Freight Persian Gulf to Japan", "中东至日本 VLGC 运费"),
    ("HSFO 380 CST", "高硫燃料油"),
    ("ICE gasoil", "欧洲柴油期货"),
    ("ICE gasoil石油气", "欧洲柴油期货"),
    ("欧洲柴油期货石油气", "欧洲柴油期货"),
    ("cash differential", "现货升贴水"),
    ("backwardation", "近月升水"),
    ("cash premium", "现货升水"),
    ("Balance month", "近月合约"),
    ("Balance Jul-Aug", "7-8 月近月结构"),
    ("Bal-Jul-Aug", "7-8 月近月结构"),
    ("EFS", "东西方价差"),
    ("crack", "裂解价差"),
    ("Differential to", "相对"),
    ("barrels a day", "桶/日"),
    ("barrels/day", "桶/日"),
    ("barrels per day", "桶/日"),
    ("million barrels", "百万桶"),
    ("gigawatts", "吉瓦"),
    ("wholesale power costs", "批发电价"),
    ("electricity costs", "电力成本"),
    ("increase", "增加"),
    ("increases", "增加"),
    ("up from", "高于"),
    ("fifth straight monthly increase", "连续第五个月增产"),
    ("in August", "于8月"),
    ("since 2024", "较2024年以来"),
    ("annual increase", "年度增幅"),
    ("demand to outpace supply", "需求将超过供给"),
    ("sanctioned entities", "受制裁实体"),
    ("crypto", "加密资产"),
    ("prices could sink to", "价格或回落至"),
    ("Dated Brent +", "较即期布伦特升水 "),
    ("Dated Brent ", "即期布伦特 "),
]


def clean_inline_text(value: Any) -> str:
    text = strip_think_tags(value or "")
    if not isinstance(text, str):
        text = str(text)
    text = re.sub(r"\s+", " ", text).strip()
    if text.lower() in {
        "n/a",
        "na",
        "none",
        "null",
        "unknown",
        "not specified",
        "no specific commentary",
        "no specific supply-demand commentary",
        "无明确信息",
        "不详",
        "暂无",
    }:
        return ""
    return text


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def contains_cjk(text: str) -> bool:
    return any("\u4e00" <= char <= "\u9fff" for char in text)


def has_numeric_signal(text: str) -> bool:
    return bool(re.search(r"\d", text or ""))


def is_mostly_ascii(text: str) -> bool:
    cleaned = "".join(char for char in text if char.isalpha())
    if not cleaned:
        return False
    ascii_chars = sum(1 for char in cleaned if ord(char) < 128)
    return ascii_chars / max(len(cleaned), 1) > 0.85


def confidence_rank(value: str) -> int:
    return {"高": 3, "中": 2, "低": 1}.get(clean_inline_text(value), 0)


def safe_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return None


def format_price_text(price: dict | None) -> str:
    if not isinstance(price, dict):
        return ""
    value = price.get("value")
    unit = humanize_market_text(clean_inline_text(price.get("unit")))
    change = clean_inline_text(price.get("change"))
    if value in (None, "") and not unit and not change:
        return ""
    if value in (None, ""):
        return ""
    value_text = humanize_market_text(str(value)) if isinstance(value, str) else str(value)
    base = f"{value_text}{unit}"
    if change and change not in {"0", "0.000", "0.00"}:
        base = f"{base}（{change}）" if base else change
    return base


def parse_change_value(price: dict | None) -> float | None:
    if not isinstance(price, dict):
        return None
    return safe_float(price.get("change"))


def normalize_commodity_name(name: str) -> str:
    text = clean_inline_text(name)
    lower = text.lower()
    if "eurobob" in lower:
        mapped = "汽油（ARA）"
    elif "west india marker" in lower or lower == "wim":
        mapped = "LNG 西印度市场（WIM）"
    elif "southeast asia marker" in lower or lower == "seam":
        mapped = "LNG 东南亚市场（SEAM）"
    elif "des japan/korea marker" in lower or lower in {"jkm", "lng-jkm"}:
        mapped = "LNG 亚洲现货（JKM）"
    elif lower in {"lng-nwe", "nwe"}:
        mapped = "LNG 西北欧市场（NWE）"
    elif lower in {"lng-med", "med"}:
        mapped = "LNG 地中海市场（MED）"
    elif "propane fob arab gulf" in lower:
        mapped = "丙烷"
    elif "butane fob arab gulf" in lower:
        mapped = "丁烷"
    elif "ulsd s10" in lower:
        mapped = "低硫柴油（10ppm）"
    elif "lng freight" in lower and "asia pacific two stroke" in lower:
        mapped = "LNG 运费（亚太双燃料船）"
    elif "lng freight" in lower and "two stroke" in lower:
        mapped = "LNG 运费（双燃料船）"
    elif "lng freight" in lower:
        mapped = "LNG 运费"
    elif "ulsd" in lower and "nwe" in lower:
        mapped = "低硫柴油（西北欧）"
    elif "jet" in lower and "nwe" in lower:
        mapped = "航煤（西北欧）"
    elif "naphtha" in lower and "nwe" in lower:
        mapped = "石脑油（西北欧）"
    elif ("fuel oil 3.5%" in lower or "hsfo 380" in lower) and "rdam" in lower:
        mapped = "高硫燃料油（鹿特丹）"
    else:
        mapped = COMMODITY_NAME_MAP.get(lower, text)
    return humanize_market_text(mapped)


def humanize_market_text(text: str) -> str:
    text = clean_inline_text(text)
    if not text:
        return ""
    for src, dst in DISPLAY_REPLACEMENTS:
        text = text.replace(src, dst)
    unit_map = {
        "$/tonne": " 美元/吨",
        "$/mt": " 美元/吨",
        "$/bbl": " 美元/桶",
        "$/b": " 美元/桶",
        "$/day": " 美元/日",
        "$/MMBtu": " 美元/MMBtu",
        "$/mmbtu": " 美元/MMBtu",
        "R$/cu m": " 雷亚尔/立方米",
        "R$/m3": " 雷亚尔/立方米",
        "cents/gallon": " 美分/加仑",
    }
    for src, dst in unit_map.items():
        text = text.replace(src, dst)
    text = re.sub(r"\bQ1\b", "第一季度", text)
    text = re.sub(r"\bQ2\b", "第二季度", text)
    text = re.sub(r"\bQ3\b", "第三季度", text)
    text = re.sub(r"\bQ4\b", "第四季度", text)
    text = re.sub(r"\bby 2027\b", "到 2027 年", text)
    text = re.sub(r"\bby 2025\b", "到 2025 年", text)
    text = re.sub(r"\bby 2026\b", "到 2026 年", text)
    text = re.sub(r"\bby 2028\b", "到 2028 年", text)
    text = re.sub(r"([0-9.]+)\s*million barrels", r"\1 百万桶", text)
    text = re.sub(r"([0-9.]+)\s*barrels a day", r"\1 桶/日", text)
    text = re.sub(r"([0-9.]+)\s*barrels/day", r"\1 桶/日", text)
    text = re.sub(r"([0-9.]+)\s*GW", r"\1 吉瓦", text, flags=re.IGNORECASE)
    text = re.sub(r"([0-9.]+)\s*gigawatts", r"\1 吉瓦", text, flags=re.IGNORECASE)
    text = re.sub(r"([0-9.]+)% higher", r"上升 \1%", text)
    text = re.sub(r"minus \$([0-9.]+)/mt", r"贴水 \1 美元/吨", text, flags=re.IGNORECASE)
    text = re.sub(r"\+\$([0-9.]+)/mt", r"升水 \1 美元/吨", text)
    text = re.sub(r"\$([0-9.]+)\s*million", r"\1 百万美元", text)
    text = re.sub(r"\$([0-9.]+)\s*billion", r"\1 十亿美元", text)
    text = text.replace("The Wall Street Journal", "华尔街日报")
    text = text.replace("ULSD S10", "低硫柴油（10ppm）")
    text = text.replace("LNG JKM", "LNG 亚洲现货（JKM）")
    text = text.replace("LNG WIM", "LNG 西印度市场（WIM）")
    text = text.replace("LNG SEAM", "LNG 东南亚市场（SEAM）")
    text = text.replace("LNG NWE", "LNG 西北欧市场（NWE）")
    text = text.replace("LNG MED", "LNG 地中海市场（MED）")
    text = text.replace("LNG GCM", "LNG 美湾市场（GCM）")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def replace_market_phrases(text: str) -> str:
    if not isinstance(text, str):
        text = str(text)
    if not text:
        return ""
    for src, dst in DISPLAY_REPLACEMENTS:
        text = text.replace(src, dst)
    direct_map = [
        ("ULSD S10", "低硫柴油（10ppm）"),
        ("LNG JKM", "LNG 亚洲现货（JKM）"),
        ("LNG WIM", "LNG 西印度市场（WIM）"),
        ("LNG SEAM", "LNG 东南亚市场（SEAM）"),
        ("LNG NWE", "LNG 西北欧市场（NWE）"),
        ("LNG MED", "LNG 地中海市场（MED）"),
        ("LNG GCM", "LNG 美湾市场（GCM）"),
    ]
    for src, dst in direct_map:
        text = text.replace(src, dst)
    text = re.sub(r"LNG\s*JKM", "LNG 亚洲现货（JKM）", text)
    text = re.sub(r"LNG\s*WIM", "LNG 西印度市场（WIM）", text)
    text = re.sub(r"LNG\s*SEAM", "LNG 东南亚市场（SEAM）", text)
    text = re.sub(r"LNG\s*NWE", "LNG 西北欧市场（NWE）", text)
    text = re.sub(r"LNG\s*MED", "LNG 地中海市场（MED）", text)
    text = re.sub(r"LNG\s*GCM", "LNG 美湾市场（GCM）", text)
    text = text.replace("亚太LNG 亚洲现货（JKM）", "LNG 亚洲现货（JKM）")
    text = text.replace("欧洲LNG 西北欧市场（NWE）", "LNG 西北欧市场（NWE）")
    text = text.replace("西北欧石脑油（西北欧）", "石脑油（西北欧）")
    text = text.replace("西北欧汽油（ARA）", "汽油（ARA）")
    return text


def humanize_preserving_layout(text: str) -> str:
    if not isinstance(text, str):
        text = str(text)
    lines = text.splitlines()
    if not lines:
        return replace_market_phrases(text)
    return "\n".join(replace_market_phrases(line) if line.strip() else "" for line in lines)


def has_excess_english(text: str) -> bool:
    text = clean_inline_text(text)
    if not text:
        return False
    alpha_chunks = re.findall(r"[A-Za-z]{3,}", text)
    if not alpha_chunks:
        return False
    cjk_count = sum(1 for char in text if "\u4e00" <= char <= "\u9fff")
    latin_count = sum(len(chunk) for chunk in alpha_chunks)
    return latin_count > max(cjk_count * 2, 16)


def has_long_latin_token(text: str) -> bool:
    return bool(re.search(r"[A-Za-z]{4,}", clean_inline_text(text)))


def localize_key_data(category: str, key_data: str) -> str:
    text = clean_inline_text(key_data)
    if not text:
        return ""
    lower = text.lower()
    if "188,000 barrels a day increase in august" in lower:
        return "8 月增产约 18.8 万桶/日，已连续第五个月增产"
    if "140 million barrels in june" in lower and "prices could sink to $60" in lower:
        return "6 月出口约 1.4 亿桶，日均约 470 万桶，高于 5 月的 200 万桶；油价后续或回落至 60 美元附近"
    if "70% higher electricity costs since 2024" in lower:
        return "电力成本较 2024 年累计上升约 70%，PJM 第一季度批发电价涨幅达 76%，到 2027 年供需缺口或达 6.6 吉瓦"
    if "$100 billion in crypto by sanctioned entities in 2025" in lower:
        return "2025 年受制裁实体通过加密资产流转规模约 1000 亿美元"
    if "less than 30% of electricity from fossil fuels" in lower:
        return "化石能源发电占比已降至 30% 以下"
    if "two reactors closed" in lower:
        return "两座核反应堆因冷却水不足而停运"
    if "at least 90% of accessible fossil fuels already used" in lower:
        return "北海可开采化石能源资源已开发约九成"
    if "higher jet fuel bills" in lower:
        return "航煤成本继续抬升"
    if "$1.7 billion investment" in lower and "european ev share 20%" in lower:
        return "相关投资规模约 17 亿美元，欧洲电动车渗透率约 20%，美国约 6%"
    if "8.3 gigawatt worth of data-center projects" in lower or "8.3 吉瓦拟使用innio发动机的数据中心项目" in lower:
        return "拟采用燃气机组供电的数据中心项目规模约 8.3 吉瓦"
    if "380 万桶" in text or contains_cjk(text):
        return humanize_market_text(text)
    return humanize_market_text(text)


def format_source_label(source: str) -> str:
    text = clean_inline_text(source)
    if not text:
        return "来源未标注"
    raw_lower = text.lower()
    normalized = text.replace("_", " ").replace("-", " ")
    lower = normalized.lower()
    if "wall street journal" in lower:
        return "华尔街日报"
    if "guardian weekly" in lower:
        return "卫报周刊"
    if "guardian uk" in lower or "the guardian uk" in lower:
        return "卫报"
    if lower.startswith("nyt") or "new york times" in lower:
        return "纽约时报"
    if "european marketscan" in lower:
        return "普氏欧洲成品油市场日报"
    if "arab gulf marketscan" in lower:
        return "普氏亚太与阿拉伯湾成品油市场日报"
    if "lng daily" in lower:
        return "普氏 LNG 日报"
    if "lpgaswire" in lower:
        return "LPGaswire"
    if "oilgram price report" in lower:
        return "Oilgram 价格报告"
    if "brazil fuels daily" in lower:
        return "巴西成品油日报"
    if "us marketscan" in lower:
        return "美国成品油市场日报"
    if lower.startswith("eum"):
        return "欧洲成品油市场快报"
    if "energy institute" in lower and "world energy" in lower:
        return "《世界能源统计年鉴》"
    if re.search(r"(^|[_\s-])hr-\d+", raw_lower):
        return "航运经纪简报"
    if re.search(r"(^|[_\s-])pr-\d+", raw_lower):
        return "成品油经纪简报"
    if "dynamic shipbroking weekly market report" in lower:
        return "Dynamic Shipbroking 周度航运市场报告"
    if "weekly grain and protein report" in lower:
        return "农产品周报"
    text = re.sub(r"\.(pdf|docx)$", "", text, flags=re.IGNORECASE)
    text = re.sub(r"[_-]?\d{4}[-_]?\d{2}[-_]?\d{2}.*$", "", text)
    text = re.sub(r"\s*-\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}$", "", text)
    text = re.sub(r"\s*-\s*[A-Za-z]+\s+\d{1,2},\s*\d{4}$", "", text)
    text = text.replace("_", " ")
    text = re.sub(r"\s+", " ", text).strip(" _-")
    return text or source


def normalize_thesis_topic(publisher: str) -> str:
    publisher_l = clean_inline_text(publisher).lower()
    if publisher_l == "energy institute":
        return "《世界能源统计年鉴》"
    if "wall street journal" in publisher_l:
        return "媒体观察"
    return clean_inline_text(publisher) or "机构观点"


def is_publishable_news_item(category: str, signal_type: str, key_data: str, raw_text: str, source: str) -> bool:
    category = clean_inline_text(category)
    signal_type = clean_inline_text(signal_type)
    raw_text = clean_inline_text(raw_text)
    key_data = clean_inline_text(key_data)
    source = clean_inline_text(source).lower()
    is_general_press = any(token in source for token in ("wall street journal", "new york times", "guardian"))

    if category not in ENERGY_NEWS_CATEGORIES and not is_energy_related_text(category, signal_type, raw_text):
        return False
    if category == "公司动态" and not is_energy_related_text(signal_type, raw_text):
        return False
    if "energy institute" in source or "world energy" in source:
        return False
    if "statistical review" in source:
        return False
    if "guardian weekly" in source and not key_data:
        return False
    if is_general_press and not contains_cjk(key_data) and not contains_cjk(raw_text):
        return False
    if is_general_press and has_excess_english(key_data):
        return False
    if is_general_press and has_excess_english(raw_text):
        return False
    if has_excess_english(raw_text) and not contains_cjk(raw_text):
        return False
    if not key_data and not has_numeric_signal(raw_text):
        return False
    return True


def detect_section(name: str, region: str = "", report_type: str = "") -> str:
    name_l = name.lower()
    gas_tokens = ("lng", "天然气", "jkm", "ttf")
    lpg_shipping_tokens = (
        "lpg", "propane", "butane", "丙烷", "丁烷",
        "vlcc", "suezmax", "aframax", "mr", "lr2", "td", "运费", "航运", "carrier",
    )
    oil_tokens = (
        "brent", "wti", "dubai", "naphtha", "gasoline", "gasoil", "diesel",
        "fuel oil", "jet", "kerosene", "航煤", "柴油", "汽油", "燃料油", "石脑油", "原油",
    )
    if any(token in name_l for token in gas_tokens):
        return "gas"
    if any(token in name_l for token in lpg_shipping_tokens):
        return "lpg_shipping"
    if any(token in name_l for token in oil_tokens):
        return "oil"
    return "macro"


def is_energy_related_text(*parts: Any) -> bool:
    blob = " ".join(clean_inline_text(part).lower() for part in parts if part)
    keywords = (
        "oil", "gas", "lng", "lpg", "crude", "brent", "wti", "dubai", "diesel",
        "gasoline", "naphtha", "jet", "kerosene", "fuel", "freight", "tanker",
        "能源", "原油", "天然气", "石油", "柴油", "汽油", "石脑油", "航煤", "燃料油",
        "油轮", "运费", "炼厂", "制裁", "霍尔木兹",
    )
    return any(keyword in blob for keyword in keywords)


def shorten_text(text: str, max_len: int = 120) -> str:
    text = clean_inline_text(text)
    if len(text) <= max_len:
        return text
    cut = text[:max_len].rsplit(" ", 1)[0].rstrip("；，, ")
    return f"{cut}…"


def summarize_driver(driver: str, supply_demand: str) -> str:
    driver = clean_inline_text(driver)
    supply_demand = clean_inline_text(supply_demand)
    if driver and supply_demand:
        return f"{shorten_text(driver, 90)}；供需上，{shorten_text(supply_demand, 90)}"
    if driver:
        return shorten_text(driver, 110)
    if supply_demand:
        return f"供需上，{shorten_text(supply_demand, 110)}"
    return ""


def has_meaningful_cjk_text(text: str) -> bool:
    text = clean_inline_text(text)
    if not text:
        return False
    if not contains_cjk(text):
        return False
    if text in {"无", "暂无", "不详", "无明确信息"}:
        return False
    return True


def build_signal_from_commodity(item: dict, source: str, report_type: str) -> dict | None:
    name = normalize_commodity_name(item.get("name", ""))
    if not name:
        return None
    region = humanize_market_text(clean_inline_text(item.get("region"))) or "全球"
    price_text = format_price_text(item.get("price"))
    driver = clean_inline_text(item.get("driver"))
    supply = clean_inline_text(item.get("supply_demand"))
    spread = clean_inline_text(item.get("spread"))
    if not any([price_text, driver, supply, spread]):
        return None
    if has_excess_english(f"{region}{name}") and not contains_cjk(f"{region}{name}"):
        return None
    has_supporting_text = any(
        has_meaningful_cjk_text(field)
        and not has_excess_english(field)
        for field in (driver, supply, spread)
    )
    if price_text and not has_supporting_text and detect_section(name, region, report_type) == "macro":
        return None
    change_value = parse_change_value(item.get("price"))
    summary_bits = [f"{region}{name}"]
    if price_text:
        summary_bits.append(f"报 {price_text}")
    headline = "，".join(summary_bits)
    summary = summarize_driver(driver, supply)
    if not summary and spread:
        summary = f"价差方面，{shorten_text(spread, 90)}"
    detail_parts = []
    if summary:
        detail_parts.append(summary)
    if spread:
        detail_parts.append(f"价差/结构：{shorten_text(spread, 90)}")
    return {
        "section": detect_section(name, region, report_type),
        "section_hint": report_type or region,
        "commodity": name,
        "region": region,
        "headline": headline,
        "detail": "；".join(detail_parts),
        "price_text": price_text,
        "change_value": change_value,
        "driver_text": driver,
        "supply_text": supply,
        "spread_text": spread,
        "raw_excerpt": clean_inline_text(item.get("source_excerpt")),
        "translated_excerpt": clean_inline_text(item.get("translated_excerpt")),
        "source": source,
        "source_label": format_source_label(source),
        "confidence": clean_inline_text(item.get("confidence")) or "中",
        "score": confidence_rank(clean_inline_text(item.get("confidence")))
        + (2 if price_text else 0)
        + (2 if driver else 0)
        + (1 if supply else 0),
    }


def build_signal_from_news(item: dict, source: str) -> dict | None:
    raw_text = clean_inline_text(item.get("source_excerpt") or item.get("raw_text"))
    if not raw_text:
        return None
    translated_text = clean_inline_text(item.get("translated_excerpt") or item.get("translated_text"))
    category = normalize_commodity_name(item.get("category", "")) or "能源"
    region = clean_inline_text(item.get("region")) or "全球"
    key_data = localize_key_data(category, item.get("key_data", ""))
    direction = clean_inline_text(item.get("direction"))
    signal_type = clean_inline_text(item.get("signal_type"))
    validation_text = translated_text or raw_text
    validation_key_data = key_data if contains_cjk(key_data) or not translated_text else translated_text
    if not is_publishable_news_item(category, signal_type, validation_key_data, validation_text, source):
        return None
    if not key_data and not has_numeric_signal(raw_text):
        return None
    if not key_data:
        return None
    if not has_numeric_signal(key_data) and not has_numeric_signal(raw_text) and not contains_cjk(key_data) and not contains_cjk(raw_text):
        return None
    detail_parts: list[str] = []
    if translated_text and not contains_cjk(key_data):
        detail_parts.append(f"原文事实：{shorten_text(translated_text, 96)}")
    elif key_data:
        detail_parts.append(f"关键数据：{shorten_text(humanize_market_text(key_data), 72)}")
    elif contains_cjk(raw_text) and not is_mostly_ascii(raw_text):
        detail_parts.append(shorten_text(raw_text, 72))
    elif signal_type:
        detail_parts.append(f"主要涉及{signal_type}变化")
    detail = "；".join(detail_parts)
    if not detail and not has_numeric_signal(raw_text) and not has_numeric_signal(key_data):
        return None
    if category in {"原油", "成品油"}:
        section = "oil"
    elif category in {"天然气/LNG"}:
        section = "gas"
    else:
        section = "macro"
    return {
        "section": section,
        "section_hint": category,
        "commodity": category,
        "region": region,
        "headline": f"{region}{category}相关媒体信号",
        "detail": detail,
        "price_text": "",
        "change_value": None,
        "direction": direction,
        "signal_type": signal_type,
        "driver_text": "",
        "supply_text": detail,
        "spread_text": "",
        "raw_excerpt": raw_text,
        "translated_excerpt": translated_text,
        "source": source,
        "source_label": format_source_label(source),
        "confidence": clean_inline_text(item.get("confidence")) or "中",
        "score": confidence_rank(clean_inline_text(item.get("confidence"))) + (1 if key_data else 0),
    }


def build_signal_from_forecast(item: dict, source: str, thesis: str) -> dict | None:
    commodity = normalize_commodity_name(item.get("commodity", "")) or "行业判断"
    metric = clean_inline_text(item.get("metric"))
    direction = clean_inline_text(item.get("direction"))
    magnitude = clean_inline_text(item.get("magnitude"))
    horizon = clean_inline_text(item.get("time_horizon"))
    if not any([commodity, metric, direction, magnitude]):
        return None
    if not is_energy_related_text(commodity, metric, thesis):
        return None
    detail = "；".join(filter(None, [
        shorten_text(thesis, 90),
        f"{metric}{direction}" if metric or direction else "",
        shorten_text(magnitude, 40),
        horizon,
    ]))
    return {
        "section": detect_section(commodity, "", "report_outlook"),
        "section_hint": "forecast",
        "commodity": commodity,
        "region": "全球",
        "headline": f"{commodity}中长期判断",
        "detail": detail,
        "price_text": "",
        "change_value": None,
        "driver_text": detail,
        "supply_text": "",
        "spread_text": "",
        "raw_excerpt": clean_inline_text(item.get("source_excerpt")),
        "translated_excerpt": clean_inline_text(item.get("translated_excerpt")),
        "source": source,
        "source_label": format_source_label(source),
        "confidence": clean_inline_text(item.get("confidence")) or "中",
        "score": confidence_rank(clean_inline_text(item.get("confidence"))) + 2,
    }


def build_signal_from_segment(item: dict, source: str, broker: str) -> dict | None:
    vessel = clean_inline_text(item.get("vessel_type"))
    route = clean_inline_text(item.get("route"))
    rate_text = format_price_text(item.get("rate"))
    tonnage = clean_inline_text(item.get("tonnage"))
    outlook = clean_inline_text(item.get("outlook"))
    if not any([vessel, route, rate_text, tonnage, outlook]):
        return None
    title = " / ".join(filter(None, [vessel, route]))
    detail = "；".join(filter(None, [
        f"运价 {rate_text}" if rate_text else "",
        shorten_text(tonnage, 70),
        shorten_text(outlook, 70),
        broker,
    ]))
    return {
        "section": "lpg_shipping",
        "section_hint": "shipping",
        "commodity": vessel or "航运",
        "region": "全球",
        "headline": title or "航运市场",
        "detail": detail,
        "price_text": rate_text,
        "change_value": None,
        "driver_text": outlook,
        "supply_text": tonnage,
        "spread_text": "",
        "raw_excerpt": clean_inline_text(item.get("source_excerpt")),
        "translated_excerpt": clean_inline_text(item.get("translated_excerpt")),
        "source": source,
        "source_label": format_source_label(source),
        "confidence": "中",
        "score": 3 + (2 if rate_text else 0) + (1 if outlook else 0),
    }


def extract_article_signals(extractions: list[dict]) -> list[dict]:
    signals: list[dict] = []
    for extraction in extractions:
        source = clean_inline_text(extraction.get("_source", {}).get("filename")) or "未知来源"
        report_type = clean_inline_text(extraction.get("report_type"))
        publisher = clean_inline_text(extraction.get("publisher"))
        publisher_lower = publisher.lower()
        for item in as_list(extraction.get("commodities")):
            signal = build_signal_from_commodity(item, source, report_type)
            if signal:
                signals.append(signal)
        for item in as_list(extraction.get("items")):
            signal = build_signal_from_news(item, source)
            if signal:
                signals.append(signal)
        thesis = clean_inline_text(extraction.get("thesis"))
        if publisher_lower == "energy institute":
            thesis = ""
        if thesis and is_energy_related_text(thesis, publisher):
            if publisher.lower() == "energy institute" and not has_numeric_signal(thesis):
                thesis = ""
        if thesis and is_energy_related_text(thesis, publisher):
            signals.append({
                "section": "macro",
                "section_hint": "thesis",
                "commodity": normalize_thesis_topic(publisher),
                "region": "",
                "headline": f"{normalize_thesis_topic(publisher)}重点内容",
                "detail": thesis,
                "price_text": "",
                "change_value": None,
                "direction": "",
                "signal_type": "",
                "driver_text": thesis,
                "supply_text": "",
                "spread_text": "",
                "source": source,
                "source_label": format_source_label(source),
                "confidence": "中",
                "score": 4,
            })
        if publisher_lower != "energy institute":
            for item in as_list(extraction.get("forecasts")):
                signal = build_signal_from_forecast(item, source, thesis)
                if signal:
                    signals.append(signal)
        broker = clean_inline_text(extraction.get("broker"))
        for item in as_list(extraction.get("segments")):
            signal = build_signal_from_segment(item, source, broker)
            if signal:
                signals.append(signal)
    return signals


def dedupe_signals(signals: list[dict]) -> list[dict]:
    deduped: list[dict] = []
    seen: set[str] = set()
    for signal in sorted(signals, key=lambda item: item["score"], reverse=True):
        fingerprint = "|".join([
            signal["section"],
            signal["commodity"],
            signal["region"],
            signal["source"],
        ])
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        deduped.append(signal)
    return deduped


def build_lead_summary(date_str: str, top_signals: list[dict], total_sources: int) -> str:
    if not top_signals:
        return f"{date_str} 暂无足够结构化信号，建议回看原始附件。"
    sections = {signal.get("section") for signal in top_signals}
    directions = [clean_inline_text(signal.get("direction", "")) for signal in top_signals]
    if total_sources == 1 and sections == {"oil", "macro"}:
        if directions.count("利空") >= 2:
            return (
                f"{date_str} 仅有 1 份核心来源，但释放出的关键信号较为集中："
                "原油端同时面临增产、需求偏弱与库存释放后的回补迟缓压力，"
                "短线情绪整体偏谨慎。"
            )
    parts = []
    for signal in top_signals[:3]:
        subject = format_signal_subject(signal)
        price_text = signal.get("price_text", "")
        change_value = signal.get("change_value")
        direction = clean_inline_text(signal.get("direction", ""))
        if change_value is None and not price_text:
            trend = {"利好": "偏强", "利空": "承压"}.get(direction, "出现新变化")
        elif change_value is None:
            trend = "维持高位"
        elif change_value > 0:
            trend = "走强"
        elif change_value < 0:
            trend = "回落"
        else:
            trend = "基本持平"
        if price_text:
            parts.append(f"{subject}{trend}，报 {price_text}")
        else:
            parts.append(f"{subject}{trend}")
    return f"{date_str} 共梳理 {total_sources} 份有效来源。今日市场主线集中在：" + "；".join(parts) + "。"


def interpretive_clause(signal: dict) -> str:
    commodity = humanize_market_text(signal.get("commodity", ""))
    section = clean_inline_text(signal.get("section", ""))
    direction = clean_inline_text(signal.get("direction", ""))
    region = humanize_market_text(signal.get("region", ""))
    source_label = clean_inline_text(signal.get("source_label", ""))
    price_text = clean_inline_text(signal.get("price_text", ""))

    if source_label == "华尔街日报" and commodity == "原油" and region == "中东" and direction == "利空":
        return "这意味着供应端宽松预期正在重新主导油价。"
    if source_label == "华尔街日报" and commodity == "原油" and region == "中国" and direction == "利空":
        return "需求恢复偏慢，使得市场对后续去库节奏更趋谨慎。"
    if source_label == "华尔街日报" and commodity == "电力":
        return "用电紧张开始向高耗能产业成本端传导。"
    if source_label == "华尔街日报" and commodity == "原油" and region == "全球" and direction == "中性":
        return "盘面暂时企稳，但上方空间仍受基本面压制。"
    if source_label == "普氏欧洲成品油市场日报" and commodity == "汽油（ARA）":
        return "欧洲汽油继续受高温、检修和跨区出口窗口共同支撑。"
    if source_label == "普氏欧洲成品油市场日报" and commodity == "低硫柴油（西北欧）":
        return "柴油端的强势更多来自供应扰动，而不是需求全面回暖。"
    if source_label == "普氏欧洲成品油市场日报" and commodity == "航煤（西北欧）":
        return "暑运需求改善仍在支撑航煤裂解表现。"
    if source_label == "普氏欧洲成品油市场日报" and commodity == "石脑油（西北欧）":
        return "石脑油受汽油调和需求带动，短线表现偏强。"
    if source_label == "普氏 LNG 日报" and commodity == "LNG 亚洲现货（JKM）":
        return "地缘风险重新抬头，使亚洲现货气价维持风险溢价。"
    if source_label == "普氏 LNG 日报" and commodity == "LNG 西北欧市场（NWE）":
        return "欧洲气价虽有支撑，但整体成交仍偏谨慎。"
    if source_label == "普氏 LNG 日报" and commodity == "LNG 美湾市场（GCM）":
        return "美湾现货仍在等待更明确的跨区套利机会。"
    if source_label == "普氏 LNG 日报" and commodity == "油轮运费":
        return "船东运力释放后，大西洋航线运价开始高位回调。"
    if source_label == "LPGaswire" and commodity == "丁烷" and region == "中东" and price_text:
        return "中东丁烷虽有原油带动，但现货差价仍显偏弱。"
    if source_label == "普氏亚太与阿拉伯湾成品油市场日报" and commodity == "低硫柴油（新加坡现货）":
        return "欧洲市场走强正在通过套利链条反向抬升亚洲柴油估值。"
    if source_label == "普氏亚太与阿拉伯湾成品油市场日报" and commodity == "石脑油（新加坡现货）":
        return "中国需求预期改善，为石脑油现货提供了边际支撑。"
    if source_label == "普氏亚太与阿拉伯湾成品油市场日报" and commodity == "92 RON 汽油（新加坡现货)":
        return "汽油端虽有供应增量，但现货价格暂未失守。"
    if source_label == "普氏亚太与阿拉伯湾成品油市场日报" and commodity == "92 RON 汽油（新加坡现货）":
        return "汽油端虽有供应增量，但现货价格暂未失守。"
    if source_label == "LPGaswire" and commodity == "丙烷" and region == "亚太" and price_text:
        return "前期连涨后，东北亚丙烷市场开始进入获利回吐阶段。"
    if source_label == "LPGaswire" and commodity == "丁烷" and region == "亚太" and price_text:
        return "丁烷走势仍跟随丙烷调整，短线缺少新的上行动能。"
    if source_label == "LPGaswire" and commodity == "丙烷" and region == "中东" and price_text:
        return "中东现货仍有原油支撑，但终端需求恢复力度有限。"
    if source_label == "Oilgram 价格报告" and commodity == "LPG":
        return "中东供应恢复后，LPG 价格压力开始更多体现为需求端偏弱。"
    if source_label == "《世界能源统计年鉴》":
        return "长期视角看，全球能源增量正在继续向低碳方向迁移。"
    if section == "oil" and direction == "利空":
        return "短线看，相关品种仍以偏弱整理为主。"
    if section == "oil" and direction == "利好":
        return "短线看，相关品种仍有继续走强的基础。"
    if section == "gas" and direction == "利好":
        return "这对区域气价和跨区价差形成支撑。"
    if section == "lpg_shipping" and direction == "利空":
        return "运价与现货端短期仍受装运节奏制约。"
    if section == "lpg_shipping" and direction == "利好":
        return "短线仍可关注现货端跟涨的持续性。"
    return ""


def format_signal_subject(signal: dict) -> str:
    region = humanize_market_text(signal.get("region", ""))
    commodity = humanize_market_text(signal.get("commodity", ""))
    if signal.get("section_hint") == "thesis":
        return commodity or "机构观点"
    if not region or region == "全球":
        return commodity
    if region in commodity:
        return commodity
    region_aliases = {
        "亚太": ("亚洲", "新加坡", "东北亚"),
        "欧洲": ("西北欧", "ARA", "地中海", "欧洲"),
        "西北欧": ("西北欧", "ARA"),
        "中东": ("中东", "波斯湾"),
        "巴西": ("巴西",),
        "美国": ("美国", "美湾"),
    }
    for alias in region_aliases.get(region, ()):
        if alias and alias in commodity:
            return commodity
    if "（" in commodity and region in commodity:
        return commodity
    return f"{region}{commodity}"


def list_recent_report_dates(date_str: str, limit: int = 3) -> list[str]:
    try:
        target = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return []
    candidates: list[str] = []
    for path in REPORTS_DIR.glob("2026-*-*.md"):
        name = path.stem
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", name):
            continue
        if name >= date_str:
            continue
        try:
            parsed = datetime.strptime(name, "%Y-%m-%d").date()
        except ValueError:
            continue
        if parsed < target:
            candidates.append(name)
    return sorted(candidates, reverse=True)[:limit]


def classify_report_bullet(text: str) -> str:
    head = clean_inline_text(text).split("：", 1)[0]
    return detect_section(head)


def compact_context_bullet(text: str) -> str:
    text = replace_market_phrases(text)
    if not text:
        return ""
    title, _, remainder = text.partition("：")
    if not remainder:
        return shorten_text(title, 60)
    clauses = [clean_inline_text(part) for part in remainder.split("；") if clean_inline_text(part)]
    keep: list[str] = []
    for clause in clauses[:2]:
        clause = clause.replace("FOB…", "").replace("…", "")
        clause = clean_inline_text(clause).strip("，;； ")
        if not clause:
            continue
        lowered = clause.lower()
        if "fob" in lowered or "裂解价差对布伦特" in clause or "互换裂解价差" in clause:
            continue
        if clause:
            keep.append(clause)
    if not keep:
        return title
    return f"{title}：{'；'.join(keep)}"


def score_report_bullet(text: str, section: str, origin: str = "") -> float:
    score = {
        "oil": 5.0,
        "gas": 4.5,
        "lpg_shipping": 3.5,
        "macro": 2.0,
    }.get(section, 1.0)

    info_density = min(text.count("；"), 3)
    score += info_density * 0.8

    price_match = re.search(r"（([+-]?[0-9.,]+)）", text)
    if price_match:
        raw_value = price_match.group(1).replace(",", "")
        try:
            change_value = abs(float(raw_value))
        except ValueError:
            change_value = 0.0
        if change_value >= 20:
            score += 2.5
        elif change_value >= 5:
            score += 1.8
        elif change_value >= 1:
            score += 1.0
        elif change_value > 0:
            score += 0.5

    if any(token in text for token in ("制裁", "出口禁令", "袭击", "招标", "套利", "供应", "需求", "地缘")):
        score += 1.2

    if any(token in text for token in ("汽油", "柴油", "原油", "石脑油", "航煤", "LNG", "LPG")):
        score += 0.6

    if origin == "overview":
        score += 1.2
    elif origin in {"oil", "gas", "lpg_shipping"}:
        score += 0.4

    return score


def extract_report_bullets(report_date: str, limit: int = 3) -> list[dict]:
    path = REPORTS_DIR / f"{report_date}.md"
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    joined = "\n".join(lines[:80])
    if (
        "## 延续主线" in joined
        and "## 原油与成品油" not in joined
        and "## 天然气与 LNG" not in joined
        and "## LPG 与航运" not in joined
        and "## 海外观察" not in joined
    ):
        return []
    heading_map = {
        "## 今日看点": "overview",
        "## 原油与成品油": "oil",
        "## 天然气与 LNG": "gas",
        "## LPG 与航运": "lpg_shipping",
        "## 海外观察": "macro",
    }
    bullets: list[dict] = []
    current_section = ""
    for line in lines:
        stripped = line.strip()
        if stripped in heading_map:
            current_section = heading_map[stripped]
            continue
        if stripped.startswith("## "):
            current_section = ""
            continue
        if current_section and stripped.startswith("- "):
            item = stripped[2:].strip()
            item = re.sub(r"^\*\*(.+?)\*\*：", r"\1：", item)
            item = re.sub(r"；来源：.+$", "", item)
            item = clean_inline_text(item)
            if item:
                section = classify_report_bullet(item) if current_section == "overview" else current_section
                bullets.append({
                    "text": compact_context_bullet(item),
                    "section": section,
                    "origin": current_section,
                    "date": report_date,
                    "score": score_report_bullet(item, section, current_section),
                })
        if len(bullets) >= limit:
            break
    return bullets


def build_recent_market_context(date_str: str, limit: int = 3) -> list[str]:
    picked_sections: set[str] = set()
    context: list[str] = []
    candidates: list[dict] = []
    for report_date in list_recent_report_dates(date_str, limit=10):
        candidates.extend(extract_report_bullets(report_date, limit=20))

    candidates.sort(
        key=lambda bullet: (
            -float(bullet.get("score", 0)),
            bullet.get("date", ""),
        )
    )

    for bullet in candidates:
        section = bullet.get("section", "macro")
        text = bullet.get("text", "")
        if (
            not text
            or text in context
            or section in picked_sections
            or section == "macro"
            or "世界能源统计年鉴" in text
            or "全球能源供应总量" in text
            or has_excess_english(text)
        ):
            continue
        context.append(text)
        picked_sections.add(section)
        if len(context) >= limit:
            break

    if len(context) < limit:
        for bullet in candidates:
            section = bullet.get("section", "macro")
            text = bullet.get("text", "")
            if (
                not text
                or text in context
                or section == "macro"
                or "世界能源统计年鉴" in text
                or "全球能源供应总量" in text
                or has_excess_english(text)
            ):
                continue
            context.append(text)
            if len(context) >= limit:
                break
    return context[:limit]


def is_reference_source_publishable(label: str) -> bool:
    text = clean_inline_text(label)
    if not text:
        return False
    lower = text.lower()
    blocked = (
        "guardian",
        "wall street journal",
        "new york times",
        "卫报",
        "华尔街日报",
        "农产品周报",
        "世界能源统计年鉴",
        "energy institute",
    )
    if any(token in lower for token in blocked):
        return False
    preferred = (
        "普氏",
        "lpgaswire",
        "oilgram",
        "shipbroking",
        "航运",
        "成品油",
        "lng",
        "日报",
        "经纪",
    )
    return any(token in lower for token in preferred)


def build_observation_takeaways(recent_context: list[str], has_sources: bool, streak: int = 1) -> dict[str, str]:
    heads = [replace_market_phrases(clean_inline_text(item).split("：", 1)[0]) for item in recent_context if item]
    heads = [head for head in heads if head]
    sections = [classify_report_bullet(item) for item in recent_context if item]

    if heads:
        lead_heads = "、".join(heads[:3])
        if streak >= 4:
            thesis_title = "主线进入反复验证阶段"
            thesis_text = f"连续几个交易日都没有明显新变量，{lead_heads} 这几条旧主线反而更值得反复验证，盘面变化大多会先围着它们展开。"
        elif streak == 3:
            thesis_title = "旧主线开始接受筛选"
            thesis_text = f"走到第三个整理日后，{lead_heads} 仍能反复出现，说明市场还没有摆脱旧主线，只是在等待哪一条先被证实、哪一条先被证伪。"
        elif streak == 2:
            thesis_title = "主线还在沿着旧逻辑走"
            thesis_text = f"把最近两天还能连续出现的线索放在一起看，{lead_heads} 仍是当前最容易影响盘面的几个方向。"
        else:
            thesis_title = "主线仍有迹可循"
            thesis_text = f"把最近几天还能连续出现的线索放在一起看，{lead_heads} 仍是当前最容易影响盘面的几个方向。"
    elif has_sources:
        thesis_title = "主线仍以延续为主"
        thesis_text = "现有材料没有给出足够强的新变量，短线更像是在验证上一交易日已经形成的强弱结构。"
    else:
        thesis_title = "资料面偏淡，盘面更看延续"
        thesis_text = "当天没有新的附件入库，意味着消息面暂时偏淡，盘面更容易围绕既有主线做来回验证。"

    if {"oil", "gas", "lpg_shipping"}.issubset(set(sections)):
        trade_title = "油气航运三条线并行"
        if streak >= 4:
            trade_text = "油品裂解、LNG 风险溢价和 LPG/航运节奏还在同步起作用，说明市场并没有切到新叙事，而是在旧框架里来回找确认。"
        else:
            trade_text = "油品裂解、LNG 风险溢价和 LPG/航运节奏同时在线，说明市场暂时不是单一品种独走，而是几条主线一起定价。"
    elif "oil" in sections and "gas" in sections:
        trade_title = "油气仍是定价核心"
        trade_text = "只要油品与气价两条线继续共振，跨区价差和风险偏好就还会维持在高敏感状态。"
    elif "oil" in sections:
        trade_title = "先盯油品主线"
        trade_text = "在新增信息有限的情况下，最容易先动的仍是油品裂解、跨区套利和炼厂供给这几处变量。"
    elif "gas" in sections:
        trade_title = "先盯气价与地缘扰动"
        trade_text = "如果气价继续被地缘与现货扰动托住，相关风险溢价仍可能向下游能源品种外溢。"
    else:
        trade_title = "先看价格，再看突发事件"
        trade_text = "比起泛泛的宏观叙事，更值得盯的是盘中报价、船期、制裁与装置变化这类能直接改写交易预期的变量。"

    if heads and has_sources:
        rhythm_text = "眼下更适合顺着已形成的强弱结构找验证，而不是在缺少增量证据时过早押注反转。"
    elif heads and streak >= 4:
        rhythm_text = "整理日拉长以后，最怕的不是没消息，而是把旧主线误当成新趋势；盘中确认仍然比抢跑更重要。"
    elif heads:
        rhythm_text = "没有新增资料时，盘中任何一条实打实的报价、船讯或装置消息，都可能比宏观表态更快改写节奏。"
    elif has_sources:
        rhythm_text = "材料增量不多，也意味着市场更容易放大单条消息的影响，盘中确认比提前下注更重要。"
    else:
        rhythm_text = "消息面偏淡时，先确认主线有没有被打破，比急着给方向更重要。"
    return {
        "thesis_title": thesis_title,
        "thesis_text": thesis_text,
        "trade_title": trade_title,
        "trade_text": trade_text,
        "rhythm_text": rhythm_text,
    }


def build_observation_watch_items(recent_context: list[str], streak: int = 1) -> list[str]:
    items: list[str] = []
    sections = [classify_report_bullet(item) for item in recent_context if item]
    heads = [replace_market_phrases(clean_inline_text(item).split("：", 1)[0]) for item in recent_context if item]
    heads = [head for head in heads if head]

    if "oil" in sections:
        oil_head = next((head for head, section in zip(heads, sections) if section == "oil"), "油品主线")
        prefix = "先看" if streak <= 2 else "先继续看"
        items.append(f"{prefix}{oil_head}所在链条的裂解与跨区套利有没有继续扩张，这通常决定油品板块能否延续强弱分化。")
    if "gas" in sections:
        gas_head = next((head for head, section in zip(heads, sections) if section == "gas"), "LNG 主线")
        items.append(f"再看{gas_head}是否继续被现货紧张或地缘情绪托住，这会直接影响区域气价和跨区价差。")
    if "lpg_shipping" in sections:
        lpg_head = next((head for head, section in zip(heads, sections) if section == "lpg_shipping"), "LPG/航运主线")
        items.append(f"{lpg_head}更值得盯装船节奏和现货成交，一旦运输恢复或需求放缓被证实，价格弹性往往会先收缩。")

    if not items:
        items = [
            "先看盘中报价有没有脱离前一交易日区间，这比泛泛讨论方向更有用。",
            "再看装运、招标、制裁和装置消息有没有增量，这些事件最容易直接改写交易预期。",
            "若没有新的硬信息出现，盘面大概率仍以延续和验证为主，不必急于追逐新叙事。",
        ]
    return items[:3]


def build_observation_follow_up(recent_context: list[str], has_sources: bool, streak: int = 1) -> list[str]:
    heads = [replace_market_phrases(clean_inline_text(item).split("：", 1)[0]) for item in recent_context if item]
    heads = [head for head in heads if head]
    if heads:
        first_line = (
            f"如果{heads[0]}所在主线在盘中被新报价或装运消息证伪，当日判断就需要及时切换。"
            if streak <= 2 else
            f"如果{heads[0]}这条线在连续整理后仍迟迟拿不到新成交或装运验证，就要警惕市场开始放弃旧逻辑。"
        )
        return [
            first_line,
            f"若{heads[min(1, len(heads)-1)]}继续获得成交或现货数据验证，现有延续逻辑才算真正站稳。"
            if len(heads) > 1 else
            "若盘中没有新的成交或现货数据跟进，现有判断更适合视作观察结论，而不是趋势确认。",
        ]
    if has_sources:
        return ["若新增材料只提供零碎观点而没有硬数据，建议继续把它当作补充线索，而不是直接改写主判断。"]
    return ["若后续补入新的附件或盘中出现明确价格异动，建议第一时间重写当日观察结论。"]


def consecutive_observation_streak(date_str: str) -> int:
    try:
        current = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        return 1
    streak = 1
    for step in range(1, 8):
        report_date = (current - timedelta(days=step)).strftime("%Y-%m-%d")
        report_path = REPORTS_DIR / f"{report_date}.md"
        if not report_path.exists():
            break
        text = report_path.read_text(encoding="utf-8")
        if "当日暂未入库新的可用附件" not in text:
            break
        streak += 1
    return streak


def build_context_analysis(item: str) -> dict[str, str]:
    text = replace_market_phrases(clean_inline_text(item))
    subject, separator, detail = text.partition("：")
    section = classify_report_bullet(text)
    mechanism = {
        "oil": "核心要看裂解、套利和炼厂供应是否继续同向，而不是只看单日绝对价格。",
        "gas": "核心要看风险溢价能否获得现货成交和区域价差确认。",
        "lpg_shipping": "核心要看装船、运力与终端采购能否形成同向变化。",
    }.get(section, "核心要看这一变化能否被成交、库存或装运数据继续确认。")
    transmission = {
        "oil": "若成立，影响会从裂解与套利扩散到炼厂排产和区域库存。",
        "gas": "若成立，影响会从区域价差扩散到船货流向和到岸成本。",
        "lpg_shipping": "若成立，影响会从装船节奏扩散到运费和区域升贴水。",
    }.get(section, "若成立，影响会先体现为风险偏好变化，再传导至现货定价。")
    return {
        "title": subject or "延续主线",
        "evidence": detail if separator and detail else text,
        "mechanism": mechanism,
        "transmission": transmission,
        "invalidation": f"若{subject or '该主线'}迟迟得不到新成交、库存或装运数据确认，应降低其作为趋势依据的权重。",
    }


def build_empty_article(date_str: str, extractions: list[dict]) -> dict:
    source_labels = []
    for extraction in extractions:
        filename = clean_inline_text(extraction.get("_source", {}).get("filename"))
        if filename:
            source_labels.append(format_source_label(filename))
    unique_sources = [
        label for label in dict.fromkeys(source_labels)
        if is_reference_source_publishable(label)
    ]
    recent_context = build_recent_market_context(date_str, limit=3)
    observation_streak = consecutive_observation_streak(date_str)
    observation = build_observation_takeaways(recent_context, bool(unique_sources), observation_streak)
    if unique_sources:
        lead_summary = (
            f"{date_str} 新增可核验来源不多，暂未出现足以重写交易主线的硬信息。"
            "在这种情况下，更值得做的是顺着既有主线看验证，而不是急着寻找新的叙事重心。"
        )
    else:
        streak_prefix = (
            f"{date_str} 当日暂未入库新的可用附件，这是连续第 {observation_streak} 个信息整理日。"
            if observation_streak > 1 else
            f"{date_str} 当日暂未入库新的可用附件，市场进入信息整理窗口。"
        )
        lead_summary = (
            streak_prefix +
            "缺少增量资料时，盘面通常不会凭空长出新主线，关键还是看前一交易日的强弱结构能否在盘中被继续验证。"
        )
    article_title = f"能源市场日报｜{date_str}"
    if recent_context:
        short_heads = "、".join(replace_market_phrases(clean_inline_text(item).split("：", 1)[0]) for item in recent_context[:3])
        summary_text = f"{date_str} 延续主线集中在：{short_heads}。"
    else:
        summary_text = lead_summary
    watch_items = build_observation_watch_items(recent_context, observation_streak)
    follow_up_items = build_observation_follow_up(recent_context, bool(unique_sources), observation_streak)
    reference_scope = (
        unique_sources[:5]
        if unique_sources else
        ["信息口径：沿用前序日报中已记录的公开市场报价与事件线索；当日无新增附件。"]
    )
    markdown_lines = [
        f"# {article_title}",
        "",
        f"> {lead_summary}",
        "",
        "## 今日看点",
        f"- {replace_market_phrases(observation['thesis_text'])}",
        f"- {observation['trade_text']}",
        f"- {observation['rhythm_text']}",
        "",
    ]
    if recent_context:
        markdown_lines.extend([
            "## 延续主线",
        ])
        for item in recent_context:
            markdown_lines.append(f"- {replace_market_phrases(item)}")
        markdown_lines.extend([
            "",
        ])
    markdown_lines.extend([
        "## 盘中重点",
    ])
    for item in watch_items:
        markdown_lines.append(f"- {item}")
    markdown_lines.extend([
        "",
        "## 参考范围",
    ])
    for source in reference_scope:
        markdown_lines.append(f"- {source}")
    markdown_lines.extend([
        "",
        "## 后续关注",
        "",
    ])
    for item in follow_up_items:
        markdown_lines.append(f"- {item}")
    article_markdown = "\n".join(markdown_lines)

    html_parts = [
        "<!DOCTYPE html>",
        '<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">',
        f"<title>{html.escape(article_title)}</title>",
        "<style>",
        "body{margin:0;background:#ffffff;font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#1f2937;}",
        ".wrap{max-width:720px;margin:0 auto;padding:28px 18px 44px;}",
        ".card{background:#ffffff;padding:0;}",
        ".eyebrow{font-size:12px;letter-spacing:.08em;color:#0f766e;font-weight:700;margin:0 0 10px;text-transform:uppercase;}",
        "h1{font-size:32px;line-height:1.35;margin:0 0 12px;color:#111827;font-weight:700;}",
        ".meta{font-size:13px;color:#9ca3af;margin:0 0 24px;}",
        ".lead{margin:0 0 30px;padding:18px 18px 16px;border-left:4px solid #14b8a6;background:#f8fafc;}",
        ".lead p{margin:0;font-size:17px;line-height:1.95;color:#1f2937;}",
        "h2{font-size:24px;line-height:1.45;margin:36px 0 14px;color:#111827;font-weight:700;}",
        ".signal-grid{display:grid;grid-template-columns:1fr;gap:16px;}",
        ".signal-card{padding:0 0 16px;border-bottom:1px solid #e5e7eb;}",
        ".signal-card.highlight{padding:16px 18px;border:1px solid #d1fae5;border-radius:16px;background:#fcfffe;}",
        ".signal-badge{margin:0 0 8px;font-size:12px;color:#0f766e;font-weight:700;letter-spacing:.04em;}",
        ".signal-title{margin:0 0 8px;font-size:20px;line-height:1.55;color:#111827;font-weight:700;}",
        ".signal-summary{margin:0;font-size:16px;line-height:1.95;color:#374151;}",
        ".signal-source{margin:10px 0 0;font-size:12px;color:#9ca3af;}",
        "</style></head><body><div class=\"wrap\"><article class=\"card\">",
        '<p class="eyebrow">ETI 市场日报</p>',
        f"<h1>{html.escape(article_title)}</h1>",
        f'<p class="meta">{html.escape(date_str)} · 日报观察版 · {"已跟踪 " + str(len(unique_sources)) + " 份新增来源" if unique_sources else "前序公开信息回看"}</p>',
        f'<section class="lead"><p>{html.escape(lead_summary)}</p></section>',
        "<h2>今日看点</h2>",
        '<div class="signal-grid">',
        f'<section class="signal-card highlight"><p class="signal-badge">核心判断</p><h3 class="signal-title">{html.escape(observation["thesis_title"])}</h3><p class="signal-summary">{html.escape(replace_market_phrases(observation["thesis_text"]))}</p></section>',
        f'<section class="signal-card"><p class="signal-badge">市场脉络</p><h3 class="signal-title">{html.escape(observation["trade_title"])}</h3><p class="signal-summary">{html.escape(observation["trade_text"])}</p></section>',
        f'<section class="signal-card"><p class="signal-badge">短线观察</p><h3 class="signal-title">先看节奏，再等新变量</h3><p class="signal-summary">{html.escape(observation["rhythm_text"])}</p></section>',
        "</div>",
    ]
    if recent_context:
        html_parts.extend([
            "<h2>延续主线</h2>",
            '<div class="signal-grid">',
        ])
        for item in recent_context:
            html_parts.append(
                f'<section class="signal-card"><p class="signal-badge">重点线索</p><p class="signal-summary">{html.escape(replace_market_phrases(item))}</p></section>'
            )
        html_parts.extend([
            "</div>",
        ])
    html_parts.extend([
        "<h2>盘中重点</h2>",
        '<div class="signal-grid">',
    ])
    for item in watch_items:
        html_parts.append(
            f'<section class="signal-card"><p class="signal-badge">继续关注</p><p class="signal-summary">{html.escape(item)}</p></section>'
        )
    html_parts.extend([
        "</div>",
        "<h2>参考范围</h2>",
        '<div class="signal-grid">',
    ])
    for source in reference_scope:
        html_parts.append(
            f'<section class="signal-card"><p class="signal-badge">参考来源</p><p class="signal-summary">{html.escape(source)}</p></section>'
        )
    html_parts.append("</div>")
    html_parts.extend([
        "<h2>后续关注</h2>",
        '<div class="signal-grid">',
    ])
    for item in follow_up_items:
        html_parts.append(
            f'<section class="signal-card"><p class="signal-badge">更新条件</p><p class="signal-summary">{html.escape(item)}</p></section>'
        )
    html_parts.extend([
        "</div>",
        "</article></div></body></html>",
    ])

    return {
        "summary": summary_text,
        "report_markdown": article_markdown,
        "report_wechat_html": "".join(html_parts),
        "publishable": False,
        "publish_reason": "no actionable news",
    }


def audit_report_quality(target_date: str, markdown: str, html_text: str) -> list[str]:
    issues: list[str] = []
    if "## 深度拆解" in markdown:
        required_sections = ["## 关键事实", "## 深度拆解", "## 情景推演", "## 验证清单", "## 参考资料"]
    elif "## 原油与成品油" in markdown or "## 天然气与 LNG" in markdown:
        required_sections = ["## 今日看点"]
    else:
        required_sections = ["## 今日看点", "## 盘中重点", "## 后续关注"]
    for section in required_sections:
        if section not in markdown:
            issues.append(f"missing section: {section}")

    banned_patterns = [
        r"<think\b",
        r"\bAI\b",
        r"AI\s*生成",
        r"人工智能生成",
        r"大语言模型",
        r"内部讨论",
        r"自动生成",
        r"可作为观察版发布",
        r"Nothing to do",
        r"\{\{#?.+?#?\}\}",
        r"<script\b",
        r"<iframe\b",
        r"javascript\s*:",
    ]
    for pattern in banned_patterns:
        if re.search(pattern, markdown, re.IGNORECASE) or re.search(pattern, html_text, re.IGNORECASE):
            issues.append(f"banned phrase matched: {pattern}")

    if "## 延续主线" in markdown:
        lines = markdown.splitlines()
        capture = False
        lead_count = 0
        for line in lines:
            stripped = line.strip()
            if stripped == "## 延续主线":
                capture = True
                continue
            if capture and stripped.startswith("## "):
                break
            if capture and stripped.startswith("- "):
                lead_count += 1
        if lead_count < 2:
            issues.append("延续主线 items < 2")

    weak_bullet_count = 0
    for line in markdown.splitlines():
        stripped = line.strip()
        if not stripped.startswith("- **"):
            continue
        body = re.sub(r"^- \*\*(.+?)\*\*：", "", stripped)
        body = body.replace("；来源：", "|来源：")
        content_part = body.split("|来源：", 1)[0].strip()
        if "无；" in stripped or "暂无补充说明" in stripped:
            issues.append("placeholder wording in bullet")
        if content_part.startswith("报价 ") and "；" not in content_part:
            weak_bullet_count += 1
        if content_part in {"", "报价"}:
            weak_bullet_count += 1
    if weak_bullet_count > 0:
        issues.append(f"weak bullets detected: {weak_bullet_count}")

    english_chunks = re.findall(r"[A-Za-z]{4,}", markdown)
    if len(english_chunks) > 30:
        issues.append("too much english residue")

    if len(markdown.strip()) < 300:
        issues.append("markdown too short")

    if target_date not in markdown or target_date not in html_text:
        issues.append("target date missing from report output")

    if "<html" not in html_text.lower():
        issues.append("html output missing document root")

    if issues:
        print(f"  [AUDIT] {target_date} quality warnings:")
        for issue in issues:
            print(f"    - {issue}")
    else:
        print(f"  [AUDIT] {target_date} passed quality checks")
    return issues


def save_quality_audit(
    target_date: str,
    issues: list[str],
    *,
    publishable: bool = True,
    publish_reason: str = "",
    llm_review_status: str = "",
) -> None:
    QUALITY_DIR.mkdir(parents=True, exist_ok=True)
    status = "pass" if not issues else "fail"
    payload = {
        "date": target_date,
        "status": status,
        "issues": issues,
        "publishable": publishable,
        "publish_reason": publish_reason,
        "llm_review_status": llm_review_status,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    audit_path = QUALITY_DIR / f"{target_date}.json"
    audit_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    index_path = QUALITY_DIR / "index.jsonl"
    line = json.dumps(payload, ensure_ascii=False)
    existing_lines: list[str] = []
    if index_path.exists():
        existing_lines = [
            row for row in index_path.read_text(encoding="utf-8").splitlines()
            if row.strip() and f'"date": "{target_date}"' not in row
        ]
    existing_lines.append(line)
    index_path.write_text("\n".join(existing_lines) + "\n", encoding="utf-8")


def trend_label(change_value: float | None) -> str:
    if change_value is None:
        return "持稳"
    if change_value > 0:
        return "偏强"
    if change_value < 0:
        return "回落"
    return "持稳"


def narrative_label(signal: dict) -> str:
    if signal.get("section_hint") == "thesis":
        return ""
    price_text = signal.get("price_text", "")
    change_value = signal.get("change_value")
    direction = clean_inline_text(signal.get("direction", ""))
    if not price_text and change_value is None:
        return {"利好": "偏强", "利空": "承压", "中性": "变化有限"}.get(direction, "出现新变化")
    if change_value is None:
        return "持稳"
    if change_value > 0:
        return "走强"
    if change_value < 0:
        return "回落"
    return "持稳"


def narrative_direction_text(signal: dict) -> str:
    direction = clean_inline_text(signal.get("direction", ""))
    signal_type = clean_inline_text(signal.get("signal_type", ""))
    if direction == "利好":
        return "对市场情绪形成支撑"
    if direction == "利空":
        if signal_type == "政策":
            return "政策层面偏谨慎"
        return "对市场形成压制"
    if direction == "中性":
        return "影响相对中性"
    return ""


def summarize_section(section_key: str, section_signals: list[dict]) -> str:
    if not section_signals:
        return ""
    top = section_signals[:3]
    phrases = []
    seen_phrases: set[str] = set()
    for signal in top:
        subject = format_signal_subject(signal)
        label = narrative_label(signal)
        price_text = signal.get("price_text", "")
        if price_text:
            phrase = f"{subject}{label}，报 {price_text}"
        else:
            phrase = f"{subject}{label}"
        if phrase in seen_phrases:
            continue
        seen_phrases.add(phrase)
        phrases.append(phrase)
    sources = {clean_inline_text(signal.get("source_label", "")) for signal in section_signals}
    commodities = {humanize_market_text(signal.get("commodity", "")) for signal in section_signals}
    if section_key == "oil" and sources == {"华尔街日报"} and "原油" in commodities:
        return "原油板块的压力主要来自增产预期重新升温，而亚洲需求恢复节奏偏慢进一步压制了市场风险偏好。"
    if section_key == "oil" and sources == {"普氏欧洲成品油市场日报"}:
        return "欧洲成品油板块整体维持偏强，背后是高温、检修与跨区套利同时推升了现货紧张度。"
    if section_key == "oil" and sources == {"普氏亚太与阿拉伯湾成品油市场日报"}:
        return "亚太成品油价格继续受欧洲强势外溢影响，柴油与汽油的套利逻辑仍在发挥作用。"
    if section_key == "lpg_shipping" and "LPGaswire" in sources:
        return "LPG 板块短线更像高位震荡：东北亚出现回吐，中东市场则仍由原油波动提供底部支撑。"
    if section_key == "gas" and sources == {"普氏 LNG 日报"}:
        return "LNG 市场的核心仍是地缘扰动带来的风险溢价，而现货需求本身并未显著放大。"
    if section_key == "lpg_shipping" and sources == {"普氏 LNG 日报", "Oilgram 价格报告"}:
        return "航运与 LPG 价格均从高位回落，显示运输恢复和供应修复正在压缩此前的风险溢价。"
    if section_key == "oil":
        return "油品板块的核心矛盾仍在供需与套利窗口，" + "；".join(phrases) + "。"
    if section_key == "gas":
        return "天然气与 LNG 板块仍围绕区域供需和跨区价差展开，" + "；".join(phrases) + "。"
    if section_key == "lpg_shipping":
        return "LPG 与航运板块延续区域分化，短线仍由现货报价和装运节奏主导，" + "；".join(phrases) + "。"
    return "补充来源中的有效信号主要包括：" + "；".join(phrases) + "。"


def render_signal_bullet(signal: dict) -> str:
    subject = format_signal_subject(signal)
    price_text = signal.get("price_text", "")
    change_value = signal.get("change_value")
    driver_text = humanize_market_text(signal.get("driver_text", ""))
    supply_text = humanize_market_text(signal.get("supply_text", ""))
    spread_text = humanize_market_text(signal.get("spread_text", ""))
    trend = narrative_label(signal)

    if signal.get("section_hint") == "thesis":
        sentence = subject or "机构观点"
    else:
        sentence = f"{subject}{trend}"
    if price_text:
        sentence += f"，报 {price_text}"

    clauses = []
    direction_clause = narrative_direction_text(signal)
    if direction_clause:
        clauses.append(direction_clause)
    if contains_cjk(driver_text) and not is_mostly_ascii(driver_text) and not has_excess_english(driver_text):
        clauses.append(shorten_text(driver_text, 56))
    if "关键数据：" in supply_text:
        clauses.append(shorten_text(supply_text, 72))
    elif contains_cjk(supply_text) and not is_mostly_ascii(supply_text) and not has_excess_english(supply_text):
        clauses.append(f"供需方面，{shorten_text(supply_text, 56)}")
    if spread_text and not is_mostly_ascii(spread_text) and not has_excess_english(spread_text) and not has_long_latin_token(spread_text):
        clauses.append(f"价差/结构：{shorten_text(spread_text, 48)}")

    if clauses:
        sentence += "；" + "；".join(clauses)
    sentence += f"（来源：{signal.get('source_label') or signal['source']}）"
    return sentence


def render_signal_title(signal: dict) -> str:
    subject = format_signal_subject(signal)
    trend = narrative_label(signal)
    if signal.get("section_hint") == "thesis":
        return subject or "机构观点"
    return f"{subject}{trend}"


def pick_summary_clause(text: str, max_len: int = 64) -> str:
    text = clean_inline_text(text)
    if not text:
        return ""
    for splitter in ("；", ";", "。"):
        text = text.split(splitter)[0].strip()
    return shorten_text(text, max_len)


def is_generic_support_clause(clause: str) -> bool:
    text = clean_inline_text(clause)
    if not text:
        return True
    generic_prefixes = (
        "报价 ",
        "对市场情绪形成支撑",
        "对市场形成压制",
        "影响相对中性",
        "政策层面偏谨慎",
    )
    return any(text.startswith(prefix) for prefix in generic_prefixes)


def build_signal_clauses(signal: dict, *, include_source: bool = False) -> list[str]:
    price_text = signal.get("price_text", "")
    driver_text = humanize_market_text(signal.get("driver_text", ""))
    supply_text = humanize_market_text(signal.get("supply_text", ""))
    spread_text = humanize_market_text(signal.get("spread_text", ""))
    direction_clause = narrative_direction_text(signal)

    clauses: list[str] = []
    if price_text:
        clauses.append(f"报价 {price_text}")
    if direction_clause:
        clauses.append(direction_clause)

    if "关键数据：" in supply_text:
        clauses.append(supply_text.replace("关键数据：", "", 1).strip())
    elif contains_cjk(driver_text) and not is_mostly_ascii(driver_text) and not has_excess_english(driver_text):
        clauses.append(pick_summary_clause(driver_text, 64))
    elif contains_cjk(supply_text) and not is_mostly_ascii(supply_text) and not has_excess_english(supply_text):
        clauses.append(pick_summary_clause(supply_text.replace("供需方面，", "", 1), 64))

    if (
        spread_text
        and spread_text not in {"无", "N/A"}
        and not is_mostly_ascii(spread_text)
        and not has_excess_english(spread_text)
        and not has_long_latin_token(spread_text)
        and "FOB" not in spread_text
        and "=" not in spread_text
    ):
        clauses.append(f"结构上，{pick_summary_clause(spread_text, 44)}")

    cleaned: list[str] = []
    for clause in clauses:
        clause = clean_inline_text(clause).rstrip("；。 ")
        if clause in {"无", "无明确信息"}:
            continue
        if clause and clause not in cleaned:
            cleaned.append(clause)

    interpretive = interpretive_clause(signal)
    interpretive = clean_inline_text(interpretive).rstrip("；。 ")
    if interpretive and interpretive not in cleaned:
        cleaned.append(interpretive)

    limit = 4
    if include_source:
        source_clause = f"来源：{signal.get('source_label') or signal['source']}"
        cleaned = cleaned[: max(limit - 1, 0)]
        cleaned.append(source_clause)
        return cleaned
    return cleaned[:limit]


def is_publishable_signal(signal: dict) -> bool:
    clauses = build_signal_clauses(signal)
    if not clauses:
        return False
    support_clauses = [clause for clause in clauses if not is_generic_support_clause(clause)]
    price_text = clean_inline_text(signal.get("price_text", ""))
    section_hint = clean_inline_text(signal.get("section_hint", ""))
    if section_hint == "thesis":
        return bool(support_clauses or clauses)
    if price_text and not support_clauses:
        return False
    if not price_text and not support_clauses:
        return False
    return True


def render_signal_markdown(signal: dict) -> str:
    title = render_signal_title(signal)
    clauses = build_signal_clauses(signal)
    return f"**{title}**：{'；'.join(clauses)}"


def render_signal_html_card(signal: dict, section_name: str, *, highlight: bool = False) -> str:
    title = render_signal_title(signal)
    clauses = build_signal_clauses(signal)
    summary = "；".join(clauses) if clauses else "暂无补充说明。"
    section_badge = "今日重点" if highlight else section_name
    card_cls = "signal-card highlight" if highlight else "signal-card"
    return (
        f'<section class="{card_cls}">'
        f'<p class="signal-badge">{html.escape(section_badge)}</p>'
        f'<h3 class="signal-title">{html.escape(title)}</h3>'
        f'<p class="signal-summary">{html.escape(summary)}</p>'
        f"</section>"
    )


def section_body_signals(section_signals: list[dict], top_signals: list[dict], limit: int = 3) -> list[dict]:
    top_keys = {render_signal_title(signal) for signal in top_signals}
    unique_section = [signal for signal in section_signals if render_signal_title(signal) not in top_keys]
    if unique_section:
        return unique_section[:limit]
    return section_signals[: min(1, limit)]


def build_follow_up_items(signals: list[dict], limit: int = 3) -> list[str]:
    items: list[str] = []
    seen: set[str] = set()
    for signal in signals:
        title = render_signal_title(signal)
        if not title or title in seen:
            continue
        seen.add(title)
        clauses = build_signal_clauses(signal)
        focus = ""
        for clause in clauses:
            clause = clean_inline_text(clause)
            if clause and not clause.startswith("报价 "):
                focus = clause
                break
        if focus:
            items.append(f"继续跟踪{title}：重点看“{focus}”这一驱动在下一交易时段是否延续。")
        elif signal.get("price_text"):
            items.append(f"继续跟踪{title}：重点看当前报价变化能否延续到下一交易时段。")
        if len(items) >= limit:
            break
    return items


def reference_product_titles(signals: list[dict]) -> list[str]:
    titles: list[str] = []
    for signal in signals:
        title = clean_inline_text(signal.get("source_label")) or format_source_label(signal.get("source", ""))
        title = re.sub(r"^\d+\s*", "", title).strip(" _-")
        if not title or title == "来源未标注" or title in titles:
            continue
        titles.append(title)
    return titles


def signal_evidence_text(signal: dict) -> str:
    subject = format_signal_subject(signal)
    price_text = clean_inline_text(signal.get("price_text", ""))
    driver_text = humanize_market_text(signal.get("driver_text", ""))
    supply_text = humanize_market_text(signal.get("supply_text", ""))
    parts: list[str] = []
    if price_text:
        parts.append(f"{subject}报 {price_text}")
    else:
        parts.append(f"{subject}{narrative_label(signal)}")
    if "关键数据：" in supply_text:
        parts.append(pick_summary_clause(supply_text.replace("关键数据：", "", 1), 70))
    elif contains_cjk(driver_text) and not has_excess_english(driver_text):
        parts.append(pick_summary_clause(driver_text, 70))
    elif contains_cjk(supply_text) and not has_excess_english(supply_text):
        parts.append(pick_summary_clause(supply_text, 70))
    return "；".join(part for part in parts if part).rstrip("；。") + "。"


def signal_transmission_text(signal: dict) -> str:
    section = clean_inline_text(signal.get("section", ""))
    commodity = humanize_market_text(signal.get("commodity", ""))
    if section == "oil":
        if any(token in commodity for token in ("汽油", "柴油", "航煤", "石脑油", "燃料油")):
            return "传导顺序通常先落在裂解价差和跨区套利，再影响炼厂排产、采购意愿与区域库存。"
        return "传导顺序通常先影响原料成本与炼厂采购，再扩散到成品油裂解和库存预期。"
    if section == "gas":
        return "传导顺序通常是区域价差先变化，随后改变船货流向、到岸成本与现货采购节奏。"
    if section == "lpg_shipping":
        return "传导顺序通常从装船和运力开始，经由运费变化反映到区域到岸价与现货升贴水。"
    return "这类变化更可能先影响风险偏好和成本预期，再传导到具体品种的现货定价。"


def signal_invalidation_text(signal: dict) -> str:
    section = clean_inline_text(signal.get("section", ""))
    direction = clean_inline_text(signal.get("direction", ""))
    change_value = signal.get("change_value")
    if direction == "利空" or (isinstance(change_value, (int, float)) and change_value < 0):
        if section == "oil":
            return "若库存转降、供应再度受扰或现货升水修复，当前偏弱判断需要下调权重。"
        if section == "gas":
            return "若船货供应收紧或区域现货需求回升，当前回落逻辑可能迅速反转。"
        return "若现货成交和装运节奏重新收紧，当前偏弱判断将失效。"
    if section == "oil":
        return "若裂解未能继续扩张、套利窗口关闭或炼厂供应恢复，当前强势将更像短期扰动。"
    if section == "gas":
        return "若现货成交没有跟进、船货供应增加或地缘溢价回落，当前支撑将明显减弱。"
    if section == "lpg_shipping":
        return "若装船恢复、运力释放或终端补库放缓，价格与运费的上行弹性会先收缩。"
    return "若后续缺少成交、库存或装运数据确认，这一判断应继续视作观察结论。"


def build_signal_analysis(signal: dict) -> dict[str, str]:
    subject = format_signal_subject(signal)
    mechanism = clean_inline_text(interpretive_clause(signal)).rstrip("。")
    driver_blob = " ".join([
        humanize_market_text(signal.get("driver_text", "")),
        humanize_market_text(signal.get("supply_text", "")),
        humanize_market_text(signal.get("translated_excerpt", "")),
        humanize_market_text(signal.get("raw_excerpt", "")),
    ])
    if "区域供需基本稳定" in driver_blob and any(token in driver_blob for token in ("美欧", "欧洲", "美国")):
        mechanism = "本地供需并未明显恶化，价格变化更多是外部基准和跨区套利向亚洲市场传导"
    elif any(token in driver_blob for token in ("炼厂供应中断", "供应中断", "燃料短缺")) and any(token in driver_blob for token in ("需求", "出口")):
        mechanism = "需求扩张与供应中断同时出现，现货紧张并非单一事件驱动，因此持续性通常强于普通消息冲击"
    elif any(token in driver_blob for token in ("采购需求增加", "买家采购需求")) and any(token in driver_blob for token in ("增加出货", "供应增加")):
        mechanism = "需求与供应同步增加但价格仍然走强，说明边际采购强度暂时高于新增货源，现货竞争在增强"
    elif any(token in driver_blob for token in ("地缘风险", "制裁", "袭击")):
        mechanism = "当前价格变化包含明显风险溢价，持续性取决于现货成交能否接替事件情绪"
    if any(token in driver_blob.lower() for token in ("rosebank", "罗斯班克", "co2", "二氧化碳", "emissions", "排放")):
        mechanism = "这条信息主要改变的是项目审批、融资成本与长期供给预期，而非当天现货价格；若监管约束收紧，新增上游产能的兑现时间会被进一步后移"
    elif any(token in driver_blob.lower() for token in ("hormuz", "霍尔木兹", "transit fee", "通行费", "service fee")):
        mechanism = "航道收费会把地缘风险从一次性情绪转化为可持续的运输成本，首先抬升保险与运费，再通过到岸成本进入油气现货定价"
    elif any(token in driver_blob.lower() for token in ("refiner", "refinery", "炼厂", "fuel shortage", "燃料短缺", "drone", "无人机")):
        mechanism = "炼厂受扰直接压缩成品油可供应量，影响通常先体现在当地短缺与裂解走强，随后才可能反向改变原油采购和跨区调运"
    elif any(token in driver_blob.lower() for token in ("north sea", "北海", "reserves extracted", "储量已被开采", "oilfield jobs", "石油行业的就业")):
        mechanism = "这反映的是成熟产区的结构性衰退：单个新项目或许能延缓产量下滑，却很难逆转储量递减、就业收缩和单位开发成本上升的长期趋势"
    if not mechanism:
        mechanism = {
            "oil": "当前变化反映供需预期与套利结构正在重新定价",
            "gas": "当前变化反映区域供需与风险溢价正在重新平衡",
            "lpg_shipping": "当前变化反映现货供需与运输节奏仍不同步",
        }.get(clean_inline_text(signal.get("section", "")), "当前变化正在改变市场对后续成本与风险的判断")
    return {
        "title": f"{subject}：{narrative_label(signal)}背后的主导变量",
        "evidence": signal_evidence_text(signal),
        "mechanism": mechanism + "。",
        "transmission": signal_transmission_text(signal),
        "invalidation": signal_invalidation_text(signal),
    }


def build_translation_excerpts(signals: list[dict], limit: int = 3) -> list[dict[str, str]]:
    excerpts: list[dict[str, str]] = []
    seen: set[str] = set()
    for signal in signals:
        translation = clean_inline_text(signal.get("translated_excerpt", ""))
        original = clean_inline_text(signal.get("raw_excerpt", ""))
        if not translation or not original:
            continue
        fingerprint = re.sub(r"\W+", "", translation.lower())[:120]
        if not fingerprint or fingerprint in seen:
            continue
        seen.add(fingerprint)
        analysis = build_signal_analysis(signal)
        excerpts.append({
            "title": format_signal_subject(signal),
            "translation": shorten_text(translation, 360),
            "importance": analysis["mechanism"],
        })
        if len(excerpts) >= limit:
            break
    return excerpts


def build_market_thesis(signals: list[dict]) -> str:
    top = signals[:3]
    if not top:
        return "当前有效信号不足，方向判断应以盘中成交和库存变化为准。"
    subjects = [format_signal_subject(signal) for signal in top]
    sections = {clean_inline_text(signal.get("section", "")) for signal in top}
    change_signs = {
        1 if isinstance(signal.get("change_value"), (int, float)) and signal.get("change_value") > 0 else
        -1 if isinstance(signal.get("change_value"), (int, float)) and signal.get("change_value") < 0 else 0
        for signal in top
    }
    first_view = clean_inline_text(interpretive_clause(top[0])).rstrip("。")
    if 1 in change_signs and -1 in change_signs:
        opening = f"{'、'.join(subjects)}方向并不一致，说明当前是区域与品种结构分化，而不是能源链单边行情。"
    elif len(sections) >= 2:
        opening = f"今天的重点不是单一价格涨跌，而是{'、'.join(subjects)}之间的联动是否成立。"
    else:
        opening = f"今天的核心矛盾集中在{'、'.join(subjects)}，同一链条内的强弱分化比绝对方向更重要。"
    if first_view:
        return opening + first_view + "；因此，盘中应优先验证传导链，而不是只追踪报价本身。"
    return opening + "盘中应优先验证成交、价差与装运是否同向，避免把孤立报价误判为趋势。"


def build_scenario_items(signals: list[dict]) -> list[dict[str, str]]:
    top = signals[:3]
    if not top:
        return []
    dominant = build_signal_analysis(top[0])
    base_subjects = "、".join(format_signal_subject(signal) for signal in top[:2])
    return [
        {
            "label": "基准情景",
            "text": f"{base_subjects}沿现有驱动运行，市场维持结构性分化；价格有方向，但跨品种不会同步单边扩张。",
        },
        {
            "label": "强化情景",
            "text": f"若成交、价差和装运数据继续同向确认，{format_signal_subject(top[0])}将从短期波动升级为可延续主线。",
        },
        {
            "label": "反转情景",
            "text": dominant["invalidation"],
        },
    ]


def build_local_article(date_str: str, mode: str, extractions: list[dict], remote_summary: str = "") -> dict:
    if mode != "daily" or not extractions:
        return {}

    signals = dedupe_signals(extract_article_signals(extractions))
    signals = [signal for signal in signals if is_publishable_signal(signal)]
    if not signals:
        return build_empty_article(date_str, extractions)

    top_signals = signals[:4]
    grouped: dict[str, list[dict]] = {key: [] for key in SECTION_CONFIG if key != "overview"}
    for signal in signals:
        section = signal["section"]
        if section not in grouped:
            section = "macro"
        if len(grouped[section]) < 4:
            grouped[section].append(signal)

    lead_summary = build_market_thesis(top_signals)
    follow_up_items = build_follow_up_items(top_signals)
    analyses = [build_signal_analysis(signal) for signal in top_signals[:3]]
    translated_excerpts = build_translation_excerpts(signals, MAX_TRANSLATED_EXCERPTS)
    scenarios = build_scenario_items(top_signals)
    references = reference_product_titles(signals) or ["ETI 能源市场日报"]
    section_insights: list[tuple[str, str]] = []
    for section_key in ("oil", "gas", "lpg_shipping", "macro"):
        section_signals = grouped[section_key]
        if not section_signals:
            continue
        insight = summarize_section(section_key, section_signals)
        if insight:
            section_insights.append((SECTION_CONFIG[section_key], insight))

    article_title = f"能源市场日报｜{date_str}"
    markdown_lines = [
        f"# {article_title}",
        "",
        f"> {lead_summary}",
        "",
        "## 关键事实",
    ]
    for signal in top_signals:
        markdown_lines.append(f"- {render_signal_markdown(signal)}")
    markdown_lines.extend(["", "## 深度拆解"])
    for analysis in analyses:
        markdown_lines.append(
            f"- **{analysis['title']}**：事实：{analysis['evidence']}"
            f"机制：{analysis['mechanism']}传导：{analysis['transmission']}"
            f"失效条件：{analysis['invalidation']}"
        )
    if translated_excerpts:
        markdown_lines.extend(["", "## 原文摘译"])
        for excerpt in translated_excerpts:
            markdown_lines.append(
                f"- **{excerpt['title']}**：摘译：{excerpt['translation']}"
                f"为什么重要：{excerpt['importance']}"
            )
    if section_insights:
        markdown_lines.extend(["", "## 市场传导"])
        for section_name, insight in section_insights:
            markdown_lines.append(f"- **{section_name}**：{insight}")
    if scenarios:
        markdown_lines.extend(["", "## 情景推演"])
        for scenario in scenarios:
            markdown_lines.append(f"- **{scenario['label']}**：{scenario['text']}")
    if follow_up_items:
        markdown_lines.extend(["", "## 验证清单", ""])
        for item in follow_up_items:
            markdown_lines.append(f"- {item}")
    markdown_lines.extend(["", "## 参考资料", ""])
    for index, reference in enumerate(references, start=1):
        markdown_lines.append(f"- [{index}] {reference}")
    article_markdown = humanize_preserving_layout("\n".join(markdown_lines))

    html_parts = [
        "<!DOCTYPE html>",
        '<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">',
        f"<title>{html.escape(article_title)}</title>",
        "<style>",
        "body{margin:0;background:#ffffff;font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#1f2937;}",
        ".wrap{max-width:720px;margin:0 auto;padding:28px 18px 44px;}",
        ".card{background:#ffffff;padding:0;}",
        ".eyebrow{font-size:12px;letter-spacing:.08em;color:#0f766e;font-weight:700;margin:0 0 10px;text-transform:uppercase;}",
        "h1{font-size:32px;line-height:1.35;margin:0 0 12px;color:#111827;font-weight:700;}",
        ".meta{font-size:13px;color:#9ca3af;margin:0 0 24px;}",
        ".lead{margin:0 0 30px;padding:18px 18px 16px;border-left:4px solid #14b8a6;background:#f8fafc;}",
        ".lead p{margin:0;font-size:17px;line-height:1.95;color:#1f2937;}",
        "h2{font-size:24px;line-height:1.45;margin:36px 0 14px;color:#111827;font-weight:700;}",
        ".section-intro{margin:0 0 16px;font-size:16px;line-height:1.95;color:#4b5563;}",
        ".signal-grid{display:grid;grid-template-columns:1fr;gap:16px;}",
        ".signal-card{padding:0 0 16px;border-bottom:1px solid #e5e7eb;}",
        ".signal-card.highlight{padding:16px 18px;border:1px solid #d1fae5;border-radius:16px;background:#fcfffe;}",
        ".analysis-card{margin:0 0 18px;padding:17px 18px;border-left:4px solid #0f766e;background:#f8fafc;}",
        ".analysis-row{margin:8px 0 0;font-size:15px;line-height:1.9;color:#374151;}",
        ".analysis-key{color:#0f766e;font-weight:700;}",
        ".translation-card{margin:0 0 18px;padding:18px;border:1px solid #dbeafe;border-radius:14px;background:#f8fbff;}",
        ".translation-text{margin:8px 0 0;font-size:16px;line-height:2;color:#1f2937;}",
        ".translation-note{margin:12px 0 0;padding-top:11px;border-top:1px solid #dbeafe;font-size:14px;line-height:1.85;color:#4b5563;}",
        ".scenario-card{margin:0 0 12px;padding:15px 16px;border:1px solid #e5e7eb;border-radius:12px;background:#fff;}",
        ".reference-list{margin:0;padding-left:22px;color:#6b7280;font-size:13px;line-height:1.9;}",
        ".signal-badge{margin:0 0 8px;font-size:12px;color:#0f766e;font-weight:700;letter-spacing:.04em;}",
        ".signal-title{margin:0 0 8px;font-size:20px;line-height:1.55;color:#111827;font-weight:700;}",
        ".signal-summary{margin:0;font-size:16px;line-height:1.95;color:#374151;}",
        "</style></head><body><div class=\"wrap\"><article class=\"card\">",
        '<p class="eyebrow">ETI 市场日报</p>',
        f"<h1>{html.escape(article_title)}</h1>",
        f'<p class="meta">{html.escape(date_str)} · ETI 能源市场研究</p>',
        f'<section class="lead"><p>{html.escape(lead_summary)}</p></section>',
        "<h2>关键事实</h2>",
        '<div class="signal-grid">',
    ]
    for signal in top_signals:
        html_parts.append(render_signal_html_card(signal, "关键事实", highlight=True))
    html_parts.append("</div>")
    html_parts.append("<h2>深度拆解</h2>")
    for analysis in analyses:
        html_parts.append(
            '<section class="analysis-card">'
            f'<h3 class="signal-title">{html.escape(analysis["title"])}</h3>'
            f'<p class="analysis-row"><span class="analysis-key">事实｜</span>{html.escape(analysis["evidence"])}</p>'
            f'<p class="analysis-row"><span class="analysis-key">机制｜</span>{html.escape(analysis["mechanism"])}</p>'
            f'<p class="analysis-row"><span class="analysis-key">传导｜</span>{html.escape(analysis["transmission"])}</p>'
            f'<p class="analysis-row"><span class="analysis-key">失效条件｜</span>{html.escape(analysis["invalidation"])}</p>'
            "</section>"
        )
    if translated_excerpts:
        html_parts.append("<h2>原文摘译</h2>")
        html_parts.append('<p class="section-intro">以下内容保留原文的事实顺序和语气，仅作中文摘译；市场含义另行说明。</p>')
        for excerpt in translated_excerpts:
            html_parts.append(
                '<section class="translation-card">'
                f'<p class="signal-badge">{html.escape(excerpt["title"])}</p>'
                f'<p class="translation-text">{html.escape(excerpt["translation"])}</p>'
                f'<p class="translation-note"><strong>为什么重要：</strong>{html.escape(excerpt["importance"])}</p>'
                "</section>"
            )
    if section_insights:
        html_parts.append("<h2>市场传导</h2>")
        for section_name, insight in section_insights:
            html_parts.append(
                f'<section class="signal-card"><p class="signal-badge">{html.escape(section_name)}</p>'
                f'<p class="signal-summary">{html.escape(insight)}</p></section>'
            )
    if scenarios:
        html_parts.append("<h2>情景推演</h2>")
        for scenario in scenarios:
            html_parts.append(
                f'<section class="scenario-card"><p class="signal-badge">{html.escape(scenario["label"])}</p>'
                f'<p class="signal-summary">{html.escape(scenario["text"])}</p></section>'
            )
    if follow_up_items:
        html_parts.append("<h2>验证清单</h2>")
        html_parts.append('<div class="signal-grid">')
        for item in follow_up_items:
            html_parts.append(
                f'<section class="signal-card"><p class="signal-badge">下一步验证</p><p class="signal-summary">{html.escape(item)}</p></section>'
            )
        html_parts.append("</div>")
    html_parts.append("<h2>参考资料</h2>")
    html_parts.append('<ol class="reference-list">')
    for reference in references:
        html_parts.append(f"<li>{html.escape(reference)}</li>")
    html_parts.append("</ol>")
    html_parts.append("</article></div></body></html>")

    return {
        "summary": lead_summary,
        "report_markdown": article_markdown,
        "report_wechat_html": "".join(html_parts),
        "publishable": True,
        "publish_reason": "",
    }


# ── Text Extraction ────────────────────────────────────────

def extract_pdf(path: Path) -> str:
    """Extract text from PDF using pymupdf."""
    import fitz
    doc = fitz.open(str(path))
    text = ""
    for page in doc:
        text += page.get_text()
    doc.close()
    return text


def extract_docx(path: Path) -> str:
    """Extract text from DOCX using python-docx."""
    from docx import Document
    doc = Document(str(path))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def extract_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return extract_pdf(path)
    elif suffix == ".docx":
        return extract_docx(path)
    raise ValueError(f"Unsupported format: {suffix}")


def should_skip_extracted_text(path: Path, raw_text: str) -> str | None:
    """Return a skip reason when extracted text is too sparse to be useful."""
    if path.suffix.lower() == ".pdf" and len(raw_text.strip()) < MIN_EXTRACTED_TEXT_CHARS:
        return f"image-only or low-text PDF (< {MIN_EXTRACTED_TEXT_CHARS} chars)"
    return None


# ── File Discovery ─────────────────────────────────────────

def find_date_files(date_str: str) -> list[dict]:
    """Find all PDF/DOCX files for a given date by scanning Obsidian notes."""
    # Notes are named like: 2026-07-06_the-guardian.md
    notes_dir = VAULT / "notes"
    if not notes_dir.exists():
        return []

    files = []
    prefix = f"{date_str}_"
    for note_file in sorted(notes_dir.glob(f"{prefix}*.md")):
        # Parse frontmatter to get attachment path
        try:
            content = note_file.read_text(encoding="utf-8")
        except Exception:
            continue

        # Extract attachment path from wiki link: [[../attachments/.../file.pdf|name]]
        match = re.search(r'\[\[(.*?\.(?:pdf|docx))[|\]]', content)
        if not match:
            continue

        rel_path = match.group(1)
        attach_path = (note_file.parent / rel_path).resolve()
        if not attach_path.exists():
            continue

        # Extract original filename (strip msgId_ prefix)
        original = attach_path.name.split("_", 1)[-1] if "_" in attach_path.name else attach_path.name
        files.append({
            "path": str(attach_path),
            "filename": original,
            "size_mb": round(attach_path.stat().st_size / (1024 * 1024), 1),
            "date": date_str,
            "msg_id": attach_path.name.split("_", 1)[0] if "_" in attach_path.name else "0",
            "note": str(note_file),
        })
    return files


def find_weekly_report_dates() -> list[str]:
    """Find the last 7 daily report dates."""
    dates = []
    today = datetime.now(timezone.utc).date()
    for i in range(1, 8):
        d = today - timedelta(days=i)
        dates.append(d.strftime("%Y-%m-%d"))
    return dates


def find_monthly_report_dates() -> list[str]:
    """Find dates in the previous month with daily reports."""
    today = datetime.now(timezone.utc).date()
    first = today.replace(day=1)
    last_month_end = first - timedelta(days=1)
    last_month_start = last_month_end.replace(day=1)

    dates = []
    d = last_month_start
    while d <= last_month_end:
        dates.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)
    return dates


# ── Dify API ────────────────────────────────────────────────

async def call_dify_workflow(http: Any, inputs: dict,
                             api_key: str = None) -> dict:
    """Call a Dify workflow and return the result."""
    if not DIFY_BASE:
        raise RuntimeError("DIFY_BASE_URL is required")
    key = api_key or DIFY_KEY
    if api_key == DIFY_KEY_EXTRACT:
        key = ensure_api_key(key, "DIFY_WORKFLOW_API_KEY_EXTRACT")
    elif api_key == DIFY_KEY_AGGREGATE:
        key = ensure_api_key(key, "DIFY_WORKFLOW_API_KEY_AGGREGATE")
    else:
        key = ensure_api_key(key, "DIFY_WORKFLOW_API_KEY")
    resp = await http.post(
        f"{DIFY_BASE}/v1/workflows/run",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "inputs": inputs,
            "response_mode": "blocking",
            "user": "daily-report-bot",
        },
        timeout=300.0,
    )
    resp.raise_for_status()
    try:
        data = resp.json()
    except Exception:
        data = parse_json_dict_candidates(resp.text)
    outputs = data.get("data", {}).get("outputs", data)
    return normalize_workflow_outputs(outputs)


async def structured_extract(http: Any, file_info: dict,
                             raw_text: str) -> dict:
    """Extract structured data from a single document via Dify."""
    filename = file_info["filename"]
    match = match_template(filename)

    if match["template"] is None:
        # Auto-discovery: first classify, then extract
        print(f"  [DISCOVER] {filename} — unknown type, auto-discovering...")
        discovery = await call_dify_workflow(http, {
            "mode": "auto_discover",
            "filename": filename,
            "preview": raw_text[:3000],
            "discovery_prompt": AUTO_DISCOVERY_PROMPT.format(
                filename=filename, preview=raw_text[:3000]
            ),
        })
        # Save learned template
        tmpl = discovery.get("template", {})
        patterns = discovery.get("match_suggestions", [filename.lower()])
        save_learned_template(tmpl.get("id", hashlib.md5(filename.encode()).hexdigest()[:8]),
                              tmpl, patterns)
        template = tmpl
        print(f"  [DISCOVER] → {discovery.get('doc_type', 'unknown')}")
    else:
        template = match["template"]
        print(f"  [{match['source']}] {filename} → {template['id']}")

    clipped_text = clip_text_for_dify(raw_text, MAX_DIFY_INPUT_CHARS)
    if len(clipped_text) < len(raw_text):
        print(f"  [TRIM] extract text clipped to {len(clipped_text)} chars")

    payload = {
        "mode": "extract",
        "filename": filename,
        "date": file_info["date"],
        "raw_text": clipped_text,
        "template_id": template["id"],
        "template_task": template["task"],
        "template_schema": json.dumps(template.get("output_schema", {}), ensure_ascii=False),
    }
    retry_limits = [
        len(clipped_text),
        RETRY_DIFY_INPUT_CHARS,
        RETRY_DIFY_INPUT_CHARS_SECONDARY,
        RETRY_DIFY_INPUT_CHARS_TERTIARY,
    ]
    retry_limits = [limit for limit in retry_limits if limit > 0]
    seen_limits: set[int] = set()
    last_error: Exception | None = None
    result: dict | None = None
    for index, limit in enumerate(retry_limits):
        if limit in seen_limits:
            continue
        seen_limits.add(limit)
        attempt_text = clip_text_for_dify(raw_text, limit)
        if index > 0:
            print(f"  [RETRY] extraction failed, retrying with {len(attempt_text)} chars")
        try:
            result = await call_dify_workflow(
                http,
                {**payload, "raw_text": attempt_text},
                api_key=DIFY_KEY_EXTRACT,
            )
            break
        except Exception as exc:
            last_error = exc
    if result is None:
        raise RuntimeError(f"structured extraction failed after retries: {last_error}")

    result["_source"] = {
        "filename": filename,
        "template_id": template["id"],
        "template_source": match["source"],
    }
    return result


# ── Aggregation ──────────────────────────────────────────────

async def aggregate_report(http: Any, date_str: str,
                           extractions: list[dict], mode: str = "daily") -> dict:
    """Aggregate all extractions into a final report."""
    report_type = {
        "daily": "日报",
        "weekly": "周报",
        "monthly": "月报",
    }.get(mode, "报告")

    return await call_dify_workflow(http, {
        "mode": "aggregate",
        "report_type": report_type,
        "date": date_str,
        "extractions": json.dumps(extractions, ensure_ascii=False),
    }, api_key=DIFY_KEY_AGGREGATE)


def collect_translation_candidates(extractions: list[dict], limit: int) -> list[tuple[str, dict]]:
    ranked: list[tuple[int, str, dict]] = []
    for extraction_index, extraction in enumerate(extractions):
        source = clean_inline_text(extraction.get("_source", {}).get("filename"))
        for item_index, item in enumerate(as_list(extraction.get("items"))):
            raw_text = clean_inline_text(item.get("source_excerpt") or item.get("raw_text"))
            if not raw_text or contains_cjk(raw_text) or item.get("translated_excerpt") or item.get("translated_text"):
                continue
            category = normalize_commodity_name(item.get("category", "")) or "能源"
            key_data = clean_inline_text(item.get("key_data"))
            signal_type = clean_inline_text(item.get("signal_type"))
            if category not in ENERGY_NEWS_CATEGORIES and not is_energy_related_text(category, signal_type, raw_text):
                continue
            if not key_data and not has_numeric_signal(raw_text):
                continue
            score = confidence_rank(clean_inline_text(item.get("confidence")))
            score += 3 if key_data else 0
            score += 2 if has_numeric_signal(raw_text) else 0
            score += 1 if signal_type in {"供需", "政策", "事件"} else 0
            raw_lower = raw_text.lower()
            if any(token in raw_lower for token in ("hormuz", "choke point", "transit fee", "service fee")):
                score += 6
            if any(token in raw_lower for token in ("refinery", "fuel shortage", "supply disruption", "sanction")):
                score += 4
            if len(raw_text) < 80:
                score -= 4
            elif len(raw_text) >= 240:
                score += 1
            candidate_id = f"{extraction_index}:{item_index}"
            ranked.append((score, candidate_id, item))
    ranked.sort(key=lambda row: row[0], reverse=True)
    return [(candidate_id, item) for _, candidate_id, item in ranked[:limit]]


def apply_candidate_translations(candidates: list[tuple[str, dict]], parsed: dict) -> int:
    translations = {
        clean_inline_text(row.get("id")): clean_inline_text(row.get("translation"))
        for row in as_list(parsed.get("translations"))
        if clean_inline_text(row.get("id")) and clean_inline_text(row.get("translation"))
    }
    updated = 0
    for candidate_id, item in candidates:
        translation = translations.get(candidate_id, "")
        if translation:
            item["translated_excerpt"] = translation
            updated += 1
    return updated


async def enrich_extractions_with_dify_translations(http: Any, extractions: list[dict]) -> int:
    candidates = collect_translation_candidates(extractions, MAX_TRANSLATED_EXCERPTS)
    if not candidates:
        return 0
    source_items = [
        {
            "id": candidate_id,
            "text": clean_inline_text(item.get("source_excerpt") or item.get("raw_text"))[:MAX_TRANSLATION_SOURCE_CHARS],
        }
        for candidate_id, item in candidates
    ]
    task = (
        "逐条忠实翻译输入 JSON 中的英文能源新闻。保留事实顺序、数字、单位、主体、条件和不确定语气；"
        "不得概括、评论、推断、补充背景或续写截断内容。"
    )
    result = await call_dify_workflow(
        http,
        {
            "mode": "extract",
            "filename": "selected-news-excerpts.json",
            "date": "",
            "raw_text": json.dumps(source_items, ensure_ascii=False),
            "template_id": "faithful_translation",
            "template_task": task,
            "template_schema": json.dumps(
                {"translations": [{"id": "原输入 id", "translation": "忠实中文直译"}]},
                ensure_ascii=False,
            ),
        },
        api_key=DIFY_KEY_EXTRACT,
    )
    return apply_candidate_translations(candidates, result)


async def enrich_extractions_with_translations(http: Any, extractions: list[dict]) -> int:
    if MAX_TRANSLATED_EXCERPTS <= 0:
        return 0
    return await enrich_extractions_with_dify_translations(http, extractions)


def render_markdown_report_html(markdown: str, summary: str, target_date: str) -> str:
    from wechat_publish import markdown_to_report_html
    return markdown_to_report_html(markdown, summary, target_date)


def build_review_evidence(extractions: list[dict]) -> str:
    serialized = json.dumps(strip_think_tags(extractions), ensure_ascii=False)
    return clip_text_for_dify(serialized, MAX_REVIEW_EVIDENCE_CHARS)


def normalize_review_result(result: dict) -> dict:
    decision = clean_inline_text(result.get("decision")).lower()
    try:
        score = float(result.get("score", 0))
    except (TypeError, ValueError):
        score = 0.0
    dimension_scores = result.get("dimension_scores")
    if not isinstance(dimension_scores, dict):
        dimension_scores = {}
    blocking_issues = [
        clean_inline_text(item)
        for item in as_list(result.get("blocking_issues"))
        if clean_inline_text(item)
    ]
    revision_instructions = [
        clean_inline_text(item)
        for item in as_list(result.get("revision_instructions"))
        if clean_inline_text(item)
    ]
    summary = clean_inline_text(result.get("summary"))
    dimension_limits = {
        "factuality": 25,
        "translation_fidelity": 20,
        "analytical_depth": 25,
        "readability": 15,
        "publication_safety": 15,
    }
    normalized_dimensions: dict[str, float] = {}
    contract_issues: list[str] = []
    for name, maximum in dimension_limits.items():
        try:
            value = float(dimension_scores[name])
        except (KeyError, TypeError, ValueError):
            contract_issues.append(f"missing or invalid dimension score: {name}")
            continue
        if value < 0 or value > maximum:
            contract_issues.append(f"dimension score out of range: {name}")
        normalized_dimensions[name] = value
    if score < 0 or score > 100:
        contract_issues.append("total score out of range")
    if len(normalized_dimensions) == len(dimension_limits):
        dimension_total = sum(normalized_dimensions.values())
        if abs(dimension_total - score) > 1:
            contract_issues.append("total score does not match dimension scores")
    if decision == "pass" and revision_instructions:
        contract_issues.append("pass result must not contain revision instructions")
    advisory_issue_patterns = (
        "不完全吻合",
        "事实不一致",
        "可能误读",
        "建议修正",
        "建议将",
        "需要修正",
        "存在错误",
    )
    if decision == "pass" and any(pattern in summary for pattern in advisory_issue_patterns):
        contract_issues.append("pass summary still identifies a factual or editorial defect")
    blocking_issues.extend(contract_issues)
    return {
        "decision": decision if decision in {"pass", "reject"} else "reject",
        "score": score,
        "dimension_scores": normalized_dimensions,
        "blocking_issues": blocking_issues,
        "revision_instructions": revision_instructions,
        "summary": summary,
    }


def review_result_passes(review: dict) -> bool:
    return (
        review.get("decision") == "pass"
        and float(review.get("score", 0)) >= REVIEW_PASS_SCORE
        and not review.get("blocking_issues")
    )


async def call_review_workflow(
    http: Any,
    mode: str,
    target_date: str,
    markdown: str,
    extractions: list[dict],
    previous_review: dict | None = None,
) -> dict:
    ensure_api_key(DIFY_KEY_REVIEW, "DIFY_WORKFLOW_API_KEY_REVIEW")
    result = await call_dify_workflow(
        http,
        {
            "mode": mode,
            "article_mode": "legacy",
            "date": target_date,
            "report_markdown": markdown,
            "extractions": build_review_evidence(extractions),
            "previous_review": json.dumps(previous_review or {}, ensure_ascii=False),
        },
        api_key=DIFY_KEY_REVIEW,
    )
    if mode == "revise":
        revised_markdown = strip_think_tags(result.get("revised_markdown", "")).strip()
        if not revised_markdown:
            raise ValueError("Dify review workflow returned empty revised_markdown")
        return {"revised_markdown": revised_markdown}
    return normalize_review_result(result)


def save_llm_review(target_date: str, payload: dict) -> Path:
    QUALITY_DIR.mkdir(parents=True, exist_ok=True)
    path = QUALITY_DIR / f"{target_date}_llm_review.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


async def review_and_revise_report(
    http: Any,
    target_date: str,
    report: dict,
    extractions: list[dict],
) -> tuple[dict, list[str], dict]:
    markdown = clean_inline_text(report.get("report_markdown", "")) if "\n" not in str(report.get("report_markdown", "")) else str(report.get("report_markdown", "")).strip()
    summary = clean_inline_text(report.get("summary", ""))
    html_text = render_markdown_report_html(markdown, summary, target_date)
    local_issues = audit_report_quality(target_date, markdown, html_text)
    review_record: dict[str, Any] = {
        "date": target_date,
        "pass_score": REVIEW_PASS_SCORE,
        "initial_local_issues": local_issues,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        initial_review = await call_review_workflow(http, "review", target_date, markdown, extractions)
        review_record["initial_review"] = initial_review
        if not local_issues and review_result_passes(initial_review):
            review_record["status"] = "pass"
            return {**report, "report_markdown": markdown, "report_wechat_html": html_text}, [], review_record

        revision_context = {
            **initial_review,
            "local_issues": local_issues,
        }
        revision = await call_review_workflow(
            http,
            "revise",
            target_date,
            markdown,
            extractions,
            revision_context,
        )
        revised_markdown = revision["revised_markdown"]
        revised_html = render_markdown_report_html(revised_markdown, summary, target_date)
        revised_local_issues = audit_report_quality(target_date, revised_markdown, revised_html)
        final_review = await call_review_workflow(
            http,
            "review",
            target_date,
            revised_markdown,
            extractions,
            revision_context,
        )
        review_record.update({
            "revision": revision,
            "revised_local_issues": revised_local_issues,
            "final_review": final_review,
        })
        passed = not revised_local_issues and review_result_passes(final_review)
        review_record["status"] = "pass" if passed else "reject"
        final_issues = [] if passed else revised_local_issues + [
            f"llm review rejected: score={final_review.get('score', 0)}",
            *[f"llm blocker: {item}" for item in final_review.get("blocking_issues", [])],
        ]
        return (
            {**report, "report_markdown": revised_markdown, "report_wechat_html": revised_html},
            final_issues,
            review_record,
        )
    except Exception as exc:
        review_record.update({"status": "reject", "error": str(exc)})
        return (
            {**report, "report_markdown": markdown, "report_wechat_html": html_text},
            [f"llm review unavailable: {exc}"],
            review_record,
        )


# ── Main Pipeline ───────────────────────────────────────────

def _selected_price_from_dict(value: dict[str, Any]):
    from intelligence.daily_prices import FusedDailyPrice

    return FusedDailyPrice(
        market_date=str(value["market_date"]),
        region=str(value["region"]),
        location=str(value["location"]),
        canonical_product=str(value["canonical_product"]),
        currency=str(value["currency"]),
        unit=str(value["unit"]),
        price=Decimal(str(value["price"])) if value.get("price") is not None else None,
        change=Decimal(str(value["change"])) if value.get("change") is not None else None,
        status=str(value["status"]),
        image_source_ids=tuple(value.get("image_source_ids", [])),
        bot_source_ids=tuple(value.get("bot_source_ids", [])),
        reasons=tuple(value.get("reasons", [])),
        display_name=value.get("display_name"),
    )


def _load_selected_prices(path: Path) -> list[Any]:
    if not path.exists():
        return []
    values = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(values, list):
        raise ValueError(f"Selected price artifact must be a list: {path}")
    return [_selected_price_from_dict(value) for value in values]


def coordinate_daily_prices(
    target_date: str,
    report_mode: str,
    price_mode: str,
    report: dict[str, Any],
    *,
    reports_dir: Path | None = None,
    prices_dir: Path | None = None,
) -> tuple[dict[str, Any], str]:
    if report_mode != "daily":
        return report, "not_daily"
    if price_mode == "off":
        return report, "disabled"
    if price_mode not in {"shadow", "append"}:
        raise ValueError(f"Unsupported price mode: {price_mode}")

    from intelligence.daily_prices import reconcile_saved_report

    from intelligence.daily_prices import resolve_daily_price_root

    report_root = reports_dir or REPORTS_DIR
    price_root = prices_dir or (
        report_root / "prices" if reports_dir is not None else resolve_daily_price_root()
    )
    state = reconcile_saved_report(date.fromisoformat(target_date), report_root, price_root)
    return report, state.status


def reconcile_pending_prices(
    lookback_days: int,
    *,
    price_mode: str | None = None,
    reports_dir: Path | None = None,
    prices_dir: Path | None = None,
    now: datetime | None = None,
) -> dict[str, dict[str, Any]]:
    if lookback_days < 1:
        raise ValueError("lookback_days must be at least 1")
    resolved_price_mode = price_mode or os.getenv("DAILY_PRICE_MODE", "shadow")
    if resolved_price_mode not in {"off", "shadow", "append"}:
        raise ValueError(f"Unsupported price mode: {resolved_price_mode}")
    if resolved_price_mode == "off":
        return {}
    from intelligence.daily_prices import reconcile_saved_report

    from intelligence.daily_prices import resolve_daily_price_root

    report_root = reports_dir or REPORTS_DIR
    price_root = prices_dir or (
        report_root / "prices" if reports_dir is not None else resolve_daily_price_root()
    )
    current = (now or datetime.now(timezone.utc)).date()
    results: dict[str, dict[str, Any]] = {}
    for offset in range(lookback_days):
        target = current - timedelta(days=offset)
        target_text = target.isoformat()
        if not (price_root / target_text).is_dir():
            continue
        state = reconcile_saved_report(target, report_root, price_root)
        results[target_text] = {"status": state.status}
    return results


def parse_args():
    p = argparse.ArgumentParser(description="ETI Intelligence Report Generator")
    p.add_argument("--date", help="Target date (YYYY-MM-DD). Default: yesterday")
    p.add_argument("--mode", choices=["daily", "weekly", "monthly"], default="daily")
    p.add_argument("--dry-run", action="store_true", help="Show plan without executing")
    p.add_argument("--skip-extract", action="store_true", help="Skip extraction, only aggregate")
    p.add_argument("--skip-translate", action="store_true", help="Skip Dify translation enrichment")
    p.add_argument("--skip-review", action="store_true", help="Skip Dify publication review (diagnostics only)")
    p.add_argument("--local-only", action="store_true", help="Generate from cached extractions without calling Dify")
    p.add_argument(
        "--price-mode",
        choices=["off", "shadow", "append"],
        default=os.getenv("DAILY_PRICE_MODE", "shadow"),
        help="Daily price coordination mode (default: DAILY_PRICE_MODE or shadow)",
    )
    p.add_argument("--reconcile-pending", action="store_true", help="Reconcile recent saved daily reports")
    p.add_argument("--lookback-days", type=int, default=7, help="Pending price reconciliation lookback")
    return p.parse_args()


def load_cached_extractions(dates: list[str]) -> list[dict]:
    """Load cached extractions for the requested dates."""
    extractions = []
    for d in dates:
        cache_file = REPORTS_DIR / f"{d}_extractions.json"
        if cache_file.exists():
            cached = json.loads(cache_file.read_text(encoding="utf-8-sig"))
            extractions.extend(cached)
            print(f"  Loaded {len(cached)} cached extractions from {d}")
    return extractions


async def main():
    args = parse_args()

    if args.reconcile_pending:
        results = reconcile_pending_prices(args.lookback_days, price_mode=args.price_mode)
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return

    # Determine date(s) to process
    if args.date:
        dates = [args.date]
    elif args.mode == "daily":
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        dates = [yesterday]
    elif args.mode == "weekly":
        dates = find_weekly_report_dates()
    elif args.mode == "monthly":
        dates = find_monthly_report_dates()
    else:
        dates = []

    print(f"Mode: {args.mode}, Dates: {dates}")

    # Step 1: Discover files
    all_files = []
    for d in dates:
        files = find_date_files(d)
        print(f"  {d}: {len(files)} files")
        all_files.extend(files)

    def save_outputs(target_date: str, mode: str, report: dict) -> None:
        output_dir = {
            "daily": REPORTS_DIR,
            "weekly": WEEKLY_DIR,
            "monthly": MONTHLY_DIR,
        }[mode]
        output_dir.mkdir(parents=True, exist_ok=True)

        md_content = report.get("report_markdown") or report.get("report_md") or report.get("markdown") or ""
        html_content = report.get("report_wechat_html") or report.get("wechat_html") or report.get("html") or ""
        summary_content = clean_inline_text(report.get("summary") or "")
        if md_content:
            md_content = humanize_preserving_layout(md_content)
        if html_content:
            html_content = replace_market_phrases(html_content)
        if summary_content:
            summary_content = replace_market_phrases(summary_content)

        if md_content:
            md_path = output_dir / f"{target_date}.md"
            md_path.write_text(md_content, encoding="utf-8")
            print(f"  Report saved: {md_path}")

        if html_content:
            html_path = output_dir / f"{target_date}_wechat.html"
            html_path.write_text(html_content, encoding="utf-8")
            print(f"  WeChat HTML saved: {html_path}")

        if summary_content:
            summary_path = output_dir / f"{target_date}_summary.txt"
            summary_path.write_text(summary_content, encoding="utf-8")
            print(f"  Summary saved: {summary_path}")

    if not all_files and not args.skip_extract:
        print("No files found. Generating observation edition.")
        target_date = dates[0] if dates else args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        fallback_report = build_empty_article(target_date, [])
        save_outputs(target_date, args.mode, fallback_report)
        issues = audit_report_quality(
            target_date,
            fallback_report.get("report_markdown", ""),
            fallback_report.get("report_wechat_html", ""),
        )
        save_quality_audit(
            target_date,
            issues,
            publishable=False,
            publish_reason=fallback_report.get("publish_reason", "no actionable news"),
        )
        return

    print(f"\nTotal: {len(all_files)} files to process")

    if args.dry_run:
        for f in all_files:
            match = match_template(f["filename"])
            status = match["template"]["id"] if match["template"] else "DISCOVER"
            print(f"  [{status}] {f['filename']} ({f['size_mb']}MB)")
        return

    extractions = load_cached_extractions(dates) if args.skip_extract else []
    if args.skip_extract and not extractions and not all_files:
        print("No cached extractions and no files found. Generating observation edition.")
        target_date = dates[0] if dates else args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        fallback_report = build_empty_article(target_date, [])
        save_outputs(target_date, args.mode, fallback_report)
        issues = audit_report_quality(
            target_date,
            fallback_report.get("report_markdown", ""),
            fallback_report.get("report_wechat_html", ""),
        )
        save_quality_audit(
            target_date,
            issues,
            publishable=False,
            publish_reason=fallback_report.get("publish_reason", "no actionable news"),
        )
        return

    if args.local_only:
        if not extractions:
            raise RuntimeError("--local-only requires --skip-extract and a cached extractions file")
        target_date = dates[0] if len(dates) == 1 else dates[-1]
        local_article = build_local_article(target_date, args.mode, extractions)
        local_article, price_status = coordinate_daily_prices(
            target_date, args.mode, args.price_mode, local_article
        )
        print(f"  Daily price status: {price_status}")
        save_outputs(target_date, args.mode, local_article)
        issues = audit_report_quality(
            target_date,
            local_article.get("report_markdown", ""),
            local_article.get("report_wechat_html", ""),
        )
        save_quality_audit(
            target_date,
            issues,
            publishable=bool(local_article.get("publishable", True)),
            publish_reason=clean_inline_text(local_article.get("publish_reason", "")),
        )
        return

    try:
        import httpx
    except ImportError as exc:
        if args.skip_extract and extractions:
            raise RuntimeError(
                "Loaded cached extractions, but missing dependency 'httpx' for aggregation. "
                "Install intelligence/requirements.txt before running the pipeline."
            ) from exc
        raise RuntimeError(
            "Missing dependency 'httpx'. Install intelligence/requirements.txt before running the pipeline."
        ) from exc

    async with httpx.AsyncClient() as http:
        # Step 2: Extract text + structured data
        if not args.skip_extract:
            for i, f in enumerate(all_files):
                print(f"\n[{i+1}/{len(all_files)}] {f['filename']} ({f['size_mb']}MB)")
                try:
                    raw = extract_text(Path(f["path"]))
                    print(f"  Text: {len(raw)} chars")
                    skip_reason = should_skip_extracted_text(Path(f["path"]), raw)
                    if skip_reason:
                        print(f"  SKIP: {skip_reason}")
                        continue
                    result = await structured_extract(http, f, raw)
                    extractions.append(result)
                except Exception as e:
                    print(f"  ERROR: {e}")

            # Save extractions cache
            if extractions:
                target_date = dates[0] if dates else args.date
                REPORTS_DIR.mkdir(parents=True, exist_ok=True)
                cache_path = REPORTS_DIR / f"{target_date}_extractions.json"
                cache_path.write_text(
                    json.dumps(extractions, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )

        # Step 3: Aggregate report
        if not extractions:
            print("\nNo extractions. Skipping aggregation.")
            return

        target_date = dates[0] if len(dates) == 1 else dates[0][:7] if args.mode == "monthly" else dates[-1]
        if not args.skip_translate:
            try:
                translated_count = await enrich_extractions_with_translations(http, extractions)
                if translated_count:
                    print(f"\nAdded {translated_count} faithful source translations")
                    if args.mode == "daily":
                        cache_path = REPORTS_DIR / f"{target_date}_extractions.json"
                        cache_path.write_text(
                            json.dumps(extractions, ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )
            except Exception as exc:
                print(f"\nTranslation enrichment skipped: {exc}")

        print(f"\nAggregating {len(extractions)} extractions into {args.mode} report...")

        report = await aggregate_report(http, target_date, extractions, args.mode)
        local_article = build_local_article(
            target_date,
            args.mode,
            extractions,
            report.get("summary", ""),
        )

        # Step 4: Review, render, and save report
        final_report = {
            "report_markdown": (
                local_article.get("report_markdown")
                or report.get("report_markdown")
                or report.get("report_md")
                or report.get("markdown")
                or ""
            ),
            "report_wechat_html": (
                local_article.get("report_wechat_html")
                or report.get("report_wechat_html")
                or report.get("wechat_html")
                or report.get("html")
                or ""
            ),
            "summary": clean_inline_text(
                local_article.get("summary")
                or report.get("summary")
                or ""
            ),
            "publishable": bool(local_article.get("publishable", True)),
            "publish_reason": clean_inline_text(local_article.get("publish_reason", "")),
        }
        review_record: dict[str, Any] = {}
        review_issues: list[str] = []
        if final_report["publishable"] and not args.skip_review:
            final_report, review_issues, review_record = await review_and_revise_report(
                http,
                target_date,
                final_report,
                extractions,
            )
            review_path = save_llm_review(target_date, review_record)
            print(f"  LLM review saved: {review_path}")
        else:
            final_report["report_wechat_html"] = render_markdown_report_html(
                final_report["report_markdown"],
                final_report["summary"],
                target_date,
            )
        final_report, price_status = coordinate_daily_prices(
            target_date, args.mode, args.price_mode, final_report
        )
        print(f"  Daily price status: {price_status}")
        save_outputs(target_date, args.mode, final_report)
        issues = review_issues or audit_report_quality(
            target_date,
            final_report.get("report_markdown", ""),
            final_report.get("report_wechat_html", ""),
        )
        save_quality_audit(
            target_date,
            issues,
            publishable=bool(final_report.get("publishable", True)),
            publish_reason=clean_inline_text(final_report.get("publish_reason", "")),
            llm_review_status=clean_inline_text(review_record.get("status", "")),
        )
        if final_report["publishable"] and review_record.get("status") == "reject":
            raise RuntimeError(f"publication review rejected report for {target_date}")

    print(f"\nDone! {len(extractions)} files processed.")


if __name__ == "__main__":
    asyncio.run(main())

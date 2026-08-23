"""Regex parsers for cleaning OCR output: amounts, codes, dates, etc."""

from __future__ import annotations

import re
from typing import Optional


# ---------------------------------------------------------------------------
# Amount parsing (mid prices)
# ---------------------------------------------------------------------------

def parse_amount(raw: str) -> Optional[float]:
    """Parse a dollar amount like '$938.25', '$938,25', '938.25', 'N/A'.

    Returns float or None.
    """
    if not raw:
        return None

    text = _pre_clean(raw)

    # N/A variants
    if re.match(r"^(N/?A|NA|N\s*A|--)$", text, re.IGNORECASE):
        return None

    # Remove currency symbols and whitespace
    text = re.sub(r"[$€£¥\s]", "", text)

    # Fix OCR errors in numeric context
    text = _fix_numeric_ocr(text)

    # Normalize decimal separators: "938,25" -> "938.25"
    # Pattern: digits, comma, exactly 2 digits at end -> decimal
    if re.search(r"^\d+,\d{2}$", text):
        text = text.replace(",", ".")
    elif re.search(r"^\d{1,3}(,\d{3})*(\.\d+)?$", text):
        # US/UK format: commas as thousands separators
        text = text.replace(",", "")
    elif re.search(r"^\d{1,3}(\.\d{3})*(,\d+)?$", text):
        # EU format: dots as thousands, comma as decimal
        text = text.replace(".", "").replace(",", ".")
    elif re.search(r"^\d+,\d{1,2}$", text):
        text = text.replace(",", ".")
    elif re.search(r"^\d{4,6}$", text):
        # OCR often drops the decimal separator in prices, e.g. 93825 -> 938.25.
        text = f"{text[:-2]}.{text[-2:]}"

    try:
        return float(text)
    except ValueError:
        return None


def parse_change(raw: str) -> Optional[float]:
    """Parse a change value like '+24.75', '-3.50', '$+24.75', '-$3,75'.

    Returns float or None.
    """
    if not raw:
        return None

    text = _pre_clean(raw)

    # N/A
    if re.match(r"^(N/?A|NA|N\s*A|--)$", text, re.IGNORECASE):
        return None

    # Remove currency symbols, whitespace, extra plus signs
    text = re.sub(r"[$€£¥\s]", "", text)
    text = text.replace("+", "")  # strip leading plus

    # Fix OCR errors
    text = _fix_numeric_ocr(text)

    # A leading speck/dot before a compact numeric change should not turn
    # "2.00" into ".200".
    if re.fullmatch(r"\.\d{3,5}", text):
        text = text[1:]

    # Detect negative: leading minus or $- style
    is_negative = text.startswith("-")
    text = text.lstrip("-")

    if not is_negative:
        # Check for trailing minus (OCR artifact)
        if text.endswith("-"):
            text = text.rstrip("-")
            is_negative = True

    # OCR sometimes reads a dollar sign or colored edge as a duplicate leading
    # digit in compact change cells, e.g. "$4.75" -> "4475".
    if re.fullmatch(r"\d{4}", text) and text[0] == text[1]:
        text = text[1:]

    # Normalize decimal. For change cells, OCR often drops the decimal
    # separator in values such as 4.50 -> 450.
    if re.search(r"^\d{3,5}$", text):
        text = f"{text[:-2]}.{text[-2:]}"
    elif re.search(r"^\d+,\d{2}$", text):
        text = text.replace(",", ".")
    elif re.search(r"^\d{1,3}(,\d{3})*(\.\d+)?$", text):
        text = text.replace(",", "")

    try:
        val = float(text)
        return -val if is_negative else val
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Code parsing
# ---------------------------------------------------------------------------

def parse_code(raw: str) -> Optional[str]:
    """Parse a product code like 'AAWY00', 'POABC00'.

    Returns uppercase alphanumeric string or None.
    """
    if not raw:
        return None

    text = _pre_clean(raw).upper()

    # N/A
    if text in ("N/A", "NA", "N.A", "N A", "--"):
        return None

    # Remove non-alphanumeric (keep letters and digits)
    text = re.sub(r"[^A-Z0-9]", "", text)

    # Fix common OCR errors in codes (only when clearly misread)
    # O -> 0 only when surrounded by digits
    text = re.sub(r"(?<=\d)O(?=\d)", "0", text)
    # I -> 1 only when surrounded by digits
    text = re.sub(r"(?<=\d)I(?=\d)", "1", text)

    # Platts codes commonly end with two digits; OCR often reads trailing 00 as OO.
    if len(text) >= 2:
        tail = text[-2:]
        if tail in {"OO", "O0", "0O"}:
            text = f"{text[:-2]}00"

    if len(text) < 3:
        return None

    return text


# ---------------------------------------------------------------------------
# Date parsing
# ---------------------------------------------------------------------------

def parse_date(raw: str) -> Optional[str]:
    """Parse a date like 'June 30, 2026' or '2026-06-30'.

    Returns ISO format 'YYYY-MM-DD' or None.
    """
    if not raw:
        return None

    text = _pre_clean(raw)

    # Already ISO
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", text)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

    # "June 30, 2026" or "Jun 30 2026"
    month_map = {
        "january": "01", "february": "02", "march": "03", "april": "04",
        "may": "05", "june": "06", "july": "07", "august": "08",
        "september": "09", "october": "10", "november": "11", "december": "12",
        "jan": "01", "feb": "02", "mar": "03", "apr": "04",
        "jun": "06", "jul": "07", "aug": "08", "sep": "09",
        "oct": "10", "nov": "11", "dec": "12",
    }

    text_lower = text.lower()
    for name, num in month_map.items():
        if name in text_lower:
            # Find day and year
            day_m = re.search(r"\b(\d{1,2})\b", text)
            year_m = re.search(r"\b(20\d{2})\b", text)
            if day_m and year_m:
                return f"{year_m.group(1)}-{num}-{day_m.group(1).zfill(2)}"

    return None


def parse_mt_bbl(raw: str) -> Optional[float]:
    """Parse a conversion factor like '7.45', '8.90'."""
    val = parse_amount(raw)
    if val is None:
        return None
    if 10 <= val <= 99 and re.fullmatch(r"\D*\d{2}\D*", raw.strip()):
        return round(val / 10, 2)
    if 100 <= val <= 999 and re.fullmatch(r"\D*\d{3}\D*", raw.strip()):
        return round(val / 100, 2)
    return val


def parse_spread_value(raw: str) -> Optional[float]:
    """Parse a spread/arbitrage value (can be negative)."""
    value = parse_change(raw)
    if value is None:
        return None

    # The dense spread matrix has dotted/colored cell borders. Tesseract often
    # reads that left border as a leading 9 or 2: 918,50 -> 18.50,
    # 210,50 -> 10.50, 9171,08 -> 171.08.
    text = _pre_clean(raw)
    is_negative = value < 0
    normalized = re.sub(r"[$€£¥\s+-]", "", text)
    if abs(value) > 200 and re.fullmatch(r"[129]\d{2,4}[,.]\d{2}", normalized):
        reparsed = parse_change(("-" if is_negative else "") + normalized[1:])
        if reparsed is not None and abs(reparsed) <= 200:
            return reparsed

    return value


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pre_clean(text: str) -> str:
    """Basic pre-cleaning for OCR text."""
    text = text.strip()
    # Replace non-breaking spaces
    text = text.replace("\xa0", " ")
    # Collapse whitespace
    text = re.sub(r"\s+", " ", text)
    return text


def _fix_numeric_ocr(text: str) -> str:
    """Fix common OCR errors in numeric strings.

    Only applies these fixes when the text is clearly numeric.
    """
    # If it contains at least one digit
    if not re.search(r"\d", text):
        return text

    # O -> 0 (only if preceded/followed by digit or at boundaries)
    text = re.sub(r"(?<=\d)O(?=\d)", "0", text)
    text = re.sub(r"^O(?=\d)", "0", text)
    text = re.sub(r"(?<=\d)O$", "0", text)

    # S -> 5 in numeric context (but not in codes)
    text = re.sub(r"(?<=\d)S(?=\d)", "5", text)

    # B -> 8 in numeric context
    text = re.sub(r"(?<=\d)B(?=\d)", "8", text)

    # l or I -> 1 in numeric context
    text = re.sub(r"(?<=\d)[lI](?=\d)", "1", text)

    # Leading "$" can be OCR'd as 6/S, but do not strip the first digit from
    # normal 3-digit commodity prices such as 631.25.
    text = re.sub(r"^[6S](?=\d{4,}[.,]\d{1,2}$)", "", text)

    return text

from __future__ import annotations

import re
import os
import shutil
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from platts_ocr.src.parsers import parse_amount, parse_change, parse_date


TITLE_DATE_PATTERN = re.compile(
    r"\bPLATTS\s+SUMMARY\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})\b",
    re.IGNORECASE,
)
SUMMARY_TITLE_DATE_VERSION = "summary-title-date.v2"


@dataclass(frozen=True, slots=True)
class SummaryTitleDateDetection:
    market_date: str | None
    version: str
    matched_count: int
    unique_dates: tuple[str, ...]
    recognized_titles: tuple[str, ...]
    failure_reason: str | None = None


def configure_tesseract() -> None:
    import pytesseract

    configured = os.getenv("TESSERACT_CMD")
    candidates = [configured, shutil.which("tesseract"), r"C:\Program Files\Tesseract-OCR\tesseract.exe"]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            pytesseract.pytesseract.tesseract_cmd = candidate
            return


def market_date_from_title_text(text: str) -> str | None:
    match = TITLE_DATE_PATTERN.search(_normalize_title_ocr(text))
    parsed = parse_date(match.group(1)) if match else None
    if not parsed:
        return None
    try:
        return date.fromisoformat(parsed).isoformat()
    except ValueError:
        return None


def title_phrase_from_text(text: str) -> str | None:
    match = TITLE_DATE_PATTERN.search(_normalize_title_ocr(text))
    return re.sub(r"\s+", " ", match.group(0)).strip() if match else None


def _normalize_title_ocr(text: str) -> str:
    return re.sub(
        r"(?i)(PLATTS\s+SUMMARY\s+[A-Za-z]+\s+)&(?=,\s+20\d{2})",
        r"\g<1>8",
        text or "",
    )


def detect_market_date_from_image_title(image_path: str) -> SummaryTitleDateDetection:
    import cv2
    import pytesseract

    configure_tesseract()

    image = cv2.imread(image_path)
    if image is None:
        return SummaryTitleDateDetection(
            market_date=None,
            version=SUMMARY_TITLE_DATE_VERSION,
            matched_count=0,
            unique_dates=(),
            recognized_titles=(),
            failure_reason="IMAGE_DECODE_FAILED",
        )
    height, width = image.shape[:2]
    title = image[0:max(45, int(height * 0.12)), 0:width]
    gray = cv2.cvtColor(title, cv2.COLOR_BGR2GRAY)
    scaled = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    _, threshold = cv2.threshold(scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    recognized_titles: list[str] = []
    detected_dates: list[str] = []
    for candidate in (scaled, threshold):
        for psm in (7, 6, 11):
            text = pytesseract.image_to_string(candidate, config=f"--psm {psm}")
            title_phrase = title_phrase_from_text(text)
            if title_phrase:
                recognized_titles.append(title_phrase)
            market_date = market_date_from_title_text(text)
            if market_date:
                detected_dates.append(market_date)
    unique_dates = tuple(sorted(set(detected_dates)))
    if len(unique_dates) > 1:
        return SummaryTitleDateDetection(
            market_date=None,
            version=SUMMARY_TITLE_DATE_VERSION,
            matched_count=len(detected_dates),
            unique_dates=unique_dates,
            recognized_titles=tuple(recognized_titles),
            failure_reason="MARKET_DATE_CONFLICT",
        )
    if not unique_dates or len(detected_dates) < 2:
        failure_reason = (
            "MARKET_DATE_INVALID"
            if recognized_titles and not unique_dates
            else "MARKET_DATE_NOT_FOUND"
        )
        return SummaryTitleDateDetection(
            market_date=None,
            version=SUMMARY_TITLE_DATE_VERSION,
            matched_count=len(detected_dates),
            unique_dates=unique_dates,
            recognized_titles=tuple(recognized_titles),
            failure_reason=failure_reason,
        )
    return SummaryTitleDateDetection(
        market_date=unique_dates[0],
        version=SUMMARY_TITLE_DATE_VERSION,
        matched_count=len(detected_dates),
        unique_dates=unique_dates,
        recognized_titles=tuple(recognized_titles),
    )


def market_date_from_image_title(image_path: str) -> str | None:
    return detect_market_date_from_image_title(image_path).market_date


def normalize_numeric(raw: str | None, *, change: bool = False) -> float | None:
    if raw is None:
        return None
    return parse_change(raw) if change else parse_amount(raw)


def validate_iso_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        return None


def detect_duplicate_records(records: list[object]) -> list[str]:
    seen: set[tuple[object, ...]] = set()
    duplicates: list[str] = []
    for record in records:
        identity = record.identity()
        if identity in seen:
            duplicates.append("DUPLICATE_RECORD:" + "|".join(str(item) for item in identity))
        seen.add(identity)
    return duplicates

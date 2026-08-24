from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
import os
from pathlib import Path
import re
import shutil
from typing import Any, Literal


ParserName = Literal["template_tesseract", "img2table_paddle", "ppstructure_v3"]
RecordType = Literal["price", "spread", "conversion"]
SUMMARY_TITLE_DATE_VERSION = "summary-title-date.v2"
TITLE_DATE_PATTERN = re.compile(
    r"\bPLATTS\s+SUMMARY\s+([A-Za-z]+\s+\d{1,2},\s+20\d{2})\b",
    re.IGNORECASE,
)


@dataclass(slots=True)
class PlattsSummaryRecord:
    record_type: RecordType
    product: str
    location: str | None = None
    code: str | None = None
    mid_raw: str | None = None
    mid: float | None = None
    change_raw: str | None = None
    change: float | None = None
    currency: str | None = None
    unit: str | None = None
    from_market: str | None = None
    to_market: str | None = None
    cell_bbox: list[int] | None = None
    confidence: float = 0.0

    def identity(self) -> tuple[str, str, str, str, str]:
        return (
            self.record_type,
            self.product,
            self.location or "",
            self.from_market or "",
            self.to_market or "",
        )


@dataclass(slots=True)
class PlattsSummaryTrialResult:
    image_id: str
    image_sha256: str
    market_date: str | None
    parser: ParserName
    duration_ms: int
    records: list[PlattsSummaryRecord] = field(default_factory=list)
    review_reasons: list[str] = field(default_factory=list)
    raw_output_path: str = ""
    market_date_source: str = "image_title"
    schema_version: str = "platts-summary-trial.v1"
    peak_memory_mb: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "PlattsSummaryTrialResult":
        payload = dict(value)
        payload["records"] = [
            PlattsSummaryRecord(**item) for item in payload.get("records", [])
        ]
        return cls(**payload)


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
    candidates = [
        configured,
        shutil.which("tesseract"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            pytesseract.pytesseract.tesseract_cmd = candidate
            return


def _normalize_title_ocr(text: str) -> str:
    return re.sub(
        r"(?i)(PLATTS\s+SUMMARY\s+[A-Za-z]+\s+)&(?=,\s+20\d{2})",
        r"\g<1>8",
        text or "",
    )


def _parse_title_date(raw: str) -> str | None:
    normalized = re.sub(r"\s+", " ", raw.strip())
    for date_format in ("%B %d, %Y", "%b %d, %Y"):
        try:
            return datetime.strptime(normalized, date_format).date().isoformat()
        except ValueError:
            continue
    return None


def market_date_from_title_text(text: str) -> str | None:
    match = TITLE_DATE_PATTERN.search(_normalize_title_ocr(text))
    return _parse_title_date(match.group(1)) if match else None


def title_phrase_from_text(text: str) -> str | None:
    match = TITLE_DATE_PATTERN.search(_normalize_title_ocr(text))
    return re.sub(r"\s+", " ", match.group(0)).strip() if match else None


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
    _, threshold = cv2.threshold(
        scaled, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )
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

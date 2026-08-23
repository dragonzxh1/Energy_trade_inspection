from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


ParserName = Literal["template_tesseract", "img2table_paddle", "ppstructure_v3"]
RecordType = Literal["price", "spread", "conversion"]


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
        payload["records"] = [PlattsSummaryRecord(**item) for item in payload.get("records", [])]
        return cls(**payload)

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal


@dataclass(frozen=True, slots=True)
class DailyPriceCandidate:
    schema_version: str
    market_date: str
    region: str
    location: str
    product: str
    price_raw: str | None
    price: Decimal | None
    change_raw: str | None
    change: Decimal | None
    currency: str | None
    unit: str | None
    source_type: Literal["image_ocr", "fuelsight_bot"]
    source_id: str
    confidence: float
    evidence: dict[str, Any]

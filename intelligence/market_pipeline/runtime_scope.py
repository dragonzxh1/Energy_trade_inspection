from __future__ import annotations

import os
from datetime import date


def pipeline_start_date() -> date | None:
    configured = os.getenv("MARKET_PIPELINE_START_DATE", "").strip()
    return date.fromisoformat(configured) if configured else None


def clamp_to_pipeline_start(value: date) -> date:
    start = pipeline_start_date()
    return max(value, start) if start else value


def before_pipeline_start(value: date) -> bool:
    start = pipeline_start_date()
    return bool(start and value < start)

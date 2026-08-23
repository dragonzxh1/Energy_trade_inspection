"""Excel and CSV exporters for OCR results."""

from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Any, Optional

import pandas as pd

from .validators import ReviewItem

logger = logging.getLogger(__name__)


def export_excel(
    output_path: str,
    prices: list[dict[str, Any]],
    spreads: list[dict[str, Any]],
    conversions: list[dict[str, Any]],
    review_items: list[ReviewItem],
) -> None:
    """Export all data to a multi-sheet Excel file."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        if prices:
            df_prices = pd.DataFrame(prices)
            df_prices = _reorder_price_columns(df_prices)
            df_prices.to_excel(writer, sheet_name="prices", index=False)

        if spreads:
            df_spreads = pd.DataFrame(spreads)
            df_spreads.to_excel(writer, sheet_name="spreads", index=False)

        if conversions:
            df_conversions = pd.DataFrame(conversions)
            df_conversions.to_excel(writer, sheet_name="conversions", index=False)

        if review_items:
            df_review = pd.DataFrame([_review_to_dict(r) for r in review_items])
            df_review.to_excel(writer, sheet_name="review_items", index=False)
        else:
            pd.DataFrame({"status": ["no issues found"]}).to_excel(
                writer, sheet_name="review_items", index=False
            )

    logger.info(f"Excel saved: {path}")


def export_csv(
    csv_dir: str,
    prices: list[dict[str, Any]],
    spreads: list[dict[str, Any]],
    conversions: list[dict[str, Any]],
    review_items: list[ReviewItem],
) -> None:
    """Export CSV files (one per data type)."""
    out = Path(csv_dir)
    out.mkdir(parents=True, exist_ok=True)

    _write_csv(out / "prices.csv", prices)
    _write_csv(out / "spreads.csv", spreads)
    _write_csv(out / "conversions.csv", conversions)
    _write_csv(out / "review_items.csv", [_review_to_dict(r) for r in review_items])

    logger.info(f"CSVs saved: {out}")


def _reorder_price_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Put key columns first."""
    preferred = [
        "summary_date", "table_id", "row_name",
        "code", "mid", "change", "extra",
        "raw_mid", "raw_change", "raw_code",
        "confidence_mid", "confidence_change", "confidence_code",
        "status_mid", "status_change", "status_code",
    ]
    existing = [c for c in preferred if c in df.columns]
    remaining = [c for c in df.columns if c not in existing]
    return df[existing + remaining]


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        path.write_text("")
        return
    fieldnames: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in row.keys():
            if key not in seen:
                seen.add(key)
                fieldnames.append(key)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _review_to_dict(r: ReviewItem) -> dict[str, Any]:
    return {
        "date": r.date,
        "table_id": r.table_id,
        "row_name": r.row_name,
        "field_name": r.field_name,
        "code": r.code,
        "raw_text": r.raw_text,
        "clean_value": r.clean_value,
        "issue": r.issue,
        "previous_mid": r.previous_mid,
        "today_mid": r.today_mid,
        "expected_change": r.expected_change,
        "ocr_change": r.ocr_change,
        "diff": r.diff,
    }

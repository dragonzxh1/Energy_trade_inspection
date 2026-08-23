"""Validators for OCR results, including cross-date verification."""

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class ReviewItem:
    """A flagged item that needs human review."""
    date: str
    table_id: str
    row_name: str
    field_name: str
    code: str
    raw_text: str
    clean_value: Any
    issue: str
    previous_mid: Optional[float] = None
    today_mid: Optional[float] = None
    expected_change: Optional[float] = None
    ocr_change: Optional[float] = None
    diff: Optional[float] = None


@dataclass
class ValidationResult:
    """Results of validation on a single field."""
    status: str  # ok, needs_review, failed
    message: str = ""
    review_item: Optional[ReviewItem] = None


def validate_field(
    field_name: str,
    raw_text: str,
    clean_value: Any,
    confidence: float,
) -> ValidationResult:
    """Validate a single field's OCR result.

    Checks:
    - Confidence threshold
    - Field-specific business rules
    """
    if confidence < 0:
        return ValidationResult("failed", "OCR produced no result")

    if confidence < 20:
        return ValidationResult("needs_review", f"Low confidence: {confidence}")

    if clean_value is None and raw_text.strip():
        # Raw text exists but couldn't be parsed
        if field_name in ("mid", "change", "extra"):
            return ValidationResult("needs_review", f"Cannot parse: '{raw_text}'")

    # Price range check for oil products
    if field_name == "mid" and isinstance(clean_value, (int, float)):
        if clean_value < 20 or clean_value > 1500:
            return ValidationResult("needs_review", f"Price out of range: {clean_value}")

    if field_name == "change" and isinstance(clean_value, (int, float)):
        if abs(clean_value) > 200:
            return ValidationResult("needs_review", f"Change too large: {clean_value}")

    if field_name == "code" and isinstance(clean_value, str):
        if clean_value not in ("N/A", "NA") and not (6 <= len(clean_value) <= 8):
            return ValidationResult("needs_review", f"Unexpected code shape: {clean_value}")

    return ValidationResult("ok")


def cross_date_validate(
    all_rows: list[dict[str, Any]],
    tolerance: float = 0.02,
) -> list[ReviewItem]:
    """Cross-date validation: today_mid - prev_mid ≈ today_change.

    Groups rows by (table_id, row_name) and checks consecutive dates.
    """
    reviews: list[ReviewItem] = []

    # Group by (table_id, row_name)
    by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in all_rows:
        key = (row.get("table_id", ""), row.get("row_name", ""))
        by_key[key].append(row)

    for key, rows in by_key.items():
        # Sort by date
        rows.sort(key=lambda r: r.get("summary_date", ""))

        for i in range(1, len(rows)):
            prev = rows[i - 1]
            curr = rows[i]

            prev_mid = prev.get("mid")
            curr_mid = curr.get("mid")
            curr_change = curr.get("change")

            if prev_mid is None or curr_mid is None:
                continue

            expected_change = round(curr_mid - prev_mid, 2)

            if curr_change is not None:
                diff = round(abs(expected_change - curr_change), 2)
                if diff > tolerance:
                    curr["validation_status"] = "needs_review"
                    curr["validation_message"] = (
                        f"Change mismatch: expected {expected_change}, got {curr_change} "
                        f"(diff={diff})"
                    )
                    review = ReviewItem(
                        date=curr.get("summary_date", ""),
                        table_id=curr.get("table_id", ""),
                        row_name=curr.get("row_name", ""),
                        field_name="change",
                        code=curr.get("code", ""),
                        raw_text=curr.get("raw_change", ""),
                        clean_value=curr_change,
                        issue=curr["validation_message"],
                        previous_mid=prev_mid,
                        today_mid=curr_mid,
                        expected_change=expected_change,
                        ocr_change=curr_change,
                        diff=diff,
                    )
                    reviews.append(review)
                    logger.warning(
                        f"[{curr.get('summary_date')}] {key}: "
                        f"mid {prev_mid}->{curr_mid}, "
                        f"expected change {expected_change}, got {curr_change}"
                    )

    return reviews

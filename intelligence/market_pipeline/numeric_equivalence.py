"""Deterministic numeric equivalence across English and Chinese scale words."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation


NUMERIC_QUANTITY_PATTERN = re.compile(
    r"(?<![A-Za-z])(?P<number>[-+]?\d+(?:,\d{3})*(?:\.\d+)?)"
    r"\s*(?P<scale>per\s+cent|percent|thousand|million|billion|%|万|亿)?",
    re.IGNORECASE,
)

SCALE_FACTORS = {
    "thousand": Decimal("1000"),
    "million": Decimal("1000000"),
    "billion": Decimal("1000000000"),
    "万": Decimal("10000"),
    "亿": Decimal("100000000"),
}


def _canonical_decimal(value: Decimal) -> str:
    normalized = value.normalize()
    if normalized == normalized.to_integral():
        return format(normalized.quantize(Decimal("1")), "f")
    return format(normalized, "f").rstrip("0").rstrip(".")


def numeric_values(text: str) -> set[str]:
    """Return exact comparable values without changing precision or guessing units."""
    values: set[str] = set()
    for match in NUMERIC_QUANTITY_PATTERN.finditer(text or ""):
        raw_number = match.group("number").replace(",", "").lstrip("+")
        scale = (match.group("scale") or "").casefold()
        try:
            value = Decimal(raw_number)
        except InvalidOperation:
            continue
        if scale in SCALE_FACTORS:
            value *= SCALE_FACTORS[scale]
        suffix = "%" if scale in {"%", "percent", "per cent"} else ""
        values.add(f"{_canonical_decimal(value)}{suffix}")
    return values

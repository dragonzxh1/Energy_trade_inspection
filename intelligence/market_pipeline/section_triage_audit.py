"""Read-only report for section-triage decisions before production mutation."""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row

from .section_triage import TRIAGE_VERSION, triage_section


def audit_rows(rows: list[dict[str, Any]], sample_size: int) -> dict[str, Any]:
    eligible: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    categories: Counter[str] = Counter()
    for row in rows:
        decision = triage_section(row.get("section_title"), row.get("section_text", ""), row.get("section_type"))
        categories[decision.category] += 1
        sample = {
            "section_id": row.get("section_id"), "market_date": str(row.get("market_date")),
            "source_id": row.get("source_id"), "title": row.get("section_title"),
            "category": decision.category, "score": decision.score,
            "reason_code": decision.reason_code, "reasons": list(decision.reasons),
            "text_preview": (row.get("section_text") or "")[:500],
        }
        (eligible if decision.dify_eligible else skipped).append(sample)
    price_supply_policy = [
        item for item in eligible
        if item["category"] in {"price_assessment", "supply_disruption", "sanctions_policy"}
    ]
    return {
        "triage_version": TRIAGE_VERSION, "total": len(rows),
        "eligible": len(eligible), "skipped": len(skipped), "categories": dict(categories),
        "eligible_samples": eligible[:sample_size], "skipped_samples": skipped[:sample_size],
        "price_supply_policy_samples": price_supply_policy,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit section triage without changing the database")
    parser.add_argument("--date-from", type=date.fromisoformat, required=True)
    parser.add_argument("--date-to", type=date.fromisoformat, required=True)
    parser.add_argument("--sample-size", type=int, default=50)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    with Connection.connect(os.environ["DATABASE_URL"], row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """SELECT section.section_id,section.section_title,section.section_text,
                          section.section_type,document.market_date,document.source_id
                   FROM document_sections section JOIN source_documents document
                     ON document.id=section.source_document_id
                   WHERE document.market_date BETWEEN %s AND %s
                     AND document.source_verified=true AND document.processing_status='parsed'
                     AND document.needs_review=false
                     AND section.fact_extraction_status IN ('pending','failed_retryable')
                   ORDER BY document.market_date,document.source_id,section.section_index""",
                (args.date_from, args.date_to),
            )
            payload = audit_rows(list(cursor.fetchall()), args.sample_size)
    rendered = json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()

"""Run isolated daily pipelines for today and recent late-arriving market dates."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import date, timedelta

from psycopg import Connection

from .runtime_scope import clamp_to_pipeline_start, pipeline_start_date


def recent_pending_dates(connection: Connection, today: date, lookback_days: int) -> list[date]:
    earliest = clamp_to_pipeline_start(today - timedelta(days=lookback_days))
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT DISTINCT document.market_date
            FROM source_documents document
            WHERE document.market_date BETWEEN %s AND %s
              AND document.market_date <> %s
              AND document.source_verified = true
              AND document.processing_status = 'parsed'
              AND document.needs_review = false
              AND (
                EXISTS (
                  SELECT 1
                  FROM document_sections section
                  WHERE section.source_document_id = document.id
                    AND section.fact_extraction_status IN ('pending', 'failed_retryable')
                )
                OR NOT EXISTS (
                  SELECT 1
                  FROM editorial_views view
                  WHERE view.market_date = document.market_date
                )
                OR EXISTS (
                  SELECT 1
                  FROM market_facts fact
                  WHERE fact.market_date = document.market_date
                    AND fact.is_current = true
                    AND fact.updated_at > COALESCE(
                      (
                        SELECT max(view.updated_at)
                        FROM editorial_views view
                        WHERE view.market_date = document.market_date
                      ),
                      '-infinity'::timestamptz
                    )
                )
                OR EXISTS (
                  SELECT 1
                  FROM digit_topic_publications publication
                  WHERE publication.market_date = document.market_date
                    AND publication.publication_status IN (
                      'generation_failed', 'publish_failed'
                    )
                )
              )
            ORDER BY document.market_date DESC
            """,
            (earliest, today, today),
        )
        return [row[0] for row in cursor.fetchall()]


def run_date(target_date: date, *, historical: bool) -> subprocess.CompletedProcess[str]:
    arguments = [
        sys.executable,
        "-m",
        "intelligence.market_pipeline.orchestrator",
        "--date",
        target_date.isoformat(),
    ]
    if historical:
        arguments.append("--historical")
    return subprocess.run(
        arguments,
        check=False,
        text=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run current and late-arrival market dates")
    parser.add_argument("--date", type=date.fromisoformat, default=date.today())
    parser.add_argument("--lookback-days", type=int, default=int(os.getenv("MARKET_PIPELINE_LOOKBACK_DAYS", "2")))
    parser.add_argument("--historical", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.lookback_days < 0 or args.lookback_days > 7:
        parser.error("--lookback-days must be between 0 and 7")
    configured_start = pipeline_start_date()
    if configured_start and args.date < configured_start:
        print(json.dumps({
            "ok": True,
            "targets": [],
            "failed_dates": [],
            "status": "skipped_before_pipeline_start",
            "pipeline_start_date": configured_start.isoformat(),
        }, ensure_ascii=False), flush=True)
        return

    with Connection.connect(os.environ["DATABASE_URL"]) as connection:
        late_dates = recent_pending_dates(connection, args.date, args.lookback_days)
    targets = [args.date, *late_dates]
    if args.dry_run:
        print(" ".join(item.isoformat() for item in targets), flush=True)
        return
    results = []
    for target_date in targets:
        completed = run_date(
            target_date,
            historical=args.historical or target_date != args.date,
        )
        results.append({
            "market_date": target_date.isoformat(),
            "returncode": completed.returncode,
        })
    failures = [item for item in results if item["returncode"]]
    print(json.dumps({
        "ok": not failures,
        "targets": results,
        "failed_dates": [item["market_date"] for item in failures],
    }, ensure_ascii=False), flush=True)
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

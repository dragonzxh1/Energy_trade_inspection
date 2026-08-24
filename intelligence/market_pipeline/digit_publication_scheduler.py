"""Publish ready Digital market dates without coupling publication to fact processing."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

from psycopg import Connection


SUCCESS_STATUSES = ("draft_created", "published", "shadow_saved")
REVIEW_REJECTED_STATUS = "review_rejected"


def ready_market_dates(
    connection: Connection,
    *,
    through_date: date,
    lookback_days: int,
    limit: int,
    date_from: date | None = None,
) -> list[date]:
    earliest = through_date - timedelta(days=lookback_days)
    if date_from and date_from > earliest:
        earliest = date_from
    with connection.cursor() as cursor:
        cursor.execute(
            """
            WITH verified_fact_dates AS (
              SELECT
                fact.market_date,
                max(fact.updated_at) AS latest_fact_at
              FROM market_facts fact
              WHERE fact.market_date BETWEEN %s AND %s
                AND fact.verification_status = 'verified'
                AND fact.publication_blocked = false
                AND fact.is_current = true
              GROUP BY fact.market_date
            ),
            latest_views AS (
              SELECT DISTINCT ON (view.market_date)
                view.market_date,
                view.evidence_ready,
                view.editorially_publishable,
                view.updated_at
              FROM editorial_views view
              WHERE view.market_date BETWEEN %s AND %s
              ORDER BY view.market_date, view.updated_at DESC
            ),
            candidates AS (
              SELECT fact_date.market_date, fact_date.latest_fact_at
              FROM verified_fact_dates fact_date
              LEFT JOIN latest_views view
                ON view.market_date = fact_date.market_date
              WHERE view.market_date IS NULL
                 OR (
                   view.evidence_ready = true
                   AND view.editorially_publishable = true
                 )
                 OR fact_date.latest_fact_at > view.updated_at
            )
            SELECT candidate.market_date
            FROM candidates candidate
            WHERE NOT EXISTS (
                SELECT 1
                FROM digit_topic_publications publication
                WHERE publication.market_date = candidate.market_date
                  AND publication.publication_status = ANY(%s)
              )
              AND NOT EXISTS (
                SELECT 1
                FROM digit_topic_publications publication
                WHERE publication.market_date = candidate.market_date
                  AND publication.publication_status = %s
                  AND publication.updated_at >= candidate.latest_fact_at
              )
            ORDER BY candidate.market_date
            LIMIT %s
            """,
            (
                earliest,
                through_date,
                earliest,
                through_date,
                [*SUCCESS_STATUSES],
                REVIEW_REJECTED_STATUS,
                limit,
            ),
        )
        return [row[0] for row in cursor.fetchall()]


def run_publication(
    target_date: date,
    *,
    through_date: date,
    dry_run: bool,
) -> subprocess.CompletedProcess[str]:
    command = [
        sys.executable,
        "-m",
        "intelligence.market_pipeline.publication_worker",
        "--date",
        target_date.isoformat(),
    ]
    if target_date < through_date:
        command.append("--historical")
    if dry_run:
        command.append("--dry-run")
    return subprocess.run(command, text=True, capture_output=True, check=False)


def publication_index_failed(target_date: date) -> bool:
    vault = Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault"))
    index_path = vault / "reports" / "digit" / target_date.isoformat() / "index.json"
    if not index_path.is_file():
        return True
    try:
        payload = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return True
    if payload.get("status") != "failed":
        return False
    articles = payload.get("articles")
    if not isinstance(articles, list) or not articles:
        return True
    statuses = {
        str(article.get("publication_status") or "")
        for article in articles if isinstance(article, dict)
    }
    return bool(statuses & {"generation_failed", "publish_failed"})


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish pending Digital market dates")
    parser.add_argument("--through-date", type=date.fromisoformat, default=date.today())
    parser.add_argument("--lookback-days", type=int, default=14)
    parser.add_argument("--max-dates", type=int, default=10)
    parser.add_argument("--date-from", type=date.fromisoformat)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.lookback_days < 1 or args.lookback_days > 90:
        parser.error("--lookback-days must be between 1 and 90")
    if args.max_dates < 1 or args.max_dates > 31:
        parser.error("--max-dates must be between 1 and 31")

    with Connection.connect(os.environ["DATABASE_URL"]) as connection:
        dates = ready_market_dates(
            connection,
            through_date=args.through_date,
            lookback_days=args.lookback_days,
            limit=args.max_dates,
            date_from=args.date_from,
        )
    results: list[dict[str, object]] = []
    for market_date in dates:
        completed = run_publication(
            market_date,
            through_date=args.through_date,
            dry_run=args.dry_run,
        )
        effective_returncode = (
            completed.returncode
            if completed.returncode
            else int(publication_index_failed(market_date))
        )
        results.append({
            "market_date": market_date.isoformat(),
            "returncode": effective_returncode,
            "stdout": completed.stdout[-4000:],
            "stderr": completed.stderr[-4000:],
        })
    failures = [result for result in results if result["returncode"]]
    print(json.dumps({
        "ok": not failures,
        "processed_dates": len(results),
        "results": results,
    }, ensure_ascii=False))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())

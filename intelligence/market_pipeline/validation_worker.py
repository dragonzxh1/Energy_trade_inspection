"""Run deterministic fact validation and conflict detection."""

from __future__ import annotations

import argparse
import os
from datetime import date

from psycopg import Connection

from .validation_repository import validate_and_persist


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate extracted market facts")
    parser.add_argument("--date", type=date.fromisoformat)
    args = parser.parse_args()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    with Connection.connect(database_url) as connection:
        facts, blocked, conflicts = validate_and_persist(connection, args.date)
    print(f"validated={facts} blocked={blocked} conflicts={conflicts}", flush=True)


if __name__ == "__main__":
    main()

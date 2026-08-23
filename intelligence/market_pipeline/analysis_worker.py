"""Compute market metrics, signals, and low-signal state from verified facts."""

from __future__ import annotations

import os

from psycopg import Connection

from .analysis_repository import compute_and_persist_signals, compute_metrics, persist_metrics


def main() -> None:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    with Connection.connect(database_url) as connection:
        metrics = compute_metrics(connection)
        persist_metrics(connection, metrics)
        signals = compute_and_persist_signals(connection)
    print(
        f"metrics={len(metrics)} computed={sum(metric.value is not None for metric in metrics)} "
        f"insufficient={sum(metric.value is None for metric in metrics)} signals={len(signals)}",
        flush=True,
    )


if __name__ == "__main__":
    main()

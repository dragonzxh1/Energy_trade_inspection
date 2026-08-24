from __future__ import annotations

import unittest
from datetime import date

from intelligence.market_pipeline.digit_publication_scheduler import (
    REVIEW_REJECTED_STATUS,
    SUCCESS_STATUSES,
    ready_market_dates,
)


class FakeCursor:
    def __init__(self, rows: list[tuple[date]]) -> None:
        self.rows = rows
        self.query = ""
        self.parameters: tuple[object, ...] = ()

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, query: str, parameters: tuple[object, ...]) -> None:
        self.query = query
        self.parameters = parameters

    def fetchall(self) -> list[tuple[date]]:
        return self.rows


class FakeConnection:
    def __init__(self, rows: list[tuple[date]]) -> None:
        self.fake_cursor = FakeCursor(rows)

    def cursor(self) -> FakeCursor:
        return self.fake_cursor


class DigitPublicationSchedulerTests(unittest.TestCase):
    def test_ready_dates_are_discovered_from_verified_facts(self) -> None:
        target_date = date(2026, 7, 30)
        connection = FakeConnection([(target_date,)])

        result = ready_market_dates(
            connection,  # type: ignore[arg-type]
            through_date=target_date,
            lookback_days=14,
            limit=10,
        )

        self.assertEqual(result, [target_date])
        self.assertIn("FROM market_facts fact", connection.fake_cursor.query)
        self.assertIn("fact.verification_status = 'verified'", connection.fake_cursor.query)
        self.assertIn("view.market_date IS NULL", connection.fake_cursor.query)
        self.assertIn(
            "publication.updated_at >= candidate.latest_fact_at",
            connection.fake_cursor.query,
        )
        self.assertEqual(
            connection.fake_cursor.parameters,
            (
                date(2026, 7, 16),
                target_date,
                date(2026, 7, 16),
                target_date,
                [*SUCCESS_STATUSES],
                REVIEW_REJECTED_STATUS,
                10,
            ),
        )


if __name__ == "__main__":
    unittest.main()

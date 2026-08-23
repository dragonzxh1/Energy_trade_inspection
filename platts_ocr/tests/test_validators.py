import unittest

from src.validators import cross_date_validate, validate_field


class ValidatorTests(unittest.TestCase):
    def test_validate_mid_range(self) -> None:
        result = validate_field("mid", "9999", 9999.0, 90)
        self.assertEqual(result.status, "needs_review")

    def test_cross_date_validate_allows_small_float_diff(self) -> None:
        rows = [
            {
                "summary_date": "2026-07-01",
                "table_id": "ULSD_10ppm",
                "row_name": "FOB Med",
                "mid": 938.25,
                "change": 0.75,
            },
            {
                "summary_date": "2026-07-02",
                "table_id": "ULSD_10ppm",
                "row_name": "FOB Med",
                "mid": 939.01,
                "change": 0.75,
            },
        ]
        self.assertEqual(cross_date_validate(rows, tolerance=0.02), [])

    def test_cross_date_validate_marks_row(self) -> None:
        rows = [
            {
                "summary_date": "2026-07-01",
                "table_id": "ULSD_10ppm",
                "row_name": "FOB Med",
                "mid": 938.25,
            },
            {
                "summary_date": "2026-07-02",
                "table_id": "ULSD_10ppm",
                "row_name": "FOB Med",
                "code": "AAWY00",
                "mid": 950.00,
                "change": 0.75,
                "raw_change": "$0,75",
            },
        ]
        reviews = cross_date_validate(rows, tolerance=0.02)
        self.assertEqual(len(reviews), 1)
        self.assertEqual(rows[1]["validation_status"], "needs_review")
        self.assertIn("expected 11.75", rows[1]["validation_message"])


if __name__ == "__main__":
    unittest.main()

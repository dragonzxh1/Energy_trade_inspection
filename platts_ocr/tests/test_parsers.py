import unittest

from src.parsers import (
    parse_amount,
    parse_change,
    parse_code,
    parse_date,
    parse_spread_value,
)


class ParserTests(unittest.TestCase):
    def test_parse_amount_decimal_comma(self) -> None:
        self.assertEqual(parse_amount("$938,25"), 938.25)

    def test_parse_amount_na(self) -> None:
        self.assertIsNone(parse_amount("N A"))

    def test_parse_change_negative_currency(self) -> None:
        self.assertEqual(parse_change("-$3,75"), -3.75)

    def test_parse_change_positive(self) -> None:
        self.assertEqual(parse_change("$+15.25"), 15.25)

    def test_parse_spread_value_strips_border_digit(self) -> None:
        self.assertEqual(parse_spread_value("918,50"), 18.5)
        self.assertEqual(parse_spread_value("210,50"), 10.5)
        self.assertEqual(parse_spread_value("9171,08-"), -171.08)
        self.assertEqual(parse_spread_value("$139,16"), 139.16)

    def test_parse_code_preserves_letter_o(self) -> None:
        self.assertEqual(parse_code("POABC00"), "POABC00")

    def test_parse_date_month_name(self) -> None:
        self.assertEqual(parse_date("PLATTS SUMMARY July 1, 2026"), "2026-07-01")


if __name__ == "__main__":
    unittest.main()

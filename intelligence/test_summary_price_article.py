import io
import json
import re
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from intelligence import daily_prices
from intelligence.daily_prices import FusedDailyPrice, PriceReleaseState
from intelligence.summary_price_article import (
    audit_summary_price_article,
    build_summary_price_article,
    write_summary_price_article,
)


TARGET_DATE = date(2026, 7, 10)


def sample_prices() -> list[FusedDailyPrice]:
    def price(region: str, location: str, product: str, value: str, change: str) -> FusedDailyPrice:
        return FusedDailyPrice(
            market_date=TARGET_DATE.isoformat(),
            region=region,
            location=location,
            canonical_product=product,
            currency="USD",
            unit="USD/MT",
            price=Decimal(value),
            change=Decimal(change),
            status="cross_verified",
            image_source_ids=("image-1",),
            bot_source_ids=("bot-1",),
            reasons=(),
        )

    return [
        price("Europe", "FOB Med", "ULSD 10ppm", "1051.25", "11.50"),
        price("Europe", "CIF NWE ARA", "Naphtha", "650.50", "-14.00"),
        price("Singapore", "Singapore FOB", "<script>", "935.57", "0"),
    ]


class SummaryPriceArticleTests(unittest.TestCase):
    def test_reconcile_command_forwards_explicit_reports_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_root = Path(temporary_directory) / "vault" / "reports"
            price_root = reports_root / "prices"
            release_state = PriceReleaseState(
                schema_version="daily-prices.v1",
                report_date=TARGET_DATE.isoformat(),
                target_market_date=TARGET_DATE.isoformat(),
                content_ready=True,
                price_ready=True,
                reference_image_ready=False,
                wait_deadline="2026-07-10T18:30:00+08:00",
                status="ready_with_prices",
                reasons=(),
            )
            with patch.object(
                daily_prices, "resolve_daily_price_root", return_value=price_root
            ), patch.object(
                daily_prices, "reconcile_saved_report", return_value=release_state
            ) as reconcile:
                with redirect_stdout(io.StringIO()):
                    result = daily_prices.main([
                        "reconcile",
                        "--date",
                        TARGET_DATE.isoformat(),
                        "--reports-root",
                        str(reports_root),
                    ])

        self.assertEqual(result, 0)
        reconcile.assert_called_once_with(TARGET_DATE, reports_root, price_root)

    def test_summary_article_contains_only_title_date_unit_and_tables(self) -> None:
        article = build_summary_price_article(TARGET_DATE, sample_prices())

        self.assertIn("| 产品 | 地区 | 价格 | 涨跌 |", article.markdown)
        self.assertIn("市场日期：2026年7月10日", article.markdown)
        self.assertIn("单位：美元/吨", article.markdown)
        for forbidden in ("摘要", "分析", "判断", "建议", "传导", "来源", "AI"):
            self.assertNotIn(forbidden, article.markdown)
        self.assertEqual(audit_summary_price_article(article), [])

    def test_change_colors_are_up_green_down_red_flat_gray_and_html_is_escaped(self) -> None:
        html = build_summary_price_article(TARGET_DATE, sample_prices()).wechat_html

        self.assertIn('data-change="up"', html)
        self.assertIn("color:#047857", html)
        self.assertIn('data-change="down"', html)
        self.assertIn("color:#b91c1c", html)
        self.assertIn('data-change="flat"', html)
        self.assertIn("color:#6b7280", html)
        self.assertNotIn("<script", html.lower())
        self.assertIn("&lt;script&gt;", html)

    def test_write_uses_the_summary_stream_paths_and_quality_audit(self) -> None:
        article = build_summary_price_article(TARGET_DATE, sample_prices())
        benchmark_keys = [f"benchmark-{index:02d}" for index in range(1, 19)]
        benchmark_quality = {
            "expected": {"count": 18, "keys": benchmark_keys},
            "selected": {"count": 18, "keys": benchmark_keys},
            "missing": {"count": 0, "keys": []},
            "conflict": {"count": 0, "keys": []},
            "unavailable": {"count": 0, "keys": []},
        }
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_root = Path(temporary_directory) / "reports"
            paths = write_summary_price_article(
                article,
                reports_root,
                benchmark_quality=benchmark_quality,
                release_status="ready_with_prices",
            )
            quality = json.loads(paths.quality_audit.read_text(encoding="utf-8"))

            self.assertEqual(paths.markdown, reports_root / "summary" / "2026-07-10.md")
            self.assertEqual(paths.wechat_html, reports_root / "summary" / "2026-07-10_wechat.html")
            self.assertTrue(paths.markdown.exists())
            self.assertTrue(paths.wechat_html.exists())
            self.assertEqual(quality["status"], "pass")
            self.assertEqual(quality["issues"], [])
            self.assertEqual(quality["publication_key"], "summary-image:2026-07-10")
            self.assertEqual(quality["expected"], benchmark_quality["expected"])
            for artifact in ("markdown", "wechat_html", "summary"):
                self.assertRegex(quality["artifact_sha256"][artifact], r"^[a-f0-9]{64}$")
            self.assertFalse(any(paths.quality_audit.parent.glob(f".{paths.quality_audit.name}*.tmp")))


if __name__ == "__main__":
    unittest.main()

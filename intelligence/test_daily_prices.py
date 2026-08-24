import json
import subprocess
import tempfile
import unittest
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

import yaml

from intelligence import daily_prices
from intelligence import fuelsight_prices
from intelligence import pending_wechat_publish
from intelligence.daily_price_models import DailyPriceCandidate
from intelligence.summary_price_article import build_summary_price_article
from intelligence.daily_prices import (
    FusedDailyPrice,
    append_price_appendix,
    compute_release_state,
    format_price_appendix_markdown,
    fuse_daily_prices,
    load_image_candidates,
    reconcile_saved_report,
    select_public_prices,
)
from intelligence.summary_image_support import PlattsSummaryRecord, PlattsSummaryTrialResult


TARGET_DATE = date(2026, 7, 10)
FUELSIGHT_FIXTURES = Path(__file__).parent / "fixtures" / "fuelsight"


def fused_price(
    *,
    region: str,
    location: str,
    product: str = "ULSD 10ppm",
    price: str,
    change: str,
) -> FusedDailyPrice:
    return FusedDailyPrice(
        market_date=TARGET_DATE.isoformat(),
        region=region,
        location=location,
        canonical_product=product,
        currency="USD",
        unit="USD/MT",
        price=Decimal(price),
        change=Decimal(change),
        status="cross_verified",
        image_source_ids=("image-1",),
        bot_source_ids=("market-1",),
        reasons=(),
    )


def complete_public_selection() -> daily_prices.PublicPriceSelection:
    configuration = daily_prices._load_config()
    prices = tuple(
        FusedDailyPrice(
            market_date=TARGET_DATE.isoformat(),
            region=str(benchmark["region"]),
            location=str(benchmark["location"]),
            canonical_product=str(benchmark["product"]),
            currency=str(benchmark["currency"]),
            unit=str(benchmark["unit"]),
            price=Decimal("500.00"),
            change=Decimal("1.00"),
            status="bot_only",
            image_source_ids=(),
            bot_source_ids=(f"bot-{index}",),
            reasons=(),
        )
        for index, benchmark in enumerate(configuration["public_benchmarks"], start=1)
    )
    return daily_prices.evaluate_public_price_selection(
        daily_prices.DailyPriceFusionResult(
            schema_version=daily_prices.SCHEMA_VERSION,
            target_market_date=TARGET_DATE.isoformat(),
            prices=prices,
            excluded_count=0,
            reasons=(),
        ),
        configuration,
    )


class PriceAppendixMarkdownTests(unittest.TestCase):
    def test_summary_price_article_uses_searchable_title_and_intro(self) -> None:
        article = build_summary_price_article(TARGET_DATE, [
            fused_price(region="Asia", location="Singapore", price="500.00", change="1.00"),
        ])

        self.assertIn("每日普氏价格表", article.title)
        self.assertIn("原油、成品油与区域价差", article.title)
        self.assertIn("每日普氏价格参考", article.markdown)
        self.assertIn("柴油、航煤、燃料油", article.wechat_html)

    def test_formats_fixed_public_price_appendix_with_explicit_change_signs(self) -> None:
        appendix = format_price_appendix_markdown(TARGET_DATE, [
            fused_price(region="Europe", location="FOB Med", price="1051.25", change="-14"),
            fused_price(region="Singapore", location="Singapore FOB", price="935.57", change="11.32"),
        ])

        self.assertEqual(
            appendix,
            "## 今日价格速览\n\n"
            "市场日期：2026年7月10日｜单位：美元/吨\n\n"
            "- 欧洲市场｜低硫柴油｜FOB Med｜1,051.25｜-14.00\n"
            "- 亚太与中东｜低硫柴油｜Singapore｜935.57｜+11.32",
        )

    def test_inserts_before_references_and_repeated_calls_are_idempotent(self) -> None:
        markdown = "# 日报\n\n## 核心判断\n\n正文\n\n## 参考资料\n\n- 数据产品\n"
        appendix = format_price_appendix_markdown(TARGET_DATE, [
            fused_price(region="Europe", location="FOB Med", price="1051.25", change="-14"),
        ])

        inserted = append_price_appendix(markdown, appendix)

        self.assertLess(inserted.index("## 今日价格速览"), inserted.index("## 参考资料"))
        self.assertEqual(append_price_appendix(inserted, appendix), inserted)

    def test_empty_appendix_leaves_original_markdown_unchanged(self) -> None:
        markdown = "# 日报\n\n## 参考范围\n\n- 数据产品\n"

        self.assertEqual(append_price_appendix(markdown, ""), markdown)

    def test_removes_duplicate_stale_and_misplaced_price_sections_before_reinserting(self) -> None:
        appendix = format_price_appendix_markdown(TARGET_DATE, [
            fused_price(region="Europe", location="FOB Med", price="1051.25", change="-14"),
        ])
        markdown = (
            "# 日报\n\n"
            "## 今日价格速览\n\n市场日期：旧日期\n\n- 旧价格\n\n"
            "## 核心判断\n\n正文\n\n"
            "## 参考资料\n\n- 数据产品\n\n"
            "## 今日价格速览\n\n市场日期：旧日期\n\n- 重复旧价格\n"
        )

        normalized = append_price_appendix(markdown, appendix)

        self.assertEqual(normalized.count("## 今日价格速览"), 1)
        self.assertNotIn("旧价格", normalized)
        self.assertNotIn("重复旧价格", normalized)
        self.assertLess(normalized.index("## 今日价格速览"), normalized.index("## 参考资料"))
        self.assertEqual(append_price_appendix(normalized, appendix), normalized)


def candidate(
    *,
    market_date: str = "2026-07-10",
    region: str = "Europe",
    location: str = "FOB Med",
    product: str = "Naphtha",
    price: str | None = "500.00",
    change: str | None = "+1.00",
    currency: str | None = "USD",
    unit: str | None = "USD/MT",
    source_type: str = "fuelsight_bot",
    source_id: str = "source-1",
) -> DailyPriceCandidate:
    return DailyPriceCandidate(
        schema_version="1.0",
        market_date=market_date,
        region=region,
        location=location,
        product=product,
        price_raw=price,
        price=Decimal(price) if price is not None else None,
        change_raw=change,
        change=Decimal(change) if change is not None else None,
        currency=currency,
        unit=unit,
        source_type=source_type,  # type: ignore[arg-type]
        source_id=source_id,
        confidence=0.9,
        evidence={"test": True},
    )


class DailyPriceFusionTests(unittest.TestCase):
    def test_cross_verified_requires_equal_target_market_date_prices_and_changes(self):
        result = fuse_daily_prices(TARGET_DATE, [candidate(source_type="image_ocr")], [candidate()])

        self.assertEqual(len(result.prices), 1)
        self.assertEqual(result.prices[0].status, "cross_verified")
        self.assertEqual(result.prices[0].price, Decimal("500.00"))
        self.assertEqual(result.prices[0].change, Decimal("1.00"))

    def test_bot_only_is_created_for_complete_bot_candidate(self):
        result = fuse_daily_prices(TARGET_DATE, [], [candidate()])

        self.assertEqual(result.prices[0].status, "bot_only")

    def test_bot_only_with_missing_change_is_unavailable_and_not_public(self):
        result = fuse_daily_prices(TARGET_DATE, [], [candidate(change=None)])
        config = {"public_benchmarks": [{
            "name": "FOB Med Naphtha", "region": "Europe", "location": "FOB Med",
            "product": "Naphtha", "currency": "USD", "unit": "USD/MT",
        }]}

        self.assertEqual(result.prices[0].status, "unavailable")
        self.assertIn("missing_change", result.prices[0].reasons)
        self.assertEqual(select_public_prices(result, config), [])

    def test_ocr_only_is_created_when_no_bot_candidate_exists(self):
        result = fuse_daily_prices(TARGET_DATE, [candidate(source_type="image_ocr")], [])

        self.assertEqual(result.prices[0].status, "ocr_only")

    def test_conflict_is_created_for_different_prices(self):
        result = fuse_daily_prices(
            TARGET_DATE,
            [candidate(source_type="image_ocr", price="500.00")],
            [candidate(price="501.00")],
        )

        self.assertEqual(result.prices[0].status, "conflict")
        self.assertIn("price_mismatch", result.prices[0].reasons)

    def test_unavailable_is_created_for_incomplete_candidate(self):
        result = fuse_daily_prices(TARGET_DATE, [], [candidate(price=None)])

        self.assertEqual(result.prices[0].status, "unavailable")
        self.assertIn("missing_price", result.prices[0].reasons)

    def test_duplicate_business_key_is_conflict(self):
        result = fuse_daily_prices(TARGET_DATE, [], [candidate(source_id="one"), candidate(source_id="two")])

        self.assertEqual(result.prices[0].status, "conflict")
        self.assertIn("duplicate_bot_candidate", result.prices[0].reasons)

    def test_unit_conflict_does_not_share_business_key(self):
        result = fuse_daily_prices(
            TARGET_DATE,
            [candidate(source_type="image_ocr", unit="USD/BBL")],
            [candidate(unit="USD/MT")],
        )

        self.assertEqual(len(result.prices), 2)
        self.assertEqual({price.status for price in result.prices}, {"ocr_only", "bot_only"})

    def test_positive_and_negative_change_are_a_conflict(self):
        result = fuse_daily_prices(
            TARGET_DATE,
            [candidate(source_type="image_ocr", change="+1.00")],
            [candidate(change="-1.00")],
        )

        self.assertEqual(result.prices[0].status, "conflict")
        self.assertIn("change_mismatch", result.prices[0].reasons)

    def test_price_and_change_are_compared_after_half_up_cent_quantization(self):
        result = fuse_daily_prices(
            TARGET_DATE,
            [candidate(source_type="image_ocr", price="500.004", change="1.004")],
            [candidate(price="500.003", change="1.003")],
        )

        self.assertEqual(result.prices[0].status, "cross_verified")
        self.assertEqual(result.prices[0].price, Decimal("500.00"))
        self.assertEqual(result.prices[0].change, Decimal("1.00"))

    def test_cross_date_candidates_are_excluded_from_business_key_set(self):
        result = fuse_daily_prices(
            TARGET_DATE,
            [candidate(market_date="2026-07-09", source_type="image_ocr")],
            [candidate(market_date="2026-07-11")],
        )

        self.assertEqual(result.prices, ())
        self.assertEqual(result.excluded_count, 2)
        self.assertIn("cross_date_image_candidate", result.reasons)
        self.assertIn("cross_date_bot_candidate", result.reasons)

    def test_bot_and_ocr_location_aliases_fuse_to_the_same_business_keys(self):
        locations = [
            ("FOB Med", "Europe", "FOB Med"),
            ("CIF NWE", "Europe", "CIF NWE ARA"),
            ("FOB Rott", "Europe", "Barges Rotterdam"),
            ("FOB Sing (MOPS)", "Singapore", "Singapore FOB"),
            ("FOB AG (MOPAG)", "Arab Gulf", "Arab Gulf"),
            ("MOPJ", "MOPJ", "MOPJ"),
        ]
        image = [
            candidate(region=region, location=location, product=f"Product {index}", source_type="image_ocr")
            for index, (_, region, location) in enumerate(locations)
        ]
        bot = [
            candidate(region="untrusted", location=raw_location, product=f"Product {index}")
            for index, (raw_location, _, _) in enumerate(locations)
        ]

        result = fuse_daily_prices(TARGET_DATE, image, bot)

        self.assertEqual([price.status for price in result.prices], ["cross_verified"] * 6)


class PublicPriceSelectionTests(unittest.TestCase):
    def test_configures_the_18_public_benchmarks_in_editorial_order(self):
        config_path = Path(__file__).parent / "config" / "daily_prices.yaml"
        config = yaml.safe_load(config_path.read_text(encoding="utf-8"))

        self.assertEqual(
            [benchmark["name"] for benchmark in config["public_benchmarks"]],
            [
                "FOB Med Naphtha", "FOB Med Premium Gasoline", "FOB Med ULSD 10ppm",
                "FOB Med Jet", "FOB Med Gasoil 0.1%", "FOB Med Fuel Oil 1%",
                "CIF NWE ULSD 10ppm", "CIF NWE Jet", "Rotterdam Diesel 10ppm",
                "Singapore Naphtha", "Singapore Gasoline 95", "Singapore Gasoline 92",
                "Singapore Jet", "Singapore ULSD 10ppm", "Singapore HSFO 380",
                "Arab Gulf Jet", "Arab Gulf Gasoil 10ppm", "MOPJ Naphtha",
            ],
        )

    def test_selects_only_configured_public_products_in_configured_order(self):
        fusion = fuse_daily_prices(
            TARGET_DATE,
            [],
            [
                candidate(product="Jet"),
                candidate(product="Naphtha"),
                candidate(location="Singapore FOB", region="Singapore", product="Gasoline 95"),
                candidate(location="Elsewhere", product="Unselected"),
            ],
        )
        config = {
            "public_benchmarks": [
                {"name": "Singapore Gasoline 95", "region": "Singapore", "location": "Singapore FOB", "product": "Gasoline 95", "currency": "USD", "unit": "USD/MT"},
                {"name": "FOB Med Naphtha", "region": "Europe", "location": "FOB Med", "product": "Naphtha", "currency": "USD", "unit": "USD/MT"},
            ]
        }

        selected = select_public_prices(fusion, config)

        self.assertEqual([price.display_name for price in selected], ["Singapore Gasoline 95", "FOB Med Naphtha"])

    def test_public_selection_allows_cross_verified_and_complete_bot_only(self):
        fusion = fuse_daily_prices(
            TARGET_DATE,
            [candidate(product="Naphtha", source_type="image_ocr")],
            [candidate(product="Naphtha"), candidate(product="Jet")],
        )
        config = {"public_benchmarks": [
            {"name": "FOB Med Naphtha", "region": "Europe", "location": "FOB Med", "product": "Naphtha", "currency": "USD", "unit": "USD/MT"},
            {"name": "FOB Med Jet", "region": "Europe", "location": "FOB Med", "product": "Jet", "currency": "USD", "unit": "USD/MT"},
        ]}

        selected = select_public_prices(fusion, config)

        self.assertEqual([price.status for price in selected], ["cross_verified", "bot_only"])

    def test_public_selection_excludes_ocr_only_and_conflicts(self):
        fusion = fuse_daily_prices(
            TARGET_DATE,
            [candidate(product="Naphtha", source_type="image_ocr"), candidate(product="Jet", source_type="image_ocr", price="499.00")],
            [candidate(product="Jet", price="500.00")],
        )
        config = {"public_benchmarks": [
            {"name": "FOB Med Naphtha", "region": "Europe", "location": "FOB Med", "product": "Naphtha", "currency": "USD", "unit": "USD/MT"},
            {"name": "FOB Med Jet", "region": "Europe", "location": "FOB Med", "product": "Jet", "currency": "USD", "unit": "USD/MT"},
        ]}

        self.assertEqual(select_public_prices(fusion, config), [])


class ImageCandidateLoadingTests(unittest.TestCase):
    def test_promote_image_candidates_requires_explicit_trial_and_writes_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trial_path = root / "approved-trial.json"
            trial = PlattsSummaryTrialResult(
                image_id="approved-image", image_sha256="abc123", market_date="2026-07-10",
                parser="template_tesseract", duration_ms=100,
                records=[PlattsSummaryRecord(
                    record_type="price", product="Naphtha", location="FOB Med",
                    mid_raw="650.50", mid=650.50, change_raw="-19.50", change=-19.50,
                    currency="USD", unit="USD/MT", confidence=1.0,
                )],
            )
            trial_path.write_text(json.dumps(trial.to_dict()), encoding="utf-8")

            output = daily_prices.promote_image_candidates(TARGET_DATE, trial_path, root / "prices")

            payload = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(payload[0]["evidence"]["image_sha256"], "abc123")
            self.assertEqual(list(output.parent.glob("*.tmp")), [])

    def test_adapts_price_records_from_real_trial_contract_and_normalizes_locations(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trial.json"
            records = [
                PlattsSummaryRecord(record_type="price", product="Naphtha", location="FOB Med", mid_raw="500.00", mid=500.0, change_raw="+1.00", change=1.0, currency="USD", unit="USD/MT", confidence=0.9),
                PlattsSummaryRecord(record_type="price", product="ULSD 10ppm", location="CIF NWE", mid_raw="600.00", mid=600.0, change_raw="+2.00", change=2.0, currency="USD", unit="USD/MT"),
                PlattsSummaryRecord(record_type="price", product="Diesel 10ppm", code="FOB Rott", mid_raw="700.00", mid=700.0, change_raw="+3.00", change=3.0, currency="USD", unit="USD/MT"),
                PlattsSummaryRecord(record_type="price", product="Jet", location="FOB Sing (MOPS)", mid_raw="800.00", mid=800.0, change_raw="-4.00", change=-4.0, currency="USD", unit="USD/MT"),
                PlattsSummaryRecord(record_type="price", product="Jet", location="FOB AG (MOPAG)", mid_raw="900.00", mid=900.0, change_raw="-5.00", change=-5.0, currency="USD", unit="USD/MT"),
                PlattsSummaryRecord(record_type="price", product="Naphtha", location="MOPJ", mid_raw="1000.00", mid=1000.0, change_raw="+6.00", change=6.0, currency="USD", unit="USD/MT"),
                PlattsSummaryRecord(record_type="spread", product="Ignored spread", location="FOB Med", mid=1.0),
            ]
            trial = PlattsSummaryTrialResult(
                image_id="photo_169", image_sha256="abc123", market_date="2026-07-10",
                parser="ppstructure_v3", duration_ms=100, records=records,
            )
            path.write_text(json.dumps(trial.to_dict()), encoding="utf-8")

            loaded = load_image_candidates(TARGET_DATE, path)

        self.assertEqual(
            [(item.region, item.location) for item in loaded],
            [
                ("Europe", "FOB Med"), ("Europe", "CIF NWE ARA"),
                ("Europe", "Barges Rotterdam"), ("Singapore", "Singapore FOB"),
                ("Arab Gulf", "Arab Gulf"), ("MOPJ", "MOPJ"),
            ],
        )
        self.assertEqual([item.price_raw for item in loaded], ["500.00", "600.00", "700.00", "800.00", "900.00", "1000.00"])
        self.assertEqual([item.change_raw for item in loaded], ["+1.00", "+2.00", "+3.00", "-4.00", "-5.00", "+6.00"])
        self.assertTrue(all(item.source_type == "image_ocr" for item in loaded))
        self.assertTrue(all(item.evidence["record_type"] == "price" for item in loaded))
        self.assertTrue(all(item.evidence["market_date_source"] == "image_title" for item in loaded))

    def test_rejects_image_candidate_when_date_is_not_from_image_title(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trial.json"
            trial = PlattsSummaryTrialResult(
                image_id="photo_169", image_sha256="abc123", market_date="2026-07-10",
                parser="ppstructure_v3", duration_ms=100, market_date_source="filename",
            )
            path.write_text(json.dumps(trial.to_dict()), encoding="utf-8")

            with self.assertRaises(ValueError):
                load_image_candidates(TARGET_DATE, path)

    def test_rejects_real_trial_result_with_a_different_market_date(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trial.json"
            trial = PlattsSummaryTrialResult(
                image_id="photo_169", image_sha256="abc123", market_date="2026-07-09",
                parser="ppstructure_v3", duration_ms=100,
                records=[PlattsSummaryRecord(
                    record_type="price", product="Naphtha", location="FOB Med", mid=500.0,
                    change=1.0, currency="USD", unit="USD/MT",
                )],
            )
            path.write_text(json.dumps(trial.to_dict()), encoding="utf-8")

            loaded = load_image_candidates(TARGET_DATE, path)

        self.assertEqual(loaded, [])


class PriceReleaseStateTests(unittest.TestCase):
    def setUp(self) -> None:
        database_persistence = patch.object(daily_prices, "persist_summary_publication_state")
        database_persistence.start()
        self.addCleanup(database_persistence.stop)

    def test_reconciliation_writes_summary_artifacts_without_legacy_content_or_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reports_dir = root / "reports"
            prices_dir = root / "prices"
            selection = complete_public_selection()

            with patch.object(daily_prices, "_refresh_bot_candidates", return_value=[]), patch.object(
                daily_prices, "_read_candidate_artifact", return_value=([], [])
            ), patch.object(daily_prices, "evaluate_public_price_selection", return_value=selection), patch.object(
                daily_prices, "_price_input_completeness", return_value=[]
            ), patch.object(daily_prices, "validate_public_reference", return_value=(False, ["public_reference_missing"])):
                state = reconcile_saved_report(
                    TARGET_DATE,
                    reports_dir,
                    prices_dir,
                    now=datetime(2026, 7, 10, 12, tzinfo=ZoneInfo("Asia/Singapore")),
                )

            self.assertEqual(state.status, "ready_with_prices")
            self.assertFalse((reports_dir / TARGET_DATE.isoformat() / "content.json").exists())
            self.assertFalse((reports_dir / f"{TARGET_DATE.isoformat()}.md").exists())
            self.assertTrue((reports_dir / "summary" / "2026-07-10.md").exists())
            self.assertTrue((reports_dir / "summary" / "2026-07-10_wechat.html").exists())
            self.assertTrue((reports_dir / "summary" / "quality" / "2026-07-10.json").exists())

    def test_ready_summary_without_legacy_artifacts_is_selected_for_summary_publish(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reports_dir = root / "reports"
            prices_dir = root / "prices"
            selection = complete_public_selection()
            with patch.object(daily_prices, "_refresh_bot_candidates", return_value=[]), patch.object(
                daily_prices, "_read_candidate_artifact", return_value=([], [])
            ), patch.object(daily_prices, "evaluate_public_price_selection", return_value=selection), patch.object(
                daily_prices, "_price_input_completeness", return_value=[]
            ), patch.object(daily_prices, "validate_public_reference", return_value=(False, ["public_reference_missing"])):
                state = reconcile_saved_report(
                    TARGET_DATE,
                    reports_dir,
                    prices_dir,
                    now=datetime(2026, 7, 10, 12, tzinfo=ZoneInfo("Asia/Singapore")),
                )
            calls: list[list[str]] = []

            def runner(command, **_kwargs):
                calls.append(command)
                return subprocess.CompletedProcess(command, 0, "ok", "")

            results = pending_wechat_publish.publish_ready_reports(
                1,
                "draft",
                price_mode="append",
                reports_dir=reports_dir,
                prices_dir=prices_dir,
                now=datetime(2026, 7, 10, 18, tzinfo=ZoneInfo("Asia/Singapore")),
                runner=runner,
            )
            content_marker_exists = (reports_dir / TARGET_DATE.isoformat() / "content.json").exists()
            legacy_markdown_exists = (reports_dir / f"{TARGET_DATE.isoformat()}.md").exists()
            summary_markdown_exists = (reports_dir / "summary" / "2026-07-10.md").exists()

        self.assertEqual(state.status, "ready_with_prices")
        self.assertFalse(content_marker_exists)
        self.assertFalse(legacy_markdown_exists)
        self.assertTrue(summary_markdown_exists)
        self.assertTrue(results[TARGET_DATE.isoformat()]["invoked"])
        self.assertEqual(calls[0][calls[0].index("--stream") + 1], "summary")

    def test_reconciliation_writes_only_summary_quality_state_when_prices_are_not_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reports_dir = root / "reports"
            prices_dir = root / "prices"
            with patch.object(daily_prices, "_refresh_bot_candidates", return_value=[]), patch.object(
                daily_prices, "_read_candidate_artifact", return_value=([], [])
            ), patch.object(daily_prices, "_price_input_completeness", return_value=[]), patch.object(
                daily_prices, "validate_public_reference", return_value=(False, ["public_reference_missing"])):
                state = reconcile_saved_report(
                    TARGET_DATE,
                    reports_dir,
                    prices_dir,
                    now=datetime(2026, 7, 10, 12, tzinfo=ZoneInfo("Asia/Singapore")),
                )

            quality_path = reports_dir / "summary" / "quality" / "2026-07-10.json"
            self.assertNotEqual(state.status, "ready_with_prices")
            self.assertFalse((reports_dir / "summary" / "2026-07-10.md").exists())
            self.assertFalse((reports_dir / "summary" / "2026-07-10_wechat.html").exists())
            quality = json.loads(quality_path.read_text(encoding="utf-8"))
            self.assertEqual(quality["status"], "fail")
            self.assertEqual(quality["release_status"], state.status)
    def _prepare_report(self, root: Path) -> tuple[Path, Path]:
        report_root = root / "reports"
        price_root = report_root / "prices"
        report_directory = report_root / TARGET_DATE.isoformat()
        report_directory.mkdir(parents=True)
        (report_directory / "content.json").write_text(json.dumps({"ready": True}), encoding="utf-8")
        return report_root, price_root

    def _save_fuelsight_snapshot(
        self,
        archive: fuelsight_prices.FuelSightArchive,
        command: str,
        response_message_id: int,
        fixture_name: str,
    ) -> None:
        response = fuelsight_prices.FuelSightResponse(
            command=command,
            command_message_id=response_message_id - 1,
            response_message_id=response_message_id,
            requested_at="2026-07-13T14:17:21+00:00",
            response_timestamp="2026-07-13T14:17:21+00:00",
            raw_text=(FUELSIGHT_FIXTURES / fixture_name).read_text(encoding="utf-8"),
        )
        archive.save_snapshot(fuelsight_prices.parse_fuelsight_response(response))

    def test_reconcile_pending_cli_passes_configured_price_mode(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(
            "os.environ", {"DAILY_PRICE_MODE": "shadow"}
        ), patch.object(
            __import__("intelligence.daily_report", fromlist=["reconcile_pending_prices"]),
            "reconcile_pending_prices",
            return_value={},
        ) as reconcile:
            exit_code = daily_prices.main([
                "--price-root", str(Path(directory) / "prices"),
                "reconcile-pending", "--lookback-days", "7",
            ])
        self.assertEqual(exit_code, 0)
        self.assertEqual(reconcile.call_args.kwargs["price_mode"], "shadow")

    def test_missing_candidate_artifacts_are_reported_without_creating_fake_empty_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report_directory = root / "reports"
            price_root = root / "prices"
            (report_directory / TARGET_DATE.isoformat()).mkdir(parents=True)
            (report_directory / TARGET_DATE.isoformat() / "content.json").write_text(
                json.dumps({"ready": True}), encoding="utf-8"
            )

            state = reconcile_saved_report(TARGET_DATE, report_directory, price_root)

            target = price_root / TARGET_DATE.isoformat()
            self.assertIn("image_artifact_missing", state.reasons)
            self.assertIn("bot_artifact_missing", state.reasons)
            self.assertFalse((target / "image_candidates.json").exists())
            self.assertFalse((target / "bot_candidates.json").exists())

    def test_real_snapshots_and_approved_trial_materialize_into_selected_prices(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report_root = root / "reports"
            price_root = report_root / "prices"
            archive = fuelsight_prices.FuelSightArchive(price_root)
            for command, message_id, fixture_name in (
                ("/eu", 8085, "eu_2026-07-10.txt"),
                ("/apag", 8087, "apag_2026-07-10.txt"),
            ):
                response = fuelsight_prices.FuelSightResponse(
                    command=command,
                    command_message_id=message_id - 1,
                    response_message_id=message_id,
                    requested_at="2026-07-13T14:17:21+00:00",
                    response_timestamp="2026-07-13T14:17:21+00:00",
                    raw_text=(FUELSIGHT_FIXTURES / fixture_name).read_text(encoding="utf-8"),
                )
                archive.save_snapshot(fuelsight_prices.parse_fuelsight_response(response))
            fuelsight_prices.materialize_bot_candidates(TARGET_DATE, archive)

            trial_path = root / "approved-trial.json"
            trial = PlattsSummaryTrialResult(
                image_id="photo_169_20260711_114854",
                image_sha256="532f592e81255c7712623739710294a4f6860bba1a6197803522d9f3d0630337",
                market_date="2026-07-10",
                parser="template_tesseract",
                duration_ms=100,
                records=[
                    PlattsSummaryRecord(
                        record_type="price", product="Naphtha", location="FOB Med",
                        mid_raw="650.50", mid=650.50, change_raw="-19.50", change=-19.50,
                        currency="USD", unit="USD/MT", confidence=1.0,
                    ),
                    PlattsSummaryRecord(
                        record_type="price", product="ULSD 10ppm", location="FOB Med",
                        mid_raw="1051.25", mid=1051.25, change_raw="-14.00", change=-14.00,
                        currency="USD", unit="USD/MT", confidence=1.0,
                    ),
                ],
            )
            trial_path.write_text(json.dumps(trial.to_dict()), encoding="utf-8")
            daily_prices.promote_image_candidates(TARGET_DATE, trial_path, price_root)
            (report_root / TARGET_DATE.isoformat()).mkdir(parents=True)
            (report_root / TARGET_DATE.isoformat() / "content.json").write_text(
                json.dumps({"ready": True}), encoding="utf-8"
            )

            state = reconcile_saved_report(TARGET_DATE, report_root, price_root)
            selected = json.loads(
                (price_root / TARGET_DATE.isoformat() / "selected_prices.json").read_text(encoding="utf-8")
            )

            self.assertEqual(state.status, "ready_with_prices")
            selected_by_name = {item["display_name"]: item for item in selected}
            self.assertEqual(selected_by_name["FOB Med Naphtha"]["status"], "cross_verified")
            self.assertEqual(selected_by_name["FOB Med ULSD 10ppm"]["status"], "cross_verified")

    def test_partial_price_inputs_wait_before_deadline_even_with_one_public_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            report_root, price_root = self._prepare_report(Path(directory))
            target = price_root / TARGET_DATE.isoformat()
            target.mkdir(parents=True)
            atomic_candidate = candidate(
                region="Europe", location="FOB Med", product="Naphtha",
                price="650.50", change="-19.50", source_type="fuelsight_bot",
            )
            daily_prices.atomic_write_json(
                target / "bot_candidates.json", [daily_prices._candidate_to_dict(atomic_candidate)]
            )

            state = reconcile_saved_report(
                TARGET_DATE,
                report_root,
                price_root,
                now=datetime(2026, 7, 13, 17, 0, tzinfo=ZoneInfo("Asia/Singapore")),
            )

            self.assertEqual(state.status, "waiting_for_prices")
            self.assertFalse(state.price_ready)
            self.assertIn("summary_image_not_promoted", state.reasons)
            self.assertIn("fuelsight_eu_snapshot_missing", state.reasons)
            self.assertIn("fuelsight_apag_snapshot_missing", state.reasons)

    def test_summary_and_both_bot_snapshots_allow_bot_only_prices_without_public_image(self):
        with tempfile.TemporaryDirectory() as directory:
            report_root, price_root = self._prepare_report(Path(directory))
            archive = fuelsight_prices.FuelSightArchive(price_root)
            self._save_fuelsight_snapshot(archive, "/eu", 8085, "eu_2026-07-10.txt")
            self._save_fuelsight_snapshot(archive, "/apag", 8087, "apag_2026-07-10.txt")
            fuelsight_prices.materialize_bot_candidates(TARGET_DATE, archive)
            target = price_root / TARGET_DATE.isoformat()
            daily_prices.atomic_write_json(target / "image_candidates.json", [])

            state = reconcile_saved_report(
                TARGET_DATE,
                report_root,
                price_root,
                now=datetime(2026, 7, 13, 17, 0, tzinfo=ZoneInfo("Asia/Singapore")),
            )

            self.assertEqual(state.status, "ready_with_prices")
            self.assertTrue(state.price_ready)
            self.assertFalse(state.reference_image_ready)
            self.assertIn("public_reference_missing", state.reasons)
            selected = json.loads(
                (target / "selected_prices.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(selected), 18)

    def test_both_snapshots_with_one_missing_and_one_conflict_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            report_root, price_root = self._prepare_report(Path(directory))
            archive = fuelsight_prices.FuelSightArchive(price_root)
            self._save_fuelsight_snapshot(archive, "/eu", 8085, "eu_2026-07-10.txt")
            self._save_fuelsight_snapshot(archive, "/apag", 8087, "apag_2026-07-10.txt")
            fuelsight_prices.materialize_bot_candidates(TARGET_DATE, archive)
            target = price_root / TARGET_DATE.isoformat()
            bot_payload = json.loads((target / "bot_candidates.json").read_text(encoding="utf-8"))
            missing_index = next(
                index for index, item in enumerate(bot_payload)
                if item["region"] == "MOPJ" and item["product"] == "Naphtha"
            )
            missing = bot_payload.pop(missing_index)
            conflicting = bot_payload[0]
            daily_prices.atomic_write_json(target / "bot_candidates.json", bot_payload)
            conflict_candidate = candidate(
                region=conflicting["region"],
                location=conflicting["location"],
                product=conflicting["product"],
                price=str(Decimal(conflicting["price"]) + Decimal("1.00")),
                change=conflicting["change"],
                currency=conflicting["currency"],
                unit=conflicting["unit"],
                source_type="image_ocr",
                source_id="conflicting-image",
            )
            daily_prices.atomic_write_json(
                target / "image_candidates.json",
                [daily_prices._candidate_to_dict(conflict_candidate)],
            )

            with patch.object(daily_prices, "_refresh_bot_candidates", return_value=[]):
                state = reconcile_saved_report(
                    TARGET_DATE,
                    report_root,
                    price_root,
                    now=datetime(2026, 7, 13, 17, 0, tzinfo=ZoneInfo("Asia/Singapore")),
                )

            quality = json.loads(
                (report_root / "summary" / "quality" / "2026-07-10.json").read_text(
                    encoding="utf-8"
                )
            )
            missing_key = "|".join((
                TARGET_DATE.isoformat(), missing["region"], missing["location"],
                missing["product"], missing["currency"], missing["unit"],
            ))
            conflict_key = "|".join((
                TARGET_DATE.isoformat(), conflicting["region"], conflicting["location"],
                conflicting["product"], conflicting["currency"], conflicting["unit"],
            ))

            self.assertFalse(state.price_ready)
            self.assertNotEqual(state.status, "ready_with_prices")
            self.assertEqual(quality["status"], "fail")
            self.assertEqual(quality["expected"]["count"], 18)
            self.assertEqual(quality["selected"]["count"], 16)
            self.assertEqual(quality["missing"], {"count": 1, "keys": [missing_key]})
            self.assertEqual(quality["conflict"], {"count": 1, "keys": [conflict_key]})
            self.assertEqual(quality["unavailable"], {"count": 0, "keys": []})

    def test_missing_apag_snapshot_waits_then_degrades_without_prices_after_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            report_root, price_root = self._prepare_report(Path(directory))
            archive = fuelsight_prices.FuelSightArchive(price_root)
            self._save_fuelsight_snapshot(archive, "/eu", 8085, "eu_2026-07-10.txt")
            fuelsight_prices.materialize_bot_candidates(TARGET_DATE, archive)
            target = price_root / TARGET_DATE.isoformat()
            daily_prices.atomic_write_json(target / "image_candidates.json", [])

            before = reconcile_saved_report(
                TARGET_DATE,
                report_root,
                price_root,
                now=datetime(2026, 7, 13, 17, 0, tzinfo=ZoneInfo("Asia/Singapore")),
            )
            after = reconcile_saved_report(
                TARGET_DATE,
                report_root,
                price_root,
                now=datetime(2026, 7, 13, 18, 1, tzinfo=ZoneInfo("Asia/Singapore")),
            )

            self.assertEqual(before.status, "waiting_for_prices")
            self.assertEqual(after.status, "ready_without_prices")
            self.assertFalse(after.price_ready)
            self.assertIn("fuelsight_apag_snapshot_missing", after.reasons)

    def test_reconcile_rebuilds_stale_partial_bot_candidates_from_latest_snapshots(self):
        with tempfile.TemporaryDirectory() as directory:
            report_root, price_root = self._prepare_report(Path(directory))
            archive = fuelsight_prices.FuelSightArchive(price_root)
            self._save_fuelsight_snapshot(archive, "/eu", 8085, "eu_2026-07-10.txt")
            self._save_fuelsight_snapshot(archive, "/apag", 8087, "apag_2026-07-10.txt")
            self._save_fuelsight_snapshot(archive, "/eu", 8095, "eu_2026-07-10.txt")
            self._save_fuelsight_snapshot(archive, "/apag", 8097, "apag_2026-07-10.txt")
            target = price_root / TARGET_DATE.isoformat()
            stale_eu_only = candidate(
                region="Europe", location="FOB Med", product="Naphtha",
                price="650.50", change="-19.50", source_type="fuelsight_bot", source_id="8085",
            )
            daily_prices.atomic_write_json(
                target / "bot_candidates.json", [daily_prices._candidate_to_dict(stale_eu_only)]
            )
            daily_prices.atomic_write_json(target / "image_candidates.json", [])

            state = reconcile_saved_report(
                TARGET_DATE,
                report_root,
                price_root,
                now=datetime(2026, 7, 13, 17, 0, tzinfo=ZoneInfo("Asia/Singapore")),
            )

            selected = json.loads((target / "selected_prices.json").read_text(encoding="utf-8"))
            self.assertEqual(state.status, "ready_with_prices")
            self.assertEqual(len(selected), 18)
            source_ids = {
                source_id
                for item in selected
                for source_id in item["bot_source_ids"]
            }
            self.assertEqual(source_ids, {"8095", "8097"})
    def test_waits_until_next_trading_day_deadline(self):
        state = compute_release_state(
            date(2026, 7, 10),
            datetime(2026, 7, 13, 17, 59, tzinfo=ZoneInfo("Asia/Singapore")),
            price_ready=False,
            content_ready=True,
        )
        self.assertEqual(state.status, "waiting_for_prices")

    def test_releases_body_without_prices_after_deadline(self):
        state = compute_release_state(
            date(2026, 7, 10),
            datetime(2026, 7, 13, 18, 1, tzinfo=ZoneInfo("Asia/Singapore")),
            price_ready=False,
            content_ready=True,
        )
        self.assertEqual(state.status, "ready_without_prices")

    def test_releases_with_prices_when_content_and_prices_are_ready(self):
        state = compute_release_state(
            TARGET_DATE,
            datetime(2026, 7, 10, 12, tzinfo=ZoneInfo("Asia/Singapore")),
            price_ready=True,
            content_ready=True,
        )

        self.assertEqual(state.status, "ready_with_prices")

    def test_price_ready_releases_without_legacy_content_marker(self):
        state = compute_release_state(
            TARGET_DATE,
            datetime(2026, 7, 14, 12, tzinfo=ZoneInfo("Asia/Singapore")),
            price_ready=True,
            content_ready=False,
        )

        self.assertEqual(state.status, "ready_with_prices")
        self.assertNotIn("content_not_ready", state.reasons)

    def test_market_holidays_move_the_deadline_to_next_open_weekday(self):
        config = {"market_holidays": ["2026-07-13"]}
        state = compute_release_state(
            TARGET_DATE,
            datetime(2026, 7, 13, 18, 1, tzinfo=ZoneInfo("Asia/Singapore")),
            price_ready=False,
            content_ready=True,
            config=config,
        )

        self.assertEqual(state.status, "waiting_for_prices")
        self.assertEqual(state.wait_deadline, "2026-07-14T18:00:00+08:00")

    def test_reconciliation_writes_summary_quality_and_price_artifacts_without_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report_directory = root / "reports"
            price_directory = root / "prices"
            (report_directory / TARGET_DATE.isoformat()).mkdir(parents=True)
            (report_directory / TARGET_DATE.isoformat() / "content.json").write_text(json.dumps({"ready": True}), encoding="utf-8")
            price_directory.mkdir()

            state = reconcile_saved_report(TARGET_DATE, report_directory, price_directory)

            self.assertIn(state.status, {"waiting_for_prices", "ready_without_prices"})
            self.assertTrue((price_directory / TARGET_DATE.isoformat() / "release_state.json").exists())
            self.assertTrue((report_directory / "summary" / "quality" / "2026-07-10.json").exists())

    def test_reconciliation_records_candidate_parse_errors_as_reasons(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            report_directory = root / "reports"
            price_directory = root / "prices" / TARGET_DATE.isoformat()
            (report_directory / TARGET_DATE.isoformat()).mkdir(parents=True)
            (report_directory / TARGET_DATE.isoformat() / "content.json").write_text(json.dumps({"ready": True}), encoding="utf-8")
            price_directory.mkdir(parents=True)
            (price_directory / "image_candidates.json").write_text("{not-json", encoding="utf-8")

            state = reconcile_saved_report(TARGET_DATE, report_directory, price_directory.parent)

            self.assertIn("image_parse_error", state.reasons)
            quality = json.loads((report_directory / "summary" / "quality" / "2026-07-10.json").read_text(encoding="utf-8"))
            self.assertIn("image_parse_error", quality["issues"])
            fusion = json.loads((price_directory / "fusion.json").read_text(encoding="utf-8"))
            self.assertIn("image_parse_error", fusion["reasons"])


if __name__ == "__main__":
    unittest.main()

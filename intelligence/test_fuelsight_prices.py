import asyncio
import io
import json
import os
import shutil
import sqlite3
import unittest
from contextlib import redirect_stdout
from dataclasses import FrozenInstanceError, replace
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from intelligence import fuelsight_prices
from intelligence import daily_prices
from intelligence.daily_price_models import DailyPriceCandidate
from intelligence.fuelsight_prices import (
    FuelSightParseError,
    FuelSightResponse,
    parse_fuelsight_market_date,
    parse_fuelsight_response,
)


FIXTURE_DIR = Path(__file__).parent / "fixtures" / "fuelsight"
EU_FIXTURE = (FIXTURE_DIR / "eu_2026-07-10.txt").read_text(encoding="utf-8")
APAG_FIXTURE = (FIXTURE_DIR / "apag_2026-07-10.txt").read_text(encoding="utf-8")
TARGET_DATE = date(2026, 7, 10)


def response(command: str, raw_text: str, command_message_id: int = 8084, response_message_id: int = 8085) -> FuelSightResponse:
    return FuelSightResponse(
        command=command,
        command_message_id=command_message_id,
        response_message_id=response_message_id,
        requested_at="2026-07-13T10:30:00+08:00",
        response_timestamp="2026-07-13T10:30:02+08:00",
        raw_text=raw_text,
    )


class DailyPriceCandidateContractTests(unittest.TestCase):
    def test_candidate_is_frozen_slot_based_contract(self) -> None:
        candidate = DailyPriceCandidate(
            schema_version="1.0",
            market_date="2026-07-10",
            region="Europe",
            location="FOB Med",
            product="Naphtha",
            price_raw="$ 650.50",
            price=Decimal("650.50"),
            change_raw="-19.50",
            change=Decimal("-19.50"),
            currency="USD",
            unit="USD/MT",
            source_type="fuelsight_bot",
            source_id="8085",
            confidence=1.0,
            evidence={"command": "/eu"},
        )

        with self.assertRaises(FrozenInstanceError):
            candidate.product = "Jet"
        with self.assertRaises(TypeError):
            candidate.extra = "not allowed"


class FuelSightDateTests(unittest.TestCase):
    def test_request_date_does_not_replace_response_market_date(self) -> None:
        snapshot = parse_fuelsight_response(response("/eu", EU_FIXTURE))

        self.assertEqual(snapshot.market_date, "2026-07-10")

    def test_missing_title_date_is_rejected(self) -> None:
        with self.assertRaises(FuelSightParseError):
            parse_fuelsight_market_date("European Products\n\nFOB Med")

    def test_invalid_english_month_is_rejected(self) -> None:
        with self.assertRaises(FuelSightParseError):
            parse_fuelsight_market_date("European Products - 10 Jly 2026")

    def test_response_message_must_follow_command_message(self) -> None:
        with self.assertRaises(FuelSightParseError):
            parse_fuelsight_response(response("/eu", EU_FIXTURE, 8084, 8084))


class FuelSightPriceParsingTests(unittest.TestCase):
    def test_real_fixtures_produce_expected_prices_and_changes(self) -> None:
        snapshots = (
            parse_fuelsight_response(response("/eu", EU_FIXTURE)),
            parse_fuelsight_response(response("/apag", APAG_FIXTURE, 8086, 8087)),
        )
        actual = {
            (candidate.region, candidate.location, candidate.product): (candidate.price, candidate.change)
            for snapshot in snapshots
            for candidate in snapshot.candidates
        }
        expected = {
            ("Europe", "FOB Med", "ULSD 10ppm"): (Decimal("1051.25"), Decimal("-14.00")),
            ("Europe", "FOB Med", "Naphtha"): (Decimal("650.50"), Decimal("-19.50")),
            ("Singapore", "Singapore FOB", "ULSD 10ppm"): (Decimal("935.57"), Decimal("-11.32")),
            ("Arab Gulf", "Arab Gulf", "Gasoil 10ppm"): (Decimal("885.51"), Decimal("-12.74")),
            ("MOPJ", "MOPJ", "Naphtha"): (Decimal("731.00"), Decimal("-6.88")),
        }

        for key, value in expected.items():
            self.assertEqual(actual[key], value)

    def test_na_price_is_preserved_as_none(self) -> None:
        snapshot = parse_fuelsight_response(response("/eu", EU_FIXTURE))
        candidate = next(
            item
            for item in snapshot.candidates
            if (item.location, item.product) == ("CIF NWE ARA", "Naphtha")
        )

        self.assertEqual(candidate.price_raw, "n/a")
        self.assertIsNone(candidate.price)
        self.assertIsNone(candidate.change_raw)
        self.assertIsNone(candidate.change)

    def test_signed_numbers_and_thousands_spaces_are_normalized(self) -> None:
        raw_text = """🇪🇺 European Products - 10 Jul 2026

FOB Med
Naphtha      $ 1 051.25  (  +14.00)
Jet          $ 1 024.00  ( -16.25)
"""
        snapshot = parse_fuelsight_response(response("/eu", raw_text))
        candidates = {candidate.product: candidate for candidate in snapshot.candidates}

        self.assertEqual(candidates["Naphtha"].price, Decimal("1051.25"))
        self.assertEqual(candidates["Naphtha"].change, Decimal("14.00"))
        self.assertEqual(candidates["Jet"].change, Decimal("-16.25"))

    def test_duplicate_business_key_is_rejected(self) -> None:
        raw_text = """🇪🇺 European Products - 10 Jul 2026

FOB Med
Naphtha      $  650.50  ( -19.50)
Naphtha      $  651.50  ( -18.50)
"""

        with self.assertRaises(FuelSightParseError):
            parse_fuelsight_response(response("/eu", raw_text))

    def test_unknown_region_heading_is_rejected(self) -> None:
        raw_text = """⛽ APAG Products - 10 Jul 2026

Unknown Harbour FOB ($/mt)
Naphtha      $  650.50  ( -19.50)
"""

        with self.assertRaises(FuelSightParseError):
            parse_fuelsight_response(response("/apag", raw_text))


class FuelSightArchiveTests(unittest.TestCase):
    def test_default_archive_uses_shared_daily_price_root(self) -> None:
        with TemporaryDirectory() as directory, patch.dict(
            "os.environ", {"DAILY_PRICE_ROOT": str(Path(directory) / "shared-prices")}
        ):
            archive = fuelsight_prices.FuelSightArchive()
            self.assertEqual(archive.reports_directory, Path(directory) / "shared-prices")
            self.assertEqual(archive.reports_directory, daily_prices.resolve_daily_price_root())

    def test_snapshot_is_indexed_by_its_market_date_not_request_date(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            self.assertTrue(hasattr(fuelsight_prices, "FuelSightArchive"))
            archive = fuelsight_prices.FuelSightArchive(Path(temporary_directory))
            requested_at = datetime(2026, 7, 13, 10, 30, tzinfo=timezone.utc)
            snapshot = parse_fuelsight_response(response("/eu", EU_FIXTURE))

            archive.save_capture("morning", requested_at, [response("/eu", EU_FIXTURE)])
            archive.save_snapshot(snapshot)

            stored = archive.find_snapshot("/eu", date(2026, 7, 10))
            self.assertIsNotNone(stored)
            self.assertEqual(stored.response_message_id, 8085)
            self.assertIsNone(archive.find_snapshot("/eu", date(2026, 7, 13)))

    def test_latest_complete_snapshot_wins_for_same_command_and_market_date(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            self.assertTrue(hasattr(fuelsight_prices, "FuelSightArchive"))
            archive = fuelsight_prices.FuelSightArchive(Path(temporary_directory))
            archive.save_snapshot(parse_fuelsight_response(response("/eu", EU_FIXTURE, 8084, 8085)))
            archive.save_snapshot(parse_fuelsight_response(response("/eu", EU_FIXTURE, 8086, 8087)))

            stored = archive.find_snapshot("/eu", date(2026, 7, 10))

            self.assertIsNotNone(stored)
            self.assertEqual(stored.response_message_id, 8087)

    def test_largest_message_id_wins_even_when_an_older_snapshot_has_more_candidates(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            archive = fuelsight_prices.FuelSightArchive(Path(temporary_directory))
            old_snapshot = parse_fuelsight_response(response("/eu", EU_FIXTURE, 8084, 8085))
            newer_snapshot = parse_fuelsight_response(response("/eu", EU_FIXTURE, 8086, 8087))
            archive.save_snapshot(replace(old_snapshot, candidates=old_snapshot.candidates * 2))
            archive.save_snapshot(newer_snapshot)

            stored = archive.find_snapshot("/eu", date(2026, 7, 10))

            self.assertIsNotNone(stored)
            self.assertEqual(stored.response_message_id, 8087)

    def test_materialize_bot_candidates_uses_latest_eu_and_apag_snapshots_atomically(self) -> None:
        with TemporaryDirectory() as directory:
            price_root = Path(directory) / "prices"
            archive = fuelsight_prices.FuelSightArchive(price_root)
            old_eu = parse_fuelsight_response(response("/eu", EU_FIXTURE, 8000, 8001))
            latest_eu = parse_fuelsight_response(response("/eu", EU_FIXTURE, 8084, 8085))
            apag = parse_fuelsight_response(response("/apag", APAG_FIXTURE, 8086, 8087))
            archive.save_snapshot(old_eu)
            archive.save_snapshot(latest_eu)
            archive.save_snapshot(apag)

            output = fuelsight_prices.materialize_bot_candidates(TARGET_DATE, archive)
            payload = json.loads(output.read_text(encoding="utf-8"))

            self.assertTrue(payload)
            self.assertEqual(
                {item["source_id"] for item in payload},
                {str(latest_eu.response_message_id), str(apag.response_message_id)},
            )
            self.assertEqual(list(output.parent.glob("*.tmp")), [])


class FakeTelegramGateway:
    def __init__(self, replies: dict[str, list[object]]) -> None:
        self.replies = replies
        self.commands: list[str] = []
        self.command_by_message_id: dict[int, str] = {}
        self.session_path: Path | None = None
        self.connected = False
        self.disconnected = False

    async def connect(self) -> None:
        self.connected = True

    async def disconnect(self) -> None:
        self.disconnected = True

    async def send_command(self, bot_username: str, command: str) -> int:
        self.commands.append(command)
        message_id = 100 + len(self.commands)
        self.command_by_message_id[message_id] = command
        return message_id

    async def wait_for_response(
        self,
        bot_username: str,
        command_message_id: int,
        timeout_seconds: int,
    ) -> object | None:
        reply = self.replies[self.command_by_message_id[command_message_id]].pop(0)
        return reply(command_message_id) if callable(reply) else reply


def telegram_reply(
    raw_text: str,
    *,
    sender_username: str = "fuelsightbot",
    message_offset: int = 1,
) -> object:
    return lambda command_message_id: SimpleNamespace(
        id=command_message_id + message_offset,
        sender_username=sender_username,
        raw_text=raw_text,
        timestamp="2026-07-13T10:30:02+08:00",
    )


class FuelSightClientTests(unittest.TestCase):
    def _config(self, source_session: Path) -> object:
        self.assertTrue(hasattr(fuelsight_prices, "FuelSightClientConfig"))
        return fuelsight_prices.FuelSightClientConfig(
            api_id=123,
            api_hash="hash",
            source_session=source_session,
            bot_username="@fuelsightbot",
            timeout_seconds=30,
            max_attempts=2,
        )

    def _source_session(self, directory: Path) -> Path:
        source_session = directory / "long_lived.session"
        connection = sqlite3.connect(source_session)
        connection.execute("CREATE TABLE sessions (id INTEGER PRIMARY KEY)")
        connection.commit()
        connection.close()
        return source_session

    def test_retries_timeout_then_archives_commands_by_their_own_market_dates(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            self.assertTrue(hasattr(fuelsight_prices, "fetch_fuelsight_capture"))
            fetch_capture = fuelsight_prices.fetch_fuelsight_capture
            temporary_path = Path(temporary_directory)
            source_session = self._source_session(temporary_path)
            archive = fuelsight_prices.FuelSightArchive(temporary_path / "reports/prices")
            gateway = FakeTelegramGateway({
                "/eu": [None, telegram_reply(EU_FIXTURE)],
                "/apag": [telegram_reply(APAG_FIXTURE.replace("10 Jul 2026", "11 Jul 2026"))],
            })
            factory = Mock(return_value=gateway)

            with patch.object(fuelsight_prices, "_create_telegram_gateway", factory, create=True):
                snapshots = asyncio.run(fetch_capture(
                    "morning",
                    datetime.fromisoformat("2026-07-13T10:30:00+08:00"),
                    self._config(source_session),
                    archive,
                ))

            self.assertEqual([snapshot.market_date for snapshot in snapshots], ["2026-07-10", "2026-07-11"])
            self.assertEqual(gateway.commands, ["/eu", "/eu", "/apag"])
            self.assertTrue(gateway.disconnected)
            self.assertTrue(source_session.exists())
            copied_session = factory.call_args.args[0]
            self.assertEqual(copied_session.name, "client.session")
            self.assertFalse(copied_session.parent.exists())
            self.assertEqual(archive.find_snapshot("/eu", date(2026, 7, 10)).response_message_id, 103)
            self.assertEqual(archive.find_snapshot("/apag", date(2026, 7, 11)).response_message_id, 104)

    def test_retries_wrong_sender_and_stale_message_without_failing_other_command(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            self.assertTrue(hasattr(fuelsight_prices, "fetch_fuelsight_capture"))
            fetch_capture = fuelsight_prices.fetch_fuelsight_capture
            temporary_path = Path(temporary_directory)
            source_session = self._source_session(temporary_path)
            archive = fuelsight_prices.FuelSightArchive(temporary_path / "reports/prices")
            gateway = FakeTelegramGateway({
                "/eu": [telegram_reply(EU_FIXTURE, sender_username="otherbot"), telegram_reply(EU_FIXTURE)],
                "/apag": [telegram_reply(APAG_FIXTURE, message_offset=0), telegram_reply(APAG_FIXTURE)],
            })

            with patch.object(fuelsight_prices, "_create_telegram_gateway", return_value=gateway, create=True):
                snapshots = asyncio.run(fetch_capture(
                    "afternoon",
                    datetime.fromisoformat("2026-07-13T14:30:00+08:00"),
                    self._config(source_session),
                    archive,
                ))

            self.assertEqual([snapshot.command for snapshot in snapshots], ["/eu", "/apag"])
            self.assertEqual(gateway.commands, ["/eu", "/eu", "/apag", "/apag"])

    def test_repeating_completed_slot_reuses_capture_without_sending_commands(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            self.assertTrue(hasattr(fuelsight_prices, "fetch_fuelsight_capture"))
            fetch_capture = fuelsight_prices.fetch_fuelsight_capture
            temporary_path = Path(temporary_directory)
            source_session = self._source_session(temporary_path)
            archive = fuelsight_prices.FuelSightArchive(temporary_path / "reports/prices")
            gateway = FakeTelegramGateway({
                "/eu": [telegram_reply(EU_FIXTURE)],
                "/apag": [telegram_reply(APAG_FIXTURE)],
            })
            requested_at = datetime.fromisoformat("2026-07-13T18:30:00+08:00")

            with patch.object(fuelsight_prices, "_create_telegram_gateway", return_value=gateway, create=True) as factory:
                first = asyncio.run(fetch_capture(
                    "evening", requested_at, self._config(source_session), archive,
                ))
                second = asyncio.run(fetch_capture(
                    "evening", requested_at, self._config(source_session), archive,
                ))

            self.assertEqual(first, second)
            self.assertEqual(gateway.commands, ["/eu", "/apag"])
            self.assertEqual(factory.call_count, 1)

    def test_disconnect_failure_still_removes_copied_session_directory(self) -> None:
        class DisconnectFailingGateway(FakeTelegramGateway):
            async def disconnect(self) -> None:
                await super().disconnect()
                raise RuntimeError("disconnect failed")

        with TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            source_session = self._source_session(temporary_path)
            archive = fuelsight_prices.FuelSightArchive(temporary_path / "reports/prices")
            gateway = DisconnectFailingGateway({
                "/eu": [telegram_reply(EU_FIXTURE)],
                "/apag": [telegram_reply(APAG_FIXTURE)],
            })
            factory = Mock(return_value=gateway)

            with patch.object(fuelsight_prices, "_create_telegram_gateway", factory):
                with self.assertRaisesRegex(RuntimeError, "disconnect failed"):
                    asyncio.run(fuelsight_prices.fetch_fuelsight_capture(
                        "morning",
                        datetime.fromisoformat("2026-07-13T10:30:00+08:00"),
                        self._config(source_session),
                        archive,
                    ))

            copied_session = factory.call_args.args[0]
            try:
                self.assertFalse(copied_session.parent.exists())
            finally:
                shutil.rmtree(copied_session.parent, ignore_errors=True)

    def test_retry_exhaustion_skips_invalid_command_and_archives_the_other_command(self) -> None:
        exhausted_replies = {
            "timeout": [None, None],
            "wrong sender": [
                telegram_reply(EU_FIXTURE, sender_username="otherbot"),
                telegram_reply(EU_FIXTURE, sender_username="otherbot"),
            ],
            "stale message": [
                telegram_reply(EU_FIXTURE, message_offset=0),
                telegram_reply(EU_FIXTURE, message_offset=0),
            ],
        }
        with TemporaryDirectory() as temporary_directory:
            temporary_path = Path(temporary_directory)
            source_session = self._source_session(temporary_path)
            for case_name, eu_replies in exhausted_replies.items():
                with self.subTest(case=case_name):
                    archive = fuelsight_prices.FuelSightArchive(temporary_path / case_name / "reports/prices")
                    gateway = FakeTelegramGateway({
                        "/eu": eu_replies,
                        "/apag": [telegram_reply(APAG_FIXTURE)],
                    })
                    with patch.object(fuelsight_prices, "_create_telegram_gateway", return_value=gateway):
                        snapshots = asyncio.run(fuelsight_prices.fetch_fuelsight_capture(
                            "afternoon",
                            datetime.fromisoformat("2026-07-13T14:30:00+08:00"),
                            self._config(source_session),
                            archive,
                        ))

                    self.assertEqual([snapshot.command for snapshot in snapshots], ["/apag"])
                    self.assertIsNone(archive.find_snapshot("/eu", date(2026, 7, 10)))
                    self.assertIsNotNone(archive.find_snapshot("/apag", date(2026, 7, 10)))
                    self.assertEqual(gateway.commands, ["/eu", "/eu", "/apag"])


class FuelSightCliTests(unittest.TestCase):
    def test_fetch_mode_off_does_not_open_telegram_or_create_price_root(self) -> None:
        with TemporaryDirectory() as directory:
            price_root = Path(directory) / "prices"
            with patch.dict(os.environ, {"DAILY_PRICE_MODE": "off", "DAILY_PRICE_ROOT": str(price_root)}), \
                    patch("intelligence.fuelsight_prices.fetch_fuelsight_capture") as fetch:
                result = fuelsight_prices.main([
                    "fetch",
                    "--slot", "morning",
                    "--requested-at", "2026-07-14T10:30:00+08:00",
                ])

            self.assertEqual(result, 0)
            fetch.assert_not_called()
            self.assertFalse(price_root.exists())

    def test_fetch_fails_when_no_valid_snapshot_is_produced(self) -> None:
        with TemporaryDirectory() as directory, patch.dict(
            "os.environ", {"DAILY_PRICE_ROOT": str(Path(directory) / "prices")}
        ), patch.object(
            fuelsight_prices, "fetch_fuelsight_capture", AsyncMock(return_value=[])
        ), patch.object(
            fuelsight_prices, "load_fuelsight_client_config", return_value=Mock()
        ), patch.object(fuelsight_prices, "materialize_bot_candidates") as materialize:
            with self.assertRaises(RuntimeError):
                fuelsight_prices.main([
                    "fetch", "--slot", "morning", "--requested-at", "2026-07-13T10:30:00+08:00"
                ])
        materialize.assert_not_called()

    def test_fetch_materializes_each_market_date_then_reconciles_shared_root(self) -> None:
        snapshot = parse_fuelsight_response(response("/eu", EU_FIXTURE))
        events: list[tuple[str, object]] = []
        with TemporaryDirectory() as directory, patch.dict(
            "os.environ", {"DAILY_PRICE_ROOT": str(Path(directory) / "prices")}
        ), patch.object(
            fuelsight_prices, "fetch_fuelsight_capture", AsyncMock(return_value=[snapshot])
        ), patch.object(
            fuelsight_prices, "load_fuelsight_client_config", return_value=Mock()
        ), patch.object(
            fuelsight_prices,
            "materialize_bot_candidates",
            side_effect=lambda market_date, _archive: events.append(("materialize", market_date)),
        ), patch.object(
            daily_prices,
            "reconcile_saved_report",
            side_effect=lambda market_date, _reports, _prices: events.append(("reconcile", market_date)),
        ), redirect_stdout(io.StringIO()):
            exit_code = fuelsight_prices.main([
                "fetch", "--slot", "morning", "--requested-at", "2026-07-13T10:30:00+08:00"
            ])

        self.assertEqual(exit_code, 0)
        self.assertEqual(events, [("materialize", TARGET_DATE), ("reconcile", TARGET_DATE)])

    def test_list_command_accepts_market_date(self) -> None:
        self.assertTrue(hasattr(fuelsight_prices, "main"))
        output = io.StringIO()

        with TemporaryDirectory() as directory, patch.dict(
            "os.environ", {"DAILY_PRICE_ROOT": str(Path(directory) / "prices")}
        ), redirect_stdout(output):
            exit_code = fuelsight_prices.main(["list", "--market-date", "2026-07-10"])

        self.assertEqual(exit_code, 0)
        self.assertEqual(json.loads(output.getvalue()), [])


if __name__ == "__main__":
    unittest.main()

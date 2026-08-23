import argparse
import asyncio
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Literal, Protocol

from intelligence.daily_price_models import DailyPriceCandidate
from intelligence.daily_prices import atomic_write_json, resolve_daily_price_root


SCHEMA_VERSION = "1.0"
PARSER_VERSION = "1.0.0"
PRODUCT_ALIASES = {
    "Prem unl": "Premium Gasoline",
    "ULSD": "ULSD 10ppm",
    "ULSD 10": "ULSD 10ppm",
    "Diesel 10": "Diesel 10ppm",
    "Gasoil 10": "Gasoil 10ppm",
}

TITLE_PATTERN = re.compile(
    r"^(?:🇪🇺\s*)?European Products - (?P<date>\d{2} [A-Za-z]{3} \d{4})$"
    r"|^(?:⛽\s*)?APAG Products - (?P<apag_date>\d{2} [A-Za-z]{3} \d{4})$"
)
PRICE_PATTERN = re.compile(
    r"^(?P<product>.+?)\s{2,}(?P<price>n/a|\$\s*[\d ]+\.\d{2})"
    r"(?:\s+\(\s*(?P<change>[+-]\s*[\d ]+\.\d{2})\s*\))?$",
    re.IGNORECASE,
)


class FuelSightParseError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class FuelSightResponse:
    command: Literal["/eu", "/apag"]
    command_message_id: int
    response_message_id: int
    requested_at: str
    response_timestamp: str
    raw_text: str


@dataclass(frozen=True, slots=True)
class FuelSightSnapshot:
    schema_version: str
    command: Literal["/eu", "/apag"]
    market_date: str
    command_message_id: int
    response_message_id: int
    requested_at: str
    response_timestamp: str
    parser_version: str
    candidates: tuple[DailyPriceCandidate, ...]


@dataclass(frozen=True, slots=True)
class FuelSightClientConfig:
    api_id: int
    api_hash: str
    source_session: Path
    bot_username: str
    timeout_seconds: int
    max_attempts: int


@dataclass(frozen=True, slots=True)
class FuelSightTelegramMessage:
    id: int
    sender_username: str | None
    raw_text: str
    timestamp: str


class FuelSightTelegramGateway(Protocol):
    async def connect(self) -> None: ...
    async def disconnect(self) -> None: ...
    async def send_command(self, bot_username: str, command: str) -> int: ...
    async def wait_for_response(
        self,
        bot_username: str,
        command_message_id: int,
        timeout_seconds: int,
    ) -> FuelSightTelegramMessage | None: ...


class FuelSightArchive:
    def __init__(self, reports_directory: Path | None = None) -> None:
        self.reports_directory = reports_directory or resolve_daily_price_root()

    def save_capture(
        self,
        slot: str,
        requested_at: datetime,
        responses: list[FuelSightResponse],
    ) -> Path:
        capture_directory = self._capture_directory(slot, requested_at)
        capture_directory.mkdir(parents=True, exist_ok=True)
        for response in responses:
            command_name = response.command.removeprefix("/")
            (capture_directory / f"fuelsight_{command_name}_raw.txt").write_text(
                response.raw_text,
                encoding="utf-8",
            )
        request = {
            "slot": slot,
            "requested_at": requested_at.isoformat(),
            "responses": [
                {
                    "command": response.command,
                    "command_message_id": response.command_message_id,
                    "response_message_id": response.response_message_id,
                    "requested_at": response.requested_at,
                    "response_timestamp": response.response_timestamp,
                }
                for response in responses
            ],
        }
        (capture_directory / "request.json").write_text(
            json.dumps(request, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return capture_directory

    def save_snapshot(self, snapshot: FuelSightSnapshot) -> Path:
        snapshot_directory = self.reports_directory / snapshot.market_date / "snapshots"
        snapshot_directory.mkdir(parents=True, exist_ok=True)
        command_name = snapshot.command.removeprefix("/")
        snapshot_path = snapshot_directory / f"fuelsight_{command_name}_{snapshot.response_message_id}.json"
        snapshot_path.write_text(
            json.dumps(_snapshot_to_dict(snapshot), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return snapshot_path

    def find_snapshot(self, command: str, market_date: date) -> FuelSightSnapshot | None:
        snapshot_directory = self.reports_directory / market_date.isoformat() / "snapshots"
        if not snapshot_directory.exists():
            return None
        command_name = command.removeprefix("/")
        snapshots = [
            _snapshot_from_dict(json.loads(path.read_text(encoding="utf-8")))
            for path in snapshot_directory.glob(f"fuelsight_{command_name}_*.json")
        ]
        if not snapshots:
            return None
        return max(snapshots, key=lambda snapshot: snapshot.response_message_id)

    def find_capture(self, slot: str, requested_at: datetime) -> list[FuelSightResponse] | None:
        request_path = self._capture_directory(slot, requested_at) / "request.json"
        if not request_path.exists():
            return None
        request = json.loads(request_path.read_text(encoding="utf-8"))
        responses = []
        for response_data in request["responses"]:
            command_name = response_data["command"].removeprefix("/")
            raw_text = (request_path.parent / f"fuelsight_{command_name}_raw.txt").read_text(encoding="utf-8")
            responses.append(FuelSightResponse(raw_text=raw_text, **response_data))
        return responses

    def _capture_directory(self, slot: str, requested_at: datetime) -> Path:
        identity = f"{slot}:{requested_at.isoformat()}".encode("utf-8")
        run_id = hashlib.sha256(identity).hexdigest()[:16]
        return self.reports_directory / "captures" / requested_at.date().isoformat() / run_id


def materialize_bot_candidates(
    market_date: date,
    archive: FuelSightArchive | None = None,
) -> Path:
    selected_archive = archive or FuelSightArchive()
    snapshots = [
        snapshot
        for command in ("/eu", "/apag")
        if (snapshot := selected_archive.find_snapshot(command, market_date)) is not None
    ]
    if not snapshots:
        raise FileNotFoundError(f"No FuelSight snapshots found for {market_date.isoformat()}")
    candidates = [
        candidate
        for snapshot in snapshots
        for candidate in snapshot.candidates
    ]
    output = selected_archive.reports_directory / market_date.isoformat() / "bot_candidates.json"
    atomic_write_json(output, [
        {
            "schema_version": candidate.schema_version,
            "market_date": candidate.market_date,
            "region": candidate.region,
            "location": candidate.location,
            "product": candidate.product,
            "price_raw": candidate.price_raw,
            "price": str(candidate.price) if candidate.price is not None else None,
            "change_raw": candidate.change_raw,
            "change": str(candidate.change) if candidate.change is not None else None,
            "currency": candidate.currency,
            "unit": candidate.unit,
            "source_type": candidate.source_type,
            "source_id": candidate.source_id,
            "confidence": candidate.confidence,
            "evidence": candidate.evidence,
        }
        for candidate in candidates
    ])
    return output


async def fetch_fuelsight_capture(
    slot: Literal["morning", "afternoon", "evening"],
    requested_at: datetime,
    config: FuelSightClientConfig,
    archive: FuelSightArchive,
) -> list[FuelSightSnapshot]:
    existing_responses = archive.find_capture(slot, requested_at) or []
    responses_by_command = {response.command: response for response in existing_responses}
    commands: tuple[Literal["/eu", "/apag"], ...] = ("/eu", "/apag")

    if len(responses_by_command) < len(commands):
        run_directory = Path("tmp") / "telegram" / "fuelsight" / uuid.uuid4().hex
        copied_session = run_directory / "client.session"
        gateway: FuelSightTelegramGateway | None = None
        try:
            run_directory.mkdir(parents=True, exist_ok=False)
            _backup_session(config.source_session, copied_session)
            gateway = _create_telegram_gateway(copied_session, config)
            await gateway.connect()
            for command in commands:
                if command in responses_by_command:
                    continue
                response = await _fetch_command(gateway, command, requested_at, config)
                if response is not None:
                    responses_by_command[command] = response
        finally:
            try:
                if gateway is not None:
                    await gateway.disconnect()
            finally:
                shutil.rmtree(run_directory, ignore_errors=True)

    responses = [responses_by_command[command] for command in commands if command in responses_by_command]
    archive.save_capture(slot, requested_at, responses)
    snapshots = []
    for response in responses:
        try:
            snapshot = parse_fuelsight_response(response)
        except FuelSightParseError:
            continue
        archive.save_snapshot(snapshot)
        snapshots.append(snapshot)
    return snapshots


async def _fetch_command(
    gateway: FuelSightTelegramGateway,
    command: Literal["/eu", "/apag"],
    requested_at: datetime,
    config: FuelSightClientConfig,
) -> FuelSightResponse | None:
    expected_sender = config.bot_username.removeprefix("@").lower()
    for _ in range(config.max_attempts):
        command_message_id = await gateway.send_command(config.bot_username, command)
        message = await gateway.wait_for_response(
            config.bot_username,
            command_message_id,
            config.timeout_seconds,
        )
        if message is None:
            continue
        sender = (message.sender_username or "").removeprefix("@").lower()
        if sender != expected_sender or message.id <= command_message_id:
            continue
        return FuelSightResponse(
            command=command,
            command_message_id=command_message_id,
            response_message_id=message.id,
            requested_at=requested_at.isoformat(),
            response_timestamp=message.timestamp,
            raw_text=message.raw_text,
        )
    return None


def _backup_session(source_session: Path, copied_session: Path) -> None:
    source_path = _session_file_path(source_session)
    if not source_path.exists():
        raise FileNotFoundError(f"Telegram session file does not exist: {source_path}")
    source_connection = sqlite3.connect(f"{source_path.resolve().as_uri()}?mode=ro", uri=True)
    destination_connection = sqlite3.connect(copied_session)
    try:
        source_connection.backup(destination_connection)
    finally:
        destination_connection.close()
        source_connection.close()


def _session_file_path(session_path: Path) -> Path:
    return session_path if session_path.suffix == ".session" else session_path.with_suffix(".session")


class _TelethonGateway:
    def __init__(self, session_path: Path, config: FuelSightClientConfig) -> None:
        from telethon import TelegramClient

        self.client = TelegramClient(str(session_path), config.api_id, config.api_hash)

    async def connect(self) -> None:
        await self.client.connect()

    async def disconnect(self) -> None:
        await self.client.disconnect()

    async def send_command(self, bot_username: str, command: str) -> int:
        message = await self.client.send_message(bot_username, command)
        return message.id

    async def wait_for_response(
        self,
        bot_username: str,
        command_message_id: int,
        timeout_seconds: int,
    ) -> FuelSightTelegramMessage | None:
        deadline = asyncio.get_running_loop().time() + timeout_seconds
        while asyncio.get_running_loop().time() < deadline:
            async for message in self.client.iter_messages(bot_username, min_id=command_message_id, limit=20):
                sender = await message.get_sender()
                return FuelSightTelegramMessage(
                    id=message.id,
                    sender_username=getattr(sender, "username", None),
                    raw_text=message.raw_text or "",
                    timestamp=message.date.isoformat(),
                )
            await asyncio.sleep(1)
        return None


def _create_telegram_gateway(
    session_path: Path,
    config: FuelSightClientConfig,
) -> FuelSightTelegramGateway:
    return _TelethonGateway(session_path, config)


EU_LOCATIONS = {
    "FOB Med": ("Europe", "FOB Med"),
    "CIF Med": ("Europe", "CIF Med"),
    "FOB NWE": ("Europe", "FOB NWE"),
    "CIF NWE ARA": ("Europe", "CIF NWE ARA"),
    "Barges Rotterdam": ("Europe", "Barges Rotterdam"),
}
APAG_LOCATIONS = {
    "Singapore FOB ($/mt)": ("Singapore", "Singapore FOB"),
    "Fujairah FOB ($/mt)": ("Fujairah", "Fujairah FOB"),
    "Arab Gulf FOB ($/mt)": ("Arab Gulf", "Arab Gulf"),
    "MOPJ ($/mt)": ("MOPJ", "MOPJ"),
}


def parse_fuelsight_market_date(raw_text: str) -> date:
    for line in raw_text.splitlines():
        match = TITLE_PATTERN.fullmatch(line.strip())
        if not match:
            continue
        title_date = match.group("date") or match.group("apag_date")
        try:
            return datetime.strptime(title_date, "%d %b %Y").date()
        except ValueError as error:
            raise FuelSightParseError("FuelSight title has an invalid market date") from error
    raise FuelSightParseError("FuelSight response is missing a supported title date")


def parse_fuelsight_response(response: FuelSightResponse) -> FuelSightSnapshot:
    if response.command not in ("/eu", "/apag"):
        raise FuelSightParseError("FuelSight command is unsupported")
    if response.response_message_id <= response.command_message_id:
        raise FuelSightParseError("FuelSight response message must follow its command message")

    market_date = parse_fuelsight_market_date(response.raw_text).isoformat()
    locations = EU_LOCATIONS if response.command == "/eu" else APAG_LOCATIONS
    candidates: list[DailyPriceCandidate] = []
    seen_keys: set[tuple[str, str, str]] = set()
    active_location: tuple[str, str] | None = None

    for line_number, raw_line in enumerate(response.raw_text.splitlines(), start=1):
        line = raw_line.strip()
        if not line or TITLE_PATTERN.fullmatch(line) or line == "All prices $/mt":
            continue
        price_match = PRICE_PATTERN.fullmatch(line)
        if price_match:
            if active_location is None:
                raise FuelSightParseError("FuelSight price appeared before a location heading")
            region, location = active_location
            product_raw = price_match.group("product").strip()
            product = PRODUCT_ALIASES.get(product_raw, product_raw)
            key = (region, location, product)
            if key in seen_keys:
                raise FuelSightParseError(f"Duplicate FuelSight price key: {key}")
            seen_keys.add(key)
            price_raw = price_match.group("price").strip()
            change_raw = price_match.group("change")
            normalized_change = _normalize_number(change_raw) if change_raw else None
            candidates.append(DailyPriceCandidate(
                schema_version=SCHEMA_VERSION,
                market_date=market_date,
                region=region,
                location=location,
                product=product,
                price_raw=price_raw,
                price=None if price_raw.lower() == "n/a" else Decimal(_normalize_number(price_raw)),
                change_raw=normalized_change,
                change=Decimal(normalized_change) if normalized_change else None,
                currency="USD",
                unit="USD/MT",
                source_type="fuelsight_bot",
                source_id=str(response.response_message_id),
                confidence=1.0,
                evidence={
                    "command": response.command,
                    "line_number": line_number,
                    "raw_line": raw_line,
                    "product_raw": product_raw,
                },
            ))
            continue
        try:
            active_location = locations[line]
        except KeyError as error:
            raise FuelSightParseError(f"Unknown FuelSight location heading: {line}") from error

    if not candidates:
        raise FuelSightParseError("FuelSight response contains no price candidates")
    return FuelSightSnapshot(
        schema_version=SCHEMA_VERSION,
        command=response.command,
        market_date=market_date,
        command_message_id=response.command_message_id,
        response_message_id=response.response_message_id,
        requested_at=response.requested_at,
        response_timestamp=response.response_timestamp,
        parser_version=PARSER_VERSION,
        candidates=tuple(candidates),
    )


def _normalize_number(raw_value: str) -> str:
    return raw_value.replace("$", "").replace(" ", "").strip()


def _snapshot_to_dict(snapshot: FuelSightSnapshot) -> dict[str, object]:
    return {
        "schema_version": snapshot.schema_version,
        "command": snapshot.command,
        "market_date": snapshot.market_date,
        "command_message_id": snapshot.command_message_id,
        "response_message_id": snapshot.response_message_id,
        "requested_at": snapshot.requested_at,
        "response_timestamp": snapshot.response_timestamp,
        "parser_version": snapshot.parser_version,
        "candidates": [
            {
                "schema_version": candidate.schema_version,
                "market_date": candidate.market_date,
                "region": candidate.region,
                "location": candidate.location,
                "product": candidate.product,
                "price_raw": candidate.price_raw,
                "price": str(candidate.price) if candidate.price is not None else None,
                "change_raw": candidate.change_raw,
                "change": str(candidate.change) if candidate.change is not None else None,
                "currency": candidate.currency,
                "unit": candidate.unit,
                "source_type": candidate.source_type,
                "source_id": candidate.source_id,
                "confidence": candidate.confidence,
                "evidence": candidate.evidence,
            }
            for candidate in snapshot.candidates
        ],
    }


def _snapshot_from_dict(data: dict[str, object]) -> FuelSightSnapshot:
    candidates = tuple(
        DailyPriceCandidate(
            schema_version=candidate["schema_version"],
            market_date=candidate["market_date"],
            region=candidate["region"],
            location=candidate["location"],
            product=candidate["product"],
            price_raw=candidate["price_raw"],
            price=Decimal(candidate["price"]) if candidate["price"] is not None else None,
            change_raw=candidate["change_raw"],
            change=Decimal(candidate["change"]) if candidate["change"] is not None else None,
            currency=candidate["currency"],
            unit=candidate["unit"],
            source_type=candidate["source_type"],
            source_id=candidate["source_id"],
            confidence=candidate["confidence"],
            evidence=candidate["evidence"],
        )
        for candidate in data["candidates"]
    )
    return FuelSightSnapshot(
        schema_version=data["schema_version"],
        command=data["command"],
        market_date=data["market_date"],
        command_message_id=data["command_message_id"],
        response_message_id=data["response_message_id"],
        requested_at=data["requested_at"],
        response_timestamp=data["response_timestamp"],
        parser_version=data["parser_version"],
        candidates=candidates,
    )


def load_fuelsight_client_config(
    config_path: Path = Path("intelligence/config/daily_prices.yaml"),
) -> FuelSightClientConfig:
    import yaml

    configuration = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    fuelsight = configuration["fuelsight"]
    return FuelSightClientConfig(
        api_id=int(os.environ["TELEGRAM_API_ID"]),
        api_hash=os.environ["TELEGRAM_API_HASH"],
        source_session=Path(os.getenv("TELEGRAM_SESSION_FILE", "tmp/telegram/eti_telegram")),
        bot_username=os.getenv("FUELSIGHT_BOT_USERNAME", fuelsight["bot_username"]),
        timeout_seconds=int(os.getenv("FUELSIGHT_COMMAND_TIMEOUT_SECONDS", fuelsight["timeout_seconds"])),
        max_attempts=int(os.getenv("FUELSIGHT_MAX_ATTEMPTS", fuelsight["max_attempts"])),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Capture and archive FuelSight daily prices")
    subparsers = parser.add_subparsers(dest="command", required=True)
    fetch_parser = subparsers.add_parser("fetch")
    fetch_parser.add_argument("--slot", choices=("morning", "afternoon", "evening"), required=True)
    fetch_parser.add_argument("--requested-at", type=datetime.fromisoformat, required=True)
    list_parser = subparsers.add_parser("list")
    list_parser.add_argument("--market-date", type=date.fromisoformat, required=True)
    args = parser.parse_args(argv)
    archive = FuelSightArchive()

    if args.command == "fetch":
        if os.getenv("DAILY_PRICE_MODE", "shadow").strip().lower() == "off":
            print(json.dumps({"skipped": True, "reason": "daily_price_mode_off"}))
            return 0
        snapshots = asyncio.run(fetch_fuelsight_capture(
            args.slot,
            args.requested_at,
            load_fuelsight_client_config(),
            archive,
        ))
        if not snapshots:
            raise RuntimeError(
                f"FuelSight fetch produced no valid snapshots for slot {args.slot}"
            )
        from intelligence import daily_prices

        for market_date in sorted({date.fromisoformat(snapshot.market_date) for snapshot in snapshots}):
            materialize_bot_candidates(market_date, archive)
            daily_prices.reconcile_saved_report(
                market_date,
                archive.reports_directory.parent,
                archive.reports_directory,
            )
        print(json.dumps([
            {
                "command": snapshot.command,
                "market_date": snapshot.market_date,
                "response_message_id": snapshot.response_message_id,
            }
            for snapshot in snapshots
        ], ensure_ascii=False))
        return 0

    snapshots = [
        snapshot
        for command in ("/eu", "/apag")
        if (snapshot := archive.find_snapshot(command, args.market_date)) is not None
    ]
    print(json.dumps([
        {
            "command": snapshot.command,
            "market_date": snapshot.market_date,
            "response_message_id": snapshot.response_message_id,
        }
        for snapshot in snapshots
    ], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

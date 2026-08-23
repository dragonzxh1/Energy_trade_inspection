import argparse
import hashlib
import json
import os
import re
import sys
import uuid
from dataclasses import asdict, dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo

from intelligence.daily_price_models import DailyPriceCandidate
from platts_ocr.trials.contracts import PlattsSummaryTrialResult


SCHEMA_VERSION = "daily-prices.v1"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
EXPECTED_PUBLIC_BENCHMARK_COUNT = 18
PriceStatus = Literal["cross_verified", "bot_only", "ocr_only", "conflict", "unavailable"]
ReleaseStatus = Literal["waiting_for_prices", "ready_with_prices", "ready_without_prices", "published"]
BusinessKey = tuple[str, str, str, str, str, str]
LOCATION_ALIASES = {
    "FOB Med": ("Europe", "FOB Med"),
    "CIF NWE": ("Europe", "CIF NWE ARA"),
    "CIF NWE ARA": ("Europe", "CIF NWE ARA"),
    "FOB Rott": ("Europe", "Barges Rotterdam"),
    "Barges Rotterdam": ("Europe", "Barges Rotterdam"),
    "FOB Sing (MOPS)": ("Singapore", "Singapore FOB"),
    "Singapore FOB": ("Singapore", "Singapore FOB"),
    "FOB AG (MOPAG)": ("Arab Gulf", "Arab Gulf"),
    "Arab Gulf": ("Arab Gulf", "Arab Gulf"),
    "MOPJ": ("MOPJ", "MOPJ"),
}
PUBLIC_REGION_NAMES = {
    "Europe": "欧洲市场",
    "Singapore": "亚太与中东",
    "Arab Gulf": "亚太与中东",
    "MOPJ": "亚太与中东",
}
PUBLIC_LOCATION_NAMES = {
    "Singapore FOB": "Singapore",
    "CIF NWE ARA": "CIF NWE",
    "Barges Rotterdam": "Rotterdam",
}
PUBLIC_PRODUCT_NAMES = {
    "Naphtha": "石脑油",
    "Premium Gasoline": "高标号汽油",
    "ULSD 10ppm": "低硫柴油",
    "Diesel 10ppm": "低硫柴油",
    "Gasoil 10ppm": "低硫柴油",
    "Gasoil 0.1": "低硫柴油",
    "Jet": "航空煤油",
    "FO 1%": "低硫燃料油",
    "Gasoline 95": "95号汽油",
    "Gasoline 92": "92号汽油",
    "HSFO 380": "高硫燃料油",
}


def resolve_daily_price_root() -> Path:
    configured = os.getenv("DAILY_PRICE_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser()
    vault = Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault"))
    return vault / "reports" / "prices"


@dataclass(frozen=True, slots=True)
class FusedDailyPrice:
    market_date: str
    region: str
    location: str
    canonical_product: str
    currency: str
    unit: str
    price: Decimal | None
    change: Decimal | None
    status: PriceStatus
    image_source_ids: tuple[str, ...]
    bot_source_ids: tuple[str, ...]
    reasons: tuple[str, ...]
    display_name: str | None = None

    @property
    def business_key(self) -> BusinessKey:
        return (
            self.market_date,
            self.region,
            self.location,
            self.canonical_product,
            self.currency,
            self.unit,
        )


@dataclass(frozen=True, slots=True)
class DailyPriceFusionResult:
    schema_version: str
    target_market_date: str
    prices: tuple[FusedDailyPrice, ...]
    excluded_count: int
    reasons: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class PublicPriceSelection:
    prices: tuple[FusedDailyPrice, ...]
    expected_keys: tuple[BusinessKey, ...]
    selected_keys: tuple[BusinessKey, ...]
    missing_keys: tuple[BusinessKey, ...]
    conflict_keys: tuple[BusinessKey, ...]
    unavailable_keys: tuple[BusinessKey, ...]
    configuration_issues: tuple[str, ...]

    @property
    def ready(self) -> bool:
        return (
            not self.configuration_issues
            and len(self.expected_keys) == EXPECTED_PUBLIC_BENCHMARK_COUNT
            and len(set(self.expected_keys)) == EXPECTED_PUBLIC_BENCHMARK_COUNT
            and self.selected_keys == self.expected_keys
            and not self.missing_keys
            and not self.conflict_keys
            and not self.unavailable_keys
        )

    def quality_payload(self) -> dict[str, Any]:
        return {
            "expected": _quality_key_group(self.expected_keys),
            "selected": _quality_key_group(self.selected_keys),
            "missing": _quality_key_group(self.missing_keys),
            "conflict": _quality_key_group(self.conflict_keys),
            "unavailable": _quality_key_group(self.unavailable_keys),
            "configuration_issues": list(self.configuration_issues),
        }


@dataclass(frozen=True, slots=True)
class PriceReleaseState:
    schema_version: str
    report_date: str
    target_market_date: str
    content_ready: bool
    price_ready: bool
    reference_image_ready: bool
    wait_deadline: str
    status: ReleaseStatus
    reasons: tuple[str, ...]
    missing_benchmarks: tuple[str, ...] = ()
    last_capture_at: str | None = None
    next_retry_at: str | None = None
    image_quote_ready: bool = False
    image_draft_created: bool = False
    bot_confirmation_received: bool = False
    structured_price_verified: bool = False
    historical_comparison_ready: bool = False
    needs_review: bool = False
    blocking_reasons: tuple[str, ...] = ()
    image_market_date: str | None = None
    image_date_confidence: float | None = None
    image_quote_status: str = "pending"
    image_draft_media_id: str | None = None
    bot_confirmation_status: str = "pending"
    structured_verification_status: str = "pending"
    comparison_eligible: bool = False
    last_reconciliation_at: str | None = None
    reconciliation_issues: tuple[str, ...] = ()


def format_price_appendix_markdown(target_date: date, prices: list[FusedDailyPrice]) -> str:
    public_prices = [price for price in prices if price.price is not None and price.change is not None]
    if not public_prices:
        return ""
    lines = [
        "## 今日价格速览",
        "",
        f"市场日期：{target_date.year}年{target_date.month}月{target_date.day}日｜单位：美元/吨",
        "",
    ]
    for price in public_prices:
        region = PUBLIC_REGION_NAMES.get(price.region, price.region)
        product = PUBLIC_PRODUCT_NAMES.get(price.canonical_product, price.canonical_product)
        location = PUBLIC_LOCATION_NAMES.get(price.location, price.location)
        lines.append(
            f"- {region}｜{product}｜{location}｜{price.price:,.2f}｜{price.change:+,.2f}"
        )
    return "\n".join(lines)


def append_price_appendix(markdown: str, appendix: str) -> str:
    normalized_appendix = appendix.strip()
    if not normalized_appendix:
        return markdown
    trailing_newline = markdown.endswith("\n")
    without_prices = re.sub(
        r"(?ms)^## 今日价格速览[^\S\r\n]*(?:\r?\n|\Z).*?(?=^## |\Z)",
        "",
        markdown,
    )
    without_prices = re.sub(r"\n{3,}", "\n\n", without_prices).strip()
    reference = re.search(r"(?m)^## (?:参考资料|参考范围)[^\S\r\n]*$", without_prices)
    if reference:
        result = (
            without_prices[:reference.start()].rstrip()
            + "\n\n"
            + normalized_appendix
            + "\n\n"
            + without_prices[reference.start():].lstrip()
        )
    else:
        result = without_prices + "\n\n" + normalized_appendix
    return result + ("\n" if trailing_newline else "")


def load_image_candidates(target_date: date, trial_result: Path) -> list[DailyPriceCandidate]:
    result = PlattsSummaryTrialResult.from_dict(json.loads(trial_result.read_text(encoding="utf-8")))
    if result.market_date_source != "image_title":
        raise ValueError("OCR market date must be sourced from image_title")
    if result.market_date != target_date.isoformat():
        return []
    candidates: list[DailyPriceCandidate] = []
    for index, record in enumerate(result.records):
        if record.record_type != "price":
            continue
        raw_location = record.location or record.code
        if raw_location is None:
            raise ValueError("OCR price record is missing location and code")
        region, location = _normalize_location(None, raw_location)
        candidates.append(DailyPriceCandidate(
            schema_version=SCHEMA_VERSION,
            market_date=result.market_date,
            region=region,
            location=location,
            product=record.product,
            price_raw=record.mid_raw,
            price=Decimal(str(record.mid)) if record.mid is not None else None,
            change_raw=record.change_raw,
            change=Decimal(str(record.change)) if record.change is not None else None,
            currency=record.currency,
            unit=record.unit,
            source_type="image_ocr",
            source_id=f"{result.image_id}:{index}",
            confidence=record.confidence,
            evidence={
                "parser": result.parser,
                "image_sha256": result.image_sha256,
                "record_type": record.record_type,
                "location_raw": record.location,
                "code": record.code,
                "mid_raw": record.mid_raw,
                "change_raw": record.change_raw,
                "market_date_source": result.market_date_source,
            },
        ))
    return candidates


def promote_image_candidates(
    target_date: date,
    trial_result: Path,
    prices_dir: Path | None = None,
    *,
    source_image: Path | None = None,
    qr_image: Path | None = None,
) -> Path:
    trial = PlattsSummaryTrialResult.from_dict(json.loads(trial_result.read_text(encoding="utf-8")))
    if trial.market_date_source != "image_title":
        raise ValueError("OCR market date must be sourced from image_title")
    if trial.market_date != target_date.isoformat():
        raise ValueError(
            f"Approved OCR trial market date {trial.market_date} does not match {target_date.isoformat()}"
        )
    extracted_candidates = load_image_candidates(target_date, trial_result)
    candidates = [] if trial.review_reasons else extracted_candidates
    target_directory = (prices_dir or resolve_daily_price_root()) / target_date.isoformat()
    target_directory.mkdir(parents=True, exist_ok=True)
    if source_image is not None:
        source_image = Path(source_image)
        source_sha256 = hashlib.sha256(source_image.read_bytes()).hexdigest()
        if source_sha256 != trial.image_sha256:
            raise ValueError("Approved OCR trial image hash does not match source image")
    output = target_directory / "image_candidates.json"
    atomic_write_json(output, [_candidate_to_dict(item) for item in candidates])
    atomic_write_json(target_directory / "image_promotion.json", {
        "schema_version": SCHEMA_VERSION,
        "target_market_date": target_date.isoformat(),
        "image_id": trial.image_id,
        "image_sha256": trial.image_sha256,
        "market_date_source": trial.market_date_source,
        "parser": trial.parser,
        "source_image_path": str(source_image.resolve()) if source_image is not None else "",
        "review_reasons": list(trial.review_reasons),
        "review_status": "blocked_unresolved_review" if trial.review_reasons else "clear",
        "ocr_candidates_extracted": len(extracted_candidates),
        "ocr_candidates_promoted": len(candidates),
    })
    if source_image is not None:
        _generate_public_reference(
            source_image,
            Path(qr_image) if qr_image is not None else None,
            target_directory,
        )
    return output


def promote_summary_image_quote(
    target_date: date | None,
    source_image: Path,
    prices_dir: Path | None = None,
    *,
    qr_image: Path | None = None,
) -> Path:
    """Promote a complete Summary image using only its title date, without price OCR."""
    from intelligence.public_price_image import validate_public_price_image
    from platts_ocr.trials.normalization import detect_market_date_from_image_title

    source_image = Path(source_image)
    if not source_image.is_file():
        raise ValueError(f"Summary source image does not exist: {source_image}")
    date_detection = detect_market_date_from_image_title(str(source_image))
    market_date = date_detection.market_date
    if not market_date:
        raise ValueError(
            "Summary market date could not be read from the image title: "
            f"{date_detection.failure_reason or 'MARKET_DATE_NOT_FOUND'}"
        )
    image_market_date = date.fromisoformat(market_date)
    if target_date is not None and image_market_date != target_date:
        raise ValueError(
            f"Summary image title date {market_date} does not match {target_date.isoformat()}"
        )
    target_date = image_market_date

    target_directory = (prices_dir or resolve_daily_price_root()) / target_date.isoformat()
    target_directory.mkdir(parents=True, exist_ok=True)
    source_sha256 = hashlib.sha256(source_image.read_bytes()).hexdigest()
    output = target_directory / "public_reference.png"
    manifest = target_directory / "public_reference_transform.json"
    if output.exists() or manifest.exists():
        if not output.is_file() or not manifest.is_file():
            raise ValueError("Summary public reference artifacts are incomplete")
        configuration = _load_config()["public_reference_image"]
        configured_qr = Path(qr_image) if qr_image is not None else Path(str(configuration["qr_path"]))
        resolved_qr = configured_qr if configured_qr.is_absolute() else PROJECT_ROOT / configured_qr
        validate_public_price_image(
            output,
            configuration,
            expected_source_sha256=source_sha256,
            source_path=source_image,
            qr_path=resolved_qr,
        )
    else:
        _generate_public_reference(
            source_image,
            Path(qr_image) if qr_image is not None else None,
            target_directory,
        )

    promotion_path = target_directory / "image_promotion.json"
    atomic_write_json(promotion_path, {
        "schema_version": SCHEMA_VERSION,
        "target_market_date": target_date.isoformat(),
        "image_id": source_image.stem,
        "image_sha256": source_sha256,
        "market_date_source": "image_title",
        "image_date_confidence": 1.0,
        "parser": "title_tesseract_consensus",
        "date_detection_version": date_detection.version,
        "date_match_count": date_detection.matched_count,
        "date_recognized_titles": list(date_detection.recognized_titles),
        "source_image_path": str(source_image.resolve()),
        "review_reasons": [],
        "review_status": "clear",
        "ocr_candidates_extracted": 0,
        "ocr_candidates_promoted": 0,
    })
    return promotion_path


def fuse_daily_prices(
    target_date: date,
    image: list[DailyPriceCandidate],
    bot: list[DailyPriceCandidate],
) -> DailyPriceFusionResult:
    target_market_date = target_date.isoformat()
    image_by_key, image_reasons, image_excluded = _candidates_for_target(
        target_market_date, image, "image_ocr", "image"
    )
    bot_by_key, bot_reasons, bot_excluded = _candidates_for_target(
        target_market_date, bot, "fuelsight_bot", "bot"
    )
    prices = tuple(
        _fuse_key(key, image_by_key.get(key, []), bot_by_key.get(key, []))
        for key in sorted(set(image_by_key) | set(bot_by_key))
    )
    return DailyPriceFusionResult(
        schema_version=SCHEMA_VERSION,
        target_market_date=target_market_date,
        prices=prices,
        excluded_count=image_excluded + bot_excluded,
        reasons=tuple(image_reasons + bot_reasons),
    )


def evaluate_public_price_selection(
    result: DailyPriceFusionResult,
    config: dict[str, Any],
) -> PublicPriceSelection:
    prices_by_key = {price.business_key: price for price in result.prices}
    selected: list[FusedDailyPrice] = []
    expected_keys: list[BusinessKey] = []
    selected_keys: list[BusinessKey] = []
    missing_keys: list[BusinessKey] = []
    conflict_keys: list[BusinessKey] = []
    unavailable_keys: list[BusinessKey] = []
    benchmarks = config.get("public_benchmarks", [])
    configuration_issues: list[str] = []
    if not isinstance(benchmarks, list):
        benchmarks = []
        configuration_issues.append("public_benchmarks_not_a_list")
    for benchmark in benchmarks:
        key = (
            result.target_market_date,
            str(benchmark["region"]),
            str(benchmark["location"]),
            str(benchmark["product"]),
            str(benchmark["currency"]),
            str(benchmark["unit"]),
        )
        expected_keys.append(key)
        price = prices_by_key.get(key)
        if price is None:
            missing_keys.append(key)
            continue
        if price.status == "conflict":
            conflict_keys.append(key)
            continue
        if (
            price.status not in {"cross_verified", "bot_only"}
            or price.price is None
            or price.change is None
        ):
            unavailable_keys.append(key)
            continue
        selected.append(_with_display_name(price, str(benchmark["name"])))
        selected_keys.append(key)
    if len(expected_keys) != EXPECTED_PUBLIC_BENCHMARK_COUNT:
        configuration_issues.append(
            f"public_benchmark_count={len(expected_keys)} expected={EXPECTED_PUBLIC_BENCHMARK_COUNT}"
        )
    if len(set(expected_keys)) != len(expected_keys):
        configuration_issues.append("duplicate_public_benchmark_keys")
    return PublicPriceSelection(
        prices=tuple(selected),
        expected_keys=tuple(expected_keys),
        selected_keys=tuple(selected_keys),
        missing_keys=tuple(missing_keys),
        conflict_keys=tuple(conflict_keys),
        unavailable_keys=tuple(unavailable_keys),
        configuration_issues=tuple(configuration_issues),
    )


def select_public_prices(result: DailyPriceFusionResult, config: dict[str, Any]) -> list[FusedDailyPrice]:
    return list(evaluate_public_price_selection(result, config).prices)


def _quality_key_group(keys: tuple[BusinessKey, ...]) -> dict[str, Any]:
    return {
        "count": len(keys),
        "keys": ["|".join(key) for key in keys],
    }


def _benchmark_quality_reasons(selection: PublicPriceSelection) -> list[str]:
    reasons = list(selection.configuration_issues)
    for status, keys in (
        ("missing", selection.missing_keys),
        ("conflict", selection.conflict_keys),
        ("unavailable", selection.unavailable_keys),
    ):
        reasons.extend(f"public_benchmark_{status}:{'|'.join(key)}" for key in keys)
    if selection.selected_keys != selection.expected_keys:
        reasons.append(
            f"public_benchmark_selected={len(selection.selected_keys)}/"
            f"{len(selection.expected_keys)}"
        )
    return _unique(reasons)


def compute_release_state(
    target_date: date,
    now: datetime,
    price_ready: bool,
    content_ready: bool,
    config: dict[str, Any] | None = None,
) -> PriceReleaseState:
    configuration = _merged_config(config)
    timezone = ZoneInfo(configuration["timezone"])
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    local_now = now.astimezone(timezone)
    deadline = _next_trading_deadline(target_date, configuration, timezone)
    del content_ready
    reasons: list[str] = []
    if not price_ready:
        reasons.append("prices_not_ready")

    if price_ready:
        status: ReleaseStatus = "ready_with_prices"
    elif local_now >= deadline:
        status = "ready_without_prices"
        reasons.append("price_wait_deadline_elapsed")
    else:
        status = "waiting_for_prices"
        if local_now < deadline:
            reasons.append("waiting_for_next_trading_day_deadline")

    return PriceReleaseState(
        schema_version=SCHEMA_VERSION,
        report_date=target_date.isoformat(),
        target_market_date=target_date.isoformat(),
        content_ready=True,
        price_ready=price_ready,
        reference_image_ready=False,
        wait_deadline=deadline.isoformat(),
        status=status,
        reasons=tuple(reasons),
    )


def reconcile_saved_report(
    target_date: date,
    reports_dir: Path,
    prices_dir: Path,
    *,
    now: datetime | None = None,
) -> PriceReleaseState:
    configuration = _load_config()
    target_directory = prices_dir / target_date.isoformat()
    target_directory.mkdir(parents=True, exist_ok=True)
    bot_refresh_reasons = _refresh_bot_candidates(target_date, prices_dir, target_directory)
    image_candidates, image_parse_reasons = _read_candidate_artifact(
        target_directory / "image_candidates.json", "image_ocr", "image"
    )
    if bot_refresh_reasons:
        bot_candidates, bot_parse_reasons = [], bot_refresh_reasons
    else:
        bot_candidates, bot_parse_reasons = _read_candidate_artifact(
            target_directory / "bot_candidates.json", "fuelsight_bot", "bot"
        )
    parse_reasons = image_parse_reasons + bot_parse_reasons
    fusion = fuse_daily_prices(target_date, image_candidates, bot_candidates)
    if parse_reasons:
        fusion = DailyPriceFusionResult(
            schema_version=fusion.schema_version,
            target_market_date=fusion.target_market_date,
            prices=fusion.prices,
            excluded_count=fusion.excluded_count,
            reasons=fusion.reasons + tuple(parse_reasons),
        )
    selection = evaluate_public_price_selection(fusion, configuration)
    selected = list(selection.prices)
    benchmark_reasons = _benchmark_quality_reasons(selection)
    completeness_reasons = _price_input_completeness(target_date, target_directory)
    reference_image_ready, reference_reasons = validate_public_reference(target_directory)
    completeness_reasons.extend(reference_reasons)
    image_quote_ready, image_quote_reasons, image_date_confidence = (
        evaluate_image_quote_readiness(target_date, target_directory, reference_image_ready)
    )
    price_ready = selection.ready and not [
        reason for reason in completeness_reasons
        if not reason.startswith("public_reference_")
    ] and not parse_reasons
    state = compute_release_state(
        target_date,
        now or datetime.now(ZoneInfo(configuration["timezone"])),
        price_ready=price_ready,
        content_ready=True,
        config=configuration,
    )
    state = PriceReleaseState(**{
        **asdict(state),
        "reference_image_ready": reference_image_ready,
        "reasons": state.reasons + tuple(
            parse_reasons + completeness_reasons + benchmark_reasons
        ),
        "missing_benchmarks": tuple("|".join(key) for key in selection.missing_keys),
        "last_capture_at": _last_capture_at(target_directory),
        "next_retry_at": _next_poll_at(
            now or datetime.now(ZoneInfo(configuration["timezone"])), configuration,
        ) if not price_ready else None,
        "image_quote_ready": image_quote_ready,
        "bot_confirmation_received": not bot_refresh_reasons and bool(bot_candidates),
        "structured_price_verified": price_ready,
        "historical_comparison_ready": price_ready,
        "needs_review": any("conflict" in reason for reason in benchmark_reasons),
        "blocking_reasons": tuple(image_quote_reasons),
        "image_market_date": target_date.isoformat() if image_quote_ready else None,
        "image_date_confidence": image_date_confidence,
        "image_quote_status": "ready" if image_quote_ready else "blocked",
        "bot_confirmation_status": "received" if not bot_refresh_reasons and bool(bot_candidates) else "pending",
        "structured_verification_status": "verified" if price_ready else "pending",
        "comparison_eligible": price_ready,
        "last_reconciliation_at": (now or datetime.now(ZoneInfo(configuration["timezone"]))).isoformat(),
        "reconciliation_issues": tuple(_unique(
            image_quote_reasons + parse_reasons + completeness_reasons + benchmark_reasons
        )),
    })

    _write_json(target_directory / "fusion.json", _fusion_to_dict(fusion))
    _write_json(target_directory / "selected_prices.json", [_fused_to_dict(item) for item in selected])
    _write_json(target_directory / "release_state.json", _release_state_to_dict(state))
    _write_summary_price_artifacts(target_date, reports_dir, state, selection, target_directory)
    persist_summary_publication_state(_release_state_to_dict(state))
    return state


def _write_summary_price_artifacts(
    target_date: date,
    reports_dir: Path,
    state: PriceReleaseState,
    selection: PublicPriceSelection,
    target_directory: Path,
) -> None:
    from intelligence.content_streams import (
        ArticleLocator,
        build_artifact_identity,
        resolve_article_paths,
    )

    locator = ArticleLocator("summary", target_date)
    paths = resolve_article_paths(locator, reports_dir)
    benchmark_quality = selection.quality_payload()
    if state.image_quote_ready:
        from intelligence.summary_price_article import (
            build_summary_image_article,
            write_summary_image_article,
        )

        article = build_summary_image_article(target_date)
        write_summary_image_article(
            article,
            reports_dir,
            reference_image=target_directory / "public_reference.png",
            structured_price_verified=state.structured_price_verified,
        )
        return
    if state.structured_price_verified:
        from intelligence.summary_price_article import (
            build_summary_price_article,
            write_summary_price_article,
        )

        article = build_summary_price_article(target_date, list(selection.prices))
        write_summary_price_article(
            article,
            reports_dir,
            benchmark_quality=benchmark_quality,
            release_status=state.status,
        )
        return
    markdown = paths.markdown.read_text(encoding="utf-8") if paths.markdown.is_file() else ""
    wechat_html = paths.wechat_html.read_text(encoding="utf-8") if paths.wechat_html.is_file() else ""
    summary = paths.summary.read_text(encoding="utf-8") if paths.summary.is_file() else ""
    _write_json(paths.quality_audit, {
        "schema_version": "summary-price-article.v1",
        "stream": "summary",
        "market_date": target_date.isoformat(),
        "status": "fail",
        "publishable": False,
        "release_status": state.status,
        "issues": list(state.reasons),
        **benchmark_quality,
        **build_artifact_identity(locator, markdown, wechat_html, summary),
    })


def evaluate_image_quote_readiness(
    target_date: date,
    target_directory: Path,
    reference_image_ready: bool,
) -> tuple[bool, list[str], float | None]:
    reasons: list[str] = []
    promotion_path = target_directory / "image_promotion.json"
    if not promotion_path.is_file():
        return False, ["summary_image_not_promoted"], None
    try:
        promotion = json.loads(promotion_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return False, ["summary_image_promotion_invalid"], None
    if promotion.get("market_date_source") != "image_title":
        reasons.append("summary_image_date_not_from_title")
    if promotion.get("target_market_date") != target_date.isoformat():
        reasons.append("summary_image_market_date_mismatch")
    if not promotion.get("image_sha256"):
        reasons.append("summary_image_hash_missing")
    if not reference_image_ready:
        reasons.append("summary_public_reference_not_ready")
    confidence = promotion.get("image_date_confidence")
    if confidence is None:
        confidence = 1.0 if not reasons else None
    return not reasons, reasons, float(confidence) if confidence is not None else None

def validate_public_reference(target_directory: Path) -> tuple[bool, list[str]]:
    output = target_directory / "public_reference.png"
    manifest = target_directory / "public_reference_transform.json"
    promotion = target_directory / "image_promotion.json"
    if not output.exists() and not manifest.exists():
        public_error = target_directory / "public_reference_error.json"
        reason = "public_reference_generation_failed" if public_error.is_file() else "public_reference_missing"
        return False, [reason]
    if not promotion.is_file():
        return False, ["public_reference_promotion_missing"]
    try:
        from intelligence.public_price_image import validate_public_price_image

        promotion_data = json.loads(promotion.read_text(encoding="utf-8"))
        expected_source_sha256 = str(promotion_data["image_sha256"])
        source_path = Path(str(promotion_data["source_image_path"]))
        configuration = _load_config()["public_reference_image"]
        configured_qr = Path(str(configuration["qr_path"]))
        qr_path = configured_qr if configured_qr.is_absolute() else PROJECT_ROOT / configured_qr
        validate_public_price_image(
            output,
            configuration,
            expected_source_sha256=expected_source_sha256,
            source_path=source_path,
            qr_path=qr_path,
        )
    except (ImportError, OSError, KeyError, TypeError, ValueError, RuntimeError, json.JSONDecodeError):
        return False, ["public_reference_invalid"]
    return True, []


def _refresh_bot_candidates(
    target_date: date,
    prices_dir: Path,
    target_directory: Path,
) -> list[str]:
    from intelligence.fuelsight_prices import FuelSightArchive, materialize_bot_candidates

    try:
        materialize_bot_candidates(target_date, FuelSightArchive(prices_dir))
    except FileNotFoundError:
        return []
    except Exception as error:
        _write_json(target_directory / "bot_candidate_refresh_error.json", {
            "schema_version": SCHEMA_VERSION,
            "target_market_date": target_date.isoformat(),
            "reason": "bot_candidate_refresh_failed",
            "error_type": type(error).__name__,
            "error": str(error),
        })
        return ["bot_candidate_refresh_failed"]
    (target_directory / "bot_candidate_refresh_error.json").unlink(missing_ok=True)
    return []


def _price_input_completeness(target_date: date, target_directory: Path) -> list[str]:
    reasons: list[str] = []
    if not (target_directory / "image_candidates.json").is_file():
        reasons.append("summary_image_not_promoted")
    if not (target_directory / "bot_candidates.json").is_file():
        reasons.append("bot_candidates_not_materialized")

    commands: set[str] = set()
    for snapshot_path in (target_directory / "snapshots").glob("fuelsight_*.json"):
        try:
            snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            reasons.append("fuelsight_snapshot_invalid")
            continue
        if snapshot.get("market_date") != target_date.isoformat():
            reasons.append("fuelsight_snapshot_date_mismatch")
            continue
        command = snapshot.get("command")
        if command in {"/eu", "/apag"}:
            commands.add(command)
    if "/eu" not in commands:
        reasons.append("fuelsight_eu_snapshot_missing")
    if "/apag" not in commands:
        reasons.append("fuelsight_apag_snapshot_missing")
    return _unique(reasons)


def _generate_public_reference(
    source_image: Path,
    qr_image: Path | None,
    target_directory: Path,
) -> None:
    from intelligence.public_price_image import PublicPriceImageError, create_public_price_image

    configuration = _load_config()["public_reference_image"]
    configured_qr = Path(str(configuration["qr_path"]))
    selected_qr = qr_image or (configured_qr if configured_qr.is_absolute() else PROJECT_ROOT / configured_qr)
    output = target_directory / "public_reference.png"
    manifest = target_directory / "public_reference_transform.json"
    error_path = target_directory / "public_reference_error.json"
    if output.is_file() and manifest.is_file():
        existing = json.loads(manifest.read_text(encoding="utf-8"))
        source_sha256 = hashlib.sha256(source_image.read_bytes()).hexdigest()
        qr_sha256 = hashlib.sha256(selected_qr.read_bytes()).hexdigest()
        if existing.get("source_sha256") == source_sha256 and existing.get("qr_sha256") == qr_sha256:
            error_path.unlink(missing_ok=True)
            return
        raise ValueError("Existing public reference image was generated from different inputs")
    if output.exists() or manifest.exists():
        raise ValueError("Public reference image artifacts are incomplete")
    try:
        create_public_price_image(source_image, selected_qr, output, configuration)
        error_path.unlink(missing_ok=True)
    except PublicPriceImageError as error:
        atomic_write_json(error_path, {
            "schema_version": SCHEMA_VERSION,
            "reason": "public_reference_generation_failed",
            "message": str(error),
        })
        raise
    error_path.unlink(missing_ok=True)


def _candidates_for_target(
    target_market_date: str,
    candidates: list[DailyPriceCandidate],
    expected_source: str,
    label: str,
) -> tuple[dict[BusinessKey, list[DailyPriceCandidate]], list[str], int]:
    by_key: dict[BusinessKey, list[DailyPriceCandidate]] = {}
    reasons: list[str] = []
    excluded = 0
    for candidate in candidates:
        if candidate.source_type != expected_source:
            raise ValueError(f"Expected {expected_source} candidate")
        if candidate.market_date != target_market_date:
            excluded += 1
            reasons.append(f"cross_date_{label}_candidate")
            continue
        key = _candidate_key(candidate)
        by_key.setdefault(key, []).append(candidate)
    return by_key, reasons, excluded


def _fuse_key(
    key: BusinessKey,
    image_candidates: list[DailyPriceCandidate],
    bot_candidates: list[DailyPriceCandidate],
) -> FusedDailyPrice:
    image_ids = tuple(candidate.source_id for candidate in image_candidates)
    bot_ids = tuple(candidate.source_id for candidate in bot_candidates)
    reasons: list[str] = []
    if len(image_candidates) > 1:
        reasons.append("duplicate_image_candidate")
    if len(bot_candidates) > 1:
        reasons.append("duplicate_bot_candidate")
    if reasons:
        return _fused(key, None, None, "conflict", image_ids, bot_ids, reasons)

    image = image_candidates[0] if image_candidates else None
    bot = bot_candidates[0] if bot_candidates else None
    if image is not None and bot is not None:
        image_price, image_change = _quantized_values(image)
        bot_price, bot_change = _quantized_values(bot)
        missing = _missing_required_fields(image) + _missing_required_fields(bot)
        if missing:
            return _fused(key, bot_price or image_price, bot_change or image_change, "unavailable", image_ids, bot_ids, _unique(missing))
        mismatch_reasons = []
        if image_price != bot_price:
            mismatch_reasons.append("price_mismatch")
        if image_change != bot_change:
            mismatch_reasons.append("change_mismatch")
        if mismatch_reasons:
            return _fused(key, bot_price, bot_change, "conflict", image_ids, bot_ids, mismatch_reasons)
        return _fused(key, bot_price, bot_change, "cross_verified", image_ids, bot_ids, [])

    candidate = bot or image
    assert candidate is not None
    price, change = _quantized_values(candidate)
    missing = _missing_required_fields(candidate)
    if missing:
        return _fused(key, price, change, "unavailable", image_ids, bot_ids, missing)
    status: PriceStatus = "bot_only" if bot is not None else "ocr_only"
    return _fused(key, price, change, status, image_ids, bot_ids, [])


def _candidate_key(candidate: DailyPriceCandidate) -> BusinessKey:
    region, location = _normalize_location(candidate.region, candidate.location)
    return (
        candidate.market_date,
        region,
        location,
        candidate.product,
        candidate.currency or "",
        candidate.unit or "",
    )


def _quantized_values(candidate: DailyPriceCandidate) -> tuple[Decimal | None, Decimal | None]:
    return _quantize(candidate.price), _quantize(candidate.change)


def _quantize(value: Decimal | None) -> Decimal | None:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if value is not None else None


def _normalize_location(region: str | None, location: str) -> tuple[str, str]:
    return LOCATION_ALIASES.get(location, (region or "", location))


def _missing_required_fields(candidate: DailyPriceCandidate) -> list[str]:
    missing: list[str] = []
    if not candidate.market_date:
        missing.append("missing_market_date")
    if candidate.price is None:
        missing.append("missing_price")
    if candidate.change is None:
        missing.append("missing_change")
    if not candidate.currency:
        missing.append("missing_currency")
    if not candidate.unit:
        missing.append("missing_unit")
    return missing


def _unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def _fused(
    key: BusinessKey,
    price: Decimal | None,
    change: Decimal | None,
    status: PriceStatus,
    image_ids: tuple[str, ...],
    bot_ids: tuple[str, ...],
    reasons: list[str],
) -> FusedDailyPrice:
    return FusedDailyPrice(*key, price, change, status, image_ids, bot_ids, tuple(reasons))


def _with_display_name(price: FusedDailyPrice, display_name: str) -> FusedDailyPrice:
    return FusedDailyPrice(**{**asdict(price), "display_name": display_name})


def _next_trading_deadline(target_date: date, config: dict[str, Any], timezone: ZoneInfo) -> datetime:
    holidays = {date.fromisoformat(value) for value in config.get("market_holidays", [])}
    candidate = target_date + timedelta(days=int(config["wait_deadline"]["trading_days_after_market_date"]))
    while candidate.weekday() >= 5 or candidate in holidays:
        candidate += timedelta(days=1)
    deadline_time = time.fromisoformat(str(config["wait_deadline"]["local_time"]))
    return datetime.combine(candidate, deadline_time, tzinfo=timezone)


def _last_capture_at(target_directory: Path) -> str | None:
    timestamps: list[datetime] = []
    for snapshot_path in (target_directory / "snapshots").glob("fuelsight_*.json"):
        try:
            payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
            timestamp = datetime.fromisoformat(str(payload.get("response_timestamp") or ""))
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            continue
        timestamps.append(timestamp)
    return max(timestamps).isoformat() if timestamps else None


def _next_poll_at(now: datetime, config: dict[str, Any]) -> str:
    timezone = ZoneInfo(config["timezone"])
    local_now = now.astimezone(timezone)
    holidays = {date.fromisoformat(value) for value in config.get("market_holidays", [])}
    candidate_date = local_now.date()
    while True:
        if candidate_date.weekday() < 5 and candidate_date not in holidays:
            for slot_value in sorted(config.get("poll_slots", {}).values()):
                candidate = datetime.combine(candidate_date, time.fromisoformat(str(slot_value)), tzinfo=timezone)
                if candidate > local_now:
                    return candidate.isoformat()
        candidate_date += timedelta(days=1)


def _merged_config(config: dict[str, Any] | None) -> dict[str, Any]:
    base = _load_config()
    if config is None:
        return base
    merged = {**base, **config}
    merged["wait_deadline"] = {**base["wait_deadline"], **config.get("wait_deadline", {})}
    return merged


def _load_config() -> dict[str, Any]:
    import yaml

    config_path = Path(__file__).parent / "config" / "daily_prices.yaml"
    return yaml.safe_load(config_path.read_text(encoding="utf-8"))


def _candidate_from_dict(value: dict[str, Any], expected_source: str) -> DailyPriceCandidate:
    if value.get("source_type") != expected_source:
        raise ValueError(f"Expected {expected_source} candidate")
    return DailyPriceCandidate(
        schema_version=str(value["schema_version"]), market_date=str(value["market_date"]),
        region=str(value["region"]), location=str(value["location"]), product=str(value["product"]),
        price_raw=value.get("price_raw"), price=Decimal(value["price"]) if value.get("price") is not None else None,
        change_raw=value.get("change_raw"), change=Decimal(value["change"]) if value.get("change") is not None else None,
        currency=value.get("currency"), unit=value.get("unit"), source_type=expected_source, source_id=str(value["source_id"]),
        confidence=float(value["confidence"]), evidence=dict(value.get("evidence", {})),
    )


def _read_candidate_artifact(
    path: Path,
    source_type: str,
    label: str,
) -> tuple[list[DailyPriceCandidate], list[str]]:
    if not path.exists():
        return [], [f"{label}_artifact_missing"]
    try:
        values = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(values, list):
            raise ValueError(f"{path} must contain a list")
        return [_candidate_from_dict(value, source_type) for value in values], []
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return [], [f"{label}_parse_error"]


def _candidate_to_dict(candidate: DailyPriceCandidate) -> dict[str, Any]:
    data = asdict(candidate)
    data["price"] = str(candidate.price) if candidate.price is not None else None
    data["change"] = str(candidate.change) if candidate.change is not None else None
    return data


def _fused_to_dict(price: FusedDailyPrice) -> dict[str, Any]:
    data = asdict(price)
    data["price"] = str(price.price) if price.price is not None else None
    data["change"] = str(price.change) if price.change is not None else None
    return data


def _fusion_to_dict(result: DailyPriceFusionResult) -> dict[str, Any]:
    return {
        "schema_version": result.schema_version,
        "target_market_date": result.target_market_date,
        "prices": [_fused_to_dict(price) for price in result.prices],
        "excluded_count": result.excluded_count,
        "reasons": list(result.reasons),
    }


def _release_state_to_dict(state: PriceReleaseState) -> dict[str, Any]:
    data = asdict(state)
    data["reasons"] = list(state.reasons)
    data["missing_benchmarks"] = list(state.missing_benchmarks)
    return data


def persist_summary_publication_state(payload: dict[str, Any]) -> None:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        return
    from psycopg import Connection
    from psycopg.types.json import Jsonb

    with Connection.connect(database_url) as connection, connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """INSERT INTO summary_publication_states (
                 market_date,image_market_date,image_date_confidence,image_quote_status,
                 image_draft_media_id,bot_confirmation_status,structured_verification_status,
                 comparison_eligible,last_reconciliation_at,reconciliation_issues,state_json
               ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
               ON CONFLICT (market_date) DO UPDATE SET
                 image_market_date=EXCLUDED.image_market_date,
                 image_date_confidence=EXCLUDED.image_date_confidence,
                 image_quote_status=CASE
                   WHEN summary_publication_states.image_quote_status = 'draft_verified'
                     THEN summary_publication_states.image_quote_status
                   ELSE EXCLUDED.image_quote_status
                 END,
                 image_draft_media_id=COALESCE(EXCLUDED.image_draft_media_id,summary_publication_states.image_draft_media_id),
                 bot_confirmation_status=EXCLUDED.bot_confirmation_status,
                 structured_verification_status=EXCLUDED.structured_verification_status,
                 comparison_eligible=EXCLUDED.comparison_eligible,
                 last_reconciliation_at=EXCLUDED.last_reconciliation_at,
                 reconciliation_issues=EXCLUDED.reconciliation_issues,
                 state_json=EXCLUDED.state_json,updated_at=now()""",
            (
                payload["target_market_date"], payload.get("image_market_date"),
                payload.get("image_date_confidence"), payload.get("image_quote_status", "pending"),
                payload.get("image_draft_media_id"), payload.get("bot_confirmation_status", "pending"),
                payload.get("structured_verification_status", "pending"),
                bool(payload.get("comparison_eligible")), payload.get("last_reconciliation_at"),
                Jsonb(payload.get("reconciliation_issues", [])), Jsonb(payload),
            ),
        )


def record_image_draft_verified(target_date: str, media_id: str) -> dict[str, Any]:
    state_path = resolve_daily_price_root() / target_date / "release_state.json"
    if not state_path.is_file():
        raise FileNotFoundError(f"Summary release state missing: {state_path}")
    payload = json.loads(state_path.read_text(encoding="utf-8"))
    if payload.get("image_quote_ready") is not True:
        raise ValueError("Summary image quote is not ready")
    payload.update({
        "image_draft_created": True,
        "image_draft_media_id": media_id,
        "image_quote_status": "draft_verified",
    })
    atomic_write_json(state_path, payload)
    persist_summary_publication_state(payload)
    return payload

def _write_json(path: Path, data: Any) -> None:
    atomic_write_json(path, data)


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Materialize and reconcile ETI daily prices")
    parser.add_argument("--price-root", type=Path, default=None)
    subparsers = parser.add_subparsers(dest="command", required=True)
    promote = subparsers.add_parser("promote-image")
    promote.add_argument("--date", type=date.fromisoformat, required=True)
    promote.add_argument("--trial-result", type=Path, required=True)
    promote.add_argument("--source-image", type=Path, required=True)
    promote.add_argument("--qr-image", type=Path, default=None)
    summary_image = subparsers.add_parser("promote-summary-image")
    summary_image.add_argument("--date", type=date.fromisoformat, default=None)
    summary_image.add_argument("--source-image", type=Path, required=True)
    summary_image.add_argument("--qr-image", type=Path, default=None)
    materialize = subparsers.add_parser("materialize-bot")
    materialize.add_argument("--date", type=date.fromisoformat, required=True)
    reconcile = subparsers.add_parser("reconcile")
    reconcile.add_argument("--date", type=date.fromisoformat, required=True)
    reconcile.add_argument("--reports-root", type=Path, default=None)
    pending = subparsers.add_parser("reconcile-pending")
    pending.add_argument("--lookback-days", type=int, default=7)
    args = parser.parse_args(argv)
    price_root = args.price_root or resolve_daily_price_root()

    if args.command == "promote-image":
        print(promote_image_candidates(
            args.date,
            args.trial_result,
            price_root,
            source_image=args.source_image,
            qr_image=args.qr_image,
        ))
        return 0
    if args.command == "promote-summary-image":
        print(promote_summary_image_quote(
            args.date,
            args.source_image,
            price_root,
            qr_image=args.qr_image,
        ))
        return 0
    if args.command == "materialize-bot":
        from intelligence.fuelsight_prices import FuelSightArchive, materialize_bot_candidates

        print(materialize_bot_candidates(args.date, FuelSightArchive(price_root)))
        return 0
    if args.command == "reconcile":
        reports_root = args.reports_root or price_root.parent
        state = reconcile_saved_report(args.date, reports_root, price_root)
        print(json.dumps(_release_state_to_dict(state), ensure_ascii=False, indent=2))
        return 0

    from intelligence.daily_report import reconcile_pending_prices

    results = reconcile_pending_prices(
        args.lookback_days,
        price_mode=os.getenv("DAILY_PRICE_MODE", "shadow"),
        reports_dir=price_root.parent,
        prices_dir=price_root,
    )
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())



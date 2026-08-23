import hashlib
import json
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Literal


ARTICLE_SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
ARTIFACT_HASH_FIELDS = ("markdown", "wechat_html", "summary")
DEFAULT_DIGIT_SOURCE_CHANNELS = ("telegram:platts-digits",)
DEFAULT_SUMMARY_SOURCE_CHANNELS = ("telegram:quotes-summary",)


def configured_source_channels(
    environment_name: str,
    defaults: tuple[str, ...],
) -> tuple[str, ...]:
    configured = os.getenv(environment_name, "")
    values = configured.split(",") if configured else defaults
    channels = tuple(
        dict.fromkeys(value.strip() for value in values if value.strip())
    )
    if not channels:
        raise ValueError(f"{environment_name} must contain at least one source channel")
    return channels


def digital_source_channels() -> tuple[str, ...]:
    return configured_source_channels(
        "TELEGRAM_DIGITAL_SOURCE_CHANNELS",
        DEFAULT_DIGIT_SOURCE_CHANNELS,
    )


def summary_source_channels() -> tuple[str, ...]:
    return configured_source_channels(
        "TELEGRAM_SUMMARY_SOURCE_CHANNELS",
        DEFAULT_SUMMARY_SOURCE_CHANNELS,
    )


@dataclass(frozen=True)
class ArticleLocator:
    stream: Literal["summary", "digit"]
    market_date: date
    article_slug: str | None = None

    def __post_init__(self) -> None:
        if self.stream not in ("summary", "digit"):
            raise ValueError(f"unsupported content stream: {self.stream}")
        if self.stream == "summary" and self.article_slug:
            raise ValueError("summary stream does not accept article_slug")
        if self.stream == "digit" and not self.article_slug:
            raise ValueError("digit stream requires article_slug")
        if self.article_slug and not ARTICLE_SLUG_PATTERN.fullmatch(self.article_slug):
            raise ValueError(
                "article_slug must match ^[a-z0-9]+(?:-[a-z0-9]+)*$"
            )


@dataclass(frozen=True)
class ArticlePaths:
    markdown: Path
    wechat_html: Path
    summary: Path
    quality_audit: Path
    llm_review: Path
    publish_state_dir: Path
    publication_stem: str

    def publish_state_path(self, action: str) -> Path:
        return self.publish_state_dir / f"{self.publication_stem}_{action}.json"

    def preview_html_path(self, action: str) -> Path:
        return self.publish_state_dir / f"{self.publication_stem}_{action}_preview.html"

    def payload_path(self, action: str) -> Path:
        return self.publish_state_dir / f"{self.publication_stem}_{action}_payload.json"


def build_publication_key(locator: ArticleLocator) -> str:
    market_date = locator.market_date.isoformat()
    if locator.stream == "summary":
        return f"summary-image:{market_date}"
    return f"digit:{market_date}:{locator.article_slug}"


def build_artifact_identity(
    locator: ArticleLocator,
    markdown: str,
    wechat_html: str,
    summary: str,
) -> dict[str, Any]:
    values = {
        "markdown": markdown,
        "wechat_html": wechat_html,
        "summary": summary,
    }
    return {
        "publication_key": build_publication_key(locator),
        "artifact_sha256": {
            field_name: hashlib.sha256(values[field_name].encode("utf-8")).hexdigest()
            for field_name in ARTIFACT_HASH_FIELDS
        },
    }


def artifact_identity_issues(
    locator: ArticleLocator,
    audit_payload: dict[str, Any],
    markdown: str,
    wechat_html: str,
    summary: str,
) -> list[str]:
    expected = build_artifact_identity(locator, markdown, wechat_html, summary)
    issues: list[str] = []
    if audit_payload.get("publication_key") != expected["publication_key"]:
        issues.append("publication key mismatch")
    recorded_hashes = audit_payload.get("artifact_sha256")
    if not isinstance(recorded_hashes, dict):
        return issues + ["artifact sha256 manifest missing"]
    for field_name in ARTIFACT_HASH_FIELDS:
        if recorded_hashes.get(field_name) != expected["artifact_sha256"][field_name]:
            issues.append(f"{field_name} sha256 mismatch")
    return issues


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as temporary_file:
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    atomic_write_text(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
    )


def _assert_resolved_within(path: Path, root: Path, label: str) -> None:
    try:
        path.resolve(strict=False).relative_to(root.resolve(strict=False))
    except ValueError as error:
        raise ValueError(f"resolved {label} path escapes stream root") from error


def resolve_article_paths(locator: ArticleLocator, reports_root: Path) -> ArticlePaths:
    market_date = locator.market_date.isoformat()
    publish_state_dir = reports_root / "wechat_publish" / locator.stream
    if locator.stream == "summary":
        article_dir = reports_root / "summary"
        publication_stem = market_date
        quality_audit = article_dir / "quality" / f"{market_date}.json"
        llm_review = article_dir / "quality" / f"{market_date}_llm_review.json"
    else:
        article_dir = reports_root / "digit" / market_date
        publication_stem = f"{market_date}_{locator.article_slug}"
        quality_audit = article_dir / "quality" / f"{locator.article_slug}.json"
        llm_review = article_dir / "quality" / f"{locator.article_slug}_llm_review.json"

    paths = ArticlePaths(
        markdown=article_dir / f"{locator.article_slug or market_date}.md",
        wechat_html=article_dir / f"{locator.article_slug or market_date}_wechat.html",
        summary=article_dir / f"{locator.article_slug or market_date}_summary.txt",
        quality_audit=quality_audit,
        llm_review=llm_review,
        publish_state_dir=publish_state_dir,
        publication_stem=publication_stem,
    )
    for label, path in (
        ("markdown", paths.markdown),
        ("wechat_html", paths.wechat_html),
        ("summary", paths.summary),
        ("quality_audit", paths.quality_audit),
        ("llm_review", paths.llm_review),
    ):
        _assert_resolved_within(path, article_dir, label)
    for action in ("auto", "draft", "publish"):
        for label, path in (
            (f"{action}_state", paths.publish_state_path(action)),
            (f"{action}_preview", paths.preview_html_path(action)),
            (f"{action}_payload", paths.payload_path(action)),
        ):
            _assert_resolved_within(path, publish_state_dir, label)
    return paths


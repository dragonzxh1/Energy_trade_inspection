"""Deterministic checks for generic filler and repeated editorial structures."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path


VAGUE_FILLER = (
    "可能产生影响",
    "值得关注",
    "尚待观察",
    "后续仍需观察",
    "市场仍需关注",
)
GENERIC_ENERGY_PARAGRAPHS = (
    re.compile(r"航运.{0,30}保险.{0,30}(?:成本|费用)"),
    re.compile(r"绕行.{0,30}(?:成本|时间|运费)"),
    re.compile(r"价格.{0,20}(?:波动|震荡).{0,20}(?:加剧|上升)"),
)


@dataclass(frozen=True)
class StyleAuditResult:
    blocking_issues: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    maximum_paragraph_similarity: float = 0.0
    heading_sequence_similarity: float = 0.0


def _paragraphs(markdown: str) -> list[str]:
    return [
        re.sub(r"\s+", " ", block).strip()
        for block in re.split(r"\n\s*\n", markdown)
        if block.strip()
        and not block.lstrip().startswith("#")
        and not block.lstrip().startswith("-")
        and len(re.sub(r"\s+", " ", block).strip()) >= 45
    ]


def _headings(markdown: str) -> list[str]:
    return [
        re.sub(r"\s+", " ", match.group(1)).strip()
        for match in re.finditer(r"(?m)^#{2,6}\s+(.+?)\s*$", markdown)
        if match.group(1).strip() not in {"参考资料", "资料"}
    ]


def _ratio(left: str, right: str) -> float:
    return SequenceMatcher(None, left.casefold(), right.casefold()).ratio()


def audit_editorial_style(
    markdown: str, recent_markdowns: list[str] | None = None,
) -> StyleAuditResult:
    blocking: list[str] = []
    warnings: list[str] = []
    paragraphs = _paragraphs(markdown)
    for phrase in VAGUE_FILLER:
        if phrase in markdown:
            blocking.append(f"article contains vague filler phrase: {phrase}")
    for paragraph in paragraphs:
        if any(pattern.search(paragraph) for pattern in GENERIC_ENERGY_PARAGRAPHS):
            blocking.append("article contains generic shipping, insurance, rerouting, or volatility filler")
            break

    maximum_paragraph_similarity = 0.0
    heading_sequence_similarity = 0.0
    current_heading_sequence = " > ".join(_headings(markdown))
    for previous in (recent_markdowns or [])[:10]:
        previous_paragraphs = _paragraphs(previous)
        for paragraph in paragraphs:
            for previous_paragraph in previous_paragraphs:
                similarity = _ratio(paragraph, previous_paragraph)
                maximum_paragraph_similarity = max(maximum_paragraph_similarity, similarity)
                if similarity >= 0.9 and min(len(paragraph), len(previous_paragraph)) >= 45:
                    blocking.append("article repeats a paragraph from a recent publication")
                    break
            if blocking and blocking[-1] == "article repeats a paragraph from a recent publication":
                break
        previous_heading_sequence = " > ".join(_headings(previous))
        if current_heading_sequence and previous_heading_sequence:
            heading_sequence_similarity = max(
                heading_sequence_similarity,
                _ratio(current_heading_sequence, previous_heading_sequence),
            )
    if heading_sequence_similarity >= 0.85:
        warnings.append("article heading sequence closely resembles a recent publication")
    return StyleAuditResult(
        blocking_issues=list(dict.fromkeys(blocking)),
        warnings=list(dict.fromkeys(warnings)),
        maximum_paragraph_similarity=round(maximum_paragraph_similarity, 4),
        heading_sequence_similarity=round(heading_sequence_similarity, 4),
    )


def load_recent_digit_markdowns(
    reports_root: Path, target_date: date, limit: int = 10,
) -> list[str]:
    digit_root = reports_root / "digit"
    if not digit_root.exists():
        return []
    candidates: list[tuple[date, Path]] = []
    for date_dir in digit_root.iterdir():
        if not date_dir.is_dir():
            continue
        try:
            article_date = date.fromisoformat(date_dir.name)
        except ValueError:
            continue
        if article_date >= target_date:
            continue
        for path in date_dir.glob("*.md"):
            if path.name not in {"daily-index.md", "observation.md"}:
                candidates.append((article_date, path))
    candidates.sort(key=lambda item: (item[0], item[1].name), reverse=True)
    result: list[str] = []
    for _, path in candidates:
        try:
            result.append(path.read_text(encoding="utf-8"))
        except OSError:
            continue
        if len(result) >= limit:
            break
    return result

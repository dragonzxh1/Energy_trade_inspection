#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Summarize ETI daily report quality audits")
    parser.add_argument("--limit", type=int, default=14, help="Maximum number of dates to show")
    parser.add_argument("--warn-only", action="store_true", help="Show only warning dates")
    parser.add_argument("--date-from", help="Lower bound date in YYYY-MM-DD format")
    parser.add_argument("--date-to", help="Upper bound date in YYYY-MM-DD format")
    parser.add_argument("--format", choices=["text", "markdown"], default="text", help="Output format")
    parser.add_argument("--output", help="Optional file path to write the rendered summary")
    return parser.parse_args()


def load_quality_rows(quality_dir: Path) -> list[dict]:
    index_path = quality_dir / "index.jsonl"
    if not index_path.exists():
        return []

    rows: list[dict] = []
    for line in index_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and payload.get("date"):
            rows.append(payload)

    rows.sort(key=lambda row: row.get("date", ""), reverse=True)
    deduped: list[dict] = []
    seen: set[str] = set()
    for row in rows:
        date = str(row.get("date"))
        if date in seen:
            continue
        seen.add(date)
        deduped.append(row)
    return deduped


def in_range(date_value: str, date_from: str | None, date_to: str | None) -> bool:
    if date_from and date_value < date_from:
        return False
    if date_to and date_value > date_to:
        return False
    return True


def main() -> int:
    args = parse_args()
    vault = Path(os.getenv("OBSIDIAN_VAULT", "/var/www/eti/obsidian-vault"))
    quality_dir = vault / "reports" / "quality"
    rows = load_quality_rows(quality_dir)

    if args.warn_only:
        rows = [row for row in rows if row.get("status") != "pass"]
    rows = [
        row for row in rows
        if in_range(str(row.get("date", "")), args.date_from, args.date_to)
    ]
    rows = rows[: args.limit]

    if not rows:
        print("No quality audit rows found.")
        return 0

    pass_count = sum(1 for row in rows if row.get("status") == "pass")
    warn_count = sum(1 for row in rows if row.get("status") != "pass")
    if args.format == "markdown":
        lines = [
            "# 日报质量总览",
            "",
            f"- 样本数：{len(rows)}",
            f"- 通过：{pass_count}",
            f"- 告警：{warn_count}",
            "",
        ]
        for row in rows:
            date = str(row.get("date", ""))
            status = "通过" if row.get("status") == "pass" else "告警"
            issues = row.get("issues") or []
            report_path = vault / "reports" / f"{date}.md"
            html_path = vault / "reports" / f"{date}_wechat.html"
            lines.extend([
                f"## {date}｜{status}",
                f"- Markdown：`{report_path}`",
                f"- WeChat HTML：`{html_path}`",
            ])
            if issues:
                for issue in issues:
                    lines.append(f"- 问题：{issue}")
            else:
                lines.append("- 结果：未发现自动质检问题")
            lines.append("")
        rendered = "\n".join(lines).rstrip() + "\n"
    else:
        lines = [f"Rows: {len(rows)} | pass: {pass_count} | warn: {warn_count}", "-" * 80]
        for row in rows:
            date = str(row.get("date", ""))
            status = str(row.get("status", "unknown")).upper()
            issues = row.get("issues") or []
            report_path = vault / "reports" / f"{date}.md"
            html_path = vault / "reports" / f"{date}_wechat.html"
            lines.append(f"{date} [{status}]")
            lines.append(f"  md:   {report_path}")
            lines.append(f"  html: {html_path}")
            if issues:
                for issue in issues:
                    lines.append(f"  - {issue}")
            else:
                lines.append("  - no issues")
        rendered = "\n".join(lines) + "\n"

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

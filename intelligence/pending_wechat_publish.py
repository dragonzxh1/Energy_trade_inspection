from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from intelligence.content_streams import ArticleLocator, resolve_article_paths
from intelligence.daily_prices import resolve_daily_price_root


READY_STATUSES = {"ready_with_prices"}


def publish_ready_reports(
    lookback_days: int,
    action: str,
    *,
    price_mode: str | None = None,
    reports_dir: Path,
    prices_dir: Path,
    now: datetime | None = None,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> dict[str, dict[str, Any]]:
    if lookback_days < 1:
        raise ValueError("lookback_days must be at least 1")
    if action not in {"auto", "draft", "publish"}:
        raise ValueError(f"Unsupported WeChat action: {action}")
    resolved_price_mode = price_mode or os.getenv("DAILY_PRICE_MODE", "shadow")
    if resolved_price_mode != "append":
        return {}

    local_now = now or datetime.now(ZoneInfo("Asia/Singapore"))
    current_date = local_now.astimezone(ZoneInfo("Asia/Singapore")).date()
    results: dict[str, dict[str, Any]] = {}
    for offset in range(lookback_days):
        target_date = (current_date - timedelta(days=offset)).isoformat()
        locator = ArticleLocator("summary", datetime.fromisoformat(target_date).date())
        summary_paths = resolve_article_paths(locator, reports_dir)
        release_path = prices_dir / target_date / "release_state.json"
        if not summary_paths.markdown.is_file() or not release_path.is_file():
            continue
        try:
            release = json.loads(release_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            results[target_date] = {
                "stream": "summary", "status": "invalid_release_state", "invoked": False,
            }
            continue
        status = str(release.get("status", ""))
        if status not in READY_STATUSES:
            results[target_date] = {"stream": "summary", "status": status, "invoked": False}
            continue
        state_action = "draft" if action == "draft" else "publish"
        if _successful_publication_exists(summary_paths.publish_state_path(state_action), state_action):
            results[target_date] = {
                "stream": "summary", "status": status, "invoked": False, "published": True,
            }
            continue

        command = [
            sys.executable,
            "-m",
            "intelligence.wechat_publish",
            "--date",
            target_date,
            "--stream",
            "summary",
            "--action",
            action,
        ]
        completed = runner(command, check=False, capture_output=True, text=True)
        results[target_date] = {
            "stream": "summary",
            "status": status,
            "invoked": True,
            "returncode": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }
        if completed.returncode != 0:
            raise RuntimeError(f"Delayed WeChat publish failed for {target_date}: {completed.stderr.strip()}")
    return results


def _successful_publication_exists(state_path: Path, action: str) -> bool:
    if not state_path.is_file():
        return False
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if action == "draft":
            return bool(state.get("media_id")) and state.get("publication_stage") == "draft_created"
        return bool(state.get("publish_id")) and int(
            state.get("publish_status_response", {}).get("publish_status", -1)
        ) == 0
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Publish recently reconciled ETI reports")
    parser.add_argument("--lookback-days", type=int, default=7)
    parser.add_argument("--action", choices=("auto", "draft", "publish"), required=True)
    parser.add_argument("--reports-root", type=Path, default=None)
    args = parser.parse_args(argv)

    prices_dir = resolve_daily_price_root()
    reports_dir = args.reports_root or prices_dir.parent
    results = publish_ready_reports(
        args.lookback_days,
        args.action,
        reports_dir=reports_dir,
        prices_dir=prices_dir,
    )
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

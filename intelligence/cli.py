"""
CLI entry point — called by Node.js via child_process.execFile().

Usage:
  python intelligence/cli.py company --name "Rosneft" [--country ru]
  python intelligence/cli.py vessel  --imo 9999999 [--name "MT Example"]
  python intelligence/cli.py signals --name "Acme Corp" [--type company]
  python intelligence/cli.py scrape  --url https://example.com [--mode basic]

Output: JSON to stdout (one line), errors to stderr.
Exit code: 0 = success, 1 = error.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

# Windows stdout 默认可能是 GBK 编码，强制改为 UTF-8
# 这样 Tavily/Scrapling 返回的多语言内容可以正常输出给 Node.js
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

# Allow running from project root: python intelligence/cli.py ...
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load .env.local if present (picks up TAVILY_API_KEY etc.)
try:
    from dotenv import load_dotenv
    for env_file in (".env.local", ".env"):
        p = Path(__file__).parent.parent / env_file
        if p.exists():
            load_dotenv(p)
            break
except ImportError:
    pass

logging.basicConfig(level=logging.WARNING, stream=sys.stderr,
                    format="%(levelname)s %(name)s: %(message)s")


def cmd_company(args: argparse.Namespace) -> dict:
    from intelligence.entity_research import research_company
    return research_company(
        args.name,
        country=args.country or None,
        registration_number=args.reg or None,
        max_results_per_query=args.max_results,
        scrape_top_result=args.scrape,
    )


def cmd_vessel(args: argparse.Namespace) -> dict:
    from intelligence.entity_research import research_vessel
    return research_vessel(
        args.imo,
        vessel_name=args.name or None,
        flag=args.flag or None,
        max_results_per_query=args.max_results,
    )


def cmd_terminal(args: argparse.Namespace) -> dict:
    from intelligence.entity_research import research_terminal
    return research_terminal(
        args.name,
        location=args.location or None,
        operator=args.operator or None,
        max_results_per_query=args.max_results,
    )


def cmd_signals(args: argparse.Namespace) -> dict:
    from intelligence.entity_research import get_authenticity_signals
    return get_authenticity_signals(args.name, entity_type=args.type)


def cmd_scrape(args: argparse.Namespace) -> dict:
    from intelligence.scrapling_fetch import fetch_html
    html = fetch_html(args.url, timeout=args.timeout, mode=args.mode)
    return {"url": args.url, "mode": args.mode, "html_length": len(html), "html": html[:50_000]}


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Entity intelligence CLI for Energy Trade Inspection"
    )
    sub = p.add_subparsers(dest="command", required=True)

    # company
    cp = sub.add_parser("company", help="Research a company")
    cp.add_argument("--name",        required=True, help="Company name")
    cp.add_argument("--country",     default="",    help="Country code (e.g. ru, cn)")
    cp.add_argument("--reg",         default="",    help="Registration number")
    cp.add_argument("--max-results", type=int, default=5, dest="max_results")
    cp.add_argument("--scrape",      action="store_true", help="Scrape top result HTML")

    # vessel
    vp = sub.add_parser("vessel", help="Research a vessel by IMO")
    vp.add_argument("--imo",         required=True, help="IMO number")
    vp.add_argument("--name",        default="",    help="Vessel name")
    vp.add_argument("--flag",        default="",    help="Flag state")
    vp.add_argument("--max-results", type=int, default=5, dest="max_results")

    # terminal
    tp = sub.add_parser("terminal", help="Research a storage terminal / tank farm")
    tp.add_argument("--name",        required=True, help="Terminal name")
    tp.add_argument("--location",    default="",    help="Location (country or city)")
    tp.add_argument("--operator",    default="",    help="Known operator name")
    tp.add_argument("--max-results", type=int, default=5, dest="max_results")

    # signals
    sp = sub.add_parser("signals", help="Get authenticity signals for an entity")
    sp.add_argument("--name", required=True, help="Entity name")
    sp.add_argument("--type", default="company", choices=["company", "vessel", "person"])

    # scrape
    sc = sub.add_parser("scrape", help="Fetch HTML from a URL")
    sc.add_argument("--url",     required=True)
    sc.add_argument("--mode",    default="basic", choices=["basic", "stealth", "dynamic"])
    sc.add_argument("--timeout", type=int, default=30)

    return p


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    dispatch = {
        "company":  cmd_company,
        "vessel":   cmd_vessel,
        "terminal": cmd_terminal,
        "signals":  cmd_signals,
        "scrape":   cmd_scrape,
    }

    try:
        result = dispatch[args.command](args)
        print(json.dumps(result, ensure_ascii=False, default=str))
    except Exception as exc:
        json.dump({"error": str(exc)}, sys.stderr, ensure_ascii=False)
        sys.stderr.write("\n")
        sys.exit(1)


if __name__ == "__main__":
    main()

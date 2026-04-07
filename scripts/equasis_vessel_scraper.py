#!/usr/bin/env python3
"""
equasis_vessel_scraper.py

Uses Scrapling (Playwright + stealth) to log into Equasis and bulk-scrape
vessel data for energy-relevant ship types.

Usage:
  python scripts/equasis_vessel_scraper.py --cat 6 --limit 500
  python scripts/equasis_vessel_scraper.py --cat 5,6,7,8 --limit 2000 --db
  python scripts/equasis_vessel_scraper.py --cat 6 --limit 20 --dry-run

Options:
  --cat      Comma-separated category codes (default: 5,6,7,8)
             5=Bulk Carriers, 6=Oil&Chemical Tankers, 7=Gas Tankers, 8=Other Tankers
  --limit    Max vessels per category (default: 1000)
  --db       Write to PostgreSQL
  --dry-run  Print only, no DB writes
  --out      Optional CSV output path
  --delay    Seconds between pages (default: 1.5)
"""

import argparse
import asyncio
import csv
import json
import os
import re
import sys
from pathlib import Path

# ── Load .env.local ────────────────────────────────────────────────────────────
root = Path(__file__).parent.parent
env_path = root / ".env.local"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        m = re.match(r'^([A-Z_]+)=(.+)$', line)
        if m and m.group(1) not in os.environ:
            os.environ[m.group(1)] = m.group(2).strip()

EMAIL    = os.environ.get("EQUASIS_EMAIL", "")
PASSWORD = os.environ.get("EQUASIS_PASSWORD", "")
DB_URL   = os.environ.get("DATABASE_URL", "")

if not EMAIL or not PASSWORD:
    print("ERROR: Set EQUASIS_EMAIL and EQUASIS_PASSWORD in .env.local")
    sys.exit(1)

# ── Args ───────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--cat",     default="5,6,7,8")
parser.add_argument("--limit",   type=int, default=1000)
parser.add_argument("--db",      action="store_true")
parser.add_argument("--dry-run", action="store_true", dest="dry_run")
parser.add_argument("--out",     default="")
parser.add_argument("--delay",   type=float, default=1.5)
args = parser.parse_args()

CATEGORIES = {
    "5": "Bulk Carriers",
    "6": "Oil and Chemical Tankers",
    "7": "Gas Tankers",
    "8": "Other Tankers",
}

BASE = "https://www.equasis.org/EquasisWeb"

# ── Parse vessel results from HTML ────────────────────────────────────────────
def parse_results(html: str, cat_code: str) -> list[dict]:
    """Extract vessel rows from Equasis search result HTML."""
    vessels = []

    # Equasis result rows contain IMO in onclick or cell
    # Pattern: rows with vessel name, flag, IMO
    rows = re.findall(r'<tr[^>]*>([\s\S]*?)</tr>', html, re.IGNORECASE)

    for row in rows:
        # Skip header rows
        if '<th' in row.lower():
            continue

        # Extract cells
        cells_raw = re.findall(r'<td[^>]*>([\s\S]*?)</td>', row, re.IGNORECASE)
        cells = [re.sub(r'<[^>]+>', '', c).replace('&nbsp;', ' ').strip() for c in cells_raw]
        cells = [c for c in cells if c]

        if len(cells) < 2:
            continue

        # Find IMO in onclick attributes or cells
        imo = None
        imo_m = re.search(r'P_IMO[=\'\"](\d{7})', row)
        if imo_m:
            imo = imo_m.group(1)
        else:
            for cell in cells:
                m = re.search(r'\b(\d{7})\b', cell)
                if m and m.group(1)[0] in '56789':
                    imo = m.group(1)
                    break

        if not imo:
            continue

        name = cells[0] if cells else ""
        flag = cells[1] if len(cells) > 1 else ""
        flag_code = cells[2] if len(cells) > 2 else ""

        # Skip obviously bad rows
        if not name or name.lower() in ('ship name', 'name', 'vessel'):
            continue

        vessels.append({
            "imo":       imo,
            "name":      name,
            "flag":      flag,
            "flag_code": flag_code[:2].lower() if flag_code else "xx",
            "ship_type": CATEGORIES.get(cat_code, "Unknown"),
            "category":  cat_code,
        })

    return vessels


# ── DB upsert ──────────────────────────────────────────────────────────────────
def write_to_db(vessels: list[dict]) -> int:
    import psycopg2
    conn = psycopg2.connect(DB_URL)
    cur  = conn.cursor()
    inserted = 0
    for v in vessels:
        base_slug = re.sub(r'[^a-z0-9]+', '-', (v.get('name') or '').lower()).strip('-')
        slug = f"eq-{base_slug}-{v['imo']}"
        meta = json.dumps({
            "vessel_type":  v.get("ship_type"),
            "flag":         v.get("flag"),
            "equasis_cat":  v.get("category"),
        })
        src  = json.dumps([{"source": "equasis"}])
        score = json.dumps({"entity_existence": 20, "asset_reality": 20,
                            "document_consistency": 5, "community_reputation": 5})
        try:
            cur.execute("""
                INSERT INTO entities (
                    id, entity_type, name, normalized_name, slug, imo,
                    country, jurisdiction_flag,
                    sanction_status, authenticity_score, risk_level,
                    score_breakdown_json, metadata_json, data_source_json,
                    last_verified
                ) VALUES (
                    %s,'vessel',%s,%s,%s,%s,%s,%s,
                    'unknown',40,'medium',
                    %s::jsonb,%s::jsonb,%s::jsonb,NOW()
                )
                ON CONFLICT (id) DO UPDATE SET
                    name          = EXCLUDED.name,
                    country       = EXCLUDED.country,
                    metadata_json = EXCLUDED.metadata_json,
                    last_verified = NOW()
            """, (
                f"eq-{v['imo']}",
                v.get("name",""), (v.get("name") or "").lower(),
                slug, v["imo"],
                v.get("flag_code","xx"), v.get("flag_code","xx"),
                score, meta, src,
            ))
            inserted += cur.rowcount
        except Exception as e:
            print(f"  DB error IMO {v['imo']}: {e}")
            conn.rollback()
    conn.commit()
    cur.close()
    conn.close()
    return inserted


# ── Scrapling page_action ──────────────────────────────────────────────────────
def make_page_action(cat_code: str, limit: int, delay: float):
    """
    Returns a SYNC page_action for Scrapling DynamicFetcher (sync fetch).
    Logs in, searches by category, paginates, stores results via closure.
    """
    import time
    results = []

    def page_action(page):
        # ── Login ──────────────────────────────────────────────────────────────
        # Scrapling has already loaded the homepage — just fill the login form
        time.sleep(1)

        for email_sel in ['[name="j_email"]', 'input[type="text"]']:
            try:
                page.fill(email_sel, EMAIL, timeout=5000)
                break
            except Exception:
                continue

        for pwd_sel in ['[name="j_password"]', 'input[type="password"]']:
            try:
                page.fill(pwd_sel, PASSWORD, timeout=5000)
                break
            except Exception:
                continue

        page.click('button[type="submit"], input[type="submit"]')
        page.wait_for_load_state("networkidle", timeout=30000)

        content = page.content()
        if "ShipSubcription" not in content and "My Equasis" not in content:
            print("  Login failed — check credentials")
            return

        print("  Logged in.")

        # ── Paginate ───────────────────────────────────────────────────────────
        page_num = 1
        while len(results) < limit:
            print(f"  Page {page_num} ({len(results)} so far)…", end="", flush=True)

            page.goto(f"{BASE}/restricted/Search?fs=Search", wait_until="domcontentloaded")
            time.sleep(0.5)

            page.evaluate(f"""
                var el = document.querySelector('[name="P_PAGE_SHIP"]');
                if (el) el.value = '{page_num}';
                var el2 = document.querySelector('[name="ongletActifSC"]');
                if (el2) el2.value = 'ship';
            """)

            try:
                page.select_option('[name="P_CatTypeShip"]', cat_code, timeout=5000)
            except Exception:
                pass
            try:
                page.select_option('[name="P_STATUS"]', 'S', timeout=5000)
            except Exception:
                pass
            try:
                page.check('[name="checkbox-shipSearch"]', timeout=3000)
            except Exception:
                pass

            try:
                page.click('input[value="Advanced Search"], button[type="submit"]', timeout=5000)
            except Exception:
                page.keyboard.press("Enter")

            try:
                page.wait_for_load_state("load", timeout=20000)
            except Exception:
                pass
            time.sleep(delay + 1)

            html = page.content()

            if "No company nor Ship" in html:
                print(" no results.")
                break

            vessels = parse_results(html, cat_code)
            if not vessels:
                print(" 0 parsed, stopping.")
                break

            existing = {v["imo"] for v in results}
            new_v = [v for v in vessels if v["imo"] not in existing]
            results.extend(new_v[:limit - len(results)])
            print(f" +{len(new_v)} new")

            if not new_v:
                break

            has_next = bool(re.search(r'page.*next|next.*page|\bnext\b', html, re.IGNORECASE))
            if not has_next or page_num >= 200:
                break

            page_num += 1

    return page_action, results


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    from scrapling import DynamicFetcher

    categories = [c.strip() for c in args.cat.split(",")]
    all_vessels = []

    print("Equasis Vessel Scraper (Scrapling)")
    print(f"Categories: {[CATEGORIES.get(c,c) for c in categories]}")
    print(f"Limit per category: {args.limit}")

    for cat in categories:
        print(f"\n=== {CATEGORIES.get(cat, cat)} ===")
        action_fn, results = make_page_action(cat, args.limit, args.delay)

        DynamicFetcher.fetch(
            f"{BASE}/public/HomePage",
            page_action=action_fn,
            headless=True,
            network_idle=True,
            timeout=60000,
            disable_resources=True,
        )

        print(f"  Scraped: {len(results)} vessels")
        all_vessels.extend(results)

    # Deduplicate
    seen: dict = {}
    for v in all_vessels:
        if v["imo"] not in seen:
            seen[v["imo"]] = v
    unique = list(seen.values())

    print(f"\nTotal unique vessels: {len(unique)}")

    # CSV output
    if args.out:
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=["imo","name","flag","flag_code","ship_type","category"])
            w.writeheader()
            w.writerows(unique)
        print(f"Written to: {args.out}")

    # DB write
    if args.db and not args.dry_run:
        print("Writing to database…")
        n = write_to_db(unique)
        print(f"Inserted/updated: {n}")
    elif args.dry_run or not args.db:
        print("\nSample results:")
        for v in unique[:15]:
            print(f"  {v['imo']} | {v['name'][:30]:30} | {v['flag'][:20]:20} | {v['ship_type']}")
        if len(unique) > 15:
            print(f"  … and {len(unique)-15} more")


if __name__ == "__main__":
    main()

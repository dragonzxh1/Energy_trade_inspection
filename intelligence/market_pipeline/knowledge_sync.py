"""Sync versioned commodity cards to Obsidian and record their versions."""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path

from psycopg import Connection

from .knowledge import load_knowledge_cards, sync_cards_to_obsidian


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync commodity knowledge cards to Obsidian")
    parser.add_argument(
        "--target",
        default=os.getenv("COMMODITY_KNOWLEDGE_OBSIDIAN_DIR", "/var/www/eti/obsidian-vault/04_Commodity_Knowledge"),
    )
    args = parser.parse_args()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    cards = load_knowledge_cards()
    paths = sync_cards_to_obsidian(Path(args.target), cards)
    with Connection.connect(database_url) as connection, connection.transaction(), connection.cursor() as cursor:
        for commodity_id, card in cards.items():
            path = Path(args.target) / f"{commodity_id}.md"
            content_hash = hashlib.sha256(path.read_bytes()).hexdigest()
            cursor.execute(
                """
                INSERT INTO commodity_knowledge_versions (
                  commodity_id, schema_version, card_version, updated_on, content_hash,
                  obsidian_path, sync_status, synced_at
                ) VALUES (%s, %s, %s, %s, %s, %s, 'obsidian_synced', now())
                ON CONFLICT (commodity_id, card_version) DO UPDATE SET
                  content_hash = EXCLUDED.content_hash, obsidian_path = EXCLUDED.obsidian_path,
                  sync_status = 'obsidian_synced', sync_error = NULL, synced_at = now(), updated_at = now()
                """,
                (
                    commodity_id, card.schema_version, card.version, card.updated_at,
                    content_hash, str(path),
                ),
            )
    print(f"cards={len(cards)} files={len(paths)} target={args.target}", flush=True)


if __name__ == "__main__":
    main()

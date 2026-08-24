"""Verify and promote immutable SourceDocument parser revisions."""

from __future__ import annotations

import argparse
import os
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row


def promote_revision(connection: Connection[Any], document_id: str) -> dict[str, Any]:
    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """SELECT id,attachment_id,parser_version,source_verified,processing_status,
                      needs_review,revision_status,is_current
               FROM source_documents WHERE id=%s FOR UPDATE""",
            (document_id,),
        )
        candidate = cursor.fetchone()
        if not candidate:
            raise ValueError(f"source document not found: {document_id}")
        if candidate["is_current"]:
            return {"status": "already_current", "document_id": document_id}
        if (
            not candidate["source_verified"]
            or candidate["processing_status"] != "parsed"
            or candidate["needs_review"]
        ):
            raise ValueError("candidate parser revision has not passed document verification")
        cursor.execute(
            """SELECT count(DISTINCT fact.id) FILTER (WHERE fact.verification_status='verified') AS verified,
                      count(DISTINCT conflict.id) FILTER (WHERE conflict.conflict_status='unresolved') AS unresolved
               FROM document_sections section
               LEFT JOIN market_facts fact ON fact.document_section_id=section.id
               LEFT JOIN fact_conflicts conflict
                 ON conflict.left_market_fact_id=fact.id OR conflict.right_market_fact_id=fact.id
               WHERE section.source_document_id=%s""",
            (document_id,),
        )
        quality = cursor.fetchone()
        if int(quality["verified"] or 0) < 1:
            raise ValueError("candidate parser revision has no verified facts")
        if int(quality["unresolved"] or 0):
            raise ValueError("candidate parser revision has unresolved fact conflicts")

        cursor.execute(
            """SELECT id FROM source_documents
               WHERE attachment_id=%s AND is_current=true FOR UPDATE""",
            (candidate["attachment_id"],),
        )
        previous = cursor.fetchone()
        previous_id = str(previous["id"]) if previous else None
        if previous_id:
            cursor.execute(
                """UPDATE market_facts SET is_current=false,superseded_at=now(),updated_at=now()
                   WHERE document_section_id IN (
                     SELECT id FROM document_sections WHERE source_document_id=%s
                   ) AND is_current=true""",
                (previous_id,),
            )
            cursor.execute(
                """UPDATE source_documents
                   SET is_current=false,revision_status='verified',updated_at=now()
                   WHERE id=%s""",
                (previous_id,),
            )
        cursor.execute(
            """UPDATE market_facts SET is_current=true,superseded_at=NULL,updated_at=now()
               WHERE document_section_id IN (
                 SELECT id FROM document_sections WHERE source_document_id=%s
               ) AND verification_status='verified'""",
            (document_id,),
        )
        cursor.execute(
            """UPDATE source_documents
               SET is_current=true,revision_status='current',verified_at=now(),
                   supersedes_document_id=COALESCE(supersedes_document_id,%s),updated_at=now()
               WHERE id=%s""",
            (previous_id, document_id),
        )
        return {
            "status": "promoted",
            "document_id": document_id,
            "parser_version": candidate["parser_version"],
            "superseded_document_id": previous_id,
            "verified_facts": int(quality["verified"] or 0),
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Promote a verified SourceDocument parser revision")
    parser.add_argument("--document-id", required=True)
    args = parser.parse_args()
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    with Connection.connect(database_url) as connection:
        print(promote_revision(connection, args.document_id), flush=True)


if __name__ == "__main__":
    main()

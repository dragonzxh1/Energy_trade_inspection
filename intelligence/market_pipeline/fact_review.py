"""Safe command-line review for blocked market facts."""

from __future__ import annotations

import argparse
import json
import os
from datetime import date
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .analysis_repository import canonicalize_commodity


def approval_error(item: dict[str, Any], corroborating: dict[str, Any] | None) -> str | None:
    rules = {reason.get("rule_id") for reason in item["blocking_reasons"]}
    if rules != {"risk.manual_review"}:
        return "Only facts blocked solely for manual high-risk review can be approved."
    if corroborating is None:
        return "An independently verified corroborating fact is required."
    if corroborating["verification_status"] != "verified" or corroborating["publication_blocked"]:
        return "The corroborating fact has not passed verification."
    if corroborating["market_date"] != item["market_date"]:
        return "The corroborating fact uses a different market date."
    if canonicalize_commodity(corroborating.get("commodity")) != canonicalize_commodity(item.get("commodity")):
        return "The corroborating fact concerns a different commodity."
    if (corroborating.get("publisher") or "").casefold() == (item.get("publisher") or "").casefold():
        return "The corroborating fact must come from a different publisher."
    return None


def _fact(connection: Connection, fact_id: str) -> dict[str, Any] | None:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """SELECT fact.*,document.publisher,queue.blocking_reasons,queue.queue_status
               FROM market_facts fact
               JOIN source_documents document ON document.id=fact.source_document_id
               LEFT JOIN fact_review_queue queue ON queue.market_fact_id=fact.id
               WHERE fact.fact_id=%s AND fact.is_current=true""",
            (fact_id,),
        )
        row = cursor.fetchone()
        return dict(row) if row else None


def list_pending(connection: Connection, target_date: date | None) -> list[dict[str, Any]]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """SELECT fact.fact_id,fact.market_date,fact.commodity,fact.fact_type,fact.statement,
               fact.evidence_text,fact.risk_level,document.publisher,queue.priority,queue.blocking_reasons
               FROM fact_review_queue queue
               JOIN market_facts fact ON fact.id=queue.market_fact_id
               JOIN source_documents document ON document.id=fact.source_document_id
               WHERE queue.queue_status='pending' AND fact.is_current=true
                 AND (%s::date IS NULL OR fact.market_date=%s::date)
               ORDER BY fact.market_date DESC,queue.priority DESC,fact.fact_id""",
            (target_date, target_date),
        )
        return [dict(row) for row in cursor.fetchall()]


def review_fact(
    connection: Connection, *, fact_id: str, action: str, reviewer: str, notes: str,
    corroborating_fact_id: str | None = None,
) -> None:
    item = _fact(connection, fact_id)
    if not item or item.get("queue_status") != "pending":
        raise ValueError("Fact is not in the pending review queue.")
    if not reviewer.strip() or not notes.strip():
        raise ValueError("Reviewer and review notes are required.")
    corroborating = _fact(connection, corroborating_fact_id) if corroborating_fact_id else None
    if action == "approve":
        error = approval_error(item, corroborating)
        if error:
            raise ValueError(error)
    with connection.transaction(), connection.cursor() as cursor:
        if action == "approve":
            cursor.execute(
                """UPDATE market_facts SET verification_status='verified',publication_blocked=false,
                   metadata=metadata || %s,updated_at=now() WHERE fact_id=%s""",
                (Jsonb({"manual_review":{"action":"approve","reviewer":reviewer,"notes":notes,
                  "corroborating_fact_id":corroborating_fact_id}}),fact_id),
            )
            queue_status = "approved"
        else:
            cursor.execute(
                """UPDATE market_facts SET verification_status='rejected',publication_blocked=true,
                   metadata=metadata || %s,updated_at=now() WHERE fact_id=%s""",
                (Jsonb({"manual_review":{"action":"reject","reviewer":reviewer,"notes":notes}}),fact_id),
            )
            queue_status = "rejected"
        cursor.execute(
            """UPDATE fact_review_queue SET queue_status=%s,assigned_to=%s,reviewer_notes=%s,
               reviewed_at=now(),updated_at=now() WHERE market_fact_id=(SELECT id FROM market_facts WHERE fact_id=%s)""",
            (queue_status,reviewer,notes,fact_id),
        )


def main() -> None:
    parser=argparse.ArgumentParser(description="Review blocked ETI market facts")
    action=parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--list",action="store_true")
    action.add_argument("--approve")
    action.add_argument("--reject")
    parser.add_argument("--date",type=date.fromisoformat)
    parser.add_argument("--reviewer")
    parser.add_argument("--notes")
    parser.add_argument("--corroborating-fact-id")
    args=parser.parse_args()
    with Connection.connect(os.environ["DATABASE_URL"]) as connection:
        if args.list:
            print(json.dumps(list_pending(connection,args.date),ensure_ascii=False,indent=2,default=str))
            return
        review_fact(connection,fact_id=args.approve or args.reject,
            action="approve" if args.approve else "reject",reviewer=args.reviewer or "",
            notes=args.notes or "",corroborating_fact_id=args.corroborating_fact_id)
    print(json.dumps({"ok":True,"fact_id":args.approve or args.reject,
      "action":"approve" if args.approve else "reject"},ensure_ascii=False))


if __name__=="__main__": main()

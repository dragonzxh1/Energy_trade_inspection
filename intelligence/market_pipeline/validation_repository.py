"""Persistence and batch orchestration for deterministic fact validation."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from types import SimpleNamespace
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .contracts import FactDirection, FactRiskLevel, FactType, ValidationSeverity
from .fact_validation import (
    FACT_VALIDATION_VERSION,
    FactValidationContext,
    detect_fact_conflicts,
    validate_fact,
)
from .fact_review import approval_error


def load_current_facts(
    connection: Connection[Any], target_date: date | None = None,
) -> list[dict[str, Any]]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT fact.*, document.market_date AS source_market_date, document.parse_method,
                   document.publisher,
                   document.source_verified, section.section_text,
                   message.telegram_message_date
            FROM market_facts fact
            JOIN source_documents document ON document.id = fact.source_document_id
            JOIN document_sections section ON section.id = fact.document_section_id
            JOIN telegram_attachments attachment ON attachment.id = document.attachment_id
            JOIN LATERAL (
              SELECT linked.message_id
              FROM telegram_message_attachments linked
              JOIN telegram_messages candidate ON candidate.id = linked.message_id
              WHERE linked.attachment_id = attachment.id
              ORDER BY candidate.telegram_message_date, candidate.id LIMIT 1
            ) first_link ON true
            JOIN telegram_messages message ON message.id = first_link.message_id
            WHERE fact.is_current = true
              AND (%s::date IS NULL OR fact.market_date = %s::date)
            ORDER BY fact.market_date, fact.id
            """,
            (target_date, target_date),
        )
        return list(cursor.fetchall())


def _fact_object(row: dict[str, Any]) -> SimpleNamespace:
    values = dict(row)
    values["fact_type"] = FactType(row["fact_type"])
    values["direction"] = FactDirection(row["direction"])
    values["metadata"] = row["metadata"] or {}
    return SimpleNamespace(**values)


def validate_and_persist(
    connection: Connection[Any], target_date: date | None = None,
) -> tuple[int, int, int]:
    rows = load_current_facts(connection, target_date)
    facts = [_fact_object(row) for row in rows]
    blocking_count = 0
    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        for row, fact in zip(rows, facts):
            context = FactValidationContext(
                source_market_date=row["source_market_date"],
                telegram_message_date=row["telegram_message_date"],
                parse_method=row["parse_method"], source_verified=row["source_verified"],
                section_text=row["section_text"], publisher=row["publisher"],
            )
            issues, risk = validate_fact(fact, context)
            manual_review=(row.get("metadata") or {}).get("manual_review") or {}
            manual_rejected=manual_review.get("action")=="reject"
            corroborating_fact_id=manual_review.get("corroborating_fact_id")
            if manual_review.get("action")=="approve" and corroborating_fact_id:
                cursor.execute("""SELECT fact.*,document.publisher FROM market_facts fact
                  JOIN source_documents document ON document.id=fact.source_document_id
                  WHERE fact.fact_id=%s AND fact.is_current=true""",(corroborating_fact_id,))
                corroborating_row=cursor.fetchone()
                target=dict(row)
                target["blocking_reasons"]=[issue.model_dump(mode="json") for issue in issues if issue.severity==ValidationSeverity.BLOCKING]
                if corroborating_row and approval_error(target,dict(corroborating_row)) is None:
                    issues=[issue for issue in issues if issue.rule_id!="risk.manual_review"]
            cursor.execute(
                "DELETE FROM fact_validation_results WHERE market_fact_id = %s AND validation_version = %s",
                (row["id"], FACT_VALIDATION_VERSION),
            )
            for issue in issues:
                issue_payload = issue.model_dump(mode="json")
                issue_hash = hashlib.sha256(
                    f"{row['fact_id']}\x1f{FACT_VALIDATION_VERSION}\x1f{json.dumps(issue_payload, sort_keys=True)}".encode()
                ).hexdigest()
                cursor.execute(
                    """
                    INSERT INTO fact_validation_results (
                      market_fact_id, validation_version, issue_hash, rule_id, severity,
                      message, field_name, expected_value, actual_value
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        row["id"], FACT_VALIDATION_VERSION, issue_hash, issue.rule_id,
                        issue.severity.value, issue.message, issue.field_name,
                        issue.expected, issue.actual,
                    ),
                )
            blocking = [issue for issue in issues if issue.severity == ValidationSeverity.BLOCKING]
            rejected = any(issue.rule_id in {
                "content.boilerplate", "content.non_energy", "evidence.exact",
            } for issue in blocking)
            verification_status = "rejected" if rejected or manual_rejected else ("needs_review" if blocking else "verified")
            publication_blocked = verification_status != "verified"
            cursor.execute(
                """
                UPDATE market_facts
                SET verification_status = %s, risk_level = %s, validation_version = %s,
                    validated_at = now(), publication_blocked = %s, updated_at = now()
                WHERE id = %s
                """,
                (verification_status, risk.value, FACT_VALIDATION_VERSION, publication_blocked, row["id"]),
            )
            if blocking and not manual_rejected:
                blocking_count += 1
                priority = risk.value if risk != FactRiskLevel.NORMAL else "elevated"
                cursor.execute(
                    """
                    INSERT INTO fact_review_queue (market_fact_id, priority, blocking_reasons)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (market_fact_id) DO UPDATE SET
                      queue_status = 'pending', priority = EXCLUDED.priority,
                      blocking_reasons = EXCLUDED.blocking_reasons, updated_at = now()
                    """,
                    (row["id"], priority, Jsonb([issue.model_dump(mode="json") for issue in blocking])),
                )
            elif not manual_rejected:
                cursor.execute("DELETE FROM fact_review_queue WHERE market_fact_id = %s AND queue_status='pending'", (row["id"],))

        conflicts = detect_fact_conflicts(facts)
        detected_keys=[conflict.conflict_key for conflict in conflicts]
        scoped_fact_ids = [row["id"] for row in rows]
        cursor.execute(
            """
            UPDATE fact_conflicts SET conflict_status='resolved',
              resolution_notes='Automatically closed after stricter comparable-market matching.',
              resolved_at=now()
            WHERE conflict_status='unresolved'
              AND (left_market_fact_id=ANY(%s::uuid[]) OR right_market_fact_id=ANY(%s::uuid[]))
              AND NOT (conflict_key=ANY(%s::text[]))
            """,
            (scoped_fact_ids, scoped_fact_ids, detected_keys),
        )
        fact_ids = {row["fact_id"]: row["id"] for row in rows}
        for conflict in conflicts:
            cursor.execute(
                """
                INSERT INTO fact_conflicts (
                  conflict_key, conflict_type, severity, left_market_fact_id,
                  right_market_fact_id, details
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (conflict_key) DO UPDATE SET
                  severity = EXCLUDED.severity, details = EXCLUDED.details, detected_at = now()
                """,
                (
                    conflict.conflict_key, conflict.conflict_type.value, conflict.severity.value,
                    fact_ids[conflict.left_fact_id], fact_ids[conflict.right_fact_id], Jsonb(conflict.details),
                ),
            )
            for fact_id in (conflict.left_fact_id, conflict.right_fact_id):
                database_id = fact_ids[fact_id]
                cursor.execute(
                    """
                    UPDATE market_facts SET verification_status = 'needs_review',
                      publication_blocked = true, updated_at = now() WHERE id = %s
                    """,
                    (database_id,),
                )
                cursor.execute(
                    """
                    INSERT INTO fact_review_queue (market_fact_id, priority, blocking_reasons)
                    VALUES (%s, 'high', %s)
                    ON CONFLICT (market_fact_id) DO UPDATE SET queue_status = 'pending',
                      priority = 'high', blocking_reasons = EXCLUDED.blocking_reasons, updated_at = now()
                    """,
                    (database_id, Jsonb([{"rule_id": "conflict.unresolved", "conflict_key": conflict.conflict_key}])),
                )
    return len(rows), blocking_count, len(conflicts)

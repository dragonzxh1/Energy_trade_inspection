"""Transactional PostgreSQL persistence for atomic market facts."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .contracts import MARKET_FACT_SCHEMA_VERSION, FactType, MarketFact
from .fact_extraction import FACT_EXTRACTION_PROMPT_VERSION
from .fact_scheduling import is_energy_relevant_section
from .section_triage import TRIAGE_VERSION, triage_section


def ensure_fact_runs(
    connection: Connection[Any], pipeline_mode: str, market_date_from: date | None = None,
    market_date_to: date | None = None,
) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO processing_runs (
              attachment_id, run_type, pipeline_version, pipeline_mode, processing_status, metadata
            )
            SELECT document.attachment_id, 'fact_extraction', %s, %s, 'received',
                   jsonb_build_object('source_document_id', document.id, 'source_id', document.source_id)
            FROM source_documents document
            WHERE document.processing_status = 'parsed'
              AND document.source_verified = true AND document.needs_review = false
              AND (%s::date IS NULL OR document.market_date >= %s::date)
              AND (%s::date IS NULL OR document.market_date <= %s::date)
            ON CONFLICT (attachment_id, run_type, pipeline_version) DO NOTHING
            """,
            (
                MARKET_FACT_SCHEMA_VERSION, pipeline_mode, market_date_from, market_date_from,
                market_date_to, market_date_to,
            ),
        )


def create_extraction_run(
    connection: Connection[Any], *, run_id: str, market_date_from: date, market_date_to: date,
    pipeline_mode: str, run_mode: str, lease_owner: str, max_sections: int,
    max_sections_per_document: int,
) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO fact_extraction_runs (
              run_id, market_date_from, market_date_to, pipeline_mode, run_mode, lease_owner,
              max_sections, max_sections_per_document
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (run_id) DO NOTHING
            """,
            (
                run_id, market_date_from, market_date_to, pipeline_mode, run_mode, lease_owner,
                max_sections, max_sections_per_document,
            ),
        )


def prepare_fact_sections(
    connection: Connection[Any], market_date_from: date, market_date_to: date,
) -> dict[str, int]:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """UPDATE document_sections section SET triage_version='legacy-preserved',
                 triage_category='general_market_news',triage_score=section_priority,
                 triage_reasons='[\"existing retry state preserved\"]'::jsonb,
                 dify_eligible=true,triaged_at=now(),updated_at=now()
               FROM source_documents document
               WHERE document.id=section.source_document_id
                 AND document.market_date BETWEEN %s AND %s
                 AND section.triage_version IS NULL
                 AND (section.fact_extraction_status IN ('failed_retryable','failed_terminal')
                      OR (section.fact_extraction_status='pending' AND section.fact_extraction_attempts>0))""",
            (market_date_from, market_date_to),
        )
        cursor.execute(
            """UPDATE document_sections section SET fact_extraction_status='needs_review',
                 fact_extraction_reason_code='SKIPPED_LOW_PARSE_CONFIDENCE',dify_eligible=false,
                 lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
               FROM source_documents document
               WHERE document.id=section.source_document_id
                 AND document.market_date BETWEEN %s AND %s
                 AND (NOT document.source_verified OR document.processing_status<>'parsed' OR document.needs_review)
                 AND section.fact_extraction_attempts=0
                 AND section.fact_extraction_status IN ('pending','skipped')""",
            (market_date_from, market_date_to),
        )
        cursor.execute(
            """UPDATE document_sections section SET fact_extraction_status='skipped',
                 fact_extraction_reason_code='SKIPPED_TOO_SHORT',dify_eligible=false,
                 triage_version=%s,triage_category='low_editorial_value',triage_score=0,
                 triage_reasons='["below_minimum_text_length"]'::jsonb,
                 triaged_at=now(),lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
               FROM source_documents document
               WHERE document.id=section.source_document_id
                 AND document.market_date BETWEEN %s AND %s
                 AND section.fact_extraction_status='pending'
                 AND section.fact_extraction_attempts=0
                 AND length(trim(section.section_text))<80""",
            (TRIAGE_VERSION, market_date_from, market_date_to),
        )
        cursor.execute(
            """
            SELECT section.id,section.section_title,section.section_text,section.section_type
            FROM document_sections section
            JOIN source_documents document ON document.id=section.source_document_id
            WHERE document.market_date BETWEEN %s AND %s
              AND document.source_verified=true
              AND document.processing_status='parsed'
              AND document.needs_review=false
              AND section.fact_extraction_status = 'pending'
              AND section.fact_extraction_attempts = 0
              AND section.triage_version IS DISTINCT FROM %s
            """,
            (market_date_from, market_date_to, TRIAGE_VERSION),
        )
        priority_updates = []
        skipped = eligible = 0
        for row in cursor.fetchall():
            triage = triage_section(row[1], row[2], row[3])
            priority_updates.append((
                triage.score, TRIAGE_VERSION, triage.category, triage.score,
                Jsonb(list(triage.reasons)), triage.dify_eligible,
                triage.reason_code, triage.dify_eligible, row[0],
            ))
            eligible += int(triage.dify_eligible)
            skipped += int(not triage.dify_eligible)
        if priority_updates:
            cursor.executemany(
                """UPDATE document_sections SET section_priority=%s,triage_version=%s,
                   triage_category=%s,triage_score=%s,triage_reasons=%s,dify_eligible=%s,
                   triaged_at=now(),fact_extraction_reason_code=%s,
                   fact_extraction_status=CASE WHEN %s THEN fact_extraction_status ELSE 'skipped' END,
                   lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=%s""",
                priority_updates,
            )
        cursor.execute(
            """
            UPDATE document_sections section SET fact_extraction_status='skipped',
              fact_extraction_reason_code='SKIPPED_BOILERPLATE',dify_eligible=false,updated_at=now()
            FROM source_documents document
            WHERE document.id=section.source_document_id
              AND document.market_date BETWEEN %s AND %s
              AND section.fact_extraction_status IN ('pending','failed_retryable')
              AND length(section.section_text) <= 1200
              AND lower(trim(section.section_text)) ~
                '^(trade data: s&p global energy has defined standards|any unauthorized use of this copyrighted material|for sales and subscription information|for editorial comments.{0,120}contact|please refer to.{0,160}methodology)'
            """,
            (market_date_from, market_date_to),
        )
        cursor.execute(
            """
            WITH duplicates AS (
              SELECT section.id,row_number() OVER (
                PARTITION BY section.source_document_id,md5(regexp_replace(trim(section.section_text),'\\s+',' ','g'))
                ORDER BY section.section_index,section.id
              ) duplicate_rank
              FROM document_sections section JOIN source_documents document
                ON document.id=section.source_document_id
              WHERE document.market_date BETWEEN %s AND %s
                AND section.fact_extraction_status IN ('pending','failed_retryable')
            )
            UPDATE document_sections section SET fact_extraction_status='skipped',
              fact_extraction_reason_code='SKIPPED_DUPLICATE_CONTENT',dify_eligible=false,updated_at=now()
            FROM duplicates WHERE duplicates.id=section.id AND duplicates.duplicate_rank>1
            """,
            (market_date_from, market_date_to),
        )
        return {"eligible": eligible, "skipped": skipped}


def skip_non_energy_sections(
    connection: Connection[Any], market_date_from: date, market_date_to: date, keywords: list[str],
) -> int:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT section.id,section.section_title,section.section_text
            FROM document_sections section
            JOIN source_documents document ON document.id=section.source_document_id
            WHERE document.market_date BETWEEN %s AND %s
              AND document.source_verified=true AND document.processing_status='parsed'
              AND document.needs_review=false
              AND section.fact_extraction_status IN ('pending','failed_retryable')
            """,
            (market_date_from, market_date_to),
        )
        skipped_ids = [
            row["id"] for row in cursor.fetchall()
            if not is_energy_relevant_section(row["section_title"], row["section_text"], keywords)
        ]
    if not skipped_ids:
        return 0
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """UPDATE document_sections SET fact_extraction_status='skipped',
               fact_extraction_reason_code='SKIPPED_NON_ENERGY',lease_owner=NULL,
               lease_expires_at=NULL,updated_at=now() WHERE id=ANY(%s::uuid[])""",
            (skipped_ids,),
        )
        return cursor.rowcount


def reopen_terminal_sections(
    connection: Connection[Any], market_date_from: date, market_date_to: date,
) -> int:
    with connection.transaction(),connection.cursor() as cursor:
        cursor.execute("""
          UPDATE document_sections section SET fact_extraction_status='failed_retryable',
            fact_extraction_attempts=0,fact_extraction_reason_code='RETRY_AFTER_PROMPT_UPGRADE',
            dify_eligible=true,lease_owner=NULL,lease_expires_at=NULL,updated_at=now()
          FROM source_documents document WHERE document.id=section.source_document_id
            AND document.market_date BETWEEN %s AND %s
            AND section.fact_extraction_status='failed_terminal'
        """,(market_date_from,market_date_to))
        return cursor.rowcount


def recover_expired_section_leases(
    connection: Connection[Any], market_date_from: date, market_date_to: date,
) -> int:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE document_sections section SET fact_extraction_status='pending',
              fact_extraction_reason_code='WORKER_LEASE_EXPIRED',lease_owner=NULL,
              lease_expires_at=NULL,last_run_id=NULL,updated_at=now()
            FROM source_documents document
            WHERE document.id=section.source_document_id
              AND document.market_date BETWEEN %s AND %s
              AND section.fact_extraction_status IN ('leased','processing')
              AND section.lease_expires_at < now()
            """,
            (market_date_from, market_date_to),
        )
        return cursor.rowcount


def reopen_contract_invalid_sections(
    connection: Connection[Any], market_date_from: date, market_date_to: date,
) -> int:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            WITH candidates AS (
              SELECT DISTINCT section.id
              FROM document_sections section
              JOIN source_documents document ON document.id=section.source_document_id
              JOIN market_facts fact ON fact.document_section_id=section.id AND fact.is_current=true
              JOIN fact_validation_results validation ON validation.market_fact_id=fact.id
              WHERE document.market_date BETWEEN %s AND %s
                AND section.fact_extraction_status='completed'
                AND validation.severity='blocking'
                AND validation.rule_id IN ('number.required','unit.supported')
            )
            UPDATE document_sections section SET fact_extraction_status='pending',
              fact_extraction_attempts=0,fact_extraction_reason_code='RETRY_AFTER_CONTRACT_UPGRADE',
              dify_eligible=true,lease_owner=NULL,lease_expires_at=NULL,last_run_id=NULL,updated_at=now()
            FROM candidates WHERE candidates.id=section.id
            """,
            (market_date_from, market_date_to),
        )
        return cursor.rowcount


def claim_fact_sections(
    connection: Connection[Any], *, market_date_from: date, market_date_to: date,
    document_id: str | None, source_id: str | None, section_id: str | None, max_sections: int,
    max_sections_per_document: int, max_attempts: int, lease_owner: str,
    lease_minutes: int, run_id: str, retry_failed: bool,
) -> list[dict[str, Any]]:
    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            WITH claimed_by_run AS (
              SELECT source_document_id,count(*) claimed_count
              FROM document_sections WHERE last_run_id=%s
              GROUP BY source_document_id
            ), classified AS (
              SELECT section.id,section.source_document_id,section.section_priority,
                     section.fact_extraction_attempts,section.section_index,
                     CASE
                       WHEN lower(section.section_title || ' ' || left(section.section_text,800))
                         ~ '(outage|shutdown|disruption|sanction|policy)' THEN 'disruption_policy'
                       WHEN lower(section.section_title || ' ' || left(section.section_text,800))
                         ~ '(supply|demand|inventory|refinery|production)' THEN 'fundamentals'
                       WHEN lower(section.section_title || ' ' || left(section.section_text,800))
                         ~ '(trade flow|shipment|cargo|export|import|tender|freight|vessel)' THEN 'trade_flow'
                       WHEN lower(section.section_title || ' ' || left(section.section_text,800))
                         ~ '(summary|overview|highlights|market wrap|commentary)' THEN 'market_summary'
                       WHEN lower(section.section_title || ' ' || left(section.section_text,800))
                         ~ '(price|assessment|derivative|bid|offer|premium|discount|spread|[$]/)' THEN 'price'
                       ELSE 'other' END AS focus_category,
                     CASE
                       WHEN lower(section.section_title || ' ' || left(section.section_text,800))
                         ~ '(outage|shutdown|disruption|sanction|policy)' THEN 1
                       WHEN lower(section.section_title || ' ' || left(section.section_text,800))
                         ~ '(supply|demand|inventory|refinery|production)' THEN 2
                       WHEN lower(section.section_title || ' ' || left(section.section_text,800))
                         ~ '(trade flow|shipment|cargo|export|import|tender|freight|vessel)' THEN 3
                       WHEN lower(section.section_title || ' ' || left(section.section_text,800))
                         ~ '(summary|overview|highlights|market wrap|commentary)' THEN 4
                       WHEN lower(section.section_title || ' ' || left(section.section_text,800))
                         ~ '(price|assessment|derivative|bid|offer|premium|discount|spread|[$]/)' THEN 0
                       ELSE 5 END AS focus_priority,
                     CASE
                       WHEN section.fact_extraction_reason_code='RETRY_AFTER_CONTRACT_UPGRADE' THEN 0
                       WHEN %s AND section.fact_extraction_status='failed_retryable' THEN 1
                       ELSE 2 END AS retry_priority
              FROM document_sections section
              JOIN source_documents document ON document.id = section.source_document_id
              WHERE document.market_date BETWEEN %s AND %s
                AND document.source_verified = true
                AND document.processing_status = 'parsed'
                AND document.needs_review = false
                AND length(trim(section.section_text)) >= 80
                AND section.section_type NOT IN ('disclaimer','table_of_contents','advertisement','header_footer')
                AND section.dify_eligible = true
                AND (%s::uuid IS NULL OR document.id = %s::uuid)
                AND (%s::text IS NULL OR document.source_id = %s::text)
                AND (%s::text IS NULL OR section.section_id = %s::text)
                AND section.fact_extraction_attempts < %s
                AND (
                  section.fact_extraction_status = 'pending'
                  OR (%s AND section.fact_extraction_status = 'failed_retryable')
                  OR (section.fact_extraction_status IN ('leased','processing') AND section.lease_expires_at < now())
                )
            ), focus_ranked AS (
              SELECT classified.*,
                     row_number() OVER (
                       PARTITION BY classified.source_document_id,classified.focus_category
                       ORDER BY classified.retry_priority,classified.section_priority DESC,
                                classified.fact_extraction_attempts,classified.section_index,classified.id
                     ) AS focus_round
              FROM classified
            ), ranked AS (
              SELECT focus_ranked.id,
                     row_number() OVER (
                       PARTITION BY focus_ranked.source_document_id
                       ORDER BY focus_ranked.retry_priority,focus_ranked.focus_round,
                                focus_ranked.focus_priority,focus_ranked.section_priority DESC,
                                focus_ranked.fact_extraction_attempts,focus_ranked.section_index,focus_ranked.id
                     ) + coalesce(claimed_by_run.claimed_count,0) AS document_round
              FROM focus_ranked
              LEFT JOIN claimed_by_run ON claimed_by_run.source_document_id=focus_ranked.source_document_id
            ), candidates AS (
              SELECT section.id, ranked.document_round
              FROM ranked JOIN document_sections section ON section.id = ranked.id
              WHERE ranked.document_round <= %s
              ORDER BY ranked.document_round, section.section_priority DESC,
                       section.fact_extraction_attempts, section.source_document_id,
                       section.section_index
            ), locked AS (
              SELECT section.id
              FROM document_sections section JOIN candidates ON candidates.id = section.id
              ORDER BY candidates.document_round, section.section_priority DESC,
                       section.source_document_id, section.section_index
              LIMIT %s
              FOR UPDATE OF section SKIP LOCKED
            ), claimed AS (
              UPDATE document_sections section
              SET fact_extraction_status='leased', lease_owner=%s,
                  lease_expires_at=now()+(%s * interval '1 minute'), last_run_id=%s,
                  fact_extraction_reason_code=NULL, updated_at=now()
              FROM locked WHERE section.id=locked.id
              RETURNING section.*
            )
            SELECT run.id AS processing_run_id, document.id AS source_document_id,
                   document.source_id, document.market_date, document.published_at,
                   document.report_title, attachment.attachment_name,
                   claimed.id AS document_section_id, claimed.section_id, claimed.section_index,
                   claimed.section_title, claimed.section_type, claimed.section_priority,
                   claimed.page_start, claimed.region, claimed.commodity, claimed.section_text,
                   claimed.fact_extraction_attempts
            FROM claimed
            JOIN source_documents document ON document.id=claimed.source_document_id
            JOIN telegram_attachments attachment ON attachment.id=document.attachment_id
            JOIN processing_runs run ON run.attachment_id=document.attachment_id
              AND run.run_type='fact_extraction' AND run.pipeline_version=%s
            ORDER BY claimed.section_priority DESC, document.source_id, claimed.section_index
            """,
            (
                run_id, retry_failed, market_date_from, market_date_to, document_id, document_id, source_id, source_id,
                section_id, section_id,
                max_attempts, retry_failed, max_sections_per_document, max_sections,
                lease_owner, lease_minutes, run_id, MARKET_FACT_SCHEMA_VERSION,
            ),
        )
        return list(cursor.fetchall())


def mark_section_processing(connection: Connection[Any], section_id: str, lease_owner: str) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE document_sections SET fact_extraction_status='processing',
              fact_extraction_attempts=fact_extraction_attempts+1,
              fact_extraction_started_at=now(), updated_at=now()
            WHERE id=%s AND lease_owner=%s AND fact_extraction_status='leased'
            """,
            (section_id, lease_owner),
        )
        if cursor.rowcount != 1:
            raise RuntimeError("section lease is not owned by this worker")


def increment_section_attempt(connection: Connection[Any], section_id: str) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            "UPDATE document_sections SET fact_extraction_attempts=fact_extraction_attempts+1, updated_at=now() WHERE id=%s",
            (section_id,),
        )


def renew_run_leases(
    connection: Connection[Any], *, run_id: str, lease_owner: str, lease_minutes: int,
) -> int:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE document_sections SET lease_expires_at=now()+(%s * interval '1 minute'),updated_at=now()
            WHERE last_run_id=%s AND lease_owner=%s AND fact_extraction_status IN ('leased','processing')
            """,
            (lease_minutes, run_id, lease_owner),
        )
        return cursor.rowcount


def mark_section_completed(
    connection: Connection[Any], section_id: str, *, facts_count: int,
    reason_code: str | None = None,
) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE document_sections SET fact_extraction_status='completed',
              fact_extraction_reason_code=%s, fact_extraction_last_error=NULL,
              fact_extraction_completed_at=now(), lease_owner=NULL, lease_expires_at=NULL,
              updated_at=now() WHERE id=%s
            """,
            (reason_code or ("COMPLETED_WITH_FACTS" if facts_count else "NO_FACTS_FOUND"), section_id),
        )


def mark_section_failed(
    connection: Connection[Any], section_id: str, *, reason_code: str, error_message: str,
    max_attempts: int,
) -> str:
    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            UPDATE document_sections SET
              fact_extraction_status=CASE WHEN fact_extraction_attempts >= %s
                THEN 'failed_terminal' ELSE 'failed_retryable' END,
              fact_extraction_reason_code=CASE WHEN fact_extraction_attempts >= %s
                THEN 'FAILED_MAX_RETRIES' ELSE %s END,
              fact_extraction_last_error=%s, fact_extraction_completed_at=now(),
              lease_owner=NULL, lease_expires_at=NULL, updated_at=now()
            WHERE id=%s RETURNING fact_extraction_status
            """,
            (max_attempts, max_attempts, reason_code, error_message[:4000], section_id),
        )
        return str(cursor.fetchone()["fact_extraction_status"])


def record_extraction_attempt(
    connection: Connection[Any], *, run_id: str, section_id: str, attempt_number: int,
    reason_code: str, workflow_run_id: str | None, raw_response: dict[str, Any] | None,
    error_message: str | None, started_at: datetime, duration_ms: int,
) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO fact_extraction_attempt_logs (
              run_id,document_section_id,attempt_number,reason_code,workflow_run_id,
              prompt_version,raw_response,error_message,started_at,duration_ms
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (run_id,document_section_id,attempt_number) DO UPDATE SET
              reason_code=EXCLUDED.reason_code,workflow_run_id=EXCLUDED.workflow_run_id,
              raw_response=EXCLUDED.raw_response,error_message=EXCLUDED.error_message,
              completed_at=now(),duration_ms=EXCLUDED.duration_ms
            """,
            (
                run_id, section_id, attempt_number, reason_code, workflow_run_id,
                FACT_EXTRACTION_PROMPT_VERSION, Jsonb(raw_response) if raw_response is not None else None,
                error_message[:4000] if error_message else None, started_at, duration_ms,
            ),
        )


def finalize_extraction_run(
    connection: Connection[Any], *, run_id: str, market_date_from: date,
    market_date_to: date, attempted_sections: int, facts_created: int, facts_updated: int,
    price_facts_created: int, failed: bool = False, error_message: str | None = None,
) -> dict[str, Any]:
    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            WITH scoped AS (
              SELECT section.*,document.id document_id
              FROM document_sections section JOIN source_documents document
                ON document.id=section.source_document_id
              WHERE document.market_date BETWEEN %s AND %s
                AND document.source_verified=true AND document.processing_status='parsed'
                AND document.needs_review=false
            ), summary AS (
              SELECT count(*) FILTER(WHERE dify_eligible=true AND fact_extraction_status NOT IN ('skipped','needs_review')) eligible,
                count(*) FILTER(WHERE fact_extraction_status='completed' AND last_run_id=%s) completed,
                count(*) FILTER(WHERE fact_extraction_status='failed_retryable' AND last_run_id=%s) failed_retryable,
                count(*) FILTER(WHERE fact_extraction_status='failed_terminal' AND last_run_id=%s) failed_terminal,
                count(*) FILTER(WHERE fact_extraction_status='skipped') skipped,
                count(*) FILTER(WHERE dify_eligible=true AND fact_extraction_status IN ('pending','leased','processing','failed_retryable')) pending,
                count(DISTINCT document_id) FILTER(WHERE dify_eligible=true AND fact_extraction_status NOT IN ('skipped','needs_review')) documents_eligible,
                count(DISTINCT document_id) FILTER(WHERE last_run_id=%s) documents_attempted,
                (
                  SELECT count(*) FROM (
                    SELECT document_id FROM scoped
                    GROUP BY document_id
                    HAVING bool_or(last_run_id=%s)
                       AND bool_and(fact_extraction_status NOT IN (
                         'pending','leased','processing','failed_retryable','failed_terminal','needs_review'
                       ))
                  ) completed_documents
                ) documents_completed
              FROM scoped
            ), reasons AS (
              SELECT coalesce(jsonb_object_agg(reason_code,reason_count),'{}'::jsonb) breakdown
              FROM (
                SELECT coalesce(fact_extraction_reason_code,
                  CASE WHEN fact_extraction_status='pending' THEN 'NOT_ATTEMPTED_BUDGET_EXHAUSTED'
                       WHEN fact_extraction_status IN ('leased','processing') THEN 'NOT_ATTEMPTED_NO_WORKER_CAPACITY'
                       ELSE fact_extraction_status END) reason_code,count(*) reason_count
                FROM scoped GROUP BY 1
              ) grouped
            )
            UPDATE fact_extraction_runs run SET
              eligible_sections=summary.eligible,attempted_sections=%s,
              completed_sections=summary.completed,failed_retryable_sections=summary.failed_retryable,
              failed_terminal_sections=summary.failed_terminal,skipped_sections=summary.skipped,
              pending_sections=summary.pending,documents_with_eligible_sections=summary.documents_eligible,
              documents_attempted=summary.documents_attempted,documents_completed=summary.documents_completed,
              facts_created=%s,facts_updated=%s,price_facts_created=%s,
              reason_breakdown=reasons.breakdown,
              run_status=CASE WHEN %s THEN 'failed' WHEN summary.pending>0
                THEN 'completed_with_backlog' ELSE 'completed' END,
              error_message=%s,completed_at=now(),updated_at=now()
            FROM summary CROSS JOIN reasons WHERE run.run_id=%s RETURNING run.*
            """,
            (
                market_date_from, market_date_to, run_id, run_id, run_id, run_id, run_id,
                attempted_sections, facts_created, facts_updated,
                price_facts_created, failed, error_message, run_id,
            ),
        )
        result=dict(cursor.fetchone())
        cursor.execute(
            """
            SELECT count(DISTINCT document.id)
            FROM source_documents document
            JOIN document_sections section ON section.source_document_id=document.id
            WHERE document.market_date BETWEEN %s AND %s
              AND document.source_verified=true AND document.processing_status='parsed'
              AND document.needs_review=false AND section.last_run_id IS NOT NULL
            """,
            (market_date_from,market_date_to),
        )
        result["documents_covered"]=int(cursor.fetchone()["count"])
        return result


def load_fact_sections(
    connection: Connection[Any], *, limit: int, section_id: str | None, include_completed: bool
) -> list[dict[str, Any]]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT run.id AS processing_run_id, document.id AS source_document_id,
                   document.source_id, document.market_date, document.published_at,
                   document.report_title, attachment.attachment_name,
                   section.id AS document_section_id, section.section_id, section.section_index,
                   section.section_title, section.page_start, section.region, section.commodity,
                   section.section_text
            FROM document_sections section
            JOIN source_documents document ON document.id = section.source_document_id
            JOIN telegram_attachments attachment ON attachment.id = document.attachment_id
            JOIN processing_runs run
              ON run.attachment_id = document.attachment_id
             AND run.run_type = 'fact_extraction'
             AND run.pipeline_version = %s
            LEFT JOIN processing_steps step
              ON step.processing_run_id = run.id AND step.step_key = section.section_id
            WHERE document.processing_status = 'parsed'
              AND length(trim(section.section_text)) >= 40
              AND (%s::text IS NULL OR section.section_id = %s::text)
              AND (%s::boolean OR step.processing_status IS DISTINCT FROM 'completed')
            ORDER BY document.market_date, document.id, section.section_index
            LIMIT %s
            """,
            (MARKET_FACT_SCHEMA_VERSION, section_id, section_id, include_completed, limit),
        )
        return list(cursor.fetchall())


def mark_step_running(connection: Connection[Any], row: dict[str, Any], input_json: dict[str, Any]) -> str:
    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            INSERT INTO processing_steps (
              processing_run_id, step_key, step_type, processing_status, attempt_count,
              workflow_name, prompt_version, input_json, started_at
            ) VALUES (%s, %s, 'source_fact', 'running', 1, 'dify-source-fact', %s, %s, now())
            ON CONFLICT (processing_run_id, step_key) DO UPDATE SET
              processing_status = 'running', attempt_count = processing_steps.attempt_count + 1,
              input_json = EXCLUDED.input_json, output_json = NULL, error_message = NULL,
              workflow_run_id = NULL, started_at = now(), completed_at = NULL,
              duration_ms = NULL, updated_at = now()
            RETURNING id
            """,
            (
                row["processing_run_id"], row["section_id"], FACT_EXTRACTION_PROMPT_VERSION,
                Jsonb(input_json),
            ),
        )
        return str(cursor.fetchone()["id"])


def persist_fact_result(
    connection: Connection[Any], *, row: dict[str, Any], step_id: str,
    workflow_run_id: str | None, output_json: dict[str, Any], facts: list[MarketFact],
    started_at: datetime,
) -> dict[str, int]:
    duration_ms = max(0, int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000))
    hashes = [fact.fact_hash for fact in facts]
    created = updated = price_created = 0
    with connection.transaction(), connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            UPDATE market_facts
            SET is_current = false, superseded_at = now(), updated_at = now()
            WHERE document_section_id = %s
              AND fact_class = 'source_fact'
              AND is_current = true
              AND NOT (fact_hash = ANY(%s))
            """,
            (row["document_section_id"], hashes),
        )
        for fact in facts:
            cursor.execute(
                """
                INSERT INTO market_facts (
                  fact_id, fact_hash, schema_version, source_document_id, document_section_id,
                  extraction_step_id, source_id, section_id, market_date, published_at, region,
                  country, commodity, benchmark, fact_type, fact_class, statement, value, unit,
                  change_value, change_unit, direction, time_basis, evidence_text, page_number,
                  attribution, uncertainty, confidence, verification_status, risk_level,
                  supporting_fact_ids, metadata
                ) VALUES (
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (fact_hash) DO UPDATE SET
                  extraction_step_id = EXCLUDED.extraction_step_id,
                  region = EXCLUDED.region, country = EXCLUDED.country,
                  commodity = EXCLUDED.commodity, benchmark = EXCLUDED.benchmark,
                  fact_type = EXCLUDED.fact_type, statement = EXCLUDED.statement,
                  value = EXCLUDED.value, unit = EXCLUDED.unit,
                  change_value = EXCLUDED.change_value, change_unit = EXCLUDED.change_unit,
                  direction = EXCLUDED.direction, time_basis = EXCLUDED.time_basis,
                  evidence_text = EXCLUDED.evidence_text, attribution = EXCLUDED.attribution,
                  uncertainty = EXCLUDED.uncertainty,
                  confidence = EXCLUDED.confidence, metadata = EXCLUDED.metadata,
                  is_current = true, superseded_at = NULL, updated_at = now()
                RETURNING id, (xmax = 0) AS inserted
                """,
                (
                    fact.fact_id, fact.fact_hash, fact.schema_version, row["source_document_id"],
                    row["document_section_id"], step_id, fact.source_id, fact.section_id,
                    fact.market_date, fact.published_at, fact.region, fact.country, fact.commodity,
                    fact.benchmark, fact.fact_type.value, fact.fact_class.value, fact.statement,
                    fact.value, fact.unit, fact.change_value, fact.change_unit, fact.direction.value,
                    fact.time_basis, fact.evidence_text, fact.page_number, fact.attribution,
                    fact.uncertainty, fact.confidence, fact.verification_status.value,
                    fact.risk_level.value, Jsonb(fact.supporting_fact_ids), Jsonb(fact.metadata),
                ),
            )
            persisted = cursor.fetchone()
            market_fact_id = str(persisted["id"])
            if persisted["inserted"]:
                created += 1
                if fact.fact_type in {FactType.PRICE, FactType.PRICE_CHANGE}:
                    price_created += 1
            else:
                updated += 1
            if fact.fact_type in {FactType.PRICE, FactType.PRICE_CHANGE}:
                cursor.execute(
                    """
                    INSERT INTO market_prices (
                      market_fact_id, market_date, commodity, region, benchmark, price, unit,
                      change_value, change_unit, direction, source_id
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (market_fact_id) DO UPDATE SET
                      market_date = EXCLUDED.market_date, commodity = EXCLUDED.commodity,
                      region = EXCLUDED.region, benchmark = EXCLUDED.benchmark,
                      price = EXCLUDED.price, unit = EXCLUDED.unit,
                      change_value = EXCLUDED.change_value, change_unit = EXCLUDED.change_unit,
                      direction = EXCLUDED.direction, updated_at = now()
                    """,
                    (
                        market_fact_id, fact.market_date, fact.commodity, fact.region, fact.benchmark,
                        fact.value, fact.unit, fact.change_value, fact.change_unit,
                        fact.direction.value, fact.source_id,
                    ),
                )
        cursor.execute(
            """
            INSERT INTO processing_step_attempts (
              processing_step_id, attempt_number, processing_status, workflow_run_id,
              input_json, output_json, started_at, duration_ms
            )
            SELECT id, attempt_count, 'completed', %s, input_json, %s, started_at, %s
            FROM processing_steps WHERE id = %s
            ON CONFLICT (processing_step_id, attempt_number) DO UPDATE SET
              processing_status = 'completed', workflow_run_id = EXCLUDED.workflow_run_id,
              output_json = EXCLUDED.output_json, completed_at = now(), duration_ms = EXCLUDED.duration_ms
            """,
            (workflow_run_id, Jsonb(output_json), duration_ms, step_id),
        )
        cursor.execute(
            """
            UPDATE processing_steps
            SET processing_status = 'completed', workflow_run_id = %s, output_json = %s,
                completed_at = now(), duration_ms = %s, updated_at = now()
            WHERE id = %s
            """,
            (workflow_run_id, Jsonb(output_json), duration_ms, step_id),
        )
    return {"created": created, "updated": updated, "price_created": price_created}


def mark_step_failed(
    connection: Connection[Any], *, step_id: str, error_message: str, started_at: datetime
) -> None:
    duration_ms = max(0, int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000))
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO processing_step_attempts (
              processing_step_id, attempt_number, processing_status, input_json,
              error_message, started_at, duration_ms
            )
            SELECT id, attempt_count, 'failed', input_json, %s, started_at, %s
            FROM processing_steps WHERE id = %s
            ON CONFLICT (processing_step_id, attempt_number) DO UPDATE SET
              processing_status = 'failed', error_message = EXCLUDED.error_message,
              completed_at = now(), duration_ms = EXCLUDED.duration_ms
            """,
            (error_message[:4000], duration_ms, step_id),
        )
        cursor.execute(
            """
            UPDATE processing_steps
            SET processing_status = 'failed', error_message = %s, completed_at = now(),
                duration_ms = %s, updated_at = now()
            WHERE id = %s
            """,
            (error_message[:4000], duration_ms, step_id),
        )
        cursor.execute(
            """
            UPDATE processing_runs SET processing_status = 'needs_review', error_message = %s,
              updated_at = now() WHERE id = (SELECT processing_run_id FROM processing_steps WHERE id = %s)
            """,
            (error_message[:4000], step_id),
        )


def refresh_fact_run_statuses(connection: Connection[Any]) -> None:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE processing_runs run
            SET processing_status = CASE
                  WHEN EXISTS (
                    SELECT 1 FROM processing_steps failed
                    WHERE failed.processing_run_id = run.id AND failed.processing_status = 'failed'
                  ) THEN 'needs_review'
                  WHEN NOT EXISTS (
                    SELECT 1
                    FROM source_documents document
                    JOIN document_sections section ON section.source_document_id = document.id
                    LEFT JOIN processing_steps step
                      ON step.processing_run_id = run.id AND step.step_key = section.section_id
                    WHERE document.attachment_id = run.attachment_id
                      AND document.processing_status = 'parsed'
                      AND length(trim(section.section_text)) >= 40
                      AND step.processing_status IS DISTINCT FROM 'completed'
                  ) THEN 'completed'
                  ELSE 'received'
                END,
                completed_at = CASE
                  WHEN NOT EXISTS (
                    SELECT 1
                    FROM source_documents document
                    JOIN document_sections section ON section.source_document_id = document.id
                    LEFT JOIN processing_steps step
                      ON step.processing_run_id = run.id AND step.step_key = section.section_id
                    WHERE document.attachment_id = run.attachment_id
                      AND document.processing_status = 'parsed'
                      AND length(trim(section.section_text)) >= 40
                      AND step.processing_status IS DISTINCT FROM 'completed'
                  ) THEN now() ELSE NULL END,
                updated_at = now()
            WHERE run.run_type = 'fact_extraction' AND run.pipeline_version = %s
            """,
            (MARKET_FACT_SCHEMA_VERSION,),
        )

"""Evaluate rollout readiness without changing MARKET_PIPELINE_MODE automatically."""

from __future__ import annotations

import json
import os
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


def evaluate_rollout(connection: Connection, current_mode: str) -> dict:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute("SELECT count(*) documents FROM source_documents")
        documents=cursor.fetchone()["documents"]
        cursor.execute("""
          SELECT count(DISTINCT view.market_date) days
          FROM editorial_views view
          JOIN published_articles article ON article.editorial_view_id=view.id
          WHERE view.publishable=true AND view.is_historical=false
            AND jsonb_array_length(view.audit_issues)=0
            AND article.is_historical=false
            AND article.local_audit_passed=true AND article.llm_review_passed=true
            AND article.publication_status IN ('shadow_saved','draft_created','published')
        """)
        publishable_days=cursor.fetchone()["days"]
        cursor.execute("SELECT count(*) days FROM published_articles WHERE publication_status='draft_created' AND is_historical=false AND local_audit_passed AND llm_review_passed")
        review_days=cursor.fetchone()["days"]
    blockers=[]
    if documents<20: blockers.append(f"shadow documents {documents}/20")
    if publishable_days<10: blockers.append(f"publishable shadow days {publishable_days}/10")
    eligible=None
    if current_mode=="shadow" and not blockers: eligible="review"
    if current_mode=="review" and review_days>=3 and not blockers: eligible="active"
    result={"current_mode":current_mode,"shadow_document_count":documents,"shadow_publishable_days":publishable_days,
            "review_approved_days":review_days,"eligible_next_mode":eligible,"blockers":blockers}
    with connection.transaction(),connection.cursor() as cursor:
        cursor.execute("""UPDATE pipeline_rollout_state SET current_mode=%s,shadow_document_count=%s,
          shadow_publishable_days=%s,review_approved_days=%s,eligible_next_mode=%s,blockers=%s,
          evaluated_at=now(),updated_at=now() WHERE id=true""",
          (current_mode,documents,publishable_days,review_days,eligible,Jsonb(blockers)))
    return result


def main():
    with Connection.connect(os.environ["DATABASE_URL"]) as connection:
        result=evaluate_rollout(connection,os.getenv("MARKET_PIPELINE_MODE","shadow"))
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=="__main__": main()

"""Safe, auditable grouping of adjacent short sections."""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


MERGE_VERSION="section-merge.v1"
MERGE_NAMESPACE=uuid.UUID("a69df8f5-98f2-4f1f-a06d-8fbd7013ea8a")


@dataclass(frozen=True)
class MergeGroup:
    source_document_id: str
    anchor_id: str
    member_ids: list[str]
    original_anchor_text: str
    merged_text: str


def plan_section_merges(rows: list[dict[str,Any]], *, short_below: int=180, maximum_length: int=3000) -> list[MergeGroup]:
    groups: list[MergeGroup]=[]
    current: list[dict[str,Any]]=[]
    def flush() -> None:
        nonlocal current
        if len(current)>1:
            groups.append(MergeGroup(
                source_document_id=str(current[0]["source_document_id"]),anchor_id=str(current[0]["id"]),
                member_ids=[str(item["id"]) for item in current],original_anchor_text=current[0]["section_text"],
                merged_text="\n\n".join(item["section_text"].strip() for item in current),
            ))
        current=[]
    for row in rows:
        if not current:
            current=[row]; continue
        previous=current[-1]
        combined="\n\n".join(item["section_text"].strip() for item in [*current,row])
        compatible=(
            row["source_document_id"]==previous["source_document_id"]
            and row["page_start"]==previous["page_start"]
            and row["section_title"]==previous["section_title"]
            and row["section_index"]==previous["section_index"]+1
            and (len(row["section_text"])<short_below or len(previous["section_text"])<short_below)
            and len(combined)<=maximum_length
        )
        if compatible: current.append(row)
        else: flush(); current=[row]
    flush()
    return groups


def merge_pending_sections(connection: Connection[Any], market_date_from: date, market_date_to: date) -> int:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute("""
          SELECT section.id,section.source_document_id,section.section_index,section.section_title,
                 section.page_start,section.section_text
          FROM document_sections section JOIN source_documents document ON document.id=section.source_document_id
          LEFT JOIN section_merge_records record ON record.anchor_section_id=section.id AND record.active
          WHERE document.market_date BETWEEN %s AND %s AND document.source_verified
            AND document.processing_status='parsed' AND NOT document.needs_review
            AND section.fact_extraction_attempts=0 AND record.id IS NULL
            AND (section.fact_extraction_status='pending' OR
                 (section.fact_extraction_status='skipped' AND section.fact_extraction_reason_code='SKIPPED_TOO_SHORT'))
          ORDER BY section.source_document_id,section.section_index
        """,(market_date_from,market_date_to))
        groups=plan_section_merges(list(cursor.fetchall()))
    with connection.transaction(),connection.cursor() as cursor:
        for group in groups:
            digest=hashlib.sha256(group.merged_text.encode("utf-8")).hexdigest()
            merge_id=f"MERGE-{uuid.uuid5(MERGE_NAMESPACE,':'.join(group.member_ids))}"
            cursor.execute("""
              INSERT INTO section_merge_records(merge_id,merge_version,source_document_id,anchor_section_id,
                member_section_ids,original_anchor_text,merged_text,merged_text_hash,merge_reason)
              VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'adjacent_same_page_title_short') ON CONFLICT DO NOTHING
            """,(merge_id,MERGE_VERSION,group.source_document_id,group.anchor_id,Jsonb(group.member_ids),
                  group.original_anchor_text,group.merged_text,digest))
            if cursor.rowcount!=1: continue
            cursor.execute("""UPDATE document_sections SET section_text=%s,fact_extraction_status='pending',
              fact_extraction_reason_code=NULL,updated_at=now() WHERE id=%s""",(group.merged_text,group.anchor_id))
            cursor.execute("""UPDATE document_sections SET fact_extraction_status='skipped',
              fact_extraction_reason_code='SKIPPED_MERGED',dify_eligible=false,updated_at=now()
              WHERE id=ANY(%s::uuid[]) AND id<>%s""",(group.member_ids,group.anchor_id))
    return len(groups)

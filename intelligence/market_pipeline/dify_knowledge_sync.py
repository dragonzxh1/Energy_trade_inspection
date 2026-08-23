"""Validated sync plan for separated Dify knowledge bases."""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

import httpx
from psycopg import Connection

from .knowledge import load_knowledge_cards, sync_cards_to_obsidian


DATASET_ENV={
    "KB-Commodity-Frameworks":"DIFY_DATASET_ID_COMMODITY_FRAMEWORKS",
    "KB-Market-Events":"DIFY_DATASET_ID_MARKET_EVENTS",
    "KB-Editorial-History":"DIFY_DATASET_ID_EDITORIAL_HISTORY",
    "KB-Raw-Documents":"DIFY_DATASET_ID_RAW_DOCUMENTS",
}


def build_sync_plan() -> dict:
    cards=load_knowledge_cards()
    datasets={name:{"env":env,"dataset_id":os.getenv(env,""),"configured":bool(os.getenv(env))} for name,env in DATASET_ENV.items()}
    return {"documents":len(cards),"datasets":datasets,"retrieval_rule":"one commodity card by metadata; never use vector retrieval for arithmetic"}


def _document_payload(name: str, text: str) -> dict:
    return {
        "name": name,
        "text": text,
        "indexing_technique": "economy",
        "doc_form": "text_model",
        "process_rule": {"mode": "automatic"},
    }


def sync_commodity_cards(base_url: str, api_key: str, dataset_id: str) -> dict:
    cards=load_knowledge_cards()
    headers={"Authorization":f"Bearer {api_key}","Content-Type":"application/json"}
    with tempfile.TemporaryDirectory() as temporary_directory:
        target=Path(temporary_directory)
        paths=sync_cards_to_obsidian(target,cards)
        documents={path.name:path.read_text(encoding="utf-8") for path in paths if path.suffix==".md"}
    response=httpx.get(f"{base_url.rstrip('/')}/v1/datasets/{dataset_id}/documents",headers=headers,params={"limit":100},timeout=60)
    response.raise_for_status()
    existing={item.get("name"):item.get("id") for item in response.json().get("data",[])}
    created=updated=0
    document_ids={}
    for name,text in documents.items():
        document_id=existing.get(name)
        if document_id:
            result=httpx.post(
                f"{base_url.rstrip('/')}/v1/datasets/{dataset_id}/documents/{document_id}/update-by-text",
                headers=headers,json=_document_payload(name,text),timeout=120,
            ); updated+=1
            document_ids[name]=document_id
        else:
            result=httpx.post(
                f"{base_url.rstrip('/')}/v1/datasets/{dataset_id}/document/create-by-text",
                headers=headers,json=_document_payload(name,text),timeout=120,
            ); created+=1
        result.raise_for_status()
        if not document_id:
            response_payload=result.json()
            response_document=response_payload.get("document",{}) if isinstance(response_payload,dict) else {}
            if isinstance(response_document,dict) and response_document.get("id"):
                document_ids[name]=response_document["id"]
    return {"created":created,"updated":updated,"total":len(documents),"document_ids":document_ids}


def mark_cards_dify_synced(database_url: str, document_ids: dict[str,str]) -> int:
    synced=0
    with Connection.connect(database_url) as connection, connection.transaction(), connection.cursor() as cursor:
        for filename,document_id in document_ids.items():
            cursor.execute(
                """
                UPDATE commodity_knowledge_versions
                SET dify_document_id = %s, sync_status = 'dify_synced', sync_error = NULL,
                    synced_at = now(), updated_at = now()
                WHERE commodity_id = %s
                """,
                (document_id,Path(filename).stem),
            )
            synced+=cursor.rowcount
    return synced


def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--dry-run",action="store_true"); args=parser.parse_args()
    plan=build_sync_plan(); print(json.dumps(plan,ensure_ascii=False,indent=2))
    if not args.dry_run and (not os.getenv("DIFY_DATASET_API_KEY") or not all(item["configured"] for item in plan["datasets"].values())):
        raise SystemExit("Dify dataset API key and four dataset IDs are required for live sync")
    if not args.dry_run:
        result=sync_commodity_cards(
            os.getenv("DIFY_BASE_URL","http://127.0.0.1"),os.environ["DIFY_DATASET_API_KEY"],
            os.environ["DIFY_DATASET_ID_COMMODITY_FRAMEWORKS"],
        )
        document_ids=result.pop("document_ids")
        if os.getenv("DATABASE_URL"):
            result["database_rows_synced"]=mark_cards_dify_synced(os.environ["DATABASE_URL"],document_ids)
        print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=="__main__": main()

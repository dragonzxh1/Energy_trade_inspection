from __future__ import annotations

import json
import os
from datetime import date

import httpx

from intelligence.market_pipeline.fact_extraction import (
    call_dify_fact_workflow,
    extract_contract_filter,
    fact_extraction_schema_json,
)


def workflow_outputs(response: httpx.Response) -> dict:
    if response.is_error:
        raise httpx.HTTPStatusError(
            f"workflow returned HTTP {response.status_code}: {response.text[:2000]}",
            request=response.request,
            response=response,
        )
    outputs = response.json().get("data", {}).get("outputs", {})
    if not isinstance(outputs, dict):
        raise ValueError("workflow outputs are not an object")
    return outputs


def run() -> None:
    base_url = os.environ["DIFY_BASE_URL"].rstrip("/")
    extract_key = os.environ["DIFY_WORKFLOW_API_KEY_EXTRACT"]
    writer_key = os.environ["DIFY_WORKFLOW_API_KEY_WRITER"]
    review_key = os.environ["DIFY_WORKFLOW_API_KEY_REVIEW"]
    market_date = date(2026, 7, 31)
    evidence = (
        "Platts reported that the Port Alpha refinery shut one crude unit on July 31, 2026. "
        "The operator said repairs may take seven days and regional diesel supply could tighten."
    )

    extract_response, extract_run_id = call_dify_fact_workflow(
        base_url=base_url,
        api_key=extract_key,
        filename="workflow-v2-smoke.txt",
        market_date=market_date,
        section_id="workflow-v2-smoke-section",
        section_text=evidence,
    )
    contract_filter = extract_contract_filter(extract_response)
    if contract_filter.get("decode_error"):
        raise ValueError(f"extract decode failed: {contract_filter}")

    evidence_payload = {
        "editorial_view": {"article_mode": "event_brief"},
        "facts": [
            {
                "evidence_text": evidence,
                "fact_type": "event",
                "market_date": market_date.isoformat(),
                "source_title": "Platts workflow validation fixture",
            }
        ],
        "source_excerpts": [],
    }
    writer_inputs = {
        "article_mode": "event_brief",
        "date": market_date.isoformat(),
        "evidence_payload": json.dumps(evidence_payload, ensure_ascii=False),
        "article_contract": (
            "Return JSON only with title, summary and report_markdown. "
            "Write a concise Chinese event brief grounded only in the evidence."
        ),
    }
    writer_response = httpx.post(
        f"{base_url}/v1/workflows/run",
        headers={"Authorization": f"Bearer {writer_key}"},
        json={"inputs": writer_inputs, "response_mode": "blocking", "user": "workflow-v2-smoke"},
        timeout=300,
    )
    writer_outputs = workflow_outputs(writer_response)
    markdown = str(writer_outputs.get("report_markdown") or "").strip()
    if not markdown:
        raise ValueError(f"writer markdown missing: {writer_outputs}")

    review_response = httpx.post(
        f"{base_url}/v1/workflows/run",
        headers={"Authorization": f"Bearer {review_key}"},
        json={
            "inputs": {
                "mode": "review",
                "article_mode": "event_brief",
                "date": market_date.isoformat(),
                "report_markdown": markdown,
                "extractions": json.dumps(evidence_payload, ensure_ascii=False),
                "previous_review": "{}",
            },
            "response_mode": "blocking",
            "user": "workflow-v2-smoke",
        },
        timeout=300,
    )
    review_outputs = workflow_outputs(review_response)

    serialized_outputs = json.dumps(
        {"extract": extract_response, "writer": writer_outputs, "review": review_outputs},
        ensure_ascii=False,
    )
    if "<think>" in serialized_outputs.casefold():
        raise ValueError("workflow final outputs contain think tags")

    print(json.dumps({
        "extract_run_id": extract_run_id,
        "extract_contract_filter": contract_filter,
        "writer_fields": sorted(writer_outputs),
        "writer_markdown_length": len(markdown),
        "review_fields": sorted(review_outputs),
        "review_decision": review_outputs.get("decision"),
        "review_score": review_outputs.get("score"),
        "final_outputs_have_think": False,
        "fact_schema_length": len(fact_extraction_schema_json()),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    run()

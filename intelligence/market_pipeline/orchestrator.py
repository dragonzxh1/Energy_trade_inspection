"""Stable script orchestrator for the shadow/review/active market pipeline."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid
from datetime import date


def run_step(
    name: str, module: str, arguments: list[str] | None = None, *, allow_nonzero: bool = False,
) -> dict:
    command=[sys.executable,"-m",module,*(arguments or [])]
    completed=subprocess.run(command,text=True,capture_output=True)
    result={"step":name,"command":command,"returncode":completed.returncode,
            "stdout":completed.stdout[-8000:],"stderr":completed.stderr[-8000:]}
    print(json.dumps(result,ensure_ascii=False),flush=True)
    if completed.returncode and not allow_nonzero:
        raise RuntimeError(f"pipeline step failed: {name}")
    return result


def parse_step_summary(result: dict) -> dict:
    for line in reversed(result.get("stdout", "").splitlines()):
        try:
            value=json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value,dict) and "run_id" in value:
            return value
    raise RuntimeError("fact extraction did not return an auditable run summary")


def validate_fact_extraction_summary(summary: dict) -> None:
    eligible_documents=int(summary.get("documents_with_eligible_sections",0))
    covered_documents=int(summary.get("documents_covered",summary.get("documents_attempted",0)))
    attempted_sections=int(summary.get("attempted_sections",0))
    completed_sections=int(summary.get("completed_sections",0))
    pending_sections=int(summary.get("pending_sections",0))
    document_coverage=1.0 if eligible_documents == 0 else covered_documents/eligible_documents
    if eligible_documents and document_coverage < float(os.getenv("MARKET_FACT_MIN_DOCUMENT_COVERAGE","0.8")):
        raise RuntimeError(
            f"fact extraction document coverage {document_coverage:.3f} is below required minimum"
        )
    reason_breakdown = summary.get("reason_breakdown", {})
    facts_completed = int(reason_breakdown.get("COMPLETED_WITH_FACTS", 0))
    if eligible_documents and attempted_sections == 0 and completed_sections == 0 and facts_completed == 0 and pending_sections > 0:
        raise RuntimeError("fact extraction left pending sections without attempting work")
    if attempted_sections > 0 and completed_sections == 0:
        raise RuntimeError("fact extraction produced no completed sections for an eligible date")


def build_fact_worker_arguments(target_date: str, run_id: str) -> list[str]:
    return [
        "--date",target_date,"--run-id",run_id,
        "--max-sections",os.getenv("MARKET_FACT_MAX_SECTIONS","100"),
        "--max-sections-per-document",os.getenv("MARKET_FACT_MAX_SECTIONS_PER_DOCUMENT","10"),
    ]


def main():
    parser=argparse.ArgumentParser(description="Run ETI structured market pipeline")
    parser.add_argument("--date",default=date.today().isoformat()); parser.add_argument("--historical",action="store_true")
    parser.add_argument("--skip-facts",action="store_true")
    parser.add_argument(
        "--with-publication",
        action="store_true",
        help="Explicit manual compatibility mode; scheduled processing never publishes",
    )
    args=parser.parse_args()
    results=[]
    fact_run_id=f"RUN-{args.date}-FACT-{uuid.uuid4().hex[:12]}"
    results.append(run_step("document_parse","intelligence.market_pipeline.document_worker",["--limit",os.getenv("MARKET_DOCUMENT_BATCH_LIMIT","20")]))
    if not args.skip_facts:
        fact_result=run_step(
            "fact_extract","intelligence.market_pipeline.fact_worker",
            build_fact_worker_arguments(args.date,fact_run_id),
            allow_nonzero=True,
        )
        results.append(fact_result)
        summary=parse_step_summary(fact_result)
        validate_fact_extraction_summary(summary)
        results.append(run_step(
            "structured_table_facts", "intelligence.table_fact_worker",
            ["--date-from", args.date, "--date-to", args.date],
        ))
    results.append(run_step(
        "fact_validation", "intelligence.market_pipeline.validation_worker", ["--date", args.date],
    ))
    results.append(run_step("metrics_signals","intelligence.market_pipeline.analysis_worker"))
    if args.with_publication:
        publication_args=["--date",args.date]+(["--historical"] if args.historical else [])
        results.append(run_step("editorial_publication","intelligence.market_pipeline.publication_worker",publication_args))
    results.append(run_step(
        "obsidian_sync", "intelligence.market_pipeline.obsidian_sync", ["--date", args.date],
    ))
    results.append(run_step("observability","intelligence.market_pipeline.observability"))
    results.append(run_step("rollout","intelligence.market_pipeline.rollout"))
    print(json.dumps({"ok":True,"date":args.date,"steps":len(results)},ensure_ascii=False),flush=True)


if __name__=="__main__": main()

from __future__ import annotations

import unittest

from intelligence.market_pipeline.fact_retry import classify_extraction_error,completion_reason,run_with_retry
from intelligence.market_pipeline.fact_scheduling import extraction_text_for_section,fair_schedule,is_energy_relevant_section
from intelligence.market_pipeline.section_triage import triage_section
from intelligence.market_pipeline.orchestrator import (
    build_fact_worker_arguments,
    parse_step_summary,
    validate_fact_extraction_summary,
)
from intelligence.market_pipeline.fact_extraction import call_dify_fact_workflow,extract_contract_filter
from intelligence.market_pipeline.fact_worker import connect_fact_database
from intelligence.market_pipeline.fact_repository import prepare_fact_sections,recover_expired_section_leases,reopen_contract_invalid_sections
from intelligence.market_pipeline.daily_scheduler import recent_pending_dates, run_date
from unittest.mock import MagicMock,Mock,patch


class FactSchedulingTest(unittest.TestCase):
    def test_worker_batch_size_controls_parallel_dify_calls(self):
        import inspect
        from intelligence.market_pipeline import fact_worker

        source=inspect.getsource(fact_worker.main)
        self.assertIn("ThreadPoolExecutor(max_workers=min(args.batch_size, len(batch)))",source)
        self.assertIn("future.result()",source)

    def test_boilerplate_sections_are_skipped_before_scheduling(self):
        connection=MagicMock()
        cursor=connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value=[]
        prepare_fact_sections(
            connection,__import__('datetime').date(2026,7,7),__import__('datetime').date(2026,7,7)
        )
        queries="\n".join(call.args[0] for call in cursor.execute.call_args_list)
        self.assertIn("trade data: s&p global energy has defined standards",queries)
        self.assertIn("SKIPPED_BOILERPLATE",queries)
        self.assertIn("length(section.section_text) <= 1200",queries)
        self.assertIn("lower(trim(section.section_text))",queries)
        self.assertIn("section.section_type",queries)

    def test_local_triage_prioritizes_prices_and_disruptions(self):
        price=triage_section("Asia diesel assessments", "ULSD was $92.45/mt, up $1.20/mt. " * 3)
        disruption=triage_section("Refinery outage", "A shutdown disrupted crude supply and reduced output. " * 3)
        general=triage_section("Company update", "The company announced its quarterly meeting without market data. " * 3)
        self.assertEqual(price.category,"price_assessment")
        self.assertGreater(price.score,disruption.score)
        self.assertGreater(disruption.score,general.score)
        self.assertLessEqual(price.score,100)
        self.assertIn("price_value",price.reasons)
        self.assertTrue(price.dify_eligible)
        self.assertTrue(disruption.dify_eligible)
        self.assertFalse(general.dify_eligible)

    def test_too_short_section_is_not_left_pending_for_worker(self):
        result=triage_section("Asia diesel assessment", "ULSD was assessed at $92.45/mt.")
        self.assertFalse(result.dify_eligible)
        self.assertEqual(result.reason_code,"SKIPPED_TOO_SHORT")

    def test_local_triage_deprioritizes_boilerplate(self):
        result=triage_section("Methodology", "Copyright and methodology information.")
        self.assertEqual(result.category,"boilerplate")
        self.assertLess(result.score,10)

    def test_methodology_word_inside_market_text_is_not_dropped(self):
        result=triage_section("Market review", "The methodology change affected refinery supply reporting.")
        self.assertNotEqual(result.category,"boilerplate")

    def test_late_price_reference_does_not_reclassify_summary_as_price(self):
        result=triage_section("Executive Summary", "Supply remained tight. " + ("context " * 300) + "Price was $92.45/mt.")
        self.assertNotEqual(result.category,"price_assessment")

    def test_worker_audit_persists_local_triage_reason(self):
        from intelligence.market_pipeline.fact_worker import _input_audit
        audit=_input_audit({
            "source_id":"SRC-1", "section_id":"SEC-1", "market_date":__import__('datetime').date(2026,7,17),
            "attachment_name":"report.pdf", "section_title":"Diesel assessment",
            "section_text":"ULSD was assessed at $92.45/mt. " * 3, "section_type":"market_commentary",
            "section_priority":100, "page_start":1,
        }, "RUN-1")
        self.assertEqual(audit["triage"]["category"],"price_assessment")
        self.assertIn("price_value",audit["triage"]["reasons"])

    def test_claim_query_requires_high_value_triage_score(self):
        from pathlib import Path
        source=Path("intelligence/market_pipeline/fact_repository.py").read_text(encoding="utf-8")
        self.assertIn("section.dify_eligible = true",source)

    def test_expired_processing_markers_return_to_pending(self):
        connection=MagicMock()
        cursor=connection.cursor.return_value.__enter__.return_value
        cursor.rowcount=4
        recovered=recover_expired_section_leases(
            connection,__import__('datetime').date(2026,7,10),__import__('datetime').date(2026,7,11)
        )
        self.assertEqual(recovered,4)
        query=cursor.execute.call_args.args[0]
        self.assertIn("lease_expires_at < now()",query)
        self.assertIn("fact_extraction_status='pending'",query)

    def test_energy_relevance_excludes_unrelated_financial_news(self):
        keywords=["oil","natural gas","solar","wind power","refinery"]
        self.assertFalse(is_energy_relevant_section("Bitcoin funds", "Bitcoin fell 30%.", keywords))
        self.assertTrue(is_energy_relevant_section("Markets", "Refinery outages lifted oil prices.", keywords))
        self.assertTrue(is_energy_relevant_section("Power", "Solar capacity expanded.", keywords))

    def test_corporate_bond_table_is_not_energy_market_content(self):
        keywords=["oil","energy","utility","lng","refinery"]
        text=("High-yield issues with the largest price decrease. Company Energy Holdings. "
              "Coupon 7.500 Yield 6.93 Maturity April 15 2031 Credit spread 102 Bond price 100.402")
        self.assertFalse(is_energy_relevant_section("Corporate bonds",text,keywords))

    def test_mixed_bond_and_energy_table_focuses_on_energy_block(self):
        text=("Bloomberg Fixed Income Indices Yield (%) Tracking Bond Benchmarks Treasurys "
              "Mortgage-Backed 5.10. Weekly Demand, 000s barrels per day Finished motor "
              "gasoline 8,845 Natural gas storage Billions of cubic feet.")
        focused=extraction_text_for_section("Europe High Yield",text)
        self.assertTrue(focused.startswith("Weekly Demand"))
        self.assertNotIn("Bond Benchmarks",focused)
        self.assertIn("gasoline 8,845",focused)

    def test_normal_energy_section_is_not_trimmed(self):
        text="Crude oil inventories fell by 1.4 million barrels last week."
        self.assertEqual(extraction_text_for_section("Oil",text),text)

    def test_contract_upgrade_reopens_only_explicit_validation_failures(self):
        connection=MagicMock()
        cursor=connection.cursor.return_value.__enter__.return_value
        cursor.rowcount=3
        reopened=reopen_contract_invalid_sections(
            connection,__import__('datetime').date(2026,7,10),__import__('datetime').date(2026,7,11)
        )
        self.assertEqual(reopened,3)
        query=cursor.execute.call_args.args[0]
        self.assertIn("number.required",query)
        self.assertIn("unit.supported",query)
        self.assertIn("fact_extraction_status='completed'",query)

    def test_contract_upgrade_retry_has_claim_priority(self):
        from pathlib import Path
        source=Path("intelligence/market_pipeline/fact_repository.py").read_text(encoding="utf-8")
        self.assertIn("WHEN section.fact_extraction_reason_code='RETRY_AFTER_CONTRACT_UPGRADE' THEN 0",source)

    def test_retry_terminal_also_claims_reopened_failed_sections(self):
        from pathlib import Path
        source=Path("intelligence/market_pipeline/fact_worker.py").read_text(encoding="utf-8")
        self.assertIn("retry_failed=args.retry_failed or args.retry_terminal",source)

    @patch("intelligence.market_pipeline.fact_worker.Connection.connect")
    def test_worker_connection_commits_each_lease_and_result(self, connect):
        connect_fact_database("postgresql://test")
        connect.assert_called_once_with("postgresql://test", autocommit=True)

    @patch.dict("os.environ", {"MARKET_PIPELINE_START_DATE": ""})
    def test_scheduler_queries_only_recent_late_dates(self):
        connection=MagicMock()
        cursor=connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value=[(__import__('datetime').date(2026,7,10),)]
        result=recent_pending_dates(connection,__import__('datetime').date(2026,7,11),1)
        self.assertEqual(result,[__import__('datetime').date(2026,7,10)])
        query,parameters=cursor.execute.call_args.args
        self.assertIn("document.market_date <> %s",query)
        self.assertIn("fact.updated_at > COALESCE",query)
        self.assertIn("'generation_failed', 'publish_failed'",query)
        self.assertEqual(parameters[0],__import__('datetime').date(2026,7,10))

    @patch("intelligence.market_pipeline.daily_scheduler.subprocess.run")
    def test_scheduler_date_failure_is_returned_without_raising(self, subprocess_run):
        subprocess_run.return_value.returncode=1
        result=run_date(__import__('datetime').date(2026,7,10),historical=True)
        self.assertEqual(result.returncode,1)
        self.assertIn("--historical",subprocess_run.call_args.args[0])
        self.assertFalse(subprocess_run.call_args.kwargs["check"])

    def test_orchestrator_passes_explicit_target_date_and_run_id(self):
        arguments=build_fact_worker_arguments("2026-07-07","RUN-TEST")
        self.assertEqual(arguments[:4],["--date","2026-07-07","--run-id","RUN-TEST"])

    def test_orchestrator_accepts_partial_run_with_date_coverage(self):
        summary={"run_id":"RUN-1","documents_with_eligible_sections":7,
                 "documents_attempted":1,"documents_covered":7,
                 "attempted_sections":14,"completed_sections":13,
                 "failed_terminal_sections":1}
        validate_fact_extraction_summary(summary)

    def test_orchestrator_rejects_date_where_every_attempt_failed(self):
        summary={"run_id":"RUN-1","documents_with_eligible_sections":2,
                 "documents_attempted":2,"attempted_sections":2,"completed_sections":0}
        with self.assertRaisesRegex(RuntimeError,"no completed sections"):
            validate_fact_extraction_summary(summary)

    def test_orchestrator_accepts_fully_processed_rerun_without_new_attempts(self):
        summary={"run_id":"RUN-1","documents_with_eligible_sections":2,
                 "documents_attempted":0,"documents_covered":2,
                 "attempted_sections":0,"completed_sections":0,"pending_sections":0}
        validate_fact_extraction_summary(summary)

    def test_orchestrator_parses_summary_after_worker_logs(self):
        result={"stdout":"SEC-1 facts=2\n{\"run_id\":\"RUN-1\",\"completed_sections\":1}\n"}
        self.assertEqual(parse_step_summary(result)["run_id"],"RUN-1")

    def test_round_robin_limits_large_document(self):
        sections=[]
        for document,count in (("A",300),("B",20),("C",8)):
            sections.extend({"source_document_id":document,"section_priority":50,"section_index":index} for index in range(count))
        selected=fair_schedule(sections,max_sections=15,max_sections_per_document=5)
        counts={document:sum(item["source_document_id"]==document for item in selected) for document in "ABC"}
        self.assertEqual(counts,{"A":5,"B":5,"C":5})

    def test_priority_wins_within_each_document(self):
        sections=[
            {"source_document_id":"A","section_priority":10,"section_index":0},
            {"source_document_id":"A","section_priority":100,"section_index":1},
            {"source_document_id":"B","section_priority":40,"section_index":0},
        ]
        selected=fair_schedule(sections,max_sections=2,max_sections_per_document=1)
        self.assertEqual([(item["source_document_id"],item["section_index"]) for item in selected],[('A',1),('B',0)])

    def test_first_document_batch_covers_distinct_market_dimensions(self):
        sections=[
            {"source_document_id":"A","section_priority":100,"section_index":0,"section_title":"Price table","section_text":"Crude price $/bbl"},
            {"source_document_id":"A","section_priority":100,"section_index":1,"section_title":"Derivatives","section_text":"Crude price spread $/bbl"},
            {"source_document_id":"A","section_priority":80,"section_index":2,"section_title":"Supply","section_text":"Refinery outage tightened supply"},
            {"source_document_id":"A","section_priority":75,"section_index":3,"section_title":"Flows","section_text":"Cargo exports and tanker freight increased"},
        ]
        selected=fair_schedule(sections,max_sections=3,max_sections_per_document=3)
        self.assertEqual([item["section_index"] for item in selected],[0,2,3])


class FactRetryTest(unittest.TestCase):
    @patch("intelligence.market_pipeline.fact_extraction.httpx.post")
    def test_retry_feedback_is_added_to_dify_task(self,post):
        response=Mock(); response.json.return_value={"workflow_run_id":"wf","data":{"outputs":{"facts":[]}}}
        post.return_value=response
        call_dify_fact_workflow(base_url="http://dify",api_key="key",filename="x.pdf",
            market_date=__import__('datetime').date(2026,7,7),section_id="SEC-1",section_text="text",
            validation_feedback="numeric unit must appear verbatim")
        task=post.call_args.kwargs["json"]["inputs"]["template_task"]
        self.assertIn("UNIT_NOT_VERBATIM",task)
        self.assertLess(len(task),1024)

    @patch("intelligence.market_pipeline.fact_extraction.httpx.post")
    def test_missing_required_price_number_adds_contract_feedback(self,post):
        response=Mock(); response.is_error=False
        response.json.return_value={"workflow_run_id":"wf","data":{"outputs":{"facts":[]}}}
        post.return_value=response
        call_dify_fact_workflow(base_url="http://dify",api_key="key",filename="x.pdf",
            market_date=__import__('datetime').date(2026,7,7),section_id="SEC-1",section_text="Prices rose.",
            validation_feedback="price_change requires change_value and its original change_unit")
        task=post.call_args.kwargs["json"]["inputs"]["template_task"]
        self.assertIn("MISSING_REQUIRED_NUMBER",task)
        self.assertLess(len(task),1024)

    def test_failed_contract_preserves_raw_response(self):
        attempts=[]
        def operation():
            error=ValueError("Dify output does not contain a facts array")
            error.raw_payload={"outputs":{"text":"invalid"}}
            error.workflow_run_id="workflow-1"
            raise error
        with self.assertRaises(ValueError):
            run_with_retry(operation,max_attempts=1,initial_delay_seconds=0,backoff_multiplier=2,
                on_attempt=lambda number,reason,workflow,payload,error:attempts.append((workflow,payload)),sleep=lambda _:None)
        self.assertEqual(attempts,[("workflow-1",{"outputs":{"text":"invalid"}})])

    def test_missing_facts_is_retryable(self):
        self.assertEqual(classify_extraction_error(ValueError("Dify output does not contain a facts array")),"DIFY_SCHEMA_MISSING_FACTS")

    def test_contract_all_rejected_is_retryable(self):
        self.assertEqual(
            classify_extraction_error(ValueError("Dify contract filter rejected all model facts")),
            "DIFY_CONTRACT_ALL_REJECTED",
        )

    def test_contract_filter_metadata_survives_result_wrapper(self):
        payload = {"data": {"outputs": {"result": '{"schema_version":"market-fact.v1","facts":[],"contract_filter":{"model_facts_count":2,"accepted_facts_count":0,"rejected_facts_count":2}}'}}}
        metadata = extract_contract_filter(payload)
        self.assertEqual(metadata["model_facts_count"], 2)
        self.assertEqual(metadata["rejected_facts_count"], 2)

    def test_contract_filter_metadata_survives_direct_output(self):
        payload = {"facts": [], "contract_filter": {"model_facts_count": 2, "accepted_facts_count": 0}}
        self.assertEqual(extract_contract_filter(payload)["model_facts_count"], 2)

    def test_all_filtered_facts_are_audited_empty_result(self):
        payload = {
            "_dify_contract_filter": {
                "model_facts_count": 3,
                "accepted_facts_count": 0,
                "rejected_facts_count": 3,
            }
        }
        self.assertEqual(completion_reason(payload, []), "NO_VALID_FACTS_AFTER_FILTER")

    def test_partial_rejections_are_visible(self):
        payload = {"_local_validation": {"rejected_facts": ["invalid unit"]}}
        self.assertEqual(completion_reason(payload, [object()]), "COMPLETED_WITH_PARTIAL_REJECTIONS")

    def test_schema_failure_retries_then_succeeds(self):
        calls=[]
        def operation():
            calls.append(1)
            if len(calls)<3:
                raise ValueError("Dify output does not contain a facts array")
            return {"facts":[]},"workflow",[]
        attempts=[]
        result=run_with_retry(operation,max_attempts=3,initial_delay_seconds=0,backoff_multiplier=2,
            on_attempt=lambda number,reason,*_:attempts.append((number,reason)),sleep=lambda _:None)
        self.assertEqual(result[2],[])
        self.assertEqual(attempts,[(1,"DIFY_SCHEMA_MISSING_FACTS"),(2,"DIFY_SCHEMA_MISSING_FACTS"),(3,"NO_FACTS_FOUND")])

    def test_schema_failure_stops_after_max_attempts(self):
        attempts=[]
        with self.assertRaises(ValueError):
            run_with_retry(lambda: (_ for _ in ()).throw(ValueError("Dify output does not contain a facts array")),
                max_attempts=3,initial_delay_seconds=0,backoff_multiplier=2,
                on_attempt=lambda number,reason,*_:attempts.append((number,reason)),sleep=lambda _:None)
        self.assertEqual(len(attempts),3)


if __name__=="__main__": unittest.main()

"""Daily pipeline health, alerts, and article quality metrics."""

from __future__ import annotations

import json
import os
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from intelligence.content_streams import digital_source_channels


OBSERVABILITY_VERSION="market-pipeline.v1"


def refresh_observability(connection: Connection, pipeline_mode: str) -> dict:
    allowed_channels = list(digital_source_channels())
    with connection.transaction(),connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute("""SELECT view.market_date,view.publishable,view.view_change_type,
          view.evidence_ready,view.editorially_publishable,
          view.directional_signal_available,view.article_mode,
          article.id article_id,article.local_audit_passed,article.llm_review_passed,
          article.is_historical
          FROM editorial_views view
          LEFT JOIN published_articles article ON article.editorial_view_id=view.id
          ORDER BY view.market_date""")
        views=list(cursor.fetchall())
        for view in views:
            market_date=view["market_date"]
            cursor.execute(
                """SELECT count(*) total,
                          count(*) FILTER(WHERE document.processing_status='parsed') parsed
                   FROM source_documents document
                   WHERE document.market_date=%s
                     AND EXISTS (
                       SELECT 1
                       FROM telegram_message_attachments linked
                       JOIN telegram_messages message ON message.id=linked.message_id
                       WHERE linked.attachment_id=document.attachment_id
                         AND message.source_channel=ANY(%s)
                     )""",
                (market_date, allowed_channels),
            ); docs=cursor.fetchone()
            cursor.execute("SELECT count(*) total,count(*) filter(where verification_status='verified') verified,count(*) filter(where verification_status='rejected') rejected,count(*) filter(where verification_status='needs_review') review FROM market_facts WHERE market_date=%s AND is_current",(market_date,)); facts=cursor.fetchone()
            cursor.execute("""SELECT
              count(*) FILTER(WHERE queue.priority IN ('high','critical')) high_risk,
              count(*) FILTER(WHERE queue.priority NOT IN ('high','critical')) routine,
              count(*) FILTER(WHERE queue.priority='critical') critical
              FROM fact_review_queue queue
              JOIN market_facts fact ON fact.id=queue.market_fact_id
              WHERE fact.market_date=%s AND fact.is_current=true AND queue.queue_status='pending'""",
              (market_date,)); review_queue=cursor.fetchone()
            cursor.execute("SELECT count(*) total FROM market_signals WHERE market_date=%s",(market_date,)); signals=cursor.fetchone()
            status="no_signal" if view["view_change_type"]=="low_signal" else ("completed" if view["publishable"] else "needs_review")
            content_ready=view["article_id"] is not None
            quality_gate_passed=bool(
                view["publishable"] and view["local_audit_passed"] and view["llm_review_passed"]
            )
            publish_execution_allowed=bool(
                quality_gate_passed and not view["is_historical"] and pipeline_mode in {"review","active"}
            )
            cursor.execute("""INSERT INTO pipeline_daily_runs (market_date,pipeline_version,pipeline_mode,run_status,
              completed_at,document_count,fact_count,verified_fact_count,rejected_fact_count,needs_review_count,
              signal_count,publishable,content_ready,quality_gate_passed,publish_execution_allowed,
              evidence_ready,editorially_publishable,directional_signal_available,article_mode,metadata)
              VALUES (%s,%s,%s,%s,now(),%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
              ON CONFLICT (market_date,pipeline_version) DO UPDATE SET pipeline_mode=EXCLUDED.pipeline_mode,
              run_status=EXCLUDED.run_status,completed_at=now(),document_count=EXCLUDED.document_count,
              fact_count=EXCLUDED.fact_count,verified_fact_count=EXCLUDED.verified_fact_count,
              rejected_fact_count=EXCLUDED.rejected_fact_count,needs_review_count=EXCLUDED.needs_review_count,
              signal_count=EXCLUDED.signal_count,publishable=EXCLUDED.publishable,
              content_ready=EXCLUDED.content_ready,quality_gate_passed=EXCLUDED.quality_gate_passed,
              publish_execution_allowed=EXCLUDED.publish_execution_allowed,
              evidence_ready=EXCLUDED.evidence_ready,
              editorially_publishable=EXCLUDED.editorially_publishable,
              directional_signal_available=EXCLUDED.directional_signal_available,
              article_mode=EXCLUDED.article_mode,
              metadata=EXCLUDED.metadata,updated_at=now()
              RETURNING id""",(
                market_date,OBSERVABILITY_VERSION,pipeline_mode,status,docs["total"],facts["total"],
                facts["verified"],facts["rejected"],facts["review"],signals["total"],view["publishable"],
                content_ready,quality_gate_passed,publish_execution_allowed,view["evidence_ready"],
                view["editorially_publishable"],view["directional_signal_available"],view["article_mode"],
                Jsonb({"parsed_documents":docs["parsed"]}),
              ))
            run_id=cursor.fetchone()["id"]
            cursor.execute("DELETE FROM pipeline_alerts WHERE pipeline_daily_run_id=%s AND alert_status='open'",(run_id,))
            if review_queue["high_risk"]:
                severity="critical" if review_queue["critical"] else "high"
                cursor.execute("INSERT INTO pipeline_alerts(pipeline_daily_run_id,alert_type,severity,message,details) VALUES(%s,'high_risk_fact_review',%s,%s,%s)",(run_id,severity,f"{review_queue['high_risk']} high-risk facts require review",Jsonb({"count":review_queue["high_risk"],"critical":review_queue["critical"]})))
            if review_queue["routine"]:
                cursor.execute("INSERT INTO pipeline_alerts(pipeline_daily_run_id,alert_type,severity,message,details) VALUES(%s,'fact_quality_review','warning',%s,%s)",(run_id,f"{review_queue['routine']} routine fact-quality issues require review",Jsonb({"count":review_queue["routine"]})))
        cursor.execute("""SELECT article.id article_id,article.publication_status,view.view_json
          FROM published_articles article JOIN editorial_views view ON view.id=article.editorial_view_id""")
        articles=list(cursor.fetchall())
        for article in articles:
            view=article["view_json"]
            traceability=1.0 if not view.get("supporting_fact_ids") or all(view.get("supporting_fact_ids")) else 0.0
            cursor.execute("""INSERT INTO article_quality_metrics(published_article_id,metric_version,
              numeric_traceability_rate,unique_main_thesis,has_counter_signal,has_invalidation_conditions,
              validation_metric_count,unsupported_number_count,details)
              VALUES(%s,'article-quality.v1',%s,true,%s,%s,%s,0,%s)
              ON CONFLICT(published_article_id,metric_version) DO UPDATE SET numeric_traceability_rate=EXCLUDED.numeric_traceability_rate,
              unique_main_thesis=EXCLUDED.unique_main_thesis,has_counter_signal=EXCLUDED.has_counter_signal,
              has_invalidation_conditions=EXCLUDED.has_invalidation_conditions,validation_metric_count=EXCLUDED.validation_metric_count,
              unsupported_number_count=EXCLUDED.unsupported_number_count,details=EXCLUDED.details,calculated_at=now()""",
              (article["article_id"],traceability,bool(view.get("counter_signals")),bool(view.get("invalidation_conditions")),len(view.get("validation_metrics",[])),Jsonb({"publication_status":article["publication_status"]})))
    return {"daily_runs":len(views),"articles":len(articles)}


def main():
    with Connection.connect(os.environ["DATABASE_URL"]) as connection:
        result=refresh_observability(connection,os.getenv("MARKET_PIPELINE_MODE","shadow"))
    print(json.dumps(result,ensure_ascii=False),flush=True)


if __name__=="__main__": main()

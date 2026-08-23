from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


ROOT = Path(__file__).parents[1]


class DigitTopicPublicationMigrationTests(unittest.TestCase):
    def test_058_schema_is_incremental_stable_reversible_and_validated(self) -> None:
        migration = ROOT / "db" / "migrations" / "058_digit_topic_publications.sql"
        rollback = ROOT / "db" / "rollbacks" / "058_digit_topic_publications.down.sql"
        validation = ROOT / "db" / "validation" / "058_digit_topic_publications.sql"

        self.assertTrue(migration.is_file())
        self.assertTrue(rollback.is_file())
        self.assertTrue(validation.is_file())

        sql = " ".join(migration.read_text(encoding="utf-8").lower().split())
        self.assertIn("create table digit_topic_publications", sql)
        self.assertIn("references published_articles(id) on delete restrict", sql)
        self.assertIn("publication_key text not null unique", sql)
        self.assertIn(
            "unique (market_date, article_slug, publication_action)", sql,
        )
        self.assertIn("media_id text", sql)
        self.assertIn("publish_id text", sql)
        self.assertIn("publication_result jsonb", sql)
        self.assertIn("error_message text", sql)
        self.assertIn("active boolean", sql)
        self.assertNotIn("drop table", sql)

        rollback_sql = rollback.read_text(encoding="utf-8").lower()
        self.assertIn("drop table if exists digit_topic_publications", rollback_sql)
        self.assertIn("058_digit_topic_publications.sql", rollback_sql)

        validation_sql = validation.read_text(encoding="utf-8").lower()
        self.assertIn("orphan", validation_sql)
        self.assertIn("unstable_publication_key", validation_sql)
        self.assertIn("missing_success_reference", validation_sql)
        self.assertIn("aggregate_reference", validation_sql)

    def test_058_aggregate_reference_static_fixture_matches_python_id_priority(self) -> None:
        from intelligence.market_pipeline import publication_worker

        validation_sql = (
            ROOT / "db" / "validation" / "058_digit_topic_publications.sql"
        ).read_text(encoding="utf-8")
        aggregate_check = validation_sql.split(
            "SELECT 'aggregate_reference_missing'", 1,
        )[1].split(";", 1)[0].lower()
        sql_priority = re.findall(
            r"nullif\(\s*btrim\(\s*topic\.(publish_id|media_id)\s*\)\s*,\s*''\s*\)",
            aggregate_check,
        )

        self.assertEqual(sql_priority, ["publish_id", "media_id"])
        self.assertNotIn("topic.publication_status", aggregate_check)

        fixture = {
            "publication_status": "publish_failed",
            "publish_id": " PUBLISH-CRUDE ",
            "media_id": " MEDIA-CRUDE ",
            "publication_reference": "PUBLISH-CRUDE",
        }
        sql_reference = next(
            (
                str(fixture[field]).strip()
                for field in sql_priority
                if str(fixture.get(field) or "").strip()
            ),
            "",
        )

        self.assertEqual(
            sql_reference,
            publication_worker._topic_publication_reference(fixture),
        )
        self.assertEqual(sql_reference, fixture["publication_reference"])

    def test_058_success_statuses_still_require_their_specific_ids(self) -> None:
        validation_sql = " ".join((
            ROOT / "db" / "validation" / "058_digit_topic_publications.sql"
        ).read_text(encoding="utf-8").lower().split())
        success_check = validation_sql.split(
            "select 'missing_success_reference'", 1,
        )[1].split("union all", 1)[0]

        self.assertIn(
            "publication_status = 'published' and nullif(btrim(publish_id), '') is null",
            success_check,
        )
        self.assertIn(
            "publication_status = 'draft_created' and nullif(btrim(media_id), '') is null",
            success_check,
        )


class DigitTopicPublicationWorkerTests(unittest.TestCase):
    def test_publish_result_retains_both_ids_and_raw_result(self) -> None:
        from intelligence.market_pipeline import publication_worker

        payload = {
            "action": "publish",
            "media_id": "MEDIA-CRUDE",
            "publish_id": "PUBLISH-CRUDE",
            "result_path": "publish/crude.json",
        }

        rows = publication_worker.publish_topics_independently(
            [{
                "article_slug": "01-crude",
                "local_audit_status": "pass",
                "llm_review_status": "pass",
                "publication_status": "shadow_saved",
                "publication_action": "shadow",
            }],
            date(2026, 7, 10),
            action="publish",
            historical=False,
            runner=lambda *_args, **_kwargs: SimpleNamespace(stdout=json.dumps(payload)),
        )

        self.assertEqual(rows[0]["publication_action"], "publish")
        self.assertEqual(rows[0]["publication_status"], "published")
        self.assertEqual(rows[0]["media_id"], "MEDIA-CRUDE")
        self.assertEqual(rows[0]["publish_id"], "PUBLISH-CRUDE")
        self.assertEqual(rows[0]["publication_result"], payload)

    def test_nonzero_publish_recovers_structured_result_and_aggregate_reference(self) -> None:
        from intelligence.market_pipeline import publication_worker

        payload = {
            "ok": False,
            "action": "publish",
            "media_id": "MEDIA-CRUDE",
            "publish_id": "PUBLISH-CRUDE",
            "error": "TimeoutError: publish polling timed out",
            "publish_status_response": {"publish_status": 1},
        }

        def fail(command, **_kwargs):
            raise subprocess.CalledProcessError(
                1,
                command,
                output=json.dumps(payload),
                stderr="publisher exited nonzero",
            )

        rows = publication_worker.publish_topics_independently(
            [self._entry("01-crude", "shadow", "shadow_saved")],
            date(2026, 7, 10),
            action="publish",
            historical=False,
            runner=fail,
        )

        self.assertEqual(rows[0]["publication_status"], "publish_failed")
        self.assertEqual(rows[0]["publication_action"], "publish")
        self.assertEqual(rows[0]["media_id"], "MEDIA-CRUDE")
        self.assertEqual(rows[0]["publish_id"], "PUBLISH-CRUDE")
        self.assertEqual(rows[0]["publication_reference"], "PUBLISH-CRUDE")
        self.assertEqual(rows[0]["publication_result"], payload)
        self.assertIn("publish polling timed out", rows[0]["error"])
        self.assertIn("CalledProcessError", rows[0]["error"])

        aggregate = publication_worker.build_daily_aggregate_article(
            date(2026, 7, 10), Path("reports/digit/2026-07-10"), rows, {},
            is_historical=False,
        )
        self.assertEqual(
            aggregate["review_json"]["articles"][0]["publication_reference"],
            "PUBLISH-CRUDE",
        )

    def test_nonzero_publish_falls_back_to_locator_state(self) -> None:
        from intelligence.content_streams import ArticleLocator, resolve_article_paths
        from intelligence.market_pipeline import publication_worker

        payload = {
            "action": "publish",
            "media_id": "MEDIA-STATE",
            "publish_id": "PUBLISH-STATE",
            "error": "RuntimeError: WeChat polling failed",
            "draft_response": {"media_id": "MEDIA-STATE"},
        }

        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_root = Path(temporary_directory) / "reports"
            locator = ArticleLocator("digit", date(2026, 7, 10), "01-crude")
            state_path = resolve_article_paths(locator, reports_root).publish_state_path("publish")
            state_path.parent.mkdir(parents=True, exist_ok=True)
            state_path.write_text(json.dumps(payload), encoding="utf-8")

            def fail(command, **_kwargs):
                raise subprocess.CalledProcessError(
                    2,
                    command,
                    output="publisher terminated after state write",
                    stderr="process failed",
                )

            rows = publication_worker.publish_topics_independently(
                [self._entry("01-crude", "shadow", "shadow_saved")],
                date(2026, 7, 10),
                action="publish",
                historical=False,
                reports_root=reports_root,
                runner=fail,
            )

        self.assertEqual(rows[0]["publication_action"], "publish")
        self.assertEqual(rows[0]["media_id"], "MEDIA-STATE")
        self.assertEqual(rows[0]["publish_id"], "PUBLISH-STATE")
        self.assertEqual(rows[0]["publication_reference"], "PUBLISH-STATE")
        self.assertEqual(rows[0]["publication_result"], payload)
        self.assertIn("WeChat polling failed", rows[0]["error"])

    def test_database_recovery_rejects_artifact_identity_mismatch_without_runner(self) -> None:
        from intelligence.content_streams import (
            ArticleLocator,
            build_artifact_identity,
            resolve_article_paths,
        )
        from intelligence.market_pipeline import publication_worker

        target_date = date(2026, 7, 10)
        article_slug = "01-crude"
        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_root = Path(temporary_directory) / "reports"
            locator = ArticleLocator("digit", target_date, article_slug)
            paths = resolve_article_paths(locator, reports_root)
            paths.markdown.parent.mkdir(parents=True, exist_ok=True)
            markdown = "# Crude market\n\nCurrent artifact.\n"
            html = "<html><body>Current artifact.</body></html>"
            summary = "Current artifact.\n"
            paths.markdown.write_text(markdown, encoding="utf-8")
            paths.wechat_html.write_text(html, encoding="utf-8")
            paths.summary.write_text(summary, encoding="utf-8")
            identity = build_artifact_identity(locator, markdown, html, summary)
            mismatched_hashes = dict(identity["artifact_sha256"])
            mismatched_hashes["markdown"] = "0" * 64
            recovery_entry = {
                "publication_key": f"{identity['publication_key']}:publish",
                "article_slug": article_slug,
                "artifact_sha256": mismatched_hashes,
                "publication_action": "publish",
                "media_id": "MEDIA-STALE",
                "publish_id": "PUBLISH-STALE",
                "publication_result": {
                    "action": "publish",
                    "media_id": "MEDIA-STALE",
                    "publish_id": "PUBLISH-STALE",
                },
            }
            current_entry = {
                **identity,
                "article_slug": article_slug,
                "local_audit_status": "pass",
                "llm_review_status": "pass",
                "publication_status": "shadow_saved",
                "publication_action": "shadow",
            }
            runner = Mock()

            rows = publication_worker.publish_topics_independently(
                [current_entry],
                target_date,
                action="publish",
                historical=False,
                reports_root=reports_root,
                recovery_entries=[recovery_entry],
                runner=runner,
            )

            state_path = paths.publish_state_path("publish")
            self.assertFalse(state_path.exists())

        runner.assert_not_called()
        self.assertEqual(rows[0]["publication_status"], "publish_failed")
        self.assertIn("artifact identity mismatch", rows[0]["error"])
        self.assertIsNone(rows[0].get("media_id"))
        self.assertIsNone(rows[0].get("publish_id"))

    def test_action_rows_are_retained_while_aggregate_uses_active_topics(self) -> None:
        from intelligence.market_pipeline import publication_worker

        class Cursor:
            def __init__(self) -> None:
                self.executed: list[tuple[str, tuple | None]] = []
                self.rows: dict[tuple[date, str, str], dict] = {}
                self.result: list[dict] = []

            def execute(self, query, parameters=None):
                normalized = " ".join(str(query).split()).lower()
                values = tuple(parameters) if parameters is not None else None
                self.executed.append((normalized, values))
                if normalized.startswith("update digit_topic_publications set active=false"):
                    aggregate_id = values[0]
                    for row in self.rows.values():
                        if row["published_article_id"] == aggregate_id:
                            row["active"] = False
                elif normalized.startswith("insert into digit_topic_publications"):
                    (
                        published_article_id, publication_key, market_date, article_slug,
                        title, summary, markdown_path, html_path, quality_audit_path,
                        llm_review_path, artifact_sha256, local_audit_status,
                        llm_review_status, publication_action, publication_status,
                        media_id, publish_id, publication_result, error_message, topic_json,
                    ) = values
                    row_key = (market_date, article_slug, publication_action)
                    previous = self.rows.get(row_key, {})
                    same_artifact = previous.get("artifact_sha256") == artifact_sha256.obj
                    self.rows[row_key] = {
                        **topic_json.obj,
                        "published_article_id": published_article_id,
                        "publication_key": publication_key,
                        "market_date": market_date,
                        "article_slug": article_slug,
                        "title": title,
                        "summary": summary,
                        "markdown_path": markdown_path,
                        "html_path": html_path,
                        "quality_audit_path": quality_audit_path,
                        "llm_review_path": llm_review_path,
                        "artifact_sha256": artifact_sha256.obj,
                        "local_audit_status": local_audit_status,
                        "llm_review_status": llm_review_status,
                        "publication_action": publication_action,
                        "publication_status": publication_status,
                        "media_id": media_id or (
                            previous.get("media_id") if same_artifact else None
                        ),
                        "publish_id": publish_id or (
                            previous.get("publish_id") if same_artifact else None
                        ),
                        "publication_result": (
                            publication_result.obj
                            or (
                                previous.get("publication_result", {})
                                if same_artifact
                                else {}
                            )
                        ),
                        "error": error_message,
                        "active": True,
                    }
                elif normalized.startswith("select article_slug"):
                    aggregate_id, market_date = values
                    self.result = sorted(
                        (
                            row.copy() for row in self.rows.values()
                            if row["active"]
                            and row["published_article_id"] == aggregate_id
                            and row["market_date"] == market_date
                        ),
                        key=lambda row: row["article_slug"],
                    )

            def fetchall(self):
                return self.result

        cursor = Cursor()
        aggregate_id = "00000000-0000-0000-0000-000000000058"
        draft_entries = [
            self._entry("01-crude", "draft", "draft_created", media_id="MEDIA-CRUDE"),
            self._entry("02-naphtha", "draft", "draft_created", media_id="MEDIA-NAPHTHA"),
        ]
        with patch.dict(os.environ, {"ETI_RUN_ID": "TEST-DIGIT-RUN"}):
            publication_worker._persist_topic_publications(
                cursor, aggregate_id, date(2026, 7, 10), draft_entries,
            )

            active_rows = publication_worker._persist_topic_publications(
                cursor,
                aggregate_id,
                date(2026, 7, 10),
                [
                    self._entry(
                        "01-crude", "publish", "published",
                        media_id="MEDIA-CRUDE", publish_id="PUBLISH-CRUDE",
                    ),
                    draft_entries[1],
                ],
            )

        self.assertEqual(len(cursor.rows), 3)
        attempt_queries = [
            values for query, values in cursor.executed
            if query.startswith("insert into digit_publication_attempts")
        ]
        self.assertEqual(len(attempt_queries), 4)
        self.assertTrue(all(values[0] == "TEST-DIGIT-RUN" for values in attempt_queries))
        self.assertFalse(cursor.rows[(date(2026, 7, 10), "01-crude", "draft")]["active"])
        self.assertEqual(
            cursor.rows[(date(2026, 7, 10), "01-crude", "draft")]["media_id"],
            "MEDIA-CRUDE",
        )
        self.assertEqual(
            [row["publication_reference"] for row in active_rows],
            ["PUBLISH-CRUDE", "MEDIA-NAPHTHA"],
        )
        self.assertEqual(
            [row["publication_key"] for row in active_rows],
            [
                "digit:2026-07-10:01-crude:publish",
                "digit:2026-07-10:02-naphtha:draft",
            ],
        )
        self.assertEqual(publication_worker.aggregate_database_status(active_rows), "draft_created")
        aggregate = publication_worker.build_daily_aggregate_article(
            date(2026, 7, 10), Path("reports/digit/2026-07-10"), active_rows, {},
            is_historical=False,
        )
        self.assertEqual(
            [row["publication_reference"] for row in aggregate["review_json"]["articles"]],
            ["PUBLISH-CRUDE", "MEDIA-NAPHTHA"],
        )
        self.assertFalse(any(
            "delete from digit_topic_publications" in query for query, _ in cursor.executed
        ))

    @staticmethod
    def _entry(
        article_slug: str,
        action: str,
        status: str,
        *,
        media_id: str | None = None,
        publish_id: str | None = None,
    ) -> dict:
        result = {
            "action": action,
            "media_id": media_id or "",
            "publish_id": publish_id or "",
        }
        return {
            "article_slug": article_slug,
            "title": article_slug,
            "summary": article_slug,
            "markdown_path": f"{article_slug}.md",
            "html_path": f"{article_slug}_wechat.html",
            "quality_audit_path": f"quality/{article_slug}.json",
            "llm_review_path": f"quality/{article_slug}_llm.json",
            "artifact_sha256": {"markdown": "a", "wechat_html": "b", "summary": "c"},
            "local_audit_status": "pass",
            "llm_review_status": "pass",
            "publication_action": action,
            "publication_status": status,
            "media_id": media_id,
            "publish_id": publish_id,
            "publication_result": result,
        }


class DigitTopicPublisherFailureTests(unittest.TestCase):
    def test_save_json_flushes_and_replaces_from_same_directory(self) -> None:
        from intelligence import wechat_publish

        with tempfile.TemporaryDirectory() as temporary_directory:
            target = Path(temporary_directory) / "state" / "publish.json"
            with patch.object(
                wechat_publish.os, "replace", wraps=os.replace,
            ) as replace:
                wechat_publish.save_json(target, {"media_id": "MEDIA-ATOMIC"})

            source_path, target_path = replace.call_args.args
            self.assertEqual(Path(source_path).parent, target.parent)
            self.assertEqual(Path(target_path), target)
            self.assertEqual(
                json.loads(target.read_text(encoding="utf-8")),
                {"media_id": "MEDIA-ATOMIC"},
            )
            self.assertEqual(list(target.parent.glob("*.tmp")), [])

    def test_unverified_image_checkpoint_is_resumable_but_not_successfully_reusable(self) -> None:
        from intelligence import wechat_publish

        existing = {
            "ok": False,
            "action": "publish",
            "fingerprint": "fingerprint",
            "media_id": "MEDIA-CRUDE",
            "reference_image_present": True,
            "reference_image_sha256": "image-sha",
            "article_image_url": "https://mmbiz.qpic.cn/reference.png",
            "article_image_status": "uploaded",
            "publication_stage": "draft_created",
        }

        self.assertFalse(wechat_publish.is_existing_result_reusable(
            existing,
            "fingerprint",
            "publish",
            reference_image_present=True,
            reference_image_sha256="image-sha",
        ))
        self.assertTrue(wechat_publish.is_existing_result_resumable(
            existing,
            "fingerprint",
            "publish",
            reference_image_present=True,
            reference_image_sha256="image-sha",
        ))

    def test_retry_resumes_existing_publish_ids_without_recreating_objects(self) -> None:
        from intelligence import wechat_publish

        state: dict[str, object] = {}
        persisted_results: list[dict] = []

        def article_factory(*_args, **_kwargs):
            return {
                "title": "Energy market daily - 2026-07-10",
                "author": "ETI",
                "digest": "Market summary",
                "content": "<p>2026-07-10</p>" + ("market content " * 80),
                "preview_html": "<html><body>preview</body></html>",
                "content_source_url": "",
                "need_open_comment": 0,
                "only_fans_can_comment": 0,
                "reference_image_present": False,
                "reference_image_sha256": "",
                "article_image_url": "",
                "article_image_status": "not_expected",
            }

        def persist(_date, _action, _article, result, *_args):
            persisted_results.append(dict(result))
            state.clear()
            state.update(result)
            return {"result_path": "publish-state.json"}

        with ExitStack() as stack:
            stack.enter_context(patch.object(sys, "argv", [
                "wechat_publish.py", "--date", "2026-07-10", "--stream", "digit",
                "--article-slug", "01-crude", "--action", "publish",
            ]))
            stack.enter_context(patch.object(wechat_publish, "read_publish_config", return_value={}))
            stack.enter_context(patch.object(
                wechat_publish,
                "load_price_release_state",
                return_value={"status": "ready_without_prices"},
            ))
            stack.enter_context(patch.object(wechat_publish, "prepare_thumb_image"))
            stack.enter_context(patch.object(wechat_publish, "read_report_bundle", return_value={
                "md_path": Path("report.md"),
                "html_path": Path("report.html"),
                "summary_path": Path("summary.txt"),
            }))
            stack.enter_context(patch.object(
                wechat_publish, "build_article_payload", side_effect=article_factory,
            ))
            stack.enter_context(patch.object(
                wechat_publish, "load_quality_audit", return_value={"status": "pass"},
            ))
            stack.enter_context(patch.object(
                wechat_publish, "load_llm_review", return_value={"status": "pass"},
            ))
            stack.enter_context(patch.object(
                wechat_publish, "build_preflight_report", return_value={"issues": []},
            ))
            stack.enter_context(patch.object(
                wechat_publish, "validate_article_for_publish", return_value=([], []),
            ))
            stack.enter_context(patch.object(
                wechat_publish, "artifact_identity_issues", return_value=[],
            ))
            stack.enter_context(patch.object(wechat_publish, "ensure_publish_config"))
            stack.enter_context(patch.object(
                wechat_publish, "get_access_token", return_value="access-token",
            ))
            stack.enter_context(patch.object(
                wechat_publish, "ensure_thumb_media_id", return_value="thumb-id",
            ))
            stack.enter_context(patch.object(
                wechat_publish, "load_existing_result", side_effect=lambda *_args: dict(state),
            ))
            stack.enter_context(patch.object(
                wechat_publish, "prepare_article_image", return_value=[],
            ))
            create = stack.enter_context(patch.object(
                wechat_publish, "create_draft", return_value={"media_id": "MEDIA-CRUDE"},
            ))
            stack.enter_context(patch.object(
                wechat_publish,
                "verify_created_draft",
                return_value={"verified": True},
            ))
            submit = stack.enter_context(patch.object(
                wechat_publish,
                "submit_publish",
                return_value={"publish_id": "PUBLISH-CRUDE"},
            ))
            poll = stack.enter_context(patch.object(
                wechat_publish,
                "wait_publish_result",
                side_effect=[TimeoutError("publish polling timed out"), {"publish_status": 0}],
            ))
            stack.enter_context(patch.object(
                wechat_publish, "persist_publish_artifacts", side_effect=persist,
            ))
            printed = stack.enter_context(patch("builtins.print"))

            with self.assertRaisesRegex(TimeoutError, "publish polling timed out"):
                wechat_publish.main()
            wechat_publish.main()

        self.assertEqual(create.call_count, 1)
        self.assertEqual(submit.call_count, 1)
        self.assertEqual(poll.call_count, 2)
        checkpoint_stages = [
            result.get("publication_stage")
            for result in persisted_results
            if not result.get("error")
        ]
        self.assertIn("draft_created", checkpoint_stages)
        self.assertIn("publish_submitted", checkpoint_stages)
        failure_outputs = [
            json.loads(call.args[0])
            for call in printed.call_args_list
            if call.args and str(call.args[0]).lstrip().startswith("{")
            and json.loads(call.args[0]).get("ok") is False
        ]
        self.assertEqual(failure_outputs[0]["action"], "publish")
        self.assertEqual(failure_outputs[0]["media_id"], "MEDIA-CRUDE")
        self.assertEqual(failure_outputs[0]["publish_id"], "PUBLISH-CRUDE")
        self.assertIn("publish polling timed out", failure_outputs[0]["error"])

    def test_checkpoint_failure_stdout_recovers_id_and_retry_avoids_duplicate_calls(self) -> None:
        from intelligence import wechat_publish
        from intelligence.content_streams import ArticleLocator, resolve_article_paths
        from intelligence.market_pipeline import publication_worker

        target_date = date(2026, 7, 10)
        article_slug = "01-crude"
        entry = {
            "article_slug": article_slug,
            "local_audit_status": "pass",
            "llm_review_status": "pass",
            "publication_status": "shadow_saved",
            "publication_action": "shadow",
        }

        def article_factory(*_args, **_kwargs):
            return {
                "title": "Energy market daily - 2026-07-10",
                "author": "ETI",
                "digest": "Market summary",
                "content": "<p>2026-07-10</p>" + ("market content " * 80),
                "preview_html": "<html><body>preview</body></html>",
                "content_source_url": "",
                "need_open_comment": 0,
                "only_fans_can_comment": 0,
                "reference_image_present": False,
                "reference_image_sha256": "",
                "article_image_url": "",
                "article_image_status": "not_expected",
            }

        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_root = Path(temporary_directory) / "reports"
            daily_price_root = Path(temporary_directory) / "prices"
            locator = ArticleLocator("digit", target_date, article_slug)
            result_path = resolve_article_paths(locator, reports_root).publish_state_path("publish")
            original_save_json = wechat_publish.save_json
            result_write_attempts = 0
            publisher_runs = 0

            def fail_result_checkpoint_in_first_process(path, payload):
                nonlocal result_write_attempts
                if (
                    Path(path) == result_path
                    and publisher_runs == 1
                    and payload.get("publish_id")
                ):
                    result_write_attempts += 1
                    raise OSError("checkpoint disk failure")
                return original_save_json(path, payload)

            with ExitStack() as stack:
                stack.enter_context(patch.object(wechat_publish, "REPORTS_DIR", reports_root))
                stack.enter_context(patch.object(wechat_publish, "DAILY_PRICE_ROOT", daily_price_root))
                stack.enter_context(patch.object(wechat_publish, "read_publish_config", return_value={}))
                stack.enter_context(patch.object(
                    wechat_publish,
                    "load_price_release_state",
                    return_value={"status": "ready_without_prices"},
                ))
                stack.enter_context(patch.object(wechat_publish, "prepare_thumb_image"))
                stack.enter_context(patch.object(wechat_publish, "read_report_bundle", return_value={
                    "md_path": Path("report.md"),
                    "html_path": Path("report.html"),
                    "summary_path": Path("summary.txt"),
                }))
                stack.enter_context(patch.object(
                    wechat_publish, "build_article_payload", side_effect=article_factory,
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "load_quality_audit", return_value={"status": "pass"},
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "load_llm_review", return_value={"status": "pass"},
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "build_preflight_report", return_value={"issues": []},
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "validate_article_for_publish", return_value=([], []),
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "artifact_identity_issues", return_value=[],
                ))
                stack.enter_context(patch.object(wechat_publish, "ensure_publish_config"))
                stack.enter_context(patch.object(
                    wechat_publish, "get_access_token", return_value="access-token",
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "ensure_thumb_media_id", return_value="thumb-id",
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "prepare_article_image", return_value=[],
                ))
                create = stack.enter_context(patch.object(
                    wechat_publish, "create_draft", return_value={"media_id": "MEDIA-CRUDE"},
                ))
                stack.enter_context(patch.object(
                    wechat_publish,
                    "verify_created_draft",
                    return_value={"verified": True},
                ))
                submit = stack.enter_context(patch.object(
                    wechat_publish,
                    "submit_publish",
                    return_value={"publish_id": "PUBLISH-CRUDE"},
                ))
                stack.enter_context(patch.object(
                    wechat_publish,
                    "wait_publish_result",
                    return_value={"publish_status": 0},
                ))
                stack.enter_context(patch.object(
                    wechat_publish,
                    "save_json",
                    side_effect=fail_result_checkpoint_in_first_process,
                ))

                def runner(command, **_kwargs):
                    nonlocal publisher_runs
                    publisher_runs += 1
                    printed: list[str] = []

                    def capture_print(*values, **print_kwargs):
                        if print_kwargs.get("file") in {None, sys.stdout}:
                            printed.append(" ".join(str(value) for value in values))

                    with patch.object(sys, "argv", ["wechat_publish.py", *command[3:]]), patch(
                        "builtins.print", side_effect=capture_print,
                    ):
                        try:
                            wechat_publish.main()
                        except Exception as error:
                            raise subprocess.CalledProcessError(
                                1,
                                command,
                                output="\n".join(printed),
                                stderr=str(error),
                            ) from error
                    return SimpleNamespace(stdout="\n".join(printed))

                failed_rows = publication_worker.publish_topics_independently(
                    [entry],
                    target_date,
                    action="publish",
                    historical=False,
                    reports_root=reports_root,
                    runner=runner,
                )
                recovered_checkpoint = json.loads(result_path.read_text(encoding="utf-8"))
                recovered_rows = publication_worker.publish_topics_independently(
                    [entry],
                    target_date,
                    action="publish",
                    historical=False,
                    reports_root=reports_root,
                    runner=runner,
                )

        self.assertEqual(failed_rows[0]["publication_status"], "publish_failed")
        self.assertEqual(failed_rows[0]["media_id"], "MEDIA-CRUDE")
        self.assertEqual(failed_rows[0]["publish_id"], "PUBLISH-CRUDE")
        self.assertIn("checkpoint disk failure", failed_rows[0]["error"])
        self.assertEqual(recovered_checkpoint["media_id"], "MEDIA-CRUDE")
        self.assertEqual(recovered_checkpoint["publish_id"], "PUBLISH-CRUDE")
        self.assertGreaterEqual(result_write_attempts, 2)
        self.assertEqual(recovered_rows[0]["publication_status"], "published")
        self.assertEqual(recovered_rows[0]["media_id"], "MEDIA-CRUDE")
        self.assertEqual(recovered_rows[0]["publish_id"], "PUBLISH-CRUDE")
        self.assertEqual(create.call_count, 1)
        self.assertEqual(submit.call_count, 1)

    def test_double_checkpoint_failure_recovers_from_database_after_process_restart(self) -> None:
        from intelligence import wechat_publish
        from intelligence.content_streams import (
            ArticleLocator,
            build_artifact_identity,
            resolve_article_paths,
        )
        from intelligence.market_pipeline import publication_worker

        target_date = date(2026, 7, 10)
        article_slug = "01-crude"

        def article_factory(*_args, **_kwargs):
            return {
                "title": "Energy market daily - 2026-07-10",
                "author": "ETI",
                "digest": "Market summary",
                "content": "<p>2026-07-10</p>" + ("market content " * 80),
                "preview_html": "<html><body>preview</body></html>",
                "content_source_url": "",
                "need_open_comment": 0,
                "only_fans_can_comment": 0,
                "reference_image_present": False,
                "reference_image_sha256": "",
                "article_image_url": "",
                "article_image_status": "not_expected",
            }

        with tempfile.TemporaryDirectory() as temporary_directory:
            reports_root = Path(temporary_directory) / "reports"
            daily_price_root = Path(temporary_directory) / "prices"
            locator = ArticleLocator("digit", target_date, article_slug)
            paths = resolve_article_paths(locator, reports_root)
            paths.markdown.parent.mkdir(parents=True, exist_ok=True)
            markdown = "# Crude market\n\nRestart-safe publication.\n"
            html = "<html><body>Restart-safe publication.</body></html>"
            summary = "Restart-safe publication.\n"
            paths.markdown.write_text(markdown, encoding="utf-8")
            paths.wechat_html.write_text(html, encoding="utf-8")
            paths.summary.write_text(summary, encoding="utf-8")
            identity = build_artifact_identity(locator, markdown, html, summary)
            current_entry = {
                **identity,
                "article_slug": article_slug,
                "local_audit_status": "pass",
                "llm_review_status": "pass",
                "publication_status": "shadow_saved",
                "publication_action": "shadow",
            }
            result_path = paths.publish_state_path("publish")
            original_save_json = wechat_publish.save_json
            original_atomic_write_json = publication_worker.atomic_write_json
            publisher_runs = 0
            worker_checkpoint_attempts = 0

            def fail_publisher_checkpoint_in_first_process(path, payload):
                if (
                    Path(path) == result_path
                    and publisher_runs == 1
                    and payload.get("media_id")
                ):
                    raise OSError("publisher checkpoint disk failure")
                return original_save_json(path, payload)

            def fail_first_worker_checkpoint(path, payload):
                nonlocal worker_checkpoint_attempts
                if Path(path) == result_path:
                    worker_checkpoint_attempts += 1
                    if worker_checkpoint_attempts == 1:
                        raise OSError("worker checkpoint disk failure")
                return original_atomic_write_json(path, payload)

            with ExitStack() as stack:
                stack.enter_context(patch.object(wechat_publish, "REPORTS_DIR", reports_root))
                stack.enter_context(patch.object(wechat_publish, "DAILY_PRICE_ROOT", daily_price_root))
                stack.enter_context(patch.object(wechat_publish, "read_publish_config", return_value={}))
                stack.enter_context(patch.object(
                    wechat_publish,
                    "load_price_release_state",
                    return_value={"status": "ready_without_prices"},
                ))
                stack.enter_context(patch.object(wechat_publish, "prepare_thumb_image"))
                stack.enter_context(patch.object(
                    wechat_publish, "build_article_payload", side_effect=article_factory,
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "load_quality_audit", return_value={"status": "pass"},
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "load_llm_review", return_value={"status": "pass"},
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "build_preflight_report", return_value={"issues": []},
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "validate_article_for_publish", return_value=([], []),
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "artifact_identity_issues", return_value=[],
                ))
                stack.enter_context(patch.object(wechat_publish, "ensure_publish_config"))
                stack.enter_context(patch.object(
                    wechat_publish, "get_access_token", return_value="access-token",
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "ensure_thumb_media_id", return_value="thumb-id",
                ))
                stack.enter_context(patch.object(
                    wechat_publish, "prepare_article_image", return_value=[],
                ))
                create = stack.enter_context(patch.object(
                    wechat_publish, "create_draft", return_value={"media_id": "MEDIA-CRUDE"},
                ))
                stack.enter_context(patch.object(
                    wechat_publish,
                    "verify_created_draft",
                    return_value={"verified": True},
                ))
                submit = stack.enter_context(patch.object(
                    wechat_publish,
                    "submit_publish",
                    return_value={"publish_id": "PUBLISH-CRUDE"},
                ))
                stack.enter_context(patch.object(
                    wechat_publish,
                    "wait_publish_result",
                    return_value={"publish_status": 0},
                ))
                stack.enter_context(patch.object(
                    wechat_publish,
                    "save_json",
                    side_effect=fail_publisher_checkpoint_in_first_process,
                ))
                stack.enter_context(patch.object(
                    publication_worker,
                    "atomic_write_json",
                    side_effect=fail_first_worker_checkpoint,
                ))

                def runner(command, **_kwargs):
                    nonlocal publisher_runs
                    publisher_runs += 1
                    printed: list[str] = []

                    def capture_print(*values, **print_kwargs):
                        if print_kwargs.get("file") in {None, sys.stdout}:
                            printed.append(" ".join(str(value) for value in values))

                    with patch.object(sys, "argv", ["wechat_publish.py", *command[3:]]), patch(
                        "builtins.print", side_effect=capture_print,
                    ):
                        try:
                            wechat_publish.main()
                        except Exception as error:
                            raise subprocess.CalledProcessError(
                                1,
                                command,
                                output="\n".join(printed),
                                stderr=str(error),
                            ) from error
                    return SimpleNamespace(stdout="\n".join(printed))

                failed_rows = publication_worker.publish_topics_independently(
                    [current_entry],
                    target_date,
                    action="publish",
                    historical=False,
                    reports_root=reports_root,
                    runner=runner,
                )
                self.assertFalse(result_path.exists())

                database_record = publication_worker._topic_publication_entry({
                    **failed_rows[0],
                    "publication_key": f"{identity['publication_key']}:publish",
                    "market_date": target_date,
                    "topic_json": failed_rows[0],
                })
                recovered_rows = publication_worker.publish_topics_independently(
                    [current_entry],
                    target_date,
                    action="publish",
                    historical=False,
                    reports_root=reports_root,
                    recovery_entries=[database_record],
                    runner=runner,
                )
                recovered_checkpoint = json.loads(result_path.read_text(encoding="utf-8"))

        self.assertEqual(failed_rows[0]["publication_status"], "publish_failed")
        self.assertEqual(failed_rows[0]["media_id"], "MEDIA-CRUDE")
        self.assertIsNone(failed_rows[0]["publish_id"])
        self.assertIn("publisher checkpoint disk failure", failed_rows[0]["error"])
        self.assertIn(
            "worker checkpoint disk failure",
            failed_rows[0]["publication_result"]["worker_checkpoint_error"],
        )
        self.assertEqual(recovered_rows[0]["publication_status"], "published")
        self.assertEqual(recovered_rows[0]["media_id"], "MEDIA-CRUDE")
        self.assertEqual(recovered_rows[0]["publish_id"], "PUBLISH-CRUDE")
        self.assertTrue(recovered_checkpoint["database_recovered"])
        self.assertEqual(publisher_runs, 2)
        self.assertEqual(worker_checkpoint_attempts, 2)
        self.assertEqual(create.call_count, 1)
        self.assertEqual(submit.call_count, 1)


if __name__ == "__main__":
    unittest.main()

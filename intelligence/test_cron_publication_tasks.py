from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from contextlib import nullcontext
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from intelligence.market_pipeline.contracts import ArticleTopic, SignalDirection, SignalStatus
from intelligence.market_pipeline.editorial import build_editorial_view
from intelligence.market_pipeline.knowledge import retrieve_knowledge_card


ROOT = Path(__file__).parents[1]
GIT_BASH = (
    Path(r"C:\Program Files\Git\bin\bash.exe")
    if os.name == "nt"
    else (Path(bash_path) if (bash_path := shutil.which("bash")) else None)
)


def posix_path(path: Path) -> str:
    resolved = path.resolve()
    drive = resolved.drive.rstrip(":").lower()
    suffix = resolved.as_posix().split(":", 1)[-1]
    return f"/{drive}{suffix}" if drive else suffix


def write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8", newline="\n")
    path.chmod(0o755)


class CronBehaviorHarness:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.app = root / "app"
        self.bin = root / "bin"
        self.logs = root / "logs"
        self.calls = root / "python-calls.log"
        self.app.mkdir()
        self.bin.mkdir()
        self.logs.mkdir()
        runner = (ROOT / "scripts" / "cron-runner.sh").read_text(encoding="utf-8")
        runner = runner.replace(
            'APP_DIR="/var/www/eti/Energy_trade_inspection"',
            f'APP_DIR="{posix_path(self.app)}"',
        ).replace('LOG_DIR="/var/log/eti"', f'LOG_DIR="{posix_path(self.logs)}"')
        write_executable(self.app / "cron-runner.sh", runner)
        write_executable(
            self.bin / "flock",
            "#!/usr/bin/env bash\nwhile [[ \"${1:-}\" == -* ]]; do shift; done\nshift\nif [[ \"$#\" -eq 0 ]]; then exit 0; fi\nexec \"$@\"\n",
        )
        write_executable(
            self.bin / "timeout",
            "#!/usr/bin/env bash\nshift\nexec \"$@\"\n",
        )
        write_executable(
            self.bin / "fake-python",
            "#!/usr/bin/env bash\n"
            "printf '%s|%s\\n' \"${ETI_REPORTS_ROOT:-}\" \"$*\" >> \"$FAKE_PYTHON_LOG\"\n"
            "if [[ \"$*\" == *'intelligence.wechat_publish'* && \"${FAKE_SUMMARY_READY:-true}\" == 'false' ]]; then\n"
            "  printf '%s\\n' '{\"ready\":false,\"issues\":[\"fixture preview issue\"]}'\n"
            "  if [[ \"$*\" == *'--preflight'* ]]; then exit 1; fi\n"
            "fi\n"
            "if [[ \"$*\" == *'intelligence.market_pipeline.publication_worker'* ]]; then\n"
            "  target_date=2026-07-10\n"
            "  mkdir -p \"$OBSIDIAN_VAULT/reports/digit/$target_date\"\n"
            "  cat > \"$OBSIDIAN_VAULT/reports/digit/$target_date/index.json\" <<JSON\n"
            '{"market_date":"2026-07-10","status":"complete","articles":[{"article_slug":"01-fixture","publication_status":"shadow_saved","dry_run_status":"pass"}]}\n'
            "JSON\n"
            "fi\n",
        )

    def run(self, task: str, *, streams: str, price_mode: str, pipeline_mode: str,
            auto_mode: str = "publish", extra: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
        (self.app / ".env.local").write_text(
            "\n".join((
                f"PYTHON_BIN=\"{posix_path(self.bin / 'fake-python')}\"",
                f"OBSIDIAN_VAULT=\"{posix_path(self.root / 'obsidian')}\"",
                f"WECHAT_CONTENT_STREAMS={streams}",
                f"DAILY_PRICE_MODE={price_mode}",
                f"MARKET_PIPELINE_MODE={pipeline_mode}",
                f"WECHAT_MP_AUTO_MODE={auto_mode}",
            )) + "\n",
            encoding="utf-8",
        )
        environment = os.environ.copy()
        environment.update({
            "PATH": f"{posix_path(self.bin)}:/usr/bin:/bin",
            "FAKE_PYTHON_LOG": posix_path(self.calls),
            "ETI_MARKET_DATE": "2026-07-10",
            "ETI_REPORT_DATE": "2026-07-10",
        })
        environment.pop("DAILY_PRICE_ROOT", None)
        environment.update(extra or {})
        return subprocess.run(
            [str(GIT_BASH), posix_path(self.app / "cron-runner.sh"), task],
            cwd=self.app,
            env=environment,
            capture_output=True,
            text=True,
        )

    def python_calls(self) -> list[str]:
        return self.calls.read_text(encoding="utf-8").splitlines() if self.calls.exists() else []


@unittest.skipUnless(GIT_BASH and GIT_BASH.exists(), "Bash is required for cron behavior tests")
class PublicationCronBehaviorTests(unittest.TestCase):
    def test_runner_prefers_project_venv_without_python_override(self) -> None:
        runner = (ROOT / "scripts" / "cron-runner.sh").read_text(encoding="utf-8")

        self.assertIn('APP_DIR/.venv-intelligence/bin/python', runner)
        self.assertIn('PYTHON_BIN="${PYTHON_BIN:-python3}"', runner)

    def test_default_streams_do_not_invoke_legacy_wechat(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            harness = CronBehaviorHarness(Path(temporary_directory))
            result = harness.run(
                "daily-intelligence", streams="summary,digit",
                price_mode="append", pipeline_mode="active",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(any("intelligence.wechat_publish" in call for call in harness.python_calls()))

    def test_daily_intelligence_never_invokes_legacy_publication(self) -> None:
        for price_mode, pipeline_mode in (("shadow", "active"), ("append", "shadow")):
            with self.subTest(price_mode=price_mode, pipeline_mode=pipeline_mode), \
                    tempfile.TemporaryDirectory() as temporary_directory:
                harness = CronBehaviorHarness(Path(temporary_directory))
                result = harness.run(
                    "daily-intelligence", streams="summary,digit,legacy",
                    price_mode=price_mode, pipeline_mode=pipeline_mode,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                calls = [call for call in harness.python_calls() if "intelligence.wechat_publish" in call]
                self.assertEqual(calls, [])

    def test_daily_intelligence_does_not_run_legacy_file_health_gate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            harness = CronBehaviorHarness(Path(temporary_directory))
            result = harness.run(
                "daily-intelligence", streams="summary,digit",
                price_mode="append", pipeline_mode="review",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(any(
                "scripts/report-pipeline-health.py" in call
                for call in harness.python_calls()
            ))

    def test_price_reconcile_invokes_delayed_summary_draft_publish(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            harness = CronBehaviorHarness(Path(temporary_directory))
            result = harness.run(
                "price-reconcile", streams="summary,digit",
                price_mode="append", pipeline_mode="active",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = harness.python_calls()
            self.assertTrue(any("intelligence.daily_prices reconcile-pending" in call for call in calls))
            self.assertTrue(any(
                "intelligence.pending_wechat_publish --lookback-days 7 --action draft" in call
                for call in calls
            ))

    def test_digit_cron_scans_pending_dates_in_true_dry_run(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            harness = CronBehaviorHarness(Path(temporary_directory))
            result = harness.run(
                "digit-publish", streams="summary,digit",
                price_mode="append", pipeline_mode="active",
                extra={"ETI_HISTORICAL": "1", "ETI_PUBLISH_DRY_RUN": "1"},
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            worker_call = next(
                call for call in harness.python_calls()
                if "intelligence.market_pipeline.digit_publication_scheduler" in call
            )
            self.assertIn("--dry-run", worker_call)
            self.assertIn("--through-date 2026-07-10", worker_call)
            log = (harness.logs / "digit-publish.log").read_text(encoding="utf-8")
            for field in (
                "pipeline_mode=active", "requested_action=publish",
                "effective_action=publish", "dry_run=true",
            ):
                self.assertIn(field, log)

    def test_summary_shadow_runner_only_runs_pending_worker_dry_run(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            harness = CronBehaviorHarness(Path(temporary_directory))
            result = harness.run(
                "summary-publish", streams="summary,digit",
                price_mode="shadow", pipeline_mode="shadow", auto_mode="off",
                extra={"FAKE_SUMMARY_READY": "false"},
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            summary_calls = [
                call for call in harness.python_calls()
                if "intelligence.summary_image_worker" in call
            ]
            self.assertEqual(len(summary_calls), 1)
            summary_call = summary_calls[0]
            self.assertIn("--dry-run", summary_call)
            self.assertIn("--pending", summary_call)
            self.assertNotIn("intelligence.wechat_publish", summary_call)
            log = (harness.logs / "summary-publish.log").read_text(encoding="utf-8")
            self.assertIn("result=success", log)

    def test_summary_runner_is_independent_from_price_reconciliation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            harness = CronBehaviorHarness(root)
            result = harness.run(
                "summary-publish", streams="summary,digit",
                price_mode="shadow", pipeline_mode="shadow", auto_mode="off",
                extra={
                    "DAILY_PRICE_ROOT": (
                        f"{posix_path(root / 'obsidian')}/reports/../reports/prices"
                    ),
                },
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            publish_call = next(
                call for call in harness.python_calls()
                if "intelligence.summary_image_worker" in call
            )
            self.assertIn("--pending", publish_call)
            self.assertFalse(any(
                "intelligence.daily_prices reconcile" in call
                for call in harness.python_calls()
            ))

    def test_summary_runner_ignores_structured_price_root_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            harness = CronBehaviorHarness(root)
            result = harness.run(
                "summary-publish", streams="summary,digit",
                price_mode="shadow", pipeline_mode="shadow", auto_mode="off",
                extra={"DAILY_PRICE_ROOT": posix_path(root / "drift" / "prices")},
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(any(
                "intelligence.summary_image_worker" in call
                for call in harness.python_calls()
            ))


@unittest.skipUnless(GIT_BASH and GIT_BASH.exists(), "Bash is required for crontab behavior tests")
class CrontabInstallerBehaviorTests(unittest.TestCase):
    def test_installer_honors_secure_runner_override(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            scripts = root / "scripts"
            secure = root / "secure"
            bin_dir = root / "bin"
            scripts.mkdir()
            secure.mkdir()
            bin_dir.mkdir()
            shutil.copy2(ROOT / "scripts" / "setup-crontab.sh", scripts / "setup-crontab.sh")
            secure_runner = secure / "cron-runner.sh"
            write_executable(secure_runner, "#!/usr/bin/env bash\nexit 0\n")
            state = root / "crontab.txt"
            state.write_text("", encoding="utf-8")
            write_executable(
                bin_dir / "crontab",
                "#!/usr/bin/env bash\n"
                "if [[ \"${1:-}\" == '-l' ]]; then cat \"$FAKE_CRONTAB_STATE\"; exit 0; fi\n"
                "if [[ \"${1:-}\" == '-' ]]; then cat > \"$FAKE_CRONTAB_STATE\"; exit 0; fi\n"
                "exit 2\n",
            )
            environment = os.environ.copy()
            environment.update({
                "PATH": f"{posix_path(bin_dir)}:/usr/bin:/bin",
                "FAKE_CRONTAB_STATE": posix_path(state),
                "ETI_CRON_RUNNER": posix_path(secure_runner),
                "ETI_CRON_ALLOW_UNMANAGED_RUNNER": "1",
            })
            result = subprocess.run(
                [str(GIT_BASH), posix_path(scripts / "setup-crontab.sh")],
                env=environment, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            installed = state.read_text(encoding="utf-8")
            self.assertIn(f"{posix_path(secure_runner)} summary-publish", installed)
            self.assertNotIn(f"{posix_path(scripts / 'cron-runner.sh')} summary-publish", installed)

    def test_installer_preserves_non_eti_lines_timezone_order_and_duplicates(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            scripts = root / "scripts"
            bin_dir = root / "bin"
            scripts.mkdir()
            bin_dir.mkdir()
            shutil.copy2(ROOT / "scripts" / "setup-crontab.sh", scripts / "setup-crontab.sh")
            write_executable(scripts / "cron-runner.sh", "#!/usr/bin/env bash\nexit 0\n")
            original = (
                "CRON_TZ=UTC\n"
                "0 1 * * * /opt/external-a\n"
                "0 1 * * * /opt/external-a\n"
                "CRON_TZ=Europe/London\n"
                "30 2 * * * /opt/external-b\n"
                "# BEGIN ETI MANAGED TASKS\n"
                "CRON_TZ=Asia/Shanghai\n"
                "0 0 * * * /old/eti # ETI_TASK:cleanup\n"
                "# END ETI MANAGED TASKS\n"
                "CRON_TZ=UTC\n"
                "15 3 * * * /opt/external-c\n"
            )
            expected_non_eti = (
                "CRON_TZ=UTC\n"
                "0 1 * * * /opt/external-a\n"
                "0 1 * * * /opt/external-a\n"
                "CRON_TZ=Europe/London\n"
                "30 2 * * * /opt/external-b\n"
                "CRON_TZ=UTC\n"
                "15 3 * * * /opt/external-c\n"
            )
            state = root / "crontab.txt"
            state.write_text(original, encoding="utf-8")
            write_executable(
                bin_dir / "crontab",
                "#!/usr/bin/env bash\n"
                "if [[ \"${1:-}\" == '-l' ]]; then cat \"$FAKE_CRONTAB_STATE\"; exit 0; fi\n"
                "if [[ \"${1:-}\" == '-' ]]; then cat > \"$FAKE_CRONTAB_STATE\"; exit 0; fi\n"
                "exit 2\n",
            )
            environment = os.environ.copy()
            environment.update({
                "PATH": f"{posix_path(bin_dir)}:/usr/bin:/bin",
                "FAKE_CRONTAB_STATE": posix_path(state),
                "ETI_CRON_RUNNER": posix_path(scripts / "cron-runner.sh"),
                "ETI_CRON_ALLOW_UNMANAGED_RUNNER": "1",
            })
            result = subprocess.run(
                [str(GIT_BASH), posix_path(scripts / "setup-crontab.sh")],
                env=environment, capture_output=True, text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            installed = state.read_text(encoding="utf-8")
            self.assertTrue(installed.startswith(expected_non_eti))
            self.assertEqual(installed.count("# BEGIN ETI MANAGED TASKS"), 1)
            self.assertEqual(installed.count("# END ETI MANAGED TASKS"), 1)
            self.assertEqual(installed.count("0 1 * * * /opt/external-a"), 2)
            self.assertGreater(installed.index("# BEGIN ETI MANAGED TASKS"), installed.index("/opt/external-c"))


class DigitDryRunTests(unittest.TestCase):
    def test_execution_plan_distinguishes_requested_effective_and_dry_run(self) -> None:
        from intelligence.market_pipeline import publication_worker

        self.assertEqual(
            publication_worker.resolve_publication_execution("shadow", historical=True, dry_run=False),
            ("shadow", "shadow"),
        )
        self.assertEqual(
            publication_worker.resolve_publication_execution("active", historical=True, dry_run=False),
            ("auto", "draft"),
        )
        self.assertEqual(
            publication_worker.resolve_publication_execution("active", historical=False, dry_run=True),
            ("auto", "draft"),
        )

    def test_topic_dry_run_command_cannot_request_publish(self) -> None:
        from intelligence.market_pipeline import publication_worker

        command = publication_worker._topic_publish_command(
            date(2026, 7, 10), "01-fixture", action="publish",
            historical=True, dry_run=True,
        )
        self.assertIn("--dry-run", command)
        self.assertEqual(command[command.index("--action") + 1], "draft")

    def test_preview_keeps_publication_state_and_records_dry_run_result(self) -> None:
        from intelligence.market_pipeline import publication_worker

        calls: list[list[str]] = []

        def runner(command, **_kwargs):
            calls.append(command)
            return SimpleNamespace(stdout=json.dumps({"action": "draft", "ready": True}))

        entries = publication_worker.preview_topics_independently(
            [{
                "article_slug": "01-fixture", "local_audit_status": "pass",
                "llm_review_status": "pass", "publication_status": "shadow_saved",
            }],
            date(2026, 7, 10), requested_action="auto", historical=True, runner=runner,
        )
        self.assertEqual(entries[0]["publication_status"], "shadow_saved")
        self.assertEqual(entries[0]["dry_run_status"], "pass")
        self.assertEqual(entries[0]["requested_action"], "auto")
        self.assertEqual(entries[0]["effective_action"], "draft")
        self.assertIn("--dry-run", calls[0])


class DigitFixtureE2ETests(unittest.TestCase):
    def test_fixture_repository_writes_real_digit_artifacts_and_dry_run_index(self) -> None:
        from intelligence.market_pipeline import publication_worker

        configured_output = os.getenv("ETI_FIXTURE_E2E_OUTPUT")
        temporary = tempfile.TemporaryDirectory() if not configured_output else None
        context = temporary if temporary is not None else nullcontext()
        with context:
            reports_root = Path(configured_output) if configured_output else Path(temporary.name)
            target_date = date(2026, 7, 10)
            top = SimpleNamespace(
                signal_id="FIXTURE-SIGNAL-TOP", signal_type="supply_tightening",
                direction=SignalDirection.BULLISH, confidence=.9, score=90,
                summary="Fixture supply tightened.",
                supporting_fact_ids=["FIXTURE-FACT-1"], counter_fact_ids=[],
                support_dimensions=["flow_inventory", "disruption_policy"],
                status=SignalStatus.TOP, commodity="naphtha", region="Asia",
            )
            counter = SimpleNamespace(
                signal_id="FIXTURE-SIGNAL-COUNTER", signal_type="demand_weakness",
                direction=SignalDirection.BEARISH, confidence=.8, score=70,
                summary="Fixture demand weakened.",
                supporting_fact_ids=["FIXTURE-FACT-2"], counter_fact_ids=[],
                support_dimensions=["flow_inventory", "disruption_policy"],
                status=SignalStatus.SECONDARY, commodity="naphtha", region="Asia",
            )
            facts = [
                SimpleNamespace(
                    fact_id=f"FIXTURE-FACT-{index}", fact_type=SimpleNamespace(value="supply"),
                    confidence=.9, statement=f"Fixture evidence {index}",
                    evidence_text=f"Fixture evidence {index}", source_id=f"FIXTURE-SOURCE-{index}",
                    market_date=target_date, uncertainty=None, commodity="naphtha", region="Asia",
                )
                for index in (1, 2)
            ]
            metrics = [
                SimpleNamespace(
                    metric_id=f"FIXTURE-METRIC-{index}", metric_type=f"fixture-metric-{index}",
                    benchmark="Fixture", source_fact_ids=["FIXTURE-FACT-1", "FIXTURE-FACT-2"],
                    status="computed",
                )
                for index in (1, 2, 3)
            ]
            view = build_editorial_view(
                target_date, [top, counter], previous_signals=[],
                knowledge_card=retrieve_knowledge_card("naphtha"),
                allowed_fact_ids={fact.fact_id for fact in facts}, unresolved_fact_ids=set(),
            )
            topic = ArticleTopic(
                slug="fixture-naphtha", title_hint="Fixture Naphtha",
                fact_ids=[fact.fact_id for fact in facts],
                signal_ids=[top.signal_id, counter.signal_id], rationale="controlled fixture",
            )

            def writer(*_args):
                return {
                    "title": "Fixture Naphtha",
                    "summary": "Controlled fixture preview; not production facts.",
                    "report_markdown": """# Fixture Naphtha
## 今日结论
Fixture supply tightened; not production facts.
## 原文摘译
> Fixture evidence 1
## 市场传导
Fixture evidence remains isolated from production data.
## 反向信号与风险
Fixture demand weakened.
## 下一交易日验证
Observe fixture metrics.
## 资料
- Fixture Source 1
""",
                }

            def reviewer(*_args, **_kwargs):
                return {"decision": "pass", "score": 95, "blocking_issues": []}

            entry = publication_worker.build_topic_article(
                topic, 1, target_date=target_date, view=view, facts=facts,
                signals=[top, counter], metrics=metrics,
                mapping={"FIXTURE-SOURCE-1": "Fixture Source 1", "FIXTURE-SOURCE-2": "Fixture Source 2"},
                reports_root=reports_root, dify_base_url="fixture://dify",
                writer_key="fixture-writer", review_key="fixture-review",
                writer=writer, reviewer=reviewer, auditor=lambda *_args: [],
            )
            entries = publication_worker.preview_topics_independently(
                [entry], target_date, requested_action="auto", historical=True,
                runner=lambda *_args, **_kwargs: SimpleNamespace(
                    stdout=json.dumps({"action": "draft", "ready": True})
                ),
            )
            date_dir = reports_root / "digit" / target_date.isoformat()
            publication_worker.finalize_daily_aggregate(
                None, "FIXTURE-VIEW", target_date, date_dir, entries,
                {"FIXTURE-SOURCE-1": "Fixture Source 1"}, is_historical=True,
                persister=lambda *_args, **_kwargs: None,
            )
            index = json.loads((date_dir / "index.json").read_text(encoding="utf-8"))
            quality = json.loads(Path(entry["quality_audit_path"]).read_text(encoding="utf-8"))
            llm_review = json.loads(Path(entry["llm_review_path"]).read_text(encoding="utf-8"))

            self.assertEqual(index["articles"][0]["dry_run_status"], "pass")
            self.assertTrue((date_dir / "01-fixture-naphtha.md").is_file())
            self.assertTrue((date_dir / "01-fixture-naphtha_wechat.html").is_file())
            self.assertTrue((date_dir / "daily-index.md").is_file())
            self.assertTrue((date_dir / "daily-index_wechat.html").is_file())
            self.assertIn("not production facts", (date_dir / "01-fixture-naphtha.md").read_text(encoding="utf-8"))
            for audit_payload in (quality, llm_review):
                self.assertEqual(
                    audit_payload["publication_key"],
                    "digit:2026-07-10:01-fixture-naphtha",
                )
                for artifact in ("markdown", "wechat_html", "summary"):
                    self.assertRegex(audit_payload["artifact_sha256"][artifact], r"^[a-f0-9]{64}$")


if __name__ == "__main__":
    unittest.main()

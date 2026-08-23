from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from intelligence.market_pipeline import obsidian_sync
from intelligence.market_pipeline.obsidian_sync import (
    MUTABLE_DIRECTORIES,
    sync_database_to_obsidian,
)


class SnapshotConnection:
    def __init__(self, vault: Path, rows: dict[str, list[dict]], observed_statuses: list[str]):
        self.vault = vault
        self.rows = rows
        self.observed_statuses = observed_statuses

    def cursor(self, row_factory=None):
        connection = self

        class Cursor:
            results: list[dict]

            def execute(self, query, parameters=None):
                for table_name, rows in connection.rows.items():
                    if f"FROM {table_name}" in query:
                        if table_name == "published_articles" and parameters:
                            self.results = [
                                row for row in rows if row["market_date"] == parameters[0]
                            ]
                        else:
                            self.results = rows
                        return
                raise AssertionError(f"unexpected query: {query}")

            def fetchall(self):
                return self.results

        class Context:
            def __enter__(self):
                manifest_path = connection.vault / "09_Evaluation" / "sync_manifest.json"
                connection.observed_statuses.append(json.loads(
                    manifest_path.read_text(encoding="utf-8")
                )["status"])
                return Cursor()

            def __exit__(self, exc_type, exc_value, traceback):
                return False

        return Context()


def write_publication(root: Path, market_date: date, title: str) -> Path:
    source_directory = root / market_date.isoformat()
    source_directory.mkdir(parents=True)
    (source_directory / "chart.png").write_bytes(f"chart-{market_date}".encode())
    markdown_path = source_directory / "daily.md"
    markdown_path.write_text(
        f"# {title}\n\n[Market chart](chart.png)\n",
        encoding="utf-8",
    )
    return markdown_path


def snapshot_rows(publications: list[tuple[date, Path]], *, revised_first_document: bool = False):
    documents = []
    facts = []
    signals = []
    views = []
    articles = []
    for index, (market_date, markdown_path) in enumerate(publications, start=1):
        suffix = market_date.isoformat()
        documents.append({
            "schema_version": "1.0",
            "source_id": f"SRC-{suffix}",
            "market_date": market_date,
            "publisher": "ETI",
            "processing_status": "parsed",
            "content_hash": f"document-hash-{index}",
            "report_title": "Revised historical document" if revised_first_document and index == 1 else f"Document {index}",
            "parse_method": "text",
            "parse_confidence": 1.0,
            "needs_review": False,
            "market_date_reason": "explicit",
        })
        facts.append({
            "schema_version": "1.0",
            "fact_id": f"FACT-{suffix}",
            "source_id": f"SRC-{suffix}",
            "section_id": f"SECTION-{index}",
            "market_date": market_date,
            "verification_status": "verified",
            "risk_level": "low",
            "publication_blocked": False,
            "statement": f"Fact {index}",
            "evidence_text": f"Evidence {index}",
            "fact_type": "price",
            "commodity": "crude_oil",
            "benchmark": "Brent",
            "value": 80 + index,
            "unit": "USD/bbl",
        })
        signals.append({
            "schema_version": "1.0",
            "signal_id": f"SIGNAL-{suffix}",
            "market_date": market_date,
            "signal_status": "top",
            "score": 80 + index,
            "scoring_version": "1.0",
            "title": f"Signal {index}",
            "summary": f"Summary {index}",
            "support_dimensions": ["price", "flow"],
            "supporting_fact_ids": [f"FACT-{suffix}"],
        })
        views.append({
            "schema_version": "1.0",
            "view_id": f"VIEW-{suffix}",
            "market_date": market_date,
            "view_change_type": "updated",
            "publishable": True,
            "main_thesis": f"Thesis {index}",
            "comparison_with_previous_day": f"Comparison {index}",
            "view_json": {"day": index},
        })
        articles.append({"market_date": market_date, "markdown_path": str(markdown_path)})
    return {
        "source_documents": documents,
        "market_facts": facts,
        "market_signals": signals,
        "editorial_views": views,
        "published_articles": articles,
    }


def published_bytes(vault: Path, market_date: date) -> dict[str, bytes]:
    published_root = vault / "08_Published_Daily"
    markdown_path = published_root / f"{market_date}.md"
    artifact_root = published_root / market_date.isoformat()
    paths = [markdown_path, *sorted(path for path in artifact_root.rglob("*") if path.is_file())]
    return {path.relative_to(published_root).as_posix(): path.read_bytes() for path in paths}


def tree_bytes(root: Path) -> dict[str, bytes | None] | None:
    if not root.exists():
        return None
    snapshot: dict[str, bytes | None] = {".": None}
    for path in sorted(root.rglob("*")):
        relative_path = path.relative_to(root).as_posix()
        snapshot[f"{relative_path}/" if path.is_dir() else relative_path] = (
            None if path.is_dir() else path.read_bytes()
        )
    return snapshot


def mutable_bytes(vault: Path) -> dict[str, dict[str, bytes | None] | None]:
    return {
        directory: tree_bytes(vault / directory)
        for directory in sorted(MUTABLE_DIRECTORIES)
    }


def add_stale_cards(vault: Path) -> None:
    for directory in sorted(MUTABLE_DIRECTORIES):
        stale_card = vault / directory / "stale" / "stale-card.md"
        stale_card.parent.mkdir()
        stale_card.write_bytes(b"old-stale\x00" + directory.encode("utf-8"))


class ObsidianSyncAtomicTest(unittest.TestCase):
    def test_date_scoped_sync_ignores_conflicting_historical_publication(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            vault = root / "vault"
            source_root = root / "published"
            historical_date = date(2026, 7, 10)
            target_date = date(2026, 7, 17)
            original_historical = write_publication(source_root, historical_date, "Original history")
            observed_statuses: list[str] = []

            sync_database_to_obsidian(
                SnapshotConnection(
                    vault,
                    snapshot_rows([(historical_date, original_historical)]),
                    observed_statuses,
                ),
                vault,
            )
            original_published = published_bytes(vault, historical_date)

            revised_historical = write_publication(source_root / "revised", historical_date, "Revised history")
            target_markdown = write_publication(source_root, target_date, "Target day")
            counts = sync_database_to_obsidian(
                SnapshotConnection(
                    vault,
                    snapshot_rows([
                        (historical_date, revised_historical),
                        (target_date, target_markdown),
                    ]),
                    observed_statuses,
                ),
                vault,
                market_date=target_date,
            )

            self.assertEqual(counts["articles"], 1)
            self.assertEqual(published_bytes(vault, historical_date), original_published)
            self.assertIn("# Target day", (vault / "08_Published_Daily" / f"{target_date}.md").read_text(encoding="utf-8"))

    def test_full_sync_removes_all_mutable_cards_absent_from_current_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            vault = root / "vault"
            source_root = root / "published"
            first_date = date(2026, 7, 10)
            second_date = date(2026, 7, 11)
            first_markdown = write_publication(source_root, first_date, "Day one")
            observed_statuses: list[str] = []

            sync_database_to_obsidian(
                SnapshotConnection(
                    vault,
                    snapshot_rows([(first_date, first_markdown)]),
                    observed_statuses,
                ),
                vault,
            )
            first_publication = published_bytes(vault, first_date)
            for directory in (
                "02_Source_Documents",
                "03_Atomic_Facts",
                "06_Market_Signals",
                "07_Editorial_Views",
            ):
                (vault / directory / "stale-card.md").write_text(
                    "stale\n",
                    encoding="utf-8",
                )

            second_markdown = write_publication(source_root, second_date, "Day two")
            sync_database_to_obsidian(
                SnapshotConnection(
                    vault,
                    snapshot_rows([(second_date, second_markdown)]),
                    observed_statuses,
                ),
                vault,
            )

            expected_files = {
                "02_Source_Documents": {f"SRC-{second_date}.md"},
                "03_Atomic_Facts": {f"FACT-{second_date}.md"},
                "06_Market_Signals": {f"{second_date}_SIGNAL-{second_date}.md"},
                "07_Editorial_Views": {f"{second_date}.md"},
            }
            for directory, expected in expected_files.items():
                actual = {
                    path.relative_to(vault / directory).as_posix()
                    for path in (vault / directory).rglob("*")
                    if path.is_file()
                }
                self.assertEqual(actual, expected)
            self.assertFalse(
                (vault / "03_Atomic_Facts" / f"FACT-{first_date}.md").exists()
            )
            self.assertEqual(published_bytes(vault, first_date), first_publication)

    def test_first_middle_and_last_copy_failures_restore_full_mutable_snapshot(self):
        for failure_name, failure_call in (("first", 1), ("middle", 4), ("last", 8)):
            with self.subTest(failure=failure_name):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    root = Path(temporary_directory)
                    vault = root / "vault"
                    source_root = root / "published"
                    first_date = date(2026, 7, 10)
                    second_date = date(2026, 7, 11)
                    first_markdown = write_publication(source_root, first_date, "Original")
                    second_markdown = write_publication(source_root, second_date, "Next")
                    observed_statuses: list[str] = []

                    sync_database_to_obsidian(
                        SnapshotConnection(
                            vault,
                            snapshot_rows([(first_date, first_markdown)]),
                            observed_statuses,
                        ),
                        vault,
                    )
                    add_stale_cards(vault)
                    original_mutable = mutable_bytes(vault)
                    original_published = tree_bytes(vault / "08_Published_Daily")
                    copy_calls = [0]
                    original_copy = obsidian_sync._atomic_copy_file

                    def fail_copy(source: Path, target: Path) -> None:
                        copy_calls[0] += 1
                        if copy_calls[0] == failure_call:
                            raise OSError(f"injected {failure_name} copy failure")
                        original_copy(source, target)

                    with patch.object(obsidian_sync, "_atomic_copy_file", fail_copy):
                        with self.assertRaises(OSError):
                            sync_database_to_obsidian(
                                SnapshotConnection(
                                    vault,
                                    snapshot_rows(
                                        [
                                            (first_date, first_markdown),
                                            (second_date, second_markdown),
                                        ],
                                        revised_first_document=True,
                                    ),
                                    observed_statuses,
                                ),
                                vault,
                            )

                    failed_manifest = json.loads(
                        (vault / "09_Evaluation" / "sync_manifest.json").read_text(
                            encoding="utf-8"
                        )
                    )
                    self.assertEqual(copy_calls[0], failure_call)
                    self.assertEqual(failed_manifest["status"], "failed")
                    self.assertEqual(failed_manifest["error_type"], "OSError")
                    self.assertEqual(mutable_bytes(vault), original_mutable)
                    self.assertEqual(
                        tree_bytes(vault / "08_Published_Daily"),
                        original_published,
                    )

    def test_published_creation_failure_restores_mutable_and_published_snapshots(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            vault = root / "vault"
            source_root = root / "published"
            first_date = date(2026, 7, 10)
            second_date = date(2026, 7, 11)
            first_markdown = write_publication(source_root, first_date, "Original")
            second_markdown = write_publication(source_root, second_date, "Next")
            observed_statuses: list[str] = []

            sync_database_to_obsidian(
                SnapshotConnection(
                    vault,
                    snapshot_rows([(first_date, first_markdown)]),
                    observed_statuses,
                ),
                vault,
            )
            add_stale_cards(vault)
            original_mutable = mutable_bytes(vault)
            original_published = tree_bytes(vault / "08_Published_Daily")
            create_calls = [0]
            original_create = obsidian_sync._atomic_create_file

            def fail_second_create(source: Path, target: Path) -> None:
                create_calls[0] += 1
                if create_calls[0] == 2:
                    raise PermissionError(f"cannot create {target}")
                original_create(source, target)

            with patch.object(obsidian_sync, "_atomic_create_file", fail_second_create):
                with self.assertRaises(PermissionError):
                    sync_database_to_obsidian(
                        SnapshotConnection(
                            vault,
                            snapshot_rows(
                                [
                                    (first_date, first_markdown),
                                    (second_date, second_markdown),
                                ],
                                revised_first_document=True,
                            ),
                            observed_statuses,
                        ),
                        vault,
                    )

            failed_manifest = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(create_calls[0], 2)
            self.assertEqual(failed_manifest["status"], "failed")
            self.assertEqual(failed_manifest["error_type"], "PermissionError")
            self.assertEqual(mutable_bytes(vault), original_mutable)
            self.assertEqual(
                tree_bytes(vault / "08_Published_Daily"),
                original_published,
            )

    def test_consecutive_full_syncs_replace_staged_cards_and_preserve_publications(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            vault = root / "vault"
            source_root = root / "published"
            first_date = date(2026, 7, 10)
            second_date = date(2026, 7, 11)
            first_markdown = write_publication(source_root, first_date, "Day one")
            observed_statuses: list[str] = []

            first_counts = sync_database_to_obsidian(
                SnapshotConnection(
                    vault,
                    snapshot_rows([(first_date, first_markdown)]),
                    observed_statuses,
                ),
                vault,
            )
            first_manifest = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )
            first_publication = published_bytes(vault, first_date)

            second_markdown = write_publication(source_root, second_date, "Day two")
            second_counts = sync_database_to_obsidian(
                SnapshotConnection(
                    vault,
                    snapshot_rows(
                        [(first_date, first_markdown), (second_date, second_markdown)],
                        revised_first_document=True,
                    ),
                    observed_statuses,
                ),
                vault,
            )
            second_manifest = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )

            self.assertEqual(first_counts, {
                "documents": 1, "facts": 1, "signals": 1, "views": 1, "articles": 1,
            })
            self.assertEqual(second_counts, {
                "documents": 2, "facts": 2, "signals": 2, "views": 2, "articles": 2,
            })
            self.assertEqual(observed_statuses, ["in_progress", "in_progress"])
            self.assertEqual(first_manifest["status"], "success")
            self.assertEqual(second_manifest["status"], "success")
            self.assertNotEqual(first_manifest["run_id"], second_manifest["run_id"])
            self.assertEqual(published_bytes(vault, first_date), first_publication)
            self.assertIn(
                "Revised historical document",
                (vault / "02_Source_Documents" / f"SRC-{first_date}.md").read_text(encoding="utf-8"),
            )
            self.assertTrue((vault / "03_Atomic_Facts" / f"FACT-{second_date}.md").is_file())
            self.assertTrue(
                (vault / "06_Market_Signals" / f"{second_date}_SIGNAL-{second_date}.md").is_file()
            )
            self.assertTrue((vault / "07_Editorial_Views" / f"{second_date}.md").is_file())
            self.assertTrue((vault / "08_Published_Daily" / f"{second_date}.md").is_file())

    def test_changed_published_content_fails_closed_without_rewriting_old_files(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            vault = root / "vault"
            source_root = root / "published"
            market_date = date(2026, 7, 10)
            markdown_path = write_publication(source_root, market_date, "Original")
            observed_statuses: list[str] = []
            connection = SnapshotConnection(
                vault,
                snapshot_rows([(market_date, markdown_path)]),
                observed_statuses,
            )

            sync_database_to_obsidian(connection, vault)
            original_publication = published_bytes(vault, market_date)
            successful_run_id = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )["run_id"]
            markdown_path.write_text(
                "# Conflicting revision\n\n[Market chart](chart.png)\n",
                encoding="utf-8",
            )

            with self.assertRaises(FileExistsError):
                sync_database_to_obsidian(connection, vault)

            failed_manifest = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(observed_statuses, ["in_progress", "in_progress"])
            self.assertEqual(failed_manifest["status"], "failed")
            self.assertEqual(failed_manifest["error_type"], "FileExistsError")
            self.assertNotEqual(failed_manifest["run_id"], successful_run_id)
            self.assertEqual(published_bytes(vault, market_date), original_publication)

    def test_changed_published_artifact_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            vault = root / "vault"
            source_root = root / "published"
            market_date = date(2026, 7, 10)
            markdown_path = write_publication(source_root, market_date, "Original")
            observed_statuses: list[str] = []
            connection = SnapshotConnection(
                vault,
                snapshot_rows([(market_date, markdown_path)]),
                observed_statuses,
            )

            sync_database_to_obsidian(connection, vault)
            original_publication = published_bytes(vault, market_date)
            (markdown_path.parent / "chart.png").write_bytes(b"changed-chart")

            with self.assertRaises(FileExistsError):
                sync_database_to_obsidian(connection, vault)

            failed_manifest = json.loads(
                (vault / "09_Evaluation" / "sync_manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(failed_manifest["status"], "failed")
            self.assertEqual(published_bytes(vault, market_date), original_publication)


if __name__ == "__main__":
    unittest.main()

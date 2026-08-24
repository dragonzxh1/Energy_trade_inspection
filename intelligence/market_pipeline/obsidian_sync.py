"""One-way PostgreSQL to Obsidian synchronization for pipeline artifacts."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from psycopg import Connection
from psycopg.rows import dict_row


DIRECTORIES = (
    "00_Inbox", "01_Raw_Sources", "02_Source_Documents", "03_Atomic_Facts",
    "04_Commodity_Knowledge", "05_Market_Events", "06_Market_Signals",
    "07_Editorial_Views", "08_Published_Daily", "09_Evaluation", "10_Templates", "99_Archive",
)
MARKDOWN_LINK = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
MUTABLE_DIRECTORIES = {
    "02_Source_Documents",
    "03_Atomic_Facts",
    "06_Market_Signals",
    "07_Editorial_Views",
}
PUBLISHED_DIRECTORY = "08_Published_Daily"


def _write_card(path: Path, frontmatter: dict[str, Any], title: str, body: list[str]) -> None:
    payload = yaml.safe_dump(frontmatter, allow_unicode=True, sort_keys=False)
    _atomic_create_text(
        path,
        f"---\n{payload}---\n\n# {title}\n\n" + "\n\n".join(body) + "\n",
    )


def _atomic_create_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as temporary_file:
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        try:
            os.link(temporary_path, path)
        except FileExistsError:
            raise FileExistsError(f"sync target already exists: {path}") from None
    finally:
        temporary_path.unlink(missing_ok=True)


def _atomic_replace_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as temporary_file:
            temporary_file.write(content)
            temporary_file.flush()
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _atomic_copy_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".tmp", dir=target.parent,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        shutil.copy2(source, temporary_path)
        with temporary_path.open("r+b") as temporary_file:
            os.fsync(temporary_file.fileno())
        os.replace(temporary_path, target)
    finally:
        temporary_path.unlink(missing_ok=True)


def _atomic_create_file(source: Path, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{target.name}.", suffix=".tmp", dir=target.parent,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    try:
        shutil.copy2(source, temporary_path)
        with temporary_path.open("r+b") as temporary_file:
            os.fsync(temporary_file.fileno())
        try:
            os.link(temporary_path, target)
        except FileExistsError:
            raise FileExistsError(f"sync target already exists: {target}") from None
    finally:
        temporary_path.unlink(missing_ok=True)


def _file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _files_match(source: Path, target: Path) -> bool:
    return (
        target.is_file()
        and source.stat().st_size == target.stat().st_size
        and _file_hash(source) == _file_hash(target)
    )


def _relative_files(root: Path) -> set[Path]:
    if not root.exists():
        return set()
    if not root.is_dir():
        raise FileExistsError(f"published artifact target is not a directory: {root}")
    return {path.relative_to(root) for path in root.rglob("*") if path.is_file()}


def _preflight_published_outputs(staging_root: Path, vault: Path) -> list[tuple[Path, Path]]:
    staged_root = staging_root / PUBLISHED_DIRECTORY
    target_root = vault / PUBLISHED_DIRECTORY
    creations: list[tuple[Path, Path]] = []
    staged_markdown_files = sorted(staged_root.glob("*.md"))
    staged_files = {path for path in staged_root.rglob("*") if path.is_file()}
    accounted_files: set[Path] = set(staged_markdown_files)

    for staged_markdown in staged_markdown_files:
        article_name = staged_markdown.stem
        staged_artifact_root = staged_root / article_name
        target_markdown = target_root / staged_markdown.name
        target_artifact_root = target_root / article_name
        staged_artifact_files = _relative_files(staged_artifact_root)
        accounted_files.update(staged_artifact_root / path for path in staged_artifact_files)

        if target_markdown.exists():
            if not _files_match(staged_markdown, target_markdown):
                raise FileExistsError(
                    f"published markdown target conflicts with staged content: {target_markdown}"
                )
            target_artifact_files = _relative_files(target_artifact_root)
            if target_artifact_files != staged_artifact_files:
                raise FileExistsError(
                    f"published artifact set conflicts with staged content: {target_artifact_root}"
                )
            for relative_path in staged_artifact_files:
                if not _files_match(
                    staged_artifact_root / relative_path,
                    target_artifact_root / relative_path,
                ):
                    raise FileExistsError(
                        "published artifact target conflicts with staged content: "
                        f"{target_artifact_root / relative_path}"
                    )
            continue

        target_artifact_files = _relative_files(target_artifact_root)
        if not target_artifact_files.issubset(staged_artifact_files):
            raise FileExistsError(
                f"published artifact set conflicts with staged content: {target_artifact_root}"
            )
        for relative_path in staged_artifact_files:
            source = staged_artifact_root / relative_path
            target = target_artifact_root / relative_path
            if target.exists():
                if not _files_match(source, target):
                    raise FileExistsError(
                        f"published artifact target conflicts with staged content: {target}"
                    )
            else:
                creations.append((source, target))
        creations.append((staged_markdown, target_markdown))

    orphaned_files = staged_files - accounted_files
    if orphaned_files:
        raise RuntimeError(
            "published staging contains artifacts without a daily markdown target: "
            + ", ".join(str(path) for path in sorted(orphaned_files))
        )
    return creations


def _assert_mutable_root(vault: Path, directory: str) -> Path:
    vault_root = vault.resolve(strict=False)
    mutable_root = vault / directory
    if mutable_root.is_symlink():
        raise ValueError(f"mutable directory cannot be a symlink: {mutable_root}")
    if mutable_root.exists() and not mutable_root.is_dir():
        raise FileExistsError(f"mutable target is not a directory: {mutable_root}")
    try:
        mutable_root.resolve(strict=False).relative_to(vault_root)
    except ValueError as error:
        raise ValueError(f"mutable directory escapes vault: {mutable_root}") from error
    return mutable_root


def _relative_mutable_files(root: Path) -> set[Path]:
    if not root.exists():
        return set()
    return {
        path.relative_to(root)
        for path in root.rglob("*")
        if path.is_file() or path.is_symlink()
    }


def _assert_safe_mutable_path(path: Path, mutable_root: Path) -> None:
    try:
        path.relative_to(mutable_root)
        path.parent.resolve(strict=False).relative_to(mutable_root.resolve(strict=False))
    except ValueError as error:
        raise ValueError(f"mutable path escapes managed directory: {path}") from error

    parent = path.parent
    while parent != mutable_root:
        if parent.is_symlink():
            raise ValueError(f"mutable path traverses a symlinked directory: {path}")
        parent = parent.parent


def _preflight_mutable_outputs(
    staging_root: Path,
    vault: Path,
) -> list[tuple[Path, Path]]:
    copies: list[tuple[Path, Path]] = []
    staging_resolved = staging_root.resolve(strict=False)

    for directory in sorted(MUTABLE_DIRECTORIES):
        staged_root = staging_root / directory
        mutable_root = _assert_mutable_root(vault, directory)
        mutable_resolved = mutable_root.resolve(strict=False)
        if mutable_resolved == staging_resolved:
            raise ValueError(f"mutable directory overlaps staging: {mutable_root}")
        try:
            mutable_resolved.relative_to(staging_resolved)
        except ValueError:
            pass
        else:
            raise ValueError(f"mutable directory is inside staging: {mutable_root}")
        try:
            staging_resolved.relative_to(mutable_resolved)
        except ValueError:
            pass
        else:
            raise ValueError(f"staging is inside mutable directory: {mutable_root}")

        staged_files = _relative_mutable_files(staged_root)
        for relative_path in sorted(staged_files):
            source = staged_root / relative_path
            target = mutable_root / relative_path
            if source.is_symlink() or not source.is_file():
                raise ValueError(f"staged mutable output is not a regular file: {source}")
            _assert_safe_mutable_path(target, mutable_root)
            if target.exists() and target.is_dir() and not target.is_symlink():
                raise FileExistsError(f"mutable file target is a directory: {target}")
            copies.append((source, target))

    return copies


def _prepare_mutable_directories(
    mutable_copies: list[tuple[Path, Path]],
    vault: Path,
    transaction_root: Path,
) -> Path:
    prepared_root = transaction_root / "mutable-next"
    for directory in sorted(MUTABLE_DIRECTORIES):
        (prepared_root / directory).mkdir(parents=True)
    for source, target in mutable_copies:
        _atomic_copy_file(source, prepared_root / target.relative_to(vault))
    return prepared_root


def _restore_mutable_directories(
    vault: Path,
    transaction_root: Path,
    snapshotted_directories: list[str],
    installed_directories: list[str],
) -> None:
    snapshot_root = transaction_root / "mutable-snapshot"
    discarded_root = transaction_root / "mutable-discarded"
    discarded_root.mkdir(parents=True, exist_ok=True)
    rollback_errors: list[Exception] = []

    for directory in reversed(installed_directories):
        mutable_root = vault / directory
        if not mutable_root.exists() and not mutable_root.is_symlink():
            continue
        try:
            os.replace(mutable_root, discarded_root / directory)
        except Exception as error:
            rollback_errors.append(error)

    for directory in snapshotted_directories:
        try:
            os.replace(snapshot_root / directory, vault / directory)
        except Exception as error:
            rollback_errors.append(error)

    if rollback_errors:
        details = "; ".join(str(error) for error in rollback_errors)
        raise RuntimeError(f"mutable rollback failed: {details}") from rollback_errors[0]


def _install_mutable_directories(
    prepared_root: Path,
    vault: Path,
    transaction_root: Path,
) -> tuple[list[str], list[str]]:
    snapshot_root = transaction_root / "mutable-snapshot"
    snapshot_root.mkdir(parents=True)
    snapshotted_directories: list[str] = []
    installed_directories: list[str] = []

    try:
        for directory in sorted(MUTABLE_DIRECTORIES):
            mutable_root = _assert_mutable_root(vault, directory)
            if mutable_root.exists():
                os.replace(mutable_root, snapshot_root / directory)
                snapshotted_directories.append(directory)
        for directory in sorted(MUTABLE_DIRECTORIES):
            os.replace(prepared_root / directory, vault / directory)
            installed_directories.append(directory)
    except Exception as error:
        try:
            _restore_mutable_directories(
                vault,
                transaction_root,
                snapshotted_directories,
                installed_directories,
            )
        except Exception as rollback_error:
            error.add_note(str(rollback_error))
        raise

    return snapshotted_directories, installed_directories


def _create_directory_chain(
    path: Path,
    boundary: Path,
    created_directories: list[Path],
) -> None:
    try:
        relative_path = path.relative_to(boundary)
    except ValueError as error:
        raise ValueError(f"directory escapes sync boundary: {path}") from error

    current = boundary
    for part in relative_path.parts:
        current /= part
        if current.is_symlink():
            raise ValueError(f"sync directory cannot be a symlink: {current}")
        if current.exists():
            if not current.is_dir():
                raise FileExistsError(f"sync directory target is not a directory: {current}")
            continue
        current.mkdir()
        created_directories.append(current)


def _rollback_created_outputs(
    published_creations: list[tuple[Path, Path]],
    created_directories: list[Path],
) -> None:
    rollback_errors: list[Exception] = []
    for _, target in reversed(published_creations):
        if not target.exists() and not target.is_symlink():
            continue
        try:
            if not target.is_file() or target.is_symlink():
                raise FileExistsError(f"published rollback target is not a regular file: {target}")
            target.unlink()
        except Exception as error:
            rollback_errors.append(error)
    for directory in reversed(created_directories):
        try:
            directory.rmdir()
        except FileNotFoundError:
            pass
        except Exception as error:
            rollback_errors.append(error)

    if rollback_errors:
        details = "; ".join(str(error) for error in rollback_errors)
        raise RuntimeError(f"created output rollback failed: {details}") from rollback_errors[0]


def _sync_published_markdown(source: Path, target: Path, artifact_directory: Path) -> None:
    if not source.is_file():
        raise FileNotFoundError(f"published markdown source is not a regular file: {source}")
    if target.exists():
        raise FileExistsError(f"published markdown target already exists: {target}")
    source_root = source.parent.resolve(strict=False)
    target.parent.mkdir(parents=True, exist_ok=True)
    artifact_directory.mkdir(parents=True, exist_ok=True)
    artifact_sources: dict[Path, Path] = {}

    def rewrite_link(match: re.Match[str]) -> str:
        label, link = match.groups()
        if link.startswith("#") or re.match(r"^[a-z][a-z0-9+.-]*://", link, re.IGNORECASE):
            return match.group(0)
        candidate = (source.parent / link).resolve(strict=False)
        try:
            candidate.relative_to(source_root)
        except ValueError as error:
            raise ValueError(f"published artifact link escapes source directory: {link}") from error
        if not candidate.is_file():
            raise FileNotFoundError(f"published artifact link target missing: {candidate}")
        copied = artifact_directory / candidate.name
        previous_source = artifact_sources.get(copied)
        if previous_source is not None and previous_source != candidate:
            raise FileExistsError(f"published artifact target is ambiguous: {copied}")
        if previous_source is None:
            shutil.copy2(candidate, copied)
            artifact_sources[copied] = candidate
        rewritten = Path(os.path.relpath(copied, target.parent)).as_posix()
        return f"[{label}]({rewritten})"

    rewritten_markdown = MARKDOWN_LINK.sub(
        rewrite_link,
        source.read_text(encoding="utf-8"),
    )
    _atomic_create_text(target, rewritten_markdown)


def _stage_database_outputs(
    connection: Connection[Any], vault: Path, *, market_date: date | None = None,
) -> dict[str, int]:
    for directory in DIRECTORIES:
        (vault / directory).mkdir(parents=True, exist_ok=True)
    counts = {"documents": 0, "facts": 0, "signals": 0, "views": 0, "articles": 0}
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute("SELECT * FROM source_documents ORDER BY market_date,source_id")
        for row in cursor.fetchall():
            _write_card(
                vault / "02_Source_Documents" / f"{row['source_id']}.md",
                {"schema_version":row["schema_version"],"source_id":row["source_id"],"market_date":row["market_date"],
                 "publisher":row["publisher"],"status":row["processing_status"],"content_hash":row["content_hash"]},
                row["report_title"],
                [f"## 解析\n\n- 方法：{row['parse_method']}\n- 置信度：{row['parse_confidence']}\n- 需审核：{row['needs_review']}",
                 f"## 日期选择\n\n{row['market_date_reason']}", f"## 内部追溯\n\n`{row['source_id']}`"],
            ); counts["documents"] += 1
        cursor.execute("SELECT * FROM market_facts WHERE is_current=true ORDER BY market_date,fact_id")
        for row in cursor.fetchall():
            _write_card(
                vault / "03_Atomic_Facts" / f"{row['fact_id']}.md",
                {"schema_version":row["schema_version"],"fact_id":row["fact_id"],"source_id":row["source_id"],
                 "section_id":row["section_id"],"market_date":row["market_date"],"verification_status":row["verification_status"],
                 "risk_level":row["risk_level"],"publication_blocked":row["publication_blocked"]},
                row["statement"], [f"## 证据\n\n> {row['evidence_text']}", f"## 字段\n\n- 类型：{row['fact_type']}\n- 品种：{row['commodity'] or ''}\n- 基准：{row['benchmark'] or ''}\n- 数值：{row['value'] if row['value'] is not None else ''} {row['unit'] or ''}"],
            ); counts["facts"] += 1
        cursor.execute("SELECT * FROM market_signals ORDER BY market_date,signal_id")
        for row in cursor.fetchall():
            _write_card(
                vault / "06_Market_Signals" / f"{row['market_date']}_{row['signal_id']}.md",
                {"schema_version":row["schema_version"],"signal_id":row["signal_id"],"market_date":row["market_date"],
                 "status":row["signal_status"],"score":row["score"],"scoring_version":row["scoring_version"]},
                row["title"], [row["summary"], f"## 支持维度\n\n{', '.join(row['support_dimensions'])}",
                 f"## 事实\n\n" + "\n".join(f"- `{item}`" for item in row["supporting_fact_ids"])],
            ); counts["signals"] += 1
        cursor.execute("SELECT * FROM editorial_views ORDER BY market_date")
        for row in cursor.fetchall():
            _write_card(
                vault / "07_Editorial_Views" / f"{row['market_date']}.md",
                {"schema_version":row["schema_version"],"view_id":row["view_id"],"market_date":row["market_date"],
                 "change_type":row["view_change_type"],"publishable":row["publishable"]},
                f"编辑判断｜{row['market_date']}", [f"## 唯一主线\n\n{row['main_thesis']}",
                 f"## 与前日比较\n\n{row['comparison_with_previous_day']}",
                 f"## 完整合同\n\n```json\n{json.dumps(row['view_json'],ensure_ascii=False,indent=2)}\n```"],
            ); counts["views"] += 1
        published_query = "SELECT * FROM published_articles"
        published_parameters: tuple[object, ...] = ()
        if market_date is not None:
            published_query += " WHERE market_date = %s"
            published_parameters = (market_date,)
        cursor.execute(f"{published_query} ORDER BY market_date", published_parameters)
        for row in cursor.fetchall():
            markdown_path = row.get("markdown_path")
            if not markdown_path:
                raise FileNotFoundError("published article markdown_path is missing")
            source = Path(str(markdown_path))
            market_date = str(row["market_date"])
            target = vault / "08_Published_Daily" / f"{market_date}.md"
            _sync_published_markdown(
                source,
                target,
                vault / "08_Published_Daily" / market_date,
            )
            counts["articles"] += 1
    return counts


def _manifest_payload(
    run_id: str,
    status: str,
    started_at: str,
    counts: dict[str, int],
    error: Exception | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "run_id": run_id,
        "status": status,
        "started_at": started_at,
        "counts": counts,
        **counts,
    }
    if status != "in_progress":
        payload["finished_at"] = datetime.now(timezone.utc).isoformat()
    if error is not None:
        payload["error_type"] = type(error).__name__
        payload["error_message"] = str(error)
    return payload


def _write_manifest(path: Path, payload: dict[str, Any]) -> None:
    _atomic_replace_text(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
    )


def sync_database_to_obsidian(
    connection: Connection[Any], vault: Path, *, market_date: date | None = None,
) -> dict[str, int]:
    manifest_path = vault / "09_Evaluation" / "sync_manifest.json"
    run_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc).isoformat()
    empty_counts = {
        "documents": 0,
        "facts": 0,
        "signals": 0,
        "views": 0,
        "articles": 0,
    }
    _write_manifest(
        manifest_path,
        _manifest_payload(run_id, "in_progress", started_at, empty_counts),
    )
    transaction_root: Path | None = None
    published_creations: list[tuple[Path, Path]] = []
    created_directories: list[Path] = []
    mutable_swap: tuple[list[str], list[str]] | None = None
    try:
        transaction_root = Path(tempfile.mkdtemp(
            prefix=f".{vault.name}.obsidian-sync-",
            dir=vault.parent,
        ))
        staging_root = transaction_root / "staging"
        counts = _stage_database_outputs(connection, staging_root, market_date=market_date)
        mutable_copies = _preflight_mutable_outputs(staging_root, vault)
        published_creations = _preflight_published_outputs(staging_root, vault)
        prepared_root = _prepare_mutable_directories(
            mutable_copies,
            vault,
            transaction_root,
        )
        for directory in DIRECTORIES:
            if directory not in MUTABLE_DIRECTORIES:
                _create_directory_chain(
                    vault / directory,
                    vault,
                    created_directories,
                )
        for source, target in published_creations:
            _create_directory_chain(target.parent, vault, created_directories)
            _atomic_create_file(source, target)
        mutable_swap = _install_mutable_directories(
            prepared_root,
            vault,
            transaction_root,
        )
        _write_manifest(
            manifest_path,
            _manifest_payload(run_id, "success", started_at, counts),
        )
        return counts
    except Exception as error:
        if mutable_swap is not None and transaction_root is not None:
            try:
                _restore_mutable_directories(
                    vault,
                    transaction_root,
                    mutable_swap[0],
                    mutable_swap[1],
                )
            except Exception as rollback_error:
                error.add_note(str(rollback_error))
        try:
            _rollback_created_outputs(published_creations, created_directories)
        except Exception as rollback_error:
            error.add_note(str(rollback_error))
        try:
            _write_manifest(
                manifest_path,
                _manifest_payload(run_id, "failed", started_at, empty_counts, error),
            )
        except Exception as manifest_error:
            error.add_note(f"failed to persist failed sync manifest: {manifest_error}")
        raise
    finally:
        if transaction_root is not None:
            shutil.rmtree(transaction_root, ignore_errors=True)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Synchronize ETI pipeline artifacts to Obsidian")
    parser.add_argument("--date", help="Limit published article synchronization to one market date")
    args = parser.parse_args()
    database_url=os.environ["DATABASE_URL"]
    vault=Path(os.getenv("OBSIDIAN_VAULT","/var/www/eti/obsidian-vault"))
    market_date = date.fromisoformat(args.date) if args.date else None
    with Connection.connect(database_url) as connection:
        counts=sync_database_to_obsidian(connection,vault,market_date=market_date)
    print(json.dumps(counts,ensure_ascii=False),flush=True)


if __name__=="__main__": main()

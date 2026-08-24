#!/usr/bin/env python3
"""Verify runtime links and detect exact credential values outside shared storage."""

from __future__ import annotations

import argparse
import csv
import grp
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
from dataclasses import dataclass
from typing import Iterable


SENSITIVE_ENV_NAME = re.compile(
    r"(?:^|_)(?:SECRET|PASSWORD|TOKEN|BEARER|API_KEY|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)(?:_|$)"
    r"|DATABASE_URL|APPSECRET"
)
PLACEHOLDER_VALUES = {
    "changeme",
    "replace_me",
    "replace-me",
    "your_key_here",
    "your-key-here",
}


@dataclass(frozen=True)
class Resource:
    phase: str
    kind: str
    mode: int
    owner: str
    destination: str
    source: Path
    scan_policy: str


def load_manifest(path: Path) -> list[Resource]:
    resources: list[Resource] = []
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.reader(handle, delimiter="\t"):
            if not row or row[0].startswith("#"):
                continue
            if len(row) != 7:
                raise ValueError(f"invalid manifest row for {row[4] if len(row) > 4 else 'unknown'}")
            phase, kind, mode, owner, destination, source, scan_policy = row
            if phase not in {"pre-build", "post-build"}:
                raise ValueError(f"invalid phase for {destination}")
            if kind not in {"file", "directory"}:
                raise ValueError(f"invalid kind for {destination}")
            destination_path = Path(destination)
            if destination_path.is_absolute() or ".." in destination_path.parts:
                raise ValueError(f"unsafe destination for {destination}")
            resources.append(Resource(phase, kind, int(mode, 8), owner, destination, Path(source), scan_policy))
    return resources


def verify_resource(resource: Resource, release: Path, shared: Path) -> None:
    source = resource.source.resolve(strict=True)
    if resource.source.is_symlink() or not source.is_relative_to(shared):
        raise RuntimeError(f"unsafe source for {resource.destination}")
    if resource.kind == "file" and not source.is_file():
        raise RuntimeError(f"required file missing for {resource.destination}")
    if resource.kind == "directory" and not source.is_dir():
        raise RuntimeError(f"required directory missing for {resource.destination}")

    source_stat = source.stat()
    actual_mode = stat.S_IMODE(source_stat.st_mode)
    actual_owner = f"{pwd.getpwuid(source_stat.st_uid).pw_name}:{grp.getgrgid(source_stat.st_gid).gr_name}"
    if actual_mode != resource.mode or actual_owner != resource.owner:
        raise RuntimeError(
            f"metadata mismatch for {resource.destination}: "
            f"expected={resource.mode:o}/{resource.owner} actual={actual_mode:o}/{actual_owner}"
        )

    destination = release / resource.destination
    if not destination.is_symlink():
        raise RuntimeError(f"runtime destination is not a symlink: {resource.destination}")
    if destination.resolve(strict=True) != source:
        raise RuntimeError(f"runtime destination has unexpected target: {resource.destination}")


def parse_env_secrets(path: Path, label: str) -> dict[bytes, set[str]]:
    secrets: dict[bytes, set[str]] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        name, value = stripped.split("=", 1)
        name = name.removeprefix("export ").strip()
        if not SENSITIVE_ENV_NAME.search(name):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        if (
            len(value) < 8
            or value.casefold() in PLACEHOLDER_VALUES
            or (value.startswith("${") and value.endswith("}"))
        ):
            continue
        secrets.setdefault(value.encode(), set()).add(f"{label}:{name}")
    return secrets


def parse_json_secrets(path: Path, keys: list[str], label: str) -> dict[bytes, set[str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    secrets: dict[bytes, set[str]] = {}
    for key in keys:
        value = str(payload.get(key, "")).strip()
        if len(value) < 8:
            raise RuntimeError(f"required credential is empty or too short: {label}:{key}")
        secrets.setdefault(value.encode(), set()).add(f"{label}:{key}")
    return secrets


def collect_secrets(resources: list[Resource]) -> dict[bytes, set[str]]:
    secrets: dict[bytes, set[str]] = {}
    for resource in resources:
        if resource.scan_policy == "none":
            continue
        if resource.scan_policy == "env":
            found = parse_env_secrets(resource.source, resource.destination)
        elif resource.scan_policy.startswith("json:"):
            keys = [key for key in resource.scan_policy.removeprefix("json:").split(",") if key]
            found = parse_json_secrets(resource.source, keys, resource.destination)
        else:
            raise ValueError(f"unknown scan policy for {resource.destination}")
        for value, labels in found.items():
            secrets.setdefault(value, set()).update(labels)
    if not secrets:
        raise RuntimeError("no credentials were selected for leakage scanning")
    return secrets


def iter_regular_files(root: Path) -> Iterable[Path]:
    if root.is_symlink():
        return
    if root.is_file():
        yield root
        return
    if not root.is_dir():
        return
    for current, directories, files in os.walk(root, followlinks=False):
        current_path = Path(current)
        directories[:] = [name for name in directories if not (current_path / name).is_symlink()]
        for name in files:
            path = current_path / name
            if not path.is_symlink():
                yield path


def matching_labels(path: Path, secrets: dict[bytes, set[str]]) -> set[str]:
    labels: set[str] = set()
    max_length = max(map(len, secrets))
    overlap = b""
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                window = overlap + chunk
                for value, value_labels in secrets.items():
                    if value in window:
                        labels.update(value_labels)
                overlap = window[-max_length + 1 :] if max_length > 1 else b""
    except OSError as exc:
        raise RuntimeError(f"cannot scan file: {path}: {exc.strerror or exc}") from exc
    return labels


def scan_scope(paths: Iterable[Path], secrets: dict[bytes, set[str]]) -> list[tuple[Path, set[str]]]:
    findings: list[tuple[Path, set[str]]] = []
    for root in paths:
        for path in iter_regular_files(root):
            labels = matching_labels(path, secrets)
            if labels:
                findings.append((path, labels))
    return findings


def git_tracked_files(release: Path) -> list[Path]:
    raw = subprocess.check_output(["git", "-C", str(release), "ls-files", "-z"])
    return [release / item.decode() for item in raw.split(b"\0") if item]


def verify_backup_secret_permissions(root: Path) -> int:
    names = {
        ".env",
        ".env.local",
        ".env.intelligence",
        ".env.web-research-agent",
        "wechat_publish.json",
    }
    files = [path for path in root.rglob("*") if path.is_file() and path.name in names]
    unsafe = [path for path in files if stat.S_IMODE(path.stat().st_mode) & 0o077]
    for path in unsafe:
        print(f"unsafe backup credential permissions: path={path}", file=sys.stderr)
    if unsafe:
        raise RuntimeError("backup credential files must not be accessible by group or other users")
    return len(files)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-dir", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--skip-logs", action="store_true")
    args = parser.parse_args()

    release = args.release_dir.resolve(strict=True)
    manifest = args.manifest or release / "deploy" / "runtime-resources.tsv"
    shared = Path("/var/www/eti/shared").resolve(strict=True)
    resources = load_manifest(manifest)
    for resource in resources:
        verify_resource(resource, release, shared)
    print(f"runtime_links=ok count={len(resources)}")

    build = release / ".next"
    if not build.is_dir():
        raise RuntimeError("Next.js build directory is missing; run verification after build")
    secrets = collect_secrets(resources)
    scopes: dict[str, list[Path]] = {
        "git_tracked": git_tracked_files(release),
        "next_build": [build],
    }
    web_agent_build = release / "web-research-agent" / "dist"
    if web_agent_build.is_dir():
        scopes["web_agent_build"] = [web_agent_build]
    release_root = Path("/var/www/eti/releases")
    if release_root.is_dir():
        scopes["historical_next_builds"] = [
            candidate
            for candidate in release_root.glob("*/.next")
            if candidate.is_dir() and candidate.resolve() != build.resolve()
        ]
        scopes["historical_web_agent_builds"] = [
            candidate
            for candidate in release_root.glob("*/web-research-agent/dist")
            if candidate.is_dir() and candidate.resolve() != web_agent_build.resolve()
        ]
    if not args.skip_logs:
        scopes["logs"] = [Path("/var/log/eti"), Path("/home/ubuntu/.pm2/logs")]

    leaked = False
    for scope, paths in scopes.items():
        findings = scan_scope(paths, secrets)
        print(f"secret_scan scope={scope} findings={len(findings)}")
        for path, labels in findings:
            leaked = True
            print(f"credential leak: scope={scope} path={path} labels={','.join(sorted(labels))}", file=sys.stderr)

    process_args = subprocess.check_output(["ps", "-eo", "args="])
    process_labels = sorted({
        label
        for value, labels in secrets.items()
        if value in process_args
        for label in labels
    })
    print(f"secret_scan scope=process_argv findings={len(process_labels)}")
    if process_labels:
        leaked = True
        print(f"credential leak: scope=process_argv labels={','.join(process_labels)}", file=sys.stderr)
    backup_root = Path("/var/www/eti/backups")
    if backup_root.is_dir():
        backup_count = verify_backup_secret_permissions(backup_root)
        print(f"backup_secret_permissions=ok count={backup_count}")
    return 1 if leaked else 0


if __name__ == "__main__":
    raise SystemExit(main())

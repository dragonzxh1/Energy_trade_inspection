---
phase: 01-architecture-hardening
plan: 03
subsystem: intelligence
tags: [python, startup-check, developer-experience, reliability]
dependency_graph:
  requires: []
  provides: [python-binary-startup-warning]
  affects: [src/lib/server/intelligence.ts]
tech_stack:
  added: []
  patterns: [module-level-existsSync-guard]
key_files:
  modified:
    - src/lib/server/intelligence.ts
decisions:
  - "Use console.error (not throw) so missing venv does not crash the process — intelligence is supplemental"
  - "Platform-specific fix command in warning message matches the existing win32 path-resolution pattern"
metrics:
  duration: "< 5 minutes"
  completed: "2026-04-13"
  tasks_completed: 1
  tasks_total: 1
  files_modified: 1
---

# Phase 01 Plan 03: Python Binary Startup Check Summary

**One-liner:** `existsSync()` guard at module load emits actionable console.error naming the missing path and platform-specific venv setup command.

## What Was Built

Added an `existsSync()` startup check in `src/lib/server/intelligence.ts` that fires at module initialization. If the Python binary resolved by the `PYTHON` constant is absent, a `console.error` message is logged immediately — before any user request triggers `runCli()` — with the exact missing path and the platform-appropriate fix command.

## Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add existsSync() startup check for Python binary | bfd2e65 | src/lib/server/intelligence.ts |

## Decisions Made

1. **console.error not throw** — Intelligence is supplemental and non-blocking. The existing `runCli()` catch already handles ENOENT at call time. The startup warning is additive; crashing the process for a missing venv would be too disruptive.
2. **Platform-specific fix command** — The warning message uses `process.platform === 'win32'` to emit the correct pip path (`Scripts` vs `bin`), matching the established pattern for the `PYTHON` constant itself.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check

- `grep -n "existsSync" src/lib/server/intelligence.ts` returns 2 lines (import + usage): PASS
- `grep -n "Python binary not found" src/lib/server/intelligence.ts` returns 1 line: PASS
- `grep -n "process.platform === 'win32'" src/lib/server/intelligence.ts` returns 2 lines: PASS
- `npm run type-check` exits 0: PASS
- Commit bfd2e65 exists: PASS

## Self-Check: PASSED

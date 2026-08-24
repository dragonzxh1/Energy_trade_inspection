# Current WeChat publication release baseline

## Identity

- Branch: `codex/wechat-current-baseline`
- Dependency base: `91c06a4`
- Production evidence source: `45332ed`
- Reconstruction date: `2026-08-24` (Asia/Singapore)

This branch is the candidate baseline for the current structured WeChat
publication system. It is reconstructed from the security dependency branch,
not from the dirty production worktree.

## Included

- Database migrations 046-065, excluding the unrelated 061 mini-assistant
  experiment, with rollback and validation SQL
- Telegram adapters, source documents, facts, editorial generation, summary
  image publication, digit publication, external research, and notifications
- WeChat publishing compatibility code required by active price reconciliation
- Active cron, Telegram collector, document parser, fact backfill, and web
  research service definitions
- Next.js 16.3.2 dependency baseline and the production hardcoded Dify-key
  removal

## Held outside this release

- The 061 WeChat mini-assistant product experiment and its UI/API changes
- Platts OCR trial package, OCR runtime outputs, and `ocr_trial.py`
- Dify workflow deployment helpers that can activate an ambiguous latest
  workflow instead of a specific created workflow
- `article_four_round.py`, `auth-actions.ts`, and the credential-bearing
  `needs_review_worker.py`, which had no active production reference
- Runtime configuration, credentials, QR assets, reports, caches, backups,
  virtual environments, dependency directories, and generated output

Legacy daily-report and image-publication modules remain only where the active
price compatibility path imports them. The crontab does not schedule the legacy
daily-report entrypoint.

## Release gates

1. Run the migration reconciliation command in dry-run mode against a recent
   production backup: `npm run db:reconcile-production -- --dry-run`.
2. Review every `VERIFIED` schema signature, then run the explicit `--apply`
   command once. Never insert migration rows without a clean dry run.
3. Run the normal migration runner and all SQL validation scripts.
4. Install the reviewed cron runner with `sudo bash scripts/install-cron-runner.sh`,
   then install the crontab as the application user with
   `bash scripts/setup-crontab.sh`.
5. Pass Python tests, web-agent tests/build, root type-check/build, and a
   credential scan before deployment.
6. Install the verified database backup timer with
   `sudo bash scripts/install-database-backup.sh`, manually start the service
   once, and inspect `SHA256SUMS` plus `restore.list` before relying on the
   schedule.

Runtime resources are declared in `deploy/runtime-resources.tsv`; the manifest
contains paths and policies only, never values. Build a fresh release in an
isolated environment, then mount `post-build` resources and run the leakage
gate:

```bash
npm ci
bash scripts/build-production-release.sh
bash scripts/install-runtime-resources.sh --phase post-build
python3 scripts/verify-runtime-resources.py
```

Do not mount production env files, `.venv`, `.venv-intelligence`, or
`intelligence/wechat_publish.json` before `next build`. They are explicitly
post-build resources so Turbopack cannot cache production credentials or
traverse the Python environments. The verifier compares exact credential
values in memory against Git-tracked files, `.next`, current and historical Web
Agent build output, operational logs, and process arguments; it reports labels
and paths only, never credential values.

`build-production-release.sh` refuses to run if any runtime resource is already
mounted. It clears inherited environment variables with `env -i`, supplies only
non-production build placeholders required for route collection, and removes
the non-runtime `.next/cache` directory after a successful build.

## Operational hardening

- OpenSanctions synchronization has both a cron-level nonblocking `flock` and
  a PostgreSQL advisory lock. Each run uses unique host/container temporary
  files and a unique staging table; `psql` no longer receives `DATABASE_URL`
  in its process arguments.
- `eti-database-backup.timer` creates a daily PostgreSQL custom-format backup,
  validates it with `pg_restore --list`, writes SHA-256 checksums, and retains
  three days by default. `ETI_BACKUP_RETENTION_DAYS` may be set from 1 to 30.
- Offsite backup is intentionally not claimed as complete. Set
  `ETI_BACKUP_REMOTE` and install/configure `rclone` before treating the backup
  as host-loss protection; a configured remote that cannot be copied causes
  the service to fail and notify operators.

## Known dependency risk

The 2026-08-24 production-only npm audit reports no high or critical findings.
It reports two moderate advisories through `exceljs@4.4.0 -> uuid@8.3.2`.
The registry-proposed forced fix is a breaking ExcelJS version change, so this
baseline records the risk instead of applying an unreviewed `--force` change.
The Web Research Agent production dependency audit reports zero findings.

## Production validation reconciliation

The 2026-08-24 production gate exposed validation queries that predated later
pipeline semantics. The release updates those checks to match the deployed
rules: attributed high-risk facts are warnings unless blocked, review drafts
are not public releases, later article modes are valid, and section triage is
checked by event order rather than final status alone.

`db/maintenance/060_reconcile_section_triage_v2.sql` is the reviewed one-time
repair for sections already classified as ineligible while still carrying a
pending or retryable extraction state. It does not touch eligible, processing,
completed, or review-required sections.

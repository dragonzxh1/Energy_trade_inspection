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

## Known dependency risk

The 2026-08-24 production-only npm audit reports no high or critical findings.
It reports two moderate advisories through `exceljs@4.4.0 -> uuid@8.3.2`.
The registry-proposed forced fix is a breaking ExcelJS version change, so this
baseline records the risk instead of applying an unreviewed `--force` change.
The Web Research Agent production dependency audit reports zero findings.

# Production-observed baseline: 2026-08-24

## Purpose

This branch records a sanitized source snapshot observed at
`/var/www/eti/Energy_trade_inspection` on the ETI production host. It preserves
production drift for review and reconstruction. It is evidence, not a release
candidate, and must not be deployed directly.

## Git relationship

- Snapshot branch: `codex/prod-observed-20260824`
- Production-reported HEAD before capture: `70c16b6`
- Snapshot base: `70c16b6`
- Capture date: `2026-08-24` (Asia/Singapore)
- Text files were imported through a sanitized archive and normalized by Git;
  runtime ownership and file timestamps are not represented.

## Sanitization exclusions

The following production files or classes were deliberately not copied:

- Environment files and secret-bearing configuration, except
  `.env.local.example`
- `intelligence/wechat_publish.json`
- `intelligence/market_pipeline/needs_review_worker.py` because the observed
  copy contained an embedded credential and was not referenced by active units
- Python virtual environments, `node_modules`, caches, bytecode, logs, backups,
  temporary sync trees, OCR output, generated reports, and vendor archives

No credential value from the production host is part of this snapshot.

## Observed operational drift

- The database contains schema changes corresponding to migrations 045, 055,
  056, 057, and 063, but those filenames were absent from
  `schema_migrations` at capture time.
- Application startup repeatedly stopped at migration 045 because the
  `seo_content.commodity` column already existed. Migration tracking must be
  reconciled only after validating each expected schema signature.
- The active crontab invoked the repository-owned
  `scripts/cron-runner.sh`. A distinct root-managed runner existed at
  `/usr/local/lib/eti-cron/cron-runner.sh`, but it was not the active target.
- The running Next.js process reported version 16.2.3. The later dependency
  security baseline was not yet deployed.
- Document parsing, fact backfill, and the web research agent were active. The
  Telegram collector health timer was present but disabled.

## Classification

- Current production pipeline source: migrations 046-065 (except the absent
  061 product experiment), structured market pipeline workers, publication
  workers, source dossiers, Telegram ingestion, systemd units, and the web
  research agent.
- Historical compatibility source: legacy daily report and direct Dify
  aggregate publication scripts. Preserve for archaeology; do not schedule in
  the reconstructed release.
- Experimental source: OCR trial code and Dify workflow deployment helpers.
  Review separately before promoting.

The deployable baseline is reconstructed independently on
`codex/wechat-current-baseline` from the security dependency baseline, selected
production source, explicit migration reconciliation, and release validation.

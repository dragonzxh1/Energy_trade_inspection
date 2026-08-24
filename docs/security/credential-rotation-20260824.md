# Production credential rotation ledger: 2026-08-24

This ledger records credential names and verification evidence only. It must
never contain credential values, hashes, prefixes, screenshots, or recovery
codes.

## Completed on host

| Scope | Credential names | Result |
| --- | --- | --- |
| Application authorization | `ADMIN_SECRET`, `ETI_ADMIN_BEARER`, `AUTH_SECRET`, `SYNC_SECRET` | Rotated; new Admin credential accepted, old credential rejected, old values absent from process environments |
| PostgreSQL application role | `DATABASE_URL` password | Rotated; new connection and application query passed, old connection rejected |
| Web Agent isolation | `FIRECRAWL_API_KEY`, `DEEPSEEK_FLASH_AGENT_API_KEY` | Moved to the four-key `.env.web-research-agent`; no unrelated sensitive variable remains in the service process |
| PM2 persistence | `/home/ubuntu/.pm2/dump.pm2` | Rebuilt from a clean environment, mode `0600`, zero production credential findings |
| Revoked-value backups | Internal and database rotation backups | Removed after verification; no revoked credential rollback copy retained |

Production baseline after these controls: `production-credential-hardening-20260824`.

## Pending external issuance

These values were present in the production runtime environment during the
historic credential-bearing build. No external disclosure was observed, but
they should be replaced at the provider because the server cannot mint or
revoke them safely by itself.

| Priority | Provider credentials | Required sequence |
| --- | --- | --- |
| P0 | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ETI_NOTIFY_TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY` | Issue replacement, update runtime file, restart only consumers, verify read-only or test operation, revoke old value, run leakage gate |
| P0 | `DIFY_DATASET_API_KEY` and all non-empty `DIFY_WORKFLOW_API_KEY*` values | Create replacement in the matching Dify app/workflow, update the exact variable, run workflow verification, revoke old key |
| P1 | `FIRECRAWL_API_KEY`, `DEEPSEEK_API_KEY`, `DEEPSEEK_FLASH_AGENT_API_KEY`, `QWEN_API_KEY`, `TAVILY_API_KEY`, `TAVILY_API_KEY_BACKUP` | Prefer overlap with two valid keys; update `.env.web-research-agent` as well when the Web Agent consumes the value |
| P1 | `OPENSANCTIONS_API_KEY`, `COMPANIES_HOUSE_API_KEY`, `VESSELAPI_KEY`, `XFYUN_MAAS_API_KEY`, `EQUASIS_PASSWORD` | Rotate provider-side, run the corresponding source preflight, then revoke the old credential |

`DIFY_WORKFLOW_API_KEY_REVIEW_REPAIR` is currently empty and has no value to
rotate. `wechat_publish.json:appsecret` was not found in the affected build
cache; it remains mode `0600` and is not included in the incident-driven
rotation queue unless WeChat-side evidence changes.

## Per-key gate

1. Never put a replacement value in Git, a PR, a command argument, a ticket, or
   this ledger.
2. Update `/var/www/eti/shared/.env.local` atomically with mode `0600`; update
   the dedicated Web Agent env too when applicable.
3. Restart only the consumers and test one bounded operation. Do not revoke the
   old key until the replacement succeeds.
4. Revoke the old key, confirm it fails, and remove temporary rollback copies.
5. Run `python3 scripts/verify-runtime-resources.py`; every credential scope
   must report zero findings.

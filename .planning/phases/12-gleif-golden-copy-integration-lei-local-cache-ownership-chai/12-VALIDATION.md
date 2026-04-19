---
phase: 12
slug: gleif-golden-copy-integration-lei-local-cache-ownership-chai
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | TypeScript type-check (`tsc --noEmit`) + ESLint + integration tests via `pg` direct queries |
| **Config file** | `tsconfig.json`, `.eslintrc` |
| **Quick run command** | `npm run type-check && npm run lint` |
| **Full suite command** | `npm run build` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run type-check && npm run lint`
- **After every plan wave:** Run `npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | D-08 | — | Migration idempotent | type-check | `npm run type-check` | ✅ | ⬜ pending |
| 12-01-02 | 01 | 1 | D-01 | — | Table + indexes exist | integration | `psql -c "\d lei_cache"` | ❌ W0 | ⬜ pending |
| 12-02-01 | 02 | 1 | D-03/D-04 | — | Streaming without OOM | type-check | `npm run type-check` | ❌ W0 | ⬜ pending |
| 12-03-01 | 03 | 2 | D-05 | — | Cache-first hit returns | type-check | `npm run type-check` | ✅ | ⬜ pending |
| 12-04-01 | 04 | 2 | D-07 | — | Risk flag injected | type-check | `npm run type-check` | ✅ | ⬜ pending |
| 12-05-01 | 05 | 3 | D-10 | — | Cron auth enforced | type-check | `npm run type-check` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/server/sync/gleif-golden-copy.ts` — stub file with exported function signatures
- [ ] `db/migrations/037_lei_cache.sql` — migration file exists (Wave 1)
- [ ] npm packages installed: `unzipper`, `stream-json`, `@types/unzipper`

*Infrastructure note: No test framework installation needed — project uses tsc + lint for correctness gates.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full LEI2 Golden Copy download + import (875 MB) | D-03 | Requires live GLEIF API + multi-minute runtime | Run `syncLeiFull()` in admin sync, verify record count in lei_cache |
| Daily delta cron end-to-end | D-10 | Requires scheduled HTTP trigger | POST /api/cron/gleif-delta with Bearer ADMIN_SECRET, verify sync log entry |
| Ownership chain populated | D-06 | Requires Level 2 RR data | Query `SELECT COUNT(*) FROM lei_cache WHERE direct_parent_lei IS NOT NULL` after syncLeiLevel2() |
| Reporting exception risk flag shown in UI | D-07 | UI display requires manual check | View a company page where entity has opacity exception, confirm risk flag badge |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

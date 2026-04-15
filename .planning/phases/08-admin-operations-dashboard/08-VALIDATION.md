---
phase: 8
slug: admin-operations-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-15
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | npm run type-check (tsc --noEmit) — project has no test suite |
| **Config file** | tsconfig.json |
| **Quick run command** | `npm run type-check` |
| **Full suite command** | `npm run type-check` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run type-check`
- **After every plan wave:** Run `npm run type-check`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 08-01-01 | 01 | 1 | ADMIN-01 | T-08-01 | Non-admin cannot read sync log — 403 returned | manual + grep | `grep -n "isAuthorized" src/app/api/admin/sync/route.ts` | ⬜ pending |
| 08-01-02 | 01 | 1 | ADMIN-02 | T-08-02 | Non-admin cannot read user list — 403 returned | manual + grep | `grep -rn "isAuthorized" src/app/api/admin/` | ⬜ pending |
| 08-02-01 | 02 | 1 | ADMIN-03 | T-08-03 | Plan update validated server-side against whitelist | grep | `grep -n "free\|starter\|enterprise" src/app/api/admin/users/` | ⬜ pending |
| 08-02-02 | 02 | 1 | ADMIN-04 | — | N/A | type-check | `npm run type-check` | ⬜ pending |
| 08-03-01 | 03 | 1 | ADMIN-01..04 | — | N/A | type-check | `npm run type-check` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test framework installation needed — project uses type-check only.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sync History tab shows correct log rows | ADMIN-01 | Requires live DB with sync_log data | Start dev server, navigate to /admin, check Sync History tab |
| User list shows all users with correct plan badges | ADMIN-02 | Requires live DB with user data | Check Users tab, verify email/plan/dates display |
| Plan change takes effect immediately | ADMIN-03 | Requires live DB write + optimistic update | Change a user plan in dashboard, verify badge updates |
| Stats show correct totals and 30-day chart | ADMIN-04 | Requires live DB query | Check Platform Stats tab, verify counts match DB |
| Non-admin user sees 403 panel | ADMIN-05 | Requires session without admin email | Log in as non-admin, navigate to /admin |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

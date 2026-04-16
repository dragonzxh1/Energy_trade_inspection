---
phase: 9
slug: data-enrichment-foundations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | 无（项目当前无自动化测试框架）|
| **Config file** | none |
| **Quick run command** | `npm run type-check && npm run lint` |
| **Full suite command** | `npm run build` |
| **Estimated runtime** | ~30 seconds (type-check + lint) / ~60 seconds (build) |

---

## Sampling Rate

- **After every task commit:** Run `npm run type-check && npm run lint`
- **After every plan wave:** Run `npm run build`
- **Before `/gsd-verify-work`:** Full build must be green + manual checks below
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 9-01-01 | 01 | 1 | NETDATA-01 | T-9-01 | Migration adds is_sanctioned + sanctions_match columns | manual | `psql $DATABASE_URL -c "\d icij_entities"` | ❌ manual | ⬜ pending |
| 9-01-02 | 01 | 1 | NETDATA-01 | T-9-01 | ICIJ sync script runs sanctions UPDATE after upsert | automated | `npm run type-check` | ✅ | ⬜ pending |
| 9-01-03 | 01 | 1 | NETDATA-01 | — | IcijMatch type includes isSanctioned + sanctionsMatch | automated | `npm run type-check` | ✅ | ⬜ pending |
| 9-02-01 | 02 | 1 | NETDATA-02 | — | getIcijMatches() returns isSanctioned field | automated | `npm run type-check` | ✅ | ⬜ pending |
| 9-02-02 | 02 | 1 | NETDATA-02 | — | OffshoreLeaksPanel renders sanctioned badge when is_sanctioned=true | visual | `npm run dev` → inspect company detail page | ❌ manual | ⬜ pending |
| 9-03-01 | 03 | 2 | NETDATA-03 | T-9-02 | getCompanyFraudAlerts uses parameterized query + LIMIT 50 | automated | `npm run type-check` | ✅ | ⬜ pending |
| 9-03-02 | 03 | 2 | NETDATA-03 | — | FraudAlertsPanel tab appears on company detail page | visual | `npm run dev` → visit company detail page | ❌ manual | ⬜ pending |
| 9-04-01 | 04 | 2 | NETDATA-04 | T-9-02 | getVesselFraudAlerts uses parameterized query + LIMIT 50 | automated | `npm run type-check` | ✅ | ⬜ pending |
| 9-04-02 | 04 | 2 | NETDATA-04 | — | FraudAlertsPanel tab appears on vessel detail page | visual | `npm run dev` → visit vessel detail page | ❌ manual | ⬜ pending |
| 9-all-01 | all | all | all | — | TypeScript compilation passes with new fields | automated | `npm run type-check` | ✅ | ⬜ pending |
| 9-all-02 | all | all | all | — | No lint errors in new/modified files | automated | `npm run lint` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — no new test files needed.

The project has no test framework (documented tech debt). Validation uses:
- `npm run type-check` — TypeScript type correctness for new interfaces
- `npm run lint` — ESLint compliance
- `npm run build` — Full compilation gate
- Manual DB inspection for migration and matching correctness

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Migration 036 adds columns to icij_entities | NETDATA-01 | No DB test infrastructure | `psql $DATABASE_URL -c "\d icij_entities"` — verify `is_sanctioned boolean` and `sanctions_match text` columns exist |
| ICIJ→sanctions UPDATE marks known entity | NETDATA-01 | Requires test data in DB | `psql $DATABASE_URL -c "SELECT name, is_sanctioned, sanctions_match FROM icij_entities WHERE is_sanctioned=TRUE LIMIT 5"` after running sync script |
| Sanctioned badge renders in OffshoreLeaksPanel | NETDATA-02 | Visual UI check | `npm run dev` → visit company with ICIJ matches that are sanctioned → verify red "Sanctioned Entity" badge appears inline |
| FraudAlertsPanel visible on company detail page | NETDATA-03 | Visual UI check | `npm run dev` → visit any company detail page → verify "Fraud Alerts" tab exists, shows alerts or empty state copy |
| FraudAlertsPanel visible on vessel detail page | NETDATA-04 | Visual UI check | `npm run dev` → visit any vessel detail page → verify "Fraud Alerts" tab exists, shows alerts or empty state copy |
| F3 content lock gates FraudAlertsPanel | NETDATA-03/04 | Visual + auth check | Visit as free-plan user → verify panel content is blurred/locked; visit as paid user → verify content is visible |

---

## Threat Map

| Threat | ASVS | Mitigation in Code | Verification |
|--------|------|--------------------|--------------|
| T-9-01: SQL injection via entity name in fraud lookup | V5.3 | Parameterized queries `$1` in getCompanyFraudAlerts + getVesselFraudAlerts | `npm run type-check` — grep for `$1` placeholders in new functions |
| T-9-02: Unbounded query DoS (fraud_alerts no LIMIT) | V4.2 | `LIMIT 50` in both fraud alert queries | Verify LIMIT clause exists in repository functions |
| T-9-03: F3 content bypass (direct repo call) | V4.1 | Caller (page.tsx) checks f3Unlocked before calling fraud alert functions | Code review: verify conditional in page.tsx |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or manual verification documented above
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (type-check covers all)
- [ ] Wave 0 covers all MISSING references (N/A — no test framework)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

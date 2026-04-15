---
phase: 4
slug: scoring-engine-completion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — explicit technical debt per REQUIREMENTS.md "Out of Scope" |
| **Config file** | Not present |
| **Quick run command** | `npm run type-check` |
| **Full suite command** | `npm run build` |
| **Estimated runtime** | ~30 seconds (type-check) / ~60 seconds (build) |

---

## Sampling Rate

- **After every task commit:** Run `npm run type-check`
- **After every plan wave:** Run `npm run build`
- **Before `/gsd-verify-work`:** Full build must be green + manual browser spot-check
- **Max feedback latency:** ~60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | SCORE-01 | — | volume tier math is additive, not stacking | unit-manual | `npm run type-check` | ✅ | ⬜ pending |
| 4-01-02 | 01 | 1 | SCORE-01 | — | `phase2Pending` removed from all 9+ sites | manual | `npm run type-check` | ✅ | ⬜ pending |
| 4-02-01 | 02 | 1 | SCORE-02 | T-4-01 | shell deductions floor at 0, never negative | manual | `npm run type-check` | ✅ | ⬜ pending |
| 4-02-02 | 02 | 1 | SCORE-02 | — | domain age from `domain_whois_cache.registered_at`, not `age_days` | manual | `npm run type-check` | ✅ | ⬜ pending |
| 4-03-01 | 03 | 2 | SCORE-03 | T-4-02 | free user DOM contains no dimension data (not CSS-hidden) | manual | `npm run build` | ✅ | ⬜ pending |
| 4-03-02 | 03 | 2 | SCORE-03 | — | all 3 ScoreGauge call sites updated with `showBreakdown` prop | manual | `npm run type-check` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

None — existing TypeScript infrastructure covers all compilation checks. No test files to create.

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Entity with trade events shows non-zero tradingTrackRecord score | SCORE-01 | No automated test suite; requires live DB data | Navigate to a company page with known trade events; confirm score > 0 and ≤ 22 |
| Shell company entity scores measurably lower | SCORE-02 | Requires entity with null registration_number in DB | Use seed entity with null reg number, no domain, recent whois; confirm Entity Existence dimension is reduced |
| Free user sees upgrade CTA, no dimension bars | SCORE-03 | Session plan toggle required | Log in as free-plan user; confirm only gauge + CTA visible; confirm paid user sees breakdown |
| Free user DOM contains no dimension data | SCORE-03 | Requires browser DevTools inspection | Inspect DOM as free user; confirm no dimension bars, scores, or evidence strings present in markup |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

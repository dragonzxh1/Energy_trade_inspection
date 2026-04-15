---
phase: 3
slug: domain-email-intelligence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | none — manual + TypeScript build checks |
| **Config file** | none |
| **Quick run command** | `npm run type-check` |
| **Full suite command** | `npm run build && npm run type-check && npm run lint` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run type-check`
- **After every plan wave:** Run `npm run build && npm run type-check && npm run lint`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | DATASRC-05 | — | RDAP queries do not leak credentials | manual | `npm run type-check` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | DATASRC-05 | — | Cache TTL prevents rate-limiting abuse | manual | `npm run type-check` | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 1 | DATASRC-06 | — | DNS errors return unknown, not false negative | manual | `npm run type-check` | ❌ W0 | ⬜ pending |
| 3-02-02 | 02 | 2 | DATASRC-06 | — | DKIM probe handles selector miss gracefully | manual | `npm run type-check` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements (TypeScript strict mode + build check serves as primary automated validation for this phase).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Domain registration age displayed correctly | DATASRC-05 | No test suite; requires live RDAP call | Navigate to a company entity, check Domain tab shows age in days |
| Privacy shield detection | DATASRC-05 | Requires real registrar data | Check entity with Cloudflare/WhoisGuard domain shows privacy shield badge |
| MX record detection | DATASRC-06 | Requires live DNS resolution | Check company with known email domain shows MX present |
| SPF/DMARC risk flag visible | DATASRC-06 | Requires live DNS query | Check entity page shows risk flag for domain with missing SPF/DMARC |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

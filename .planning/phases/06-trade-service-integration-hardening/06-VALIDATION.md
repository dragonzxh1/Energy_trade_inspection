---
phase: 6
slug: trade-service-integration-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-14
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | TypeScript compiler (`tsc --noEmit`) — sole automated gate per REQUIREMENTS.md "Out of Scope: Automated test suite" |
| **Config file** | `tsconfig.json` (strict mode enabled, already present) |
| **Quick run command** | `npm run type-check` |
| **Full suite command** | `npm run type-check` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run type-check`
- **After every plan wave:** Run `npm run type-check`
- **Before `/gsd-verify-work`:** `npm run type-check` must exit 0
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | ARCH-02 | — | `status` field propagated from `checkSanctions()` (never silently swallowed) | type | `npm run type-check` | ✅ | ⬜ pending |
| 6-01-02 | 01 | 1 | ARCH-02 | — | `TradeCheckResult.sanctionDegraded?: boolean` field exists in type | type | `npm run type-check` | ✅ | ⬜ pending |
| 6-01-03 | 01 | 1 | ARCH-02 | — | Amber warning box renders in `TradeClient.tsx` when `result.sanctionDegraded === true` | manual | `npm run type-check` (structural) | ✅ | ⬜ pending |
| 6-02-01 | 02 | 2 | DECISION-03 | V5 | `sellerDomain` extracted via `extractDomain()` — rejects non-domain strings (SSRF prevention) | type + manual | `npm run type-check` | ✅ | ⬜ pending |
| 6-02-02 | 02 | 2 | DECISION-03 | — | `checkDomain()` result mapped to exact `TradeRuleInput.sellerDomainCheck` shape | type | `npm run type-check` | ✅ | ⬜ pending |
| 6-02-03 | 02 | 2 | DECISION-03 | — | `sellerDomain` forwarded from `route.ts` body → `runTradeCheck()` | type + manual | `npm run type-check` | ✅ | ⬜ pending |
| 6-02-04 | 02 | 2 | DECISION-03 | — | Seller domain optional form field renders in `TradeClient.tsx` trade form | manual | `npm run type-check` (structural) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

`npm run type-check` is already installed and functional (exit 0 confirmed before any Phase 6 changes). No test stubs, fixtures, or framework installation needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `DOMAIN_WHOIS_RISK` flag fires when seller domain < 6 months old | DECISION-03 | No automated test suite per REQUIREMENTS.md | Submit trade check via `/trade` form with a newly-registered domain (< 6 months); verify flag appears in verdict flags list |
| `DOMAIN_SPOOFING_RISK` flag fires when domain resembles a legitimate domain | DECISION-03 | No automated test suite | Submit trade check with a homoglyph/lookalike domain; verify flag appears |
| Amber warning box visible when `sanctionDegraded === true` | ARCH-02 | UI rendering requires browser | Set `sanctionDegraded: true` in mock result OR trip circuit breaker; verify amber box renders below `ResultBanner` |
| `sanctionDegraded: true` returned when OpenSanctions unavailable | ARCH-02 | Requires circuit breaker to be open | Disable OpenSanctions API key or block endpoint; run trade check; verify `result.sanctionDegraded === true` in response JSON |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

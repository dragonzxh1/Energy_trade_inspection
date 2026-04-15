# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

---

## Milestone: v1.0 — MVP

**Shipped:** 2026-04-15
**Phases:** 8 | **Plans:** 21 | **Execution:** Single-day sprint

### What Was Built

- Centralized `middleware.ts` auth guard + OpenSanctions circuit breaker with graceful degradation (`status: degraded`)
- 7 regulatory warning lists (FCA, FINMA, SFC, MAS, DFSA, SCA, CMA Oman) synced + WarningBadge component on all entity pages
- Domain/email fraud signal pipeline (RDAP WHOIS + MX/SPF/DKIM/DMARC) with DomainIntelPanel and DomainRiskBadge
- Completed 100-pt Authenticity Score: Trading Track Record live (up to 22 pts), shell company signal deductions, paid per-dimension breakdown
- Safe / Review / Block structured verdict engine with typed reason codes, 1-hop director sanction check, PDF audit trail
- Domain intelligence flags (DOMAIN_WHOIS_RISK, DOMAIN_SPOOFING_RISK) wired into trade checks via /api/trade
- SanctionBadge tooltip showing specific list sources; warninglists admin sync isolation
- Admin operations dashboard: sync job history, user list with plan editor, platform stats, daily registration chart

### What Worked

- **Dependency-ordered phase execution** — hardening architecture first (Phase 1) meant subsequent phases could trust auth/circuit breaker without rework
- **Gap closure phases** (6 and 7) effectively bridged the decision engine to real trade and entity flows without bloating earlier phases
- **Server Component pattern for admin dashboard** — co-locating data fetching and admin auth check in the page Server Component kept logic simple and avoided client-side auth leaks
- **Shared helper pattern** (`admin-auth.ts: isAdminAuthorized`) — single auth check reusable across all admin API routes, established clean pattern
- **Repository layer enrichment** for SanctionBadge sources — querying sanctionSources in getEntityByKey() kept page components clean

### What Was Inefficient

- **REQUIREMENTS.md checkboxes not updated during execution** — traceability table was maintained but individual requirement checkboxes fell out of sync as phases completed; needed manual cleanup at milestone close
- **ROADMAP.md progress table not updated during execution** — phases 6–8 showed "0/N Not started" even after SUMMARY.md files existed; caused confusion at milestone close
- **gsd-tools summary-extract returned empty** — one-liner extraction from SUMMARY.md didn't work because the SUMMARY files use YAML frontmatter + markdown sections rather than the expected field format; milestones entry required manual writing

### Patterns Established

- `isAdminAuthorized(session)` shared helper in `src/lib/server/admin-auth.ts` — all admin routes call this before executing
- Repository enrichment pattern: `checkSanctions()` returns `{ listed, sources }` — sources flow through to UI without extra queries
- CSS bar charts for admin stats (no external charting library) — consistent with project's custom CSS philosophy
- `warninglists` as isolated sync source key — allows targeted resync without triggering all data sources

### Key Lessons

1. **Update progress tables in ROADMAP.md as plans complete** — stale progress tables at milestone close require manual reconciliation; enforce this in future phases
2. **Check REQUIREMENTS.md checkboxes at phase completion, not milestone close** — 16 unchecked requirements at close all needed batch-marking; this should happen inline during execution
3. **SUMMARY.md one-liner field** — gsd-tools expects a specific `one_liner:` YAML field; current SUMMARY files use prose sections; align format if auto-extraction is needed in future
4. **Gap closure phases are effective** — dedicating explicit phases (6, 7) to wire already-built features together caught real integration gaps that would have been invisible without them

### Cost Observations

- Model: Claude Sonnet 4.6 (balanced profile)
- Sessions: ~1 intensive session
- Notable: 8 phases in single day is aggressive; context exhaustion at ~90% required session restart before milestone close

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 8 | 21 | Initial milestone — established all core patterns |

### Cumulative Quality

| Milestone | Tests | Coverage | Tech Debt Added |
|-----------|-------|----------|-----------------|
| v1.0 | 0 | 0% | No automated tests (Vitest deferred to v1.1) |

### Top Lessons (Verified Across Milestones)

1. Gap closure phases prevent integration debt from accumulating silently
2. Keep requirement tracking (checkboxes) in sync during execution, not retrospectively

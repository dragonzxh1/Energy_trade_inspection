# Energy Trade Inspection (ETI)

## What This Is

ETI is a B2B compliance and risk screening platform built for energy traders. It screens companies, vessels, and terminals against global sanctions lists (OFAC, EU FSF, UN), AIS vessel tracking data, corporate registries, and trade document intelligence to produce an **Authenticity Score** (0–100) and a trade-level risk verdict. The primary users are compliance officers and traders at mid-size energy trading firms who need fast, defensible answers before committing to a counterparty.

## Core Value

**Give energy traders instant, defensible answers on whether a counterparty is safe to trade with** — replacing manual spreadsheet lookups and slow compliance reviews with a sub-second verdict backed by verifiable data trails.

## Requirements

### Validated

<!-- Existing capabilities confirmed in codebase — shipped and working. -->

- ✓ Entity search (companies, vessels, terminals) with full-text + CJK/pinyin support — existing
- ✓ Sanctions screening: OFAC SDN, EU FSF, UN — fuzzy match, auto-synced — existing
- ✓ AIS vessel tracking: real-time position, dark period detection, port calls — existing
- ✓ Authenticity Score engine (0–100) with 5 dimensions — existing
- ✓ Document screening: PDF/DOCX/XLSX upload → entity extraction → risk report — existing
- ✓ Trade risk check: seller + vessel + port → risk flags + verdict — existing
- ✓ Company registry sync: UK Companies House, Singapore ACRA, Swiss Zefix, OpenCorporates — existing
- ✓ Stripe subscription tiers (free / starter / enterprise) — existing
- ✓ Google OAuth authentication + database-backed sessions — existing
- ✓ PDF report generation per entity — existing
- ✓ Watchlist + trade monitoring CRUD — existing
- ✓ Linear design system (dark mode, indigo accent, Inter font) — existing
- ✓ Content tier gating (F1/F2 free, F3 paid, CSS blur) — existing
- ✓ Rate limiting, CSP headers, file magic byte validation — existing

### Active

<!-- Current milestone scope — building toward these. -->

- [ ] **Regulatory warning lists**: FCA, FINMA, SFC, SC Malaysia — sync + badge display
- [ ] **Domain/email infrastructure checks**: RDAP WHOIS, MX records, SPF/DKIM/DMARC validation
- [ ] **Risk label precision**: distinguish `sanctioned` vs `warning_listed` vs `export_restricted` in UI and scoring
- [ ] **Trade verdict upgrade**: explicit Safe / Review / Block output with structured reasoning per flag
- [x] **Trading Track Record dimension**: volume-tier scoring live (up to 22/25 pts) — Validated in Phase 4: scoring-engine-completion
- [x] **Behavioral pattern scoring**: shell company signal deductions (domain age −10, no reg −8, no web −5) — Validated in Phase 4: scoring-engine-completion
- [ ] **Middleware auth guard**: centralized `middleware.ts` to replace per-route `auth()` checks
- [x] **Score transparency**: 5-dimension breakdown gated behind paid plan (conditional DOM render) — Validated in Phase 4: scoring-engine-completion
- [ ] **OpenSanctions fallback**: circuit breaker + graceful degradation when API unavailable

### Out of Scope

- Full KYC/AML platform (onboarding workflows, ongoing monitoring SLAs) — different product category
- Real-time adverse media / news monitoring — future milestone, requires content pipeline
- Direct replacement for Refinitiv World-Check — data moat too large; compete on freshness + UX + energy focus
- Vessel physical inspection scheduling — logistics integration out of scope
- Direct SWIFT/payment network checks — requires financial institution partnerships

## Context

**Current state:** ETI is approximately 55–60% complete as a competitive product. The core data pipeline (sanctions + AIS + registries + scoring) is built and functional. Key gaps are in the depth of the decision engine (Safe/Review/Block clarity), regulatory warning lists beyond OFAC/EU/UN, and domain/email fraud signals.

**Competitive context:** Primary reference competitor is Etiverify.com. ETI's differentiation is energy sector specialization (vessel tracking + commodity trade documents), CJK name support, and a modern developer-friendly UI. ETI must avoid becoming another generic data aggregator — the product value is in the decision verdict, not the data quantity.

**Research source:** ETI-Chinese-Vault (9 research files, April 2026) — competitor analysis, system design, growth strategy, validation reports.

**Technical context:**
- Next.js 16 App Router + React 19, TypeScript strict mode
- PostgreSQL 16 via raw `node-postgres` (no ORM) — 30 migrations applied
- No automated tests exist (technical debt — Vitest recommended)
- Windows dev / Linux prod deployment
- `next-auth` v5 beta — API may change before stable

**Known issues to address:**
- `tradingTrackRecord` dimension: now live (up to 22 pts) — placeholder removed in Phase 4
- No centralized auth middleware — security risk on new routes
- Missing migration 025 — schema state inconsistency risk
- `unsafe-eval` in CSP required for Next.js webpack — XSS risk
- OpenSanctions API: no circuit breaker — silent failure risk

## Constraints

- **Tech stack:** Next.js 16 + PostgreSQL (no ORM) + TypeScript strict — must maintain, no framework migration
- **Database:** Raw SQL only — no Prisma/Drizzle ORM allowed (established pattern)
- **No tests:** Adding tests is not in scope unless explicitly planned as a phase
- **Windows dev:** Build commands need `cross-env` and `--max-old-space-size=4096`
- **Auth:** next-auth v5 beta — avoid deep API coupling until stable release
- **External APIs:** OpenSanctions requires commercial license for SaaS; AIS provider terms apply

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Linear design system | Professional tool aesthetic, data-dense dark UI, matches compliance tool expectations | — Pending |
| No ORM (raw SQL) | Full control over query performance, established pattern throughout codebase | ✓ Good |
| Authenticity Score (0–100) as primary signal | Single number is immediately actionable; dimensions add transparency for paid users | — Pending |
| CSS blur for content gating (not hidden) | Preserves SEO while enforcing paywall | — Pending |
| next-auth v5 beta | Only viable DB-backed session solution for Next.js 16; risk accepted | ⚠️ Revisit |
| Energy sector focus (not generic compliance) | Differentiation via vessel tracking, commodity doc parsing, CJK support | — Pending |
| Skip Google Fonts (system fallback) | Network inaccessible in dev environment; Inter via system fonts | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-14 — Phase 5 complete: decision engine upgraded with Safe/Review/Block verdict, per-flag data source attribution, 1-hop director sanction pre-check, VerdictLabel UI, and PDF VerdictBanner*

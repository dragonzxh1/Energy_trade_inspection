# Energy Trade Inspection (ETI)

## What This Is

ETI is a B2B compliance and risk screening platform built for energy traders. It screens companies, vessels, and terminals against global sanctions lists (OFAC, EU FSF, UN), 7 regulatory warning lists (FCA, FINMA, SFC, MAS, DFSA, SCA, CMA Oman), AIS vessel tracking data, corporate registries, and domain/email fraud signals to produce an **Authenticity Score** (0–100) and a structured **Safe / Review / Block trade verdict**. The primary users are compliance officers and traders at mid-size energy trading firms who need fast, defensible answers before committing to a counterparty.

## Core Value

**Give energy traders instant, defensible answers on whether a counterparty is safe to trade with** — replacing manual spreadsheet lookups and slow compliance reviews with a sub-second verdict backed by verifiable data trails.

## Requirements

### Validated

<!-- Shipped and verified across v1.0 milestone -->

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
- ✓ **Centralized middleware.ts auth guard** — all protected routes covered by default — v1.0 (ARCH-01, ARCH-03)
- ✓ **OpenSanctions circuit breaker** — degraded-mode screening with cached data when API unavailable — v1.0 (ARCH-02)
- ✓ **Python binary path cross-platform fix** — Tavily queries succeed on Linux production — v1.0 (ARCH-04)
- ✓ **7 regulatory warning lists synced** — FCA, FINMA, SFC, MAS, DFSA, SCA, CMA Oman + WarningBadge UI — v1.0 (DATASRC-01–04)
- ✓ **Domain/email fraud signal pipeline** — RDAP WHOIS + MX/SPF/DKIM/DMARC + DomainIntelPanel — v1.0 (DATASRC-05–06)
- ✓ **Trading Track Record dimension live** — volume-tier scoring up to 22/25 pts — v1.0 (SCORE-01)
- ✓ **Shell company behavioral signal scoring** — domain age −10, no reg −8, no web −5 deductions — v1.0 (SCORE-02)
- ✓ **Score transparency for paid users** — 5-dimension breakdown with contributing factors — v1.0 (SCORE-03)
- ✓ **Safe / Review / Block verdict engine** — structured verdict + typed reason codes per flag — v1.0 (DECISION-02)
- ✓ **1-hop director/shareholder sanction check** — related_party_risk flag with name + list source — v1.0 (DECISION-05)
- ✓ **PDF audit trail** — verdict + reason codes + data sources + related-party flags + UTC timestamp — v1.0 (DECISION-04)
- ✓ **Human-readable flag explanations** — each reason code maps to explanation + triggering data source — v1.0 (DECISION-03)
- ✓ **SanctionBadge tooltip with source lists** — hovering shows specific list names (OFAC SDN, EU FSF…) — v1.0 (DECISION-01)
- ✓ **Domain intelligence in trade checks** — DOMAIN_WHOIS_RISK + DOMAIN_SPOOFING_RISK flags from /api/trade — v1.0
- ✓ **Admin operations dashboard** — sync job history, user management, plan editor, platform stats — v1.0 (ADMIN-01–04)
- ✓ **warninglists admin sync isolation** — `{ "source": "warninglists" }` runs only syncRegulatoryWarnings() — v1.0

### Active

<!-- Next milestone scope -->

- [ ] **Export controls integration**: BIS Entity List / Denied Persons List — new data source tier
- [ ] **Adverse media monitoring**: news/press signal per entity (requires content pipeline)
- [ ] **Corporate UBO graph**: beneficial ownership tracing across jurisdictions
- [ ] **API access tier**: developer API key for programmatic integration
- [ ] **Webhook notifications**: alert when watched entity status changes

### Out of Scope

- Full KYC/AML platform (onboarding workflows, ongoing monitoring SLAs) — different product category
- Real-time adverse media / news monitoring — future milestone, requires content pipeline
- Direct replacement for Refinitiv World-Check — data moat too large; compete on freshness + UX + energy focus
- Vessel physical inspection scheduling — logistics integration out of scope
- Direct SWIFT/payment network checks — requires financial institution partnerships
- Automated test suite — explicit technical debt; Vitest recommended for v1.1
- ORM (Prisma/Drizzle) — established raw SQL pattern; migration risk > benefit
- Mobile app — web-first product; compliance tools are desktop-native

## Context

**Current state (v1.0 shipped 2026-04-15):** ETI is approximately 85% complete as a competitive product. v1.0 delivered the full decision engine upgrade: structured verdicts, 7 regulatory warning lists, domain/email fraud signals, a completed 100-pt scoring engine, PDF audit trail, and an admin operations dashboard. The core platform is now production-grade.

**Known technical debt:**
- No automated tests (Vitest recommended for v1.1)
- Missing migration 025 — schema state inconsistency risk (pre-existing, non-blocking)
- `unsafe-eval` in CSP required for Next.js webpack — XSS risk, low priority
- `next-auth` v5 beta — API may change before stable release
- Python intelligence wrapper (Tavily) path fix applied; Tavily queries now succeed on Linux

**Competitive context:** Primary reference competitor is Etiverify.com. ETI's differentiation is energy sector specialization (vessel tracking + commodity trade documents), CJK name support, and a modern developer-friendly UI. v1.0 closes the gap on compliance depth with 7 warning lists and a structured verdict engine.

**Technical context:**
- Next.js 15 App Router + React 19, TypeScript strict mode, 26,430 LOC
- PostgreSQL 16 via raw `node-postgres` (no ORM) — 33 migrations applied
- Windows dev / Linux prod deployment (PM2 + Nginx)
- `next-auth` v5 beta — API may change before stable

## Constraints

- **Tech stack:** Next.js 15 + PostgreSQL (no ORM) + TypeScript strict — must maintain, no framework migration
- **Database:** Raw SQL only — no Prisma/Drizzle ORM allowed (established pattern)
- **No tests:** Adding tests is not in scope unless explicitly planned as a phase
- **Windows dev:** Build commands need `cross-env` and `--max-old-space-size=4096`
- **Auth:** next-auth v5 beta — avoid deep API coupling until stable release
- **External APIs:** OpenSanctions requires commercial license for SaaS; AIS provider terms apply

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Linear design system | Professional tool aesthetic, data-dense dark UI, matches compliance tool expectations | ✓ Good |
| No ORM (raw SQL) | Full control over query performance, established pattern throughout codebase | ✓ Good |
| Authenticity Score (0–100) as primary signal | Single number is immediately actionable; dimensions add transparency for paid users | ✓ Good |
| CSS blur for content gating (not hidden) | Preserves SEO while enforcing paywall | ✓ Good |
| next-auth v5 beta | Only viable DB-backed session solution for Next.js 15; risk accepted | ⚠️ Revisit when stable |
| Energy sector focus (not generic compliance) | Differentiation via vessel tracking, commodity doc parsing, CJK support | ✓ Good |
| Skip Google Fonts (system fallback) | Network inaccessible in dev environment; Inter via system fonts | ✓ Good |
| WarningBadge uses native title= tooltip | No JS library dependency; consistent with existing Badge primitive | ✓ Good |
| ESERVFAIL/ETIMEOUT treated as unknown (not absent) in DNS | Error stored in cache error field; avoids misreporting definitive absence | ✓ Good |
| Domain/email data stored in domain_email_cache table | Avoids new column on entities; cache pattern consistent with intelligence_cache | ✓ Good |
| SanctionBadge sources prop wired from repository.getEntityByKey() | Avoids extra query; checkSanctions() enrichment block added in repository | ✓ Good |
| warninglists source isolated before legacy fallback in admin sync | Allows admin to resync warning lists without triggering all sources | ✓ Good |
| Admin dashboard as Server Component with isAdminAuthorized() | Consistent with existing admin auth pattern; no client-side auth logic | ✓ Good |
| Stripe API version pinned in stripe.ts | Prevents unintended breaking changes on Stripe API upgrades | ✓ Good |

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
*Last updated: 2026-04-15 after v1.0 milestone — decision engine, warning lists, domain intelligence, admin dashboard all shipped*

# Roadmap: Energy Trade Inspection — Trade Fraud Decision Engine

## Overview

This milestone upgrades ETI from a functioning data aggregator (~55% complete) to a trade fraud decision engine (~85% complete). The work proceeds in dependency order: harden the architecture first so new routes are safe by default, then add regulatory warning lists and domain intelligence as data inputs, then complete the scoring engine so all 100 points are live, then upgrade the verdict engine to produce structured Safe/Review/Block decisions backed by auditable reason codes.

## Milestone

**Goal:** Deliver a trade fraud decision engine that gives compliance officers a structured, auditable verdict — not just a risk score.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [ ] **Phase 1: Architecture Hardening** - Centralize auth, add circuit breaker, secure admin endpoint, fix Python path cross-platform bug
- [x] **Phase 2: Regulatory Warning Lists** - Sync MAS/DFSA/SCA/CMA Oman/FCA/FINMA/SFC and display warning badges (completed 2026-04-13)
- [x] **Phase 3: Domain & Email Intelligence** - WHOIS/RDAP + MX/SPF/DKIM/DMARC fraud signal pipeline (completed 2026-04-14)
- [ ] **Phase 4: Scoring Engine Completion** - Trading Track Record + behavioral shell company signals + score transparency
- [ ] **Phase 5: Decision Engine Upgrade** - Structured Safe/Review/Block verdict + risk label precision + 1-hop director/shareholder sanction check + PDF audit export
- [ ] **Phase 6: Trade Service Integration Hardening** (GAP CLOSURE) - Wire domain intelligence into trade checks; surface circuit breaker degradation in TradeCheckResult
- [ ] **Phase 7: Entity Sanction Wiring & Admin Sync Fix** (GAP CLOSURE) - Pass sanctionSources to SanctionBadge on entity pages; fix warninglists isolation in admin sync API
- [ ] **Phase 8: Admin Operations Dashboard** - Cron job execution history, user management (view/edit plan), user stats and acquisition sources

## Phase Details

### Phase 1: Architecture Hardening
**Goal**: All protected routes are covered by centralized auth, the OpenSanctions API degrades gracefully, the admin sync endpoint is explicitly locked down, and the Python intelligence wrapper works on both Windows and Linux
**Depends on**: Nothing (first phase)
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-04
**Success Criteria** (what must be TRUE):
  1. Any new API route added without explicit auth check is still protected by default via `middleware.ts`
  2. When OpenSanctions API is unavailable, screening completes with `status: degraded` and a cached result — it does not return a 500 or fail silently
  3. A non-admin user calling `/api/admin/sync` receives a 403 — the endpoint verifies admin role before executing
  4. All previously per-route `auth()` calls are removed and the behavior is equivalent (no regression in protection)
  5. Intelligence queries (Tavily) succeed on Linux production — Python path resolves correctly on both Windows and Linux
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Centralize auth in middleware.ts + fix admin 401/403 (ARCH-01, ARCH-03)
- [x] 01-02-PLAN.md — OpenSanctions circuit breaker + screening degraded status (ARCH-02)
- [x] 01-03-PLAN.md — Python binary existsSync() startup check (ARCH-04)

### Phase 2: Regulatory Warning Lists
**Goal**: ETI screens entities against seven regulatory warning lists covering UK, Switzerland, Hong Kong, Singapore, UAE (Dubai DIFC), UAE (federal), and Oman — surfaces distinct warning badges on entity pages
**Depends on**: Phase 1
**Requirements**: DATASRC-01, DATASRC-02, DATASRC-03, DATASRC-04
**Success Criteria** (what must be TRUE):
  1. An entity flagged on the FCA (UK) warning list shows a distinct badge naming "FCA" as the source regulator
  2. An entity flagged on MAS (Singapore), DFSA (Dubai), SCA (UAE), or CMA Oman shows the appropriate regulator badge — each source is independently visible with its jurisdiction
  3. An entity flagged on FINMA (Switzerland) or SFC (Hong Kong) shows the appropriate badge
  4. Warning list data syncs automatically on the same schedule as existing sanctions sources
  5. Entities not on any warning list show no badge — no false positives from the new sync
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — DB migration + 7-source sync module + query function (DATASRC-01, DATASRC-02, DATASRC-03, DATASRC-04)
- [x] 02-02-PLAN.md — WarningBadge component + entity page integration (DATASRC-01, DATASRC-02, DATASRC-03, DATASRC-04)

### Phase 3: Domain & Email Intelligence
**Goal**: ETI checks counterparty domain and email infrastructure for fraud signals — newly registered domains, hidden registrants, and broken mail hygiene are surfaced as risk inputs
**Depends on**: Phase 2
**Requirements**: DATASRC-05, DATASRC-06
**Success Criteria** (what must be TRUE):
  1. For a company entity with a known domain, the intelligence view shows domain registration age, registrar name, and whether a privacy shield is active
  2. For a company entity with a known email domain, the intelligence view shows whether MX records are present, and whether SPF, DKIM, and DMARC records are configured
  3. A domain registered less than 6 months ago is flagged as a risk signal — the flag is visible on the entity page
  4. A domain with no SPF or DMARC record is flagged as a risk signal — distinguishable from a domain with full mail hygiene
**Plans**: 2 plans

Plans:
- [x] 03-01-PLAN.md — DB migration (domain_email_cache) + checkEmailDomain() + domain intelligence API route + seed domain data (DATASRC-05, DATASRC-06)
- [x] 03-02-PLAN.md — DomainRiskBadge + DomainIntelPanel + company page Domain tab integration (DATASRC-05, DATASRC-06)

### Phase 4: Scoring Engine Completion
**Goal**: The Authenticity Score uses all 100 points — Trading Track Record is calculated from real data, behavioral shell company signals reduce scores, and paid users can see the per-dimension breakdown
**Depends on**: Phase 3
**Requirements**: SCORE-01, SCORE-02, SCORE-03
**Success Criteria** (what must be TRUE):
  1. An entity with documentable trade history has a non-zero Trading Track Record score (max 25 pts) — the total possible score is now 100, not 75
  2. An entity showing shell company signals (anonymous registration, zero employees, no web presence, registered < 6 months) scores measurably lower than an equivalent transparent entity
  3. A paid user viewing an entity page sees the score broken down by all five dimensions with contributing factors listed under each
  4. A free user sees the total score but not the per-dimension breakdown — the paywall boundary is enforced
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — Extend computeTradingTrackRecord() with volume tier + full phase2Pending cleanup (SCORE-01)
- [x] 04-02-PLAN.md — Shell company signal deductions in scoreCompany() + domain data pre-fetch (SCORE-02)
- [x] 04-03-PLAN.md — ScoreGauge showBreakdown paywall + call site wiring + human checkpoint (SCORE-03)

### Phase 5: Decision Engine Upgrade
**Goal**: Every trade risk check returns a structured Safe/Review/Block verdict with typed reason codes, human-readable explanations, a 1-hop director/shareholder sanction check, and a one-click PDF audit export
**Depends on**: Phase 4
**Requirements**: DECISION-01, DECISION-02, DECISION-03, DECISION-04, DECISION-05
**Success Criteria** (what must be TRUE):
  1. A risk badge on any entity page distinguishes between `sanctioned` (OFAC/EU/UN), `warning_listed` (FCA/MAS/DFSA/SCA/CMA/FINMA/SFC), and `export_restricted` (BIS/ECFR) — each has a distinct badge color and tooltip naming the list
  2. A trade risk check returns an explicit Safe, Review, or Block verdict — not just a list of flags — with each flag carrying a typed reason code
  3. Each reason code displayed in a trade verdict links to a human-readable explanation and names the specific data source that triggered it
  4. If any direct director or shareholder of the counterparty company is sanctioned or warning-listed, a `related_party_risk` flag is raised in the verdict with the name and list source
  5. A compliance officer can click "Export PDF" on any trade verdict and receive a document showing: verdict, all reason codes, data sources, related-party flags, and a UTC timestamp — suitable as an audit trail
**Plans**: 4 plans

Plans:
- [x] 05-01-PLAN.md — TradeVerdict type + TradeFlag extension (dataSource/dataSourceSyncedAt) + RELATED_PARTY_RISK FlagCode + deriveVerdict() + FLAG_EXPLANATIONS (DECISION-02, DECISION-03)
- [x] 05-02-PLAN.md — checkRelatedPartyRisk() director pre-check + verdict wiring in trade-service.ts (DECISION-02, DECISION-05)
- [x] 05-03-PLAN.md — SanctionBadge tooltip upgrade + TradeClient VerdictLabel + FlagCard explanation section + FLAG_LABEL + button text (DECISION-01, DECISION-02, DECISION-03)
- [x] 05-04-PLAN.md — PDF VerdictBanner + extended FLAG_LABEL + flag data source rows + RelatedPartySection (DECISION-04)

### Phase 6: Trade Service Integration Hardening
**Goal**: Domain intelligence flags (DOMAIN_WHOIS_RISK, DOMAIN_SPOOFING_RISK) fire on direct /api/trade checks; circuit breaker degradation is visible in TradeCheckResult so compliance officers know when sanction data was unavailable
**Depends on**: Phase 5
**Gap Closure**: GAP-1 (sellerDomainCheck missing in trade-service.ts), GAP-2 (circuit breaker degradation not surfaced in trade path)
**Requirements**: ARCH-02, DECISION-03
**Success Criteria** (what must be TRUE):
  1. Submitting a trade check for a seller with a newly-registered domain (< 6 months) triggers a DOMAIN_WHOIS_RISK flag in the verdict
  2. Submitting a trade check for a seller domain with no SPF/DMARC triggers a DOMAIN_SPOOFING_RISK flag in the verdict
  3. When OpenSanctions API is unavailable, TradeCheckResult includes a `sanctionDegraded: true` field — the trade UI shows a warning to the compliance officer
  4. `npm run type-check` exits 0 after all changes
**Plans**: 2 plans

Plans:
- [x] 06-01-PLAN.md — sanctionDegraded field in TradeCheckResult + status propagation from checkSanctions() + amber warning box in TradeClient.tsx (ARCH-02)
- [x] 06-02-PLAN.md — sellerDomain field in TradeCheckInput + checkDomain() wiring in runTradeCheck() + route.ts forwarding + optional form field in TradeClient.tsx (DECISION-03)

### Phase 7: Entity Sanction Wiring & Admin Sync Fix
**Goal**: SanctionBadge tooltip shows source names on entity detail pages; admin can trigger warning list sync in isolation without running all data sources
**Depends on**: Phase 5
**Gap Closure**: DECISION-01 partial (sources prop dead code at entity pages), GAP-3 (warninglists not targetable in isolation)
**Requirements**: DECISION-01
**Success Criteria** (what must be TRUE):
  1. Hovering over a red SanctionBadge on a company, vessel, or terminal page shows a tooltip listing the specific sanctions lists (e.g., "OFAC SDN", "EU FSF")
  2. Posting `{ "source": "warninglists" }` to `/api/admin/sync` runs only `syncRegulatoryWarnings()` — not all data sources
  3. `npm run type-check` exits 0 after all changes
**Plans**: 2 plans

Plans:
- [ ] 07-01-PLAN.md — SanctionBadge sources prop wiring on entity pages + Stripe API version fix (DECISION-01)
- [ ] 07-02-PLAN.md — Admin sync warninglists isolation before legacy fallback (DECISION-01)

### Phase 8: Admin Operations Dashboard
**Goal**: Administrators have a dedicated dashboard to monitor data sync health, manage user accounts, and view platform usage statistics
**Depends on**: Phase 7
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04
**Success Criteria** (what must be TRUE):
  1. Admin can see a log of all sync job runs (source, status, record count, timestamp, error if any) — updated after each sync
  2. Admin can see a list of all users with their email, plan, registration date, last active date, and usage quota consumed
  3. Admin can change any user's plan (free / starter / enterprise) from the dashboard — change takes effect immediately without Stripe intervention
  4. Admin dashboard shows total user count, plan distribution (pie/bar), and daily new registrations for the past 30 days
  5. All admin dashboard pages are protected by admin-role middleware check (non-admins receive 403)
**Plans**: 3 plans

Plans:
- [x] 08-01-PLAN.md — DB migration 033 + admin-auth.ts shared helper + repository admin query functions + quota.ts last_active_at update (ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04)
- [x] 08-02-PLAN.md — GET /api/admin/users + PATCH /api/admin/users/[id]/plan + GET /api/admin/stats routes (ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04)
- [x] 08-03-PLAN.md — /admin page + SyncJobTable + UserTable + PlanSelector + StatCards + DailyRegistrationChart (ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Architecture Hardening | 3/3 | Complete | 2026-04-13 |
| 2. Regulatory Warning Lists | 2/2 | Complete | 2026-04-13 |
| 3. Domain & Email Intelligence | 2/2 | Complete | 2026-04-14 |
| 4. Scoring Engine Completion | 3/3 | Complete | 2026-04-14 |
| 5. Decision Engine Upgrade | 4/4 | Complete | 2026-04-14 |
| 6. Trade Service Integration Hardening | 0/2 | Not started | - |
| 7. Entity Sanction Wiring & Admin Sync Fix | 0/2 | Not started | - |
| 8. Admin Operations Dashboard | 0/3 | Not started | - |

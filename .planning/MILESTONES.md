# Milestones

## v1.0 MVP (Shipped: 2026-04-15)

**Phases completed:** 8 phases, 21 plans  
**Code:** 26,430 lines TypeScript  
**Git range:** feat: initial project commit → docs(phase-08): complete phase

**Key accomplishments:**

1. Centralized `middleware.ts` auth guard covering all protected routes + OpenSanctions circuit breaker with graceful degradation
2. 7 regulatory warning lists synced (FCA, FINMA, SFC, MAS, DFSA, SCA, CMA Oman) with per-source WarningBadge UI on entity pages
3. Domain/email fraud signal pipeline (RDAP WHOIS + MX/SPF/DKIM/DMARC) with DomainIntelPanel component
4. Completed 100-pt Authenticity Score — Trading Track Record live, shell company signal deductions, paid per-dimension breakdown
5. Safe/Review/Block verdict engine with typed reason codes, 1-hop director sanction check, and PDF audit trail export
6. Domain intelligence flags wired into trade checks; circuit breaker degradation surfaced in trade UI
7. SanctionBadge tooltip shows specific list sources; warninglists source independently triggerable in admin sync
8. Admin operations dashboard: sync job history, user management, plan editor, platform stats + daily registration chart

---

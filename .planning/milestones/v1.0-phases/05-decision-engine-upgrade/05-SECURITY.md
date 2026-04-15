---
phase: 05
slug: decision-engine-upgrade
status: verified
threats_open: 0
asvs_level: L1
created: 2026-04-14
---

# Phase 05 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| director names from DB → SQL query parameter | Director name strings from metadata_json.directors are normalized and passed as parameterized query params | Internal DB strings → pg_trgm parameterized query |
| external API sanction data → stored JSONB | Verdict computed server-side before INSERT; no client can influence the verdict value stored | Server-computed TypeScript union value → JSONB |
| stored JSONB result_json → PDF rendering | Old trade_sessions rows without verdict field are read by new PDF template | JSONB → react-pdf React elements |
| sanctions sources list → tooltip display | Source names from intelligence API (DB-sourced strings) rendered in tooltip | DB strings → React text nodes |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-5-01 | Tampering | `checkRelatedPartyRisk()` pg_trgm SQL query (`trade-service.ts:201–219`) | mitigate | `similarity(normalized_name, $1) >= $2` with `[normalized, THRESHOLD]` bound params — no string interpolation. Verified at `trade-service.ts:201,215`. | closed |
| T-5-02 | Tampering | Director name normalization before SQL parameterization (`trade-service.ts:191`) | mitigate | `.replace(/[^a-z0-9\s]/g, '').trim()` strips all SQL metacharacters before `db.query()`. Verified at `trade-service.ts:191`. | closed |
| T-5-03 | Tampering | SanctionBadge tooltip / FlagCard dataSource / PDF data source strings rendering | accept | React text nodes (`<Text>`, JSX `{src}`). No `innerHTML` or `dangerouslySetInnerHTML`. Content is static compile-time strings or sync-job-written DB values. | closed |
| T-5-04 | Elevation of Privilege | Unauthorized PDF access via old session IDs | accept | Pre-existing: `/api/trade/[id]/report` enforces `WHERE id=$1 AND user_id=$2`. No change in this phase. | closed |
| T-5-05 | Tampering | Verdict field stored in JSONB / old session fallback guard | mitigate | `deriveVerdict(flags)` computed server-side (`trade-service.ts:355`), stored atomically (`trade-service.ts:408`). PDF guard: `{result.verdict && <VerdictBanner ... />}` (`trade-report.tsx:474`) — undefined verdict renders nothing. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-5-01 | T-5-03 | SanctionBadge/FlagCard/PDF render DB-sourced strings as React text nodes. `@react-pdf/renderer` uses React elements, not raw HTML — no XSS vector. Content is sync-job-written or static compile-time; not user-supplied. | Claude (gsd-security-auditor) | 2026-04-14 |
| AR-5-02 | T-5-04 | PDF route auth is pre-existing (`WHERE id=$1 AND user_id=$2`). No new endpoint or auth path introduced in this phase. Accepted as inherited control. | Claude (gsd-security-auditor) | 2026-04-14 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-04-14 | 5 | 5 | 0 | Claude (gsd-security-auditor) — /gsd-secure-phase 5 |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-04-14

# SECURITY.md — Phase 05: Decision Engine Upgrade

**Generated:** 2026-04-14
**ASVS Level:** L1
**Phase:** 05 — decision-engine-upgrade
**Auditor:** GSD Security Auditor (gsd-secure-phase)

---

## Threat Verification Summary

**Threats Closed:** 5 / 5
**Threats Open:** 0 / 5
**Unregistered Flags:** 0

---

## Threat Register Verification

### Mitigated Threats

#### T-5-01 — Tampering: pg_trgm SQL parameterization in checkRelatedPartyRisk()

**Disposition:** mitigate
**Status:** CLOSED

**Mitigation verified at:**
- `src/lib/server/trade-service.ts` lines 201–205:
  ```sql
  SELECT entity_name, source, similarity(normalized_name, $1) AS sim, last_updated
  FROM sanctions_entries
  WHERE similarity(normalized_name, $1) >= $2
  ORDER BY sim DESC LIMIT 3
  ```
  called with `[normalized, MEDIUM_CONFIDENCE_THRESHOLD]`
- `src/lib/server/trade-service.ts` lines 215–219: identical parameterized pattern for `regulatory_warnings`

**Finding:** Director names are passed exclusively as `$1` / `$2` parameterized arguments. No string interpolation into SQL strings is present anywhere in `checkRelatedPartyRisk()`. The declared verification pattern `similarity(normalized_name, $1)` is confirmed present at both query sites.

---

#### T-5-02 — Tampering: Director name normalization before SQL parameterization

**Disposition:** mitigate
**Status:** CLOSED

**Mitigation verified at:**
- `src/lib/server/trade-service.ts` line 191:
  ```typescript
  const normalized = person.name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
  ```

**Finding:** Normalization strips all characters outside `[a-z0-9\s]` — including SQL metacharacters, quote characters, and semicolons — before `normalized` is passed to `db.query()`. The normalized value is used as `$1` at lines 205 and 219. Order of operations is correct: normalize first, then parameterize.

---

#### T-5-05 — Tampering: Verdict guard for old sessions in PDF template

**Disposition:** mitigate
**Status:** CLOSED

**Mitigation verified at two files:**

1. `src/lib/server/trade-service.ts` line 355:
   ```typescript
   const verdict = deriveVerdict(flags)
   ```
   and line 401 in the result object literal:
   ```typescript
   verdict,
   ```
   Verdict is computed server-side by `deriveVerdict(flags)` and stored atomically in `trade_sessions.result_json` via `JSON.stringify(result)` at line 408. No client-side re-computation path exists.

2. `src/lib/pdf/trade-report.tsx` line 474:
   ```tsx
   {result.verdict && <VerdictBanner verdict={result.verdict} />}
   ```
   The `&&` guard ensures `VerdictBanner` renders only when `result.verdict` is a truthy string. Old JSONB rows predating this feature (where `verdict` field is absent) produce `undefined`, which is falsy — the banner is absent rather than misleading. No crash, no incorrect label.

**Finding:** Both mitigation requirements confirmed. Verdict is computed once, stored once, and guarded on render.

---

### Accepted Risks

#### T-5-03 — Tampering: DB-sourced strings in SanctionBadge tooltip and FlagCard explanation

**Disposition:** accept
**Status:** CLOSED

**Rationale (from threat register):** Content is DB-sourced strings rendered as React text nodes, not `innerHTML`. `@react-pdf/renderer` renders React elements, not raw HTML. No XSS vector exists in either the web UI (`SanctionBadge.tsx` tooltip, `TradeClient.tsx` FlagCard explanation section) or the PDF template (`trade-report.tsx` FlagSection source attribution rows, `RelatedPartySection`).

**Evidence reviewed:**
- `src/lib/pdf/trade-report.tsx` lines 308–309: `f.dataSource` rendered as `<Text>` element (react-pdf primitive)
- `src/lib/pdf/trade-report.tsx` line 445: `f.dataSource` in template literal inside `<Text>` element
- `src/app/trade/TradeClient.tsx`: `flag.dataSource` rendered as React text content (not dangerouslySetInnerHTML)
- `src/components/entity/SanctionBadge.tsx`: tooltip sources rendered as `{src}` React text nodes

This risk is correctly accepted. Static compile-time dataSource strings from `trade-rules.ts` cannot contain user-supplied content. DB-sourced `sanctions_entries.source` column values are written exclusively by server-side sync jobs.

---

#### T-5-04 — Elevation of Privilege: Unauthorized PDF access via old session IDs

**Disposition:** accept
**Status:** CLOSED

**Rationale (from threat register):** Pre-existing mitigation — `/api/trade/[id]/report` route enforces `WHERE id=$1 AND user_id=$2` bind. This was verified in RESEARCH.md sources during planning. No change to the auth layer was made in Phase 05. The mitigation carries forward unchanged.

---

## Unregistered Flags

None. All four plan executor SUMMARY.md files (`05-01` through `05-04`) report zero threat flags. No new network endpoints, auth paths, file access patterns, trust boundary crossings, or schema changes were introduced by this phase.

---

## Accepted Risks Log

| Threat ID | Category | Component | Rationale | Status |
|-----------|----------|-----------|-----------|--------|
| T-5-03 | Tampering | SanctionBadge tooltip / FlagCard dataSource / PDF source rows | React text nodes — not innerHTML. Static or sync-job-written content. No XSS vector. | CLOSED |
| T-5-04 | Elevation of Privilege | PDF access via session ID | Pre-existing WHERE id=$1 AND user_id=$2 guard on /api/trade/[id]/report. No change in phase. | CLOSED |

---

## Scope Boundary

This audit covers only threats registered in the Phase 05 threat register. Implementation files were read but not modified. New vulnerability scanning outside the declared threat register was not performed.

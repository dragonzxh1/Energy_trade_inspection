# Phase 6: Trade Service Integration Hardening - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Close two specific integration gaps in the trade check path:

1. **GAP-1 (DECISION-03):** Wire `checkDomain()` into `trade-service.ts` so `DOMAIN_WHOIS_RISK` and `DOMAIN_SPOOFING_RISK` flags fire on `/api/trade` checks. The rules and the domain-check module both exist — they were never connected. Requires a domain source for the seller and a new optional form field.

2. **GAP-2 (ARCH-02):** Surface circuit breaker degradation in `TradeCheckResult`. When `checkSanctions()` returns `status: 'degraded'`, set `sanctionDegraded: true` on the result and show a visible amber warning to the compliance officer in the trade UI.

No new data sources. No new risk rules. No schema migrations. No changes to entity pages or PDF template.

</domain>

<decisions>
## Implementation Decisions

### Domain Source for Seller Check (GAP-1)

- **D-01:** Domain source is **dual**: the trade form gets a new optional "Seller domain / email" input field. If the compliance officer fills it in, that value is used (extracted via `extractDomain()`). If left blank, the system falls back to `sellerFullEntity.website` (already populated from `metadata_json.website` in repository).
- **D-02:** `TradeCheckInput` gains a new optional field (e.g., `sellerDomain?: string`) to carry the user-provided domain. The trade form UI adds a corresponding optional input.
- **D-03:** The domain is extracted using the existing `extractDomain()` from `domain-check.ts`, then passed to `checkDomain()` to produce `sellerDomainCheck`. This result is passed as `sellerDomainCheck` to `runTradeRules()`.

### Domain Failure Handling

- **D-04:** When no domain can be resolved (no form input AND no `website` on the seller entity), **silently skip** the domain check. No flags are raised, no UI notification is shown. The compliance officer knows the field is optional.
- **D-05:** When the RDAP request fails (timeout, network error), **silently fail**. The server logs the error but the domain check is treated as skipped. No UI impact.

### Sanction Degradation Surfacing (GAP-2)

- **D-06:** `TradeCheckResult` gains a new field: `sanctionDegraded?: boolean`. It is set to `true` when **either** the seller sanction check **or** the vessel sanction check returns `status: 'degraded'` from `checkSanctions()`. If both are `'ok'`, the field is absent or `false`.
- **D-07:** The `.catch(() => ({ listed: false, sources: [] }))` pattern in `trade-service.ts` must be updated to preserve the `status` field from `checkSanctions()` so degraded state is not silently swallowed.
- **D-08:** UI treatment: when `sanctionDegraded === true`, display a **standalone amber warning box** directly below the `ResultBanner` in `TradeClient.tsx`. Text: "⚠ Sanction data may be incomplete — OpenSanctions API was unavailable during this check. Cached data was used. Manual verification recommended." No changes to the verdict or flag list.

### Claude's Discretion

- Exact wording of the amber warning box text (within the intent above)
- Whether `sanctionDegraded` is a top-level field or nested under a `meta` key in `TradeCheckResult`
- CSS styling of the amber warning box (use existing CSS variable patterns, e.g., `--risk-color-high` for amber)
- Label for the new trade form field ("Seller email or domain", "Seller domain (optional)", etc.)
- Whether `checkDomain()` is called inside the first or second `Promise.all()` batch in `runTradeCheck()`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Domain Check Module
- `src/lib/server/domain-check.ts` — `checkDomain(domain)`, `extractDomain(text)`, `DomainCheckResult`, `WhoisInfo` types. Public API for domain WHOIS + spoofing detection. Cached in `domain_whois_cache` (48h TTL).

### Trade Engine
- `src/lib/server/trade-service.ts` — `runTradeCheck()`, `TradeCheckResult`, `TradeCheckInput` — both gaps are fixed here. `sellerDomainCheck` goes into `runTradeRules()` call; `sanctionDegraded` is added to `TradeCheckResult`.
- `src/lib/server/trade-rules.ts` — `TradeRuleInput.sellerDomainCheck` (lines 141–155), Rules 16/17 (DOMAIN_SPOOFING_RISK, DOMAIN_WHOIS_RISK at lines 664–710). These rules already exist — just need the input wired.
- `src/lib/server/sync/sanctions.ts` — `checkSanctions()` return type: `{ status: 'ok' | 'degraded'; listed: boolean; sources: string[]; reason?: string }`. Circuit breaker already implemented (lines 143–268).

### Trade UI
- `src/app/trade/TradeClient.tsx` — `ResultBanner` component (line 574+), `VerdictLabel` (line 72+). Amber warning box is added immediately after `ResultBanner`. Trade form inputs are also here — add optional seller domain field.

### API Route
- `src/app/api/trade/route.ts` — Accepts `TradeCheckInput` and re-exports `TradeCheckResult`. Must be updated if `TradeCheckInput` shape changes.

### Requirements
- `.planning/REQUIREMENTS.md` — ARCH-02 (circuit breaker degradation surfacing) and DECISION-03 (reason codes + data source attribution) acceptance criteria
- `.planning/ROADMAP.md` §Phase 6 — Success criteria (4 items)

### Prior Phase Context
- `.planning/phases/01-architecture-hardening/01-CONTEXT.md` §ARCH-02 — Circuit breaker design decisions (3 consecutive failures → open, 60s cooldown, degraded response shape)
- `.planning/phases/05-decision-engine-upgrade/05-CONTEXT.md` §D-01 — Verdict mapping: DOMAIN_SPOOFING_RISK is a hard-block code

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `checkDomain(domain)` in `src/lib/server/domain-check.ts` — takes a domain string, returns `DomainCheckResult` with `flagged`, `severity`, `spoofingMatches[]`, `evidence[]`. Maps directly to `TradeRuleInput.sellerDomainCheck` shape.
- `extractDomain(text)` in `src/lib/server/domain-check.ts` — parses email or URL to extract domain. Use this on both the form input and the `website` field.
- `checkSanctions()` in `src/lib/server/sync/sanctions.ts` — already returns `status: 'degraded'`; trade-service.ts just doesn't check it.
- `Company.website?` in `src/lib/types.ts` (line 72) — populated in `repository.ts` (line 359) from `metadata_json.website`. `sellerFullEntity` is already fetched when `sellerDbMatch?.registrationNumber` exists.

### Established Patterns
- `Promise.all()` batching in `runTradeCheck()` — domain check fits in the second batch alongside `sellerDbIncDate` / `pscSummary` (after `sellerDbMatch` is known)
- CSS risk color vars (`RISK_BG`, `RISK_BORDER`, `RISK_COLOR`) used throughout `TradeClient.tsx` for verdict colors — amber warning box should follow same pattern
- `.catch(() => fallback)` pattern used on all external calls in `runTradeCheck()` — same pattern for `checkDomain()`, but must NOT swallow `status` for sanction checks

### Integration Points
- `runTradeRules()` call (trade-service.ts line 321+): add `sellerDomainCheck` to the input object
- `TradeCheckResult` object (trade-service.ts line 364+): add `sanctionDegraded` field
- `ResultBanner` in `TradeClient.tsx` (line 574): amber warning box rendered conditionally below it when `result.sanctionDegraded === true`
- Trade form inputs in `TradeClient.tsx`: add optional "Seller domain / email" text input, connected to `TradeCheckInput.sellerDomain`

</code_context>

<specifics>
## Specific Ideas

- Amber warning box text intent: communicate that sanction data may be stale/incomplete and manual verification is recommended — tone is informational, not alarming (the verdict itself is unaffected, only the confidence in it is reduced)
- The existing `.catch(() => ({ listed: false, sources: [] }))` in `runTradeCheck()` line 268 needs to be refactored — it currently discards `status`. Fix: catch only network/thrown errors, let the resolved `status: 'degraded'` pass through.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-trade-service-integration-hardening*
*Context gathered: 2026-04-14*

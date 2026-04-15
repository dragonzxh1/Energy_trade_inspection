# Phase 5: Decision Engine Upgrade - Context

**Gathered:** 2026-04-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Upgrade the trade risk check to produce a structured Safe/Review/Block verdict with typed reason codes and data source attribution, add a 1-hop director/shareholder sanction check (raising `RELATED_PARTY_RISK`), sharpen risk badge precision on entity pages (sanctioned vs. warning_listed), and update the existing PDF audit trail to include the new verdict data.

Five requirements: DECISION-01, DECISION-02, DECISION-03, DECISION-04, DECISION-05.

**Not in scope:** export_restricted label / BIS/ECFR data sync (deferred to v2). No new data sources. No schema changes to entities table.

</domain>

<decisions>
## Implementation Decisions

### D-01: Verdict Mapping Logic (DECISION-02)

**New `verdict` field:** Add `verdict: 'safe' | 'review' | 'block'` to `TradeCheckResult`.

**Keep `overallRisk: RiskLevel` unchanged** — watchlist stores `lastOverallRisk`; removing it would break existing data. Both fields coexist.

**Mapping — hybrid rules:**

| Condition | Verdict |
|-----------|---------|
| Any flag with code `SANCTION_EXPOSURE` present | `block` (hard, regardless of severity) |
| Any flag with code `KNOWN_FRAUD_ALERT` present | `block` (hard) |
| Any flag with code `DOMAIN_SPOOFING_RISK` present | `block` (hard) |
| Any flag with severity `critical` (other codes) | `block` |
| Any flag with severity `high` (no block-triggering flags) | `review` |
| `RELATED_PARTY_RISK` flag present (name match uncertainty) | `review` (not hard block) |
| Only `medium` / `low` severity flags | `safe` |
| Zero flags | `safe` |

**Verdict is a recommendation, not a lock** — the platform has no human approval workflow. Block/Review/Safe are display labels; compliance officers decide themselves.

**Verdict logic placement:** New function `deriveVerdict(flags: TradeFlag[]): TradeVerdict` added in `trade-rules.ts` alongside existing `overallRiskFromFlags()`.

**Data source traceability per flag:** Each `TradeFlag` must carry a `dataSource: string` field (human-readable name, e.g., "OFAC SDN") and `dataSourceSyncedAt: string | null` (ISO timestamp from DB, showing data age). This lets compliance officers know whether a match is from fresh or stale sync data.

**New FlagCode:** `RELATED_PARTY_RISK` added to `FlagCode` union in `trade-rules.ts`. Raised when a director or beneficial owner name fuzzy-matches a sanctions/regulatory warning list entry.

### D-02: Risk Label Precision — Sanctioned Tooltip (DECISION-01)

**Scope:** `export_restricted` (BIS/ECFR) is **skipped** this phase — BIS data sync is v2. DECISION-01 is narrowed to `sanctioned` vs `warning_listed` only.

**`WarningBadge` (Phase 2):** Already handles `warning_listed` distinction per regulator — no changes needed.

**`SanctionBadge` upgrade:** When `sanction_status === 'listed'`, show the specific sanctions list source(s) in a tooltip (e.g., "Sanctioned: OFAC SDN, EU FSF"). Badge text "Sanctioned" stays the same.

**Tooltip behavior:**
- **Desktop:** hover → tooltip appears (CSS/lightweight JS)
- **Mobile:** tap/click → floating window appears with source list
- **Implementation:** Lightweight custom tooltip component — no third-party library (consistent with project convention of `title=` native tooltips in Phase 2, but now JS-driven for mobile support)

**Where sanctions sources come from:** `SanctionBadge` needs to accept an optional `sources?: string[]` prop. Call sites (company/vessel page) must fetch and pass sanction source names alongside `sanctionStatus`.

### D-03: 1-hop Director/Shareholder Check (DECISION-05)

**People checked:** Both `metadata_json.directors` AND `beneficialOwners` (PSC data from Companies House/ACRA).

**Lists checked:** Both `sanctions_entries` table (OFAC/EU/UN) AND `regulatory_warnings` table (FCA/MAS/DFSA/SCA/CMA/FINMA/SFC).

**Match algorithm:**
- Normalize name: lowercase, strip punctuation, transliterate CJK where possible
- Fuzzy match using trigram similarity (same `pg_trgm` extension already in use for entity search)
- **Higher threshold than entity search** — to reduce false positives from common names
- If nationality is available on both sides, use it as a tiebreaker (but not a strict requirement)
- Result includes confidence level ("high" / "medium") and candidate match name in `evidence[]`

**Flag raised:** `RELATED_PARTY_RISK` in `TradeFlag`, severity `high`, target `'seller'`

**Evidence format:**
```
"Director [Name] matches [List Source] entry [Matched Name] (confidence: medium)"
```

**Verdict impact:** `RELATED_PARTY_RISK` → `review` verdict (not hard block — name matching is imprecise; compliance officer must verify).

**Where to implement:** In `trade-service.ts`, as a pre-check before `runTradeRules()`. Fetch directors + PSC for the seller's DB match, run name checks, inject resulting `RELATED_PARTY_RISK` flags into the flag array passed to `runTradeRules()`.

### D-04: PDF Audit Trail Update (DECISION-04)

**Approach:** Update existing `TradeReportDocument` in `src/lib/pdf/trade-report.tsx` — do not rebuild.

**New content to add:**
1. **Verdict banner at top** — Safe / Review / Block with color (green/amber/red), placed before the existing risk summary
2. **Data source attribution per flag** — each flag card shows `dataSource` and `dataSourceSyncedAt` (e.g., "Source: OFAC SDN · Last synced: 2026-04-10")
3. **Related-party flags section** — new section at end: "Related Party Risk" listing director/PSC name matches with list source and confidence

**PDF download button:** Already exists on result page as `↓ Download PDF`. Update button text to `Export Audit PDF` for clarity. No new UI button needed — same `href="/api/trade/${result.id}/report"` link.

**Data shape change:** `TradeCheckResult` gains `verdict: TradeVerdict` field. PDF template reads this field. Existing fields unchanged.

**Access control:** Unchanged — Starter+ only (already enforced in `/api/trade/[id]/report`).

### D-05: Reason Code Human-Readable Explanations (DECISION-03)

Each `FlagCode` maps to a human-readable explanation and the data source that triggered it. This is a static lookup map (no dynamic content needed).

**Implementation:** Add `FLAG_EXPLANATIONS: Record<FlagCode, { title: string; description: string; sourceHint: string }>` constant in `trade-rules.ts`. Used by:
- Trade result UI (flag card expanded view)
- PDF template (flag detail section)

**Claude's Discretion:** Exact wording of each explanation text.

### Claude's Discretion

- Exact wording of flag explanation text for each FlagCode
- Tooltip component implementation (CSS vs. small JS state — as long as no third-party library)
- Exact trigram similarity threshold for director name matching
- Evidence string phrasing for RELATED_PARTY_RISK matches
- Whether `deriveVerdict()` is exported or internal to trade-rules.ts

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Trade Engine
- `src/lib/server/trade-rules.ts` — `FlagCode` union, `TradeFlag` interface, `TradeRuleInput`, `runTradeRules()`, `overallRiskFromFlags()`, `generateSummary()` — verdict function added here
- `src/lib/server/trade-service.ts` — `TradeCheckResult`, `TradePartyResult`, `TradeVesselResult` interfaces; director pre-check added here before `runTradeRules()`
- `src/app/api/trade/route.ts` — re-exports `TradeCheckResult`; response shape drives both UI and stored JSON

### UI
- `src/app/trade/TradeClient.tsx` line 507+ — `ResultBanner` component (verdict banner replaces/augments here); line 618 — existing "Download PDF" link (text update only)
- `src/components/entity/SanctionBadge.tsx` — add `sources?: string[]` prop, tooltip behavior
- `src/components/entity/WarningBadge.tsx` — Phase 2 delivery, no changes needed but read for badge pattern consistency

### PDF
- `src/lib/pdf/trade-report.tsx` — existing `TradeReportDocument` template (update, do not rebuild)
- `src/app/api/trade/[id]/report/route.tsx` — existing PDF endpoint (no route changes needed)

### Data & Schema
- `db/migrations/031_regulatory_warnings.sql` — `regulatory_warnings` table schema (source, source_name, normalized_name, jurisdiction)
- `db/migrations/021_trade_sessions.sql` — `trade_sessions` table stores `result_json` as JSONB (schema change: `result_json` will now include `verdict` field)
- `src/lib/types.ts` — `SanctionStatus`, `BaseEntity` types; director data path: `Company.directors[]`

### Director Data Sources
- `src/lib/server/repository.ts` lines 361+ — `metadata_json.directors` parsing in `parseEntity()`; lines 650+ — Companies House officer → director mapping
- `src/lib/server/repository.ts` — `getPscSummary()` for PSC/beneficial owner data

### Requirements
- `.planning/REQUIREMENTS.md` — DECISION-01 through DECISION-05 acceptance criteria
- `.planning/ROADMAP.md` §Phase 5 — Success criteria (5 items)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `overallRiskFromFlags(flags)` in `trade-rules.ts` — existing function; new `deriveVerdict()` follows same pattern
- `Badge` primitive in `src/components/ui/Badge` — all badge components extend this; new tooltip-enabled badge variant follows same pattern
- `renderToBuffer` from `@react-pdf/renderer` — already set up, no new PDF infrastructure needed
- `pg_trgm` extension — already enabled (migration 001); trigram similarity available for director name matching
- `checkSanctions()` in `sync/sanctions.ts` — existing sanction lookup; director check uses direct DB query (same tables, different caller)

### Established Patterns
- `FlagCode` as union type + `TradeFlag` interface — add `RELATED_PARTY_RISK` to union, follow same interface structure
- `evidence: string[]` on `TradeFlag` — already used for human-readable context; director match details go here
- `title=` native tooltip on `WarningBadge` — Phase 2 pattern; `SanctionBadge` upgrades to JS-driven tooltip for mobile support
- PDF template uses React PDF (`@react-pdf/renderer`) — same approach, no new dependencies

### Integration Points
- `TradeCheckResult` stored as JSONB in `trade_sessions.result_json` — adding `verdict` field is additive (no migration needed for existing rows; old rows simply lack the field)
- Director data available when `sellerDbMatch` is found and has `metadata_json.directors` — check for null before running RELATED_PARTY_RISK logic
- `f3Unlocked` / plan check pattern from Phase 4 — PDF export already gated on Starter+ in `/api/trade/[id]/report`

</code_context>

<specifics>
## Specific Ideas

- PDF button text: change from "↓ Download PDF" to "Export Audit PDF" (same `<a>` element, `href` unchanged)
- Verdict banner colors should follow the existing `RISK_BG` / `RISK_BORDER` / `RISK_COLOR` CSS var pattern in `TradeClient.tsx` — map Block→critical colors, Review→high colors, Safe→low colors
- Director match evidence string format: `"Director [Full Name] matches [List Name] entry '[Matched Name]' (confidence: [high|medium])"`
- `dataSourceSyncedAt` for flag traceability: fetch `synced_at` from `sanctions_entries` or `regulatory_warnings` row that triggered the flag — null if data source doesn't carry a sync timestamp

</specifics>

<deferred>
## Deferred Ideas

- **export_restricted (BIS/ECFR) label** — Requires BIS Entity List sync (DATASRC-V2-01, deferred to v2)
- **Human review workflow** — Confirmation button on Block verdicts recording "acknowledged by [user] at [timestamp]" — scope creep; not in DECISION-02
- **2-hop UBO tracing** — Only 1-hop directors/PSC are in scope per DECISION-05; deeper UBO graph is INTEL-02 (v2 requirements)
- **Verdict override / manual review state** — No human workflow in this product; out of scope

</deferred>

---

*Phase: 05-decision-engine-upgrade*
*Context gathered: 2026-04-14*

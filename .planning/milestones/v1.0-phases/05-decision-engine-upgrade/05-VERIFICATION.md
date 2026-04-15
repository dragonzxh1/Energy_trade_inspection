---
phase: 05-decision-engine-upgrade
verified: 2026-04-14T00:00:00Z
status: human_needed
score: 4/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "A risk badge on any entity page distinguishes between sanctioned (OFAC/EU/UN), warning_listed (FCA/MAS/DFSA/SCA/CMA/FINMA/SFC), and export_restricted (BIS/ECFR) — each has a distinct badge color and tooltip naming the list"
    status: partial
    reason: "export_restricted badge is not implemented (BIS/ECFR data sync deferred to v2 per CONTEXT.md D-02). SanctionBadge tooltip prop is wired but entity page call sites (company, vessel, terminal) never pass sources — sanctionSources is not a field in Company/Vessel/Terminal types, so the tooltip cannot render on entity pages in practice."
    artifacts:
      - path: "src/components/entity/SanctionBadge.tsx"
        issue: "sources prop exists and component works correctly — but no entity page call site passes sources"
      - path: "src/app/company/[slug]/page.tsx"
        issue: "SanctionBadge at line 835 does not pass sources prop — sanctionSources field not available in company type"
      - path: "src/app/vessel/[imo]/page.tsx"
        issue: "SanctionBadge at line 523 does not pass sources prop — sanctionSources field not available in vessel type"
      - path: "src/app/terminal/[id]/page.tsx"
        issue: "SanctionBadge at line 433 does not pass sources prop — sanctionSources field not available in terminal type"
    missing:
      - "export_restricted badge type (BIS/ECFR) — deferred to v2 per CONTEXT.md D-02 and REQUIREMENTS.md (DATASRC-V2-01)"
      - "sanctionSources field in entity page data shape — or alternative data path to pass sources to SanctionBadge at entity page call sites"
human_verification:
  - test: "PDF audit trail visual verification"
    expected: "Downloading a PDF from a trade verdict should show: COMPLIANCE VERDICT banner (BLOCK/REVIEW/SAFE) before OVERALL RISK ASSESSMENT; each flag card shows Source and Last synced rows; RELATED PARTY RISK section appears after vessel section when applicable; flag labels are human-readable (not raw codes); old session PDF renders without crash"
    why_human: "PDF rendering via @react-pdf/renderer cannot be verified programmatically without a running server and live database. The human checkpoint in Plan 04 (Task 3, checkpoint:human-verify) was explicitly not auto-executed. Visual inspection of the rendered PDF is required."
  - test: "VerdictLabel pill visibility in trade result UI"
    expected: "Submitting a trade check that triggers flags should show BLOCK/REVIEW/SAFE pill BEFORE the CRITICAL/HIGH/etc. badge in the result banner. FlagCard should show 'What this means' section with description and 'Source: ... Last synced: ...' below evidence chips."
    why_human: "UI behavior requires a running dev server and a live trade check submission. The flag card explanation rendering and verdict pill placement cannot be verified by static analysis alone — need to confirm they render correctly in the browser."
---

# Phase 5: Decision Engine Upgrade Verification Report

**Phase Goal:** Upgrade the decision engine — add structured Safe/Review/Block verdict, per-flag data source attribution, 1-hop director sanction pre-check, and surface all in UI and PDF audit report.
**Verified:** 2026-04-14T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Risk badge distinguishes sanctioned / warning_listed / export_restricted with distinct badge color and tooltip naming the list | PARTIAL | SanctionBadge tooltip component exists and works; entity page call sites do NOT pass sources prop; export_restricted not implemented (explicitly deferred to v2 per CONTEXT.md D-02) |
| 2 | Trade risk check returns explicit Safe/Review/Block verdict with each flag carrying a typed reason code | VERIFIED | `TradeVerdict` type, `deriveVerdict()`, `TradeCheckResult.verdict`, `VerdictLabel` in ResultBanner — all confirmed present and wired |
| 3 | Each reason code links to human-readable explanation and names specific data source that triggered it | VERIFIED | `FLAG_EXPLANATIONS` (18 entries, TypeScript exhaustive), FlagCard "What this means" section with `flag.dataSource` and `flag.dataSourceSyncedAt` |
| 4 | Director/shareholder sanction match raises related_party_risk flag with name and list source | VERIFIED | `checkRelatedPartyRisk()` in trade-service.ts queries sanctions_entries + regulatory_warnings via pg_trgm, injects `RELATED_PARTY_RISK` flags before runTradeRules() |
| 5 | Compliance officer can export PDF showing verdict + reason codes + data sources + related-party flags + UTC timestamp | VERIFIED (automated) / HUMAN CHECK PENDING | VerdictBanner, FLAG_LABEL 18 entries, per-flag Source/Last synced rows, RelatedPartySection, "Export Audit PDF" button text — all present in code; PDF rendering requires visual human verification |

**Score:** 4/5 truths verified (SC-1 partial; SC-5 pending human visual confirmation)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | export_restricted (BIS/ECFR) badge type | v2 milestone | REQUIREMENTS.md DATASRC-V2-01: "BIS Entity List / Denied Persons List (US export controls)"; CONTEXT.md D-02: "export_restricted (BIS/ECFR) is skipped this phase — BIS data sync is v2" |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/server/trade-rules.ts` | TradeVerdict type, enriched TradeFlag interface, deriveVerdict(), FLAG_EXPLANATIONS, RELATED_PARTY_RISK in FlagCode | VERIFIED | All 5 exports present; 26 `dataSource:` occurrences (1 interface + 25 push sites); TypeScript compiles clean |
| `src/lib/server/trade-service.ts` | checkRelatedPartyRisk(), TradeCheckResult.verdict field, verdict wiring | VERIFIED | checkRelatedPartyRisk() at line 175; `verdict: TradeVerdict` in TradeCheckResult at line 79; verdict computed at line 352; stored in JSONB |
| `src/components/entity/SanctionBadge.tsx` | sources prop + JS tooltip with hover/tap interaction | VERIFIED (component) / PARTIAL (call sites) | sources?: string[] at line 13; useState, onMouseEnter, onClick, role="tooltip" all present; entity page call sites do not pass sources |
| `src/app/trade/TradeClient.tsx` | VerdictLabel pill in ResultBanner, FlagCard explanation section, complete FLAG_LABEL map | VERIFIED | VerdictLabel component at line 72; result.verdict guard at line 595; FlagCard "What this means" at line 360; FLAG_LABEL 18 entries at lines 33-52; "Export Audit PDF" at line 697 |
| `src/lib/pdf/trade-report.tsx` | VerdictBanner, extended FLAG_LABEL (18 entries), flag data source rows, RelatedPartySection | VERIFIED | VerdictBanner at line 256; FLAG_LABEL 18 entries at lines 167-186; Source/Last synced rows at lines 307-318; RelatedPartySection at line 430; result.verdict guard at line 474 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| deriveVerdict() | HARD_BLOCK_CODES set | flags.some(f => HARD_BLOCK_CODES.has(f.code)) | WIRED | trade-rules.ts line 736: `flags.some(f => HARD_BLOCK_CODES.has(f.code))` |
| TradeFlag | runTradeRules() push sites | TypeScript interface enforcement | WIRED | 25 push sites all include `dataSource:` and `dataSourceSyncedAt:` — TypeScript compilation confirms |
| checkRelatedPartyRisk() | sanctions_entries + regulatory_warnings DB tables | parameterized pg_trgm similarity() queries | WIRED | trade-service.ts lines 195-220: `similarity(normalized_name, $1) >= $2` with parameterized values |
| RELATED_PARTY_RISK flags | runTradeRules() input | prepended to flags array before rule engine runs | WIRED | trade-service.ts line 346: `const flags = [...relatedPartyFlags, ...ruleFlags]` |
| VerdictLabel | VERDICT_RISK_MAP | maps TradeVerdict to RiskLevel design tokens | WIRED | TradeClient.tsx line 60: `VERDICT_RISK_MAP` mapping block→critical, review→high, safe→low |
| VerdictBanner | result.verdict | conditional render guard | WIRED | trade-report.tsx line 474: `{result.verdict && <VerdictBanner verdict={result.verdict} />}` |
| RelatedPartySection | result.flags | filter for RELATED_PARTY_RISK code | WIRED | trade-report.tsx line 431: `flags.filter(f => f.code === 'RELATED_PARTY_RISK')` |
| SanctionBadge sources prop | entity page call sites | prop-chain from entity data | NOT WIRED | Company/vessel/terminal pages call `<SanctionBadge status={...} />` without sources — data not available in entity types |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `src/app/trade/TradeClient.tsx` VerdictLabel | result.verdict | deriveVerdict(flags) in trade-service.ts | Yes — derived from live flag array | FLOWING |
| `src/app/trade/TradeClient.tsx` FlagCard explanation | flag.dataSource | set at trade-rules.ts push sites (static strings) | Yes — static compile-time constants | FLOWING |
| `src/lib/pdf/trade-report.tsx` VerdictBanner | result.verdict | stored in trade_sessions.result_json JSONB | Yes — persisted at INSERT | FLOWING |
| `src/components/entity/SanctionBadge.tsx` tooltip | sources prop | entity page call sites | No — sources prop never passed at entity pages | HOLLOW_PROP |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compilation | npm run type-check | Exit 0, no errors | PASS |
| TradeVerdict type exported | grep "export type TradeVerdict" trade-rules.ts | Found at line 721 | PASS |
| deriveVerdict() exported | grep "export function deriveVerdict" trade-rules.ts | Found at line 734 | PASS |
| FLAG_EXPLANATIONS has 18 entries (TypeScript exhaustive) | TypeScript Record<FlagCode, ...> type | Passes type-check — exhaustiveness enforced | PASS |
| checkRelatedPartyRisk() uses parameterized queries | grep "similarity(normalized_name, \$1)" | Found at lines 201, 215 | PASS |
| verdict persisted in JSONB | JSON.stringify(result) in INSERT | result object includes verdict field — confirmed at line 405 | PASS |
| "Export Audit PDF" button text | grep "Export Audit PDF" TradeClient.tsx | Found at line 697 | PASS |
| PDF renders without server | Cannot test without running server | N/A | SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DECISION-01 | 05-03-PLAN.md | Risk labels distinguish sanctioned / warning_listed / export_restricted with distinct badge color and tooltip | PARTIAL | SanctionBadge tooltip added; export_restricted deferred to v2; sources prop not passed at entity pages |
| DECISION-02 | 05-01-PLAN.md, 05-02-PLAN.md, 05-03-PLAN.md | Trade risk check returns structured Safe/Review/Block verdict with typed reason codes | SATISFIED | TradeVerdict, deriveVerdict(), TradeCheckResult.verdict, VerdictLabel all wired end-to-end |
| DECISION-03 | 05-01-PLAN.md, 05-03-PLAN.md | Each reason code maps to human-readable explanation and data source | SATISFIED | FLAG_EXPLANATIONS (18 entries), FlagCard "What this means" section, flag.dataSource rendered |
| DECISION-04 | 05-04-PLAN.md | PDF audit trail with verdict, reason codes, data sources, related-party flags, UTC timestamp | SATISFIED (code) / HUMAN PENDING | VerdictBanner, 18-entry FLAG_LABEL, Source/Last synced rows, RelatedPartySection all present; visual verification pending |
| DECISION-05 | 05-02-PLAN.md | Director/shareholder sanction pre-check raises related_party_risk flag | SATISFIED | checkRelatedPartyRisk() present, RELATED_PARTY_RISK FlagCode in union, flags prepended before runTradeRules() |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/components/entity/SanctionBadge.tsx | 37 | `showTooltip` is always false on entity pages because `sources` is undefined | Warning | Tooltip feature is dead code at entity page call sites — component works but has no active consumers with sources data |
| src/app/company/[slug]/page.tsx | 835 | `<SanctionBadge status={company.sanctionStatus} />` — no sources prop | Warning | Tooltip will never render for company pages; sanctionSources data not available in Company type |
| src/app/vessel/[imo]/page.tsx | 523 | `<SanctionBadge status={vessel.sanctionStatus} />` — no sources prop | Warning | Tooltip will never render for vessel pages |
| src/app/terminal/[id]/page.tsx | 433 | `<SanctionBadge status={terminal.sanctionStatus} />` — no sources prop | Warning | Tooltip will never render for terminal pages |

No STUB-level patterns found. No empty return null implementations blocking goal. No hardcoded empty data flowing to verdict or flag rendering.

### Human Verification Required

#### 1. PDF Audit Trail Visual Check

**Test:** Start dev server (`npm run dev`). Submit a trade check at http://localhost:3000/trade with seller "ROSNEFT" or similar. Click "Export Audit PDF". Open the downloaded PDF.

**Expected:**
- "COMPLIANCE VERDICT" section appears at top (before "OVERALL RISK ASSESSMENT") with BLOCK/REVIEW/SAFE value and disclaimer text
- Each flag card shows "Source" and "Last synced" rows
- Flag labels are human-readable (e.g., "Sanction Exposure", not "SANCTION_EXPOSURE")
- Old session PDF (if accessible from browser history) downloads without crash

**Why human:** PDF rendering via @react-pdf/renderer requires a running server. The Plan 04 human checkpoint (checkpoint:human-verify, gate: blocking) was explicitly not auto-executed per the summary.

#### 2. Trade Result UI Verification

**Test:** Submit a trade check that triggers at least one risk flag. Observe the result banner and flag cards.

**Expected:**
- BLOCK/REVIEW/SAFE pill appears BEFORE the CRITICAL/HIGH/MEDIUM/LOW badge in the result banner
- Each flag card shows a "What this means" divider section below the evidence chips with: description paragraph and "Source: [name] · Last synced: [date or Unknown]"
- PDF download button text reads "Export Audit PDF" (not "↓ Download PDF")

**Why human:** UI requires a running dev server and live trade check execution with real or seeded data.

### Gaps Summary

**SC-1 (DECISION-01) is partially implemented:**

The SanctionBadge component correctly supports a `sources` prop and renders a JS-driven tooltip when `status === 'listed'` and `sources.length > 0`. However, no entity page call site (company, vessel, terminal pages) passes this prop. The `sanctionSources` data is available in `TradePartyResult` and `TradeVesselResult` (used in the trade result UI), but the entity page types (`Company`, `Vessel`, `Terminal`) do not carry a `sanctionSources` field. As a result, the tooltip will never appear on entity detail pages — only in the trade check result context (though TradeClient.tsx uses its own inline `SanctionBadge` stub, not the imported component).

The `export_restricted` badge distinction is also absent, but this was explicitly deferred to v2 in CONTEXT.md D-02 and REQUIREMENTS.md (DATASRC-V2-01). This deferred item does not block the phase's goal of upgrading the trade risk decision engine.

**SC-5 (DECISION-04) needs human confirmation:**

All PDF components are present and wired in code. The Plan 04 human checkpoint was not auto-executed. A compliance officer must visually confirm the PDF renders correctly before this success criterion can be marked fully satisfied.

---

_Verified: 2026-04-14T00:00:00Z_
_Verifier: Claude (gsd-verifier)_

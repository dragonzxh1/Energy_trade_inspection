# Phase 5: Decision Engine Upgrade - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-14
**Phase:** 05-decision-engine-upgrade
**Areas discussed:** Verdict Mapping Logic, Risk Label Precision, Director Sanction Check Details, PDF Audit Trail Content
**Language:** Chinese (user preference for this session)

---

## Verdict Mapping Logic

| Option | Description | Selected |
|--------|-------------|----------|
| Severity-based threshold | critical→Block; high→Review; medium/low→Safe | |
| Specific code hard blocks | SANCTION_EXPOSURE, KNOWN_FRAUD_ALERT always Block | |
| Hybrid rules | Hard-block codes + severity threshold for rest | ✓ |

**User's choice:** Hybrid rules — user said "有的命中要直接block，比如某些权威的网址出现了欺诈信息" (some hits should directly block, e.g., when appearing in authoritative fraud information).

**Hard block codes confirmed:** SANCTION_EXPOSURE, KNOWN_FRAUD_ALERT, DOMAIN_SPOOFING_RISK.

**RELATED_PARTY_RISK:** User raised concern that name-only matching for directors is imprecise. Agreed to set as Review (not Block) with confidence level and candidate name in evidence.

**Data source authority discussion:**
- Tier 1 (Block triggers): OFAC SDN, EU FSF, UN Consolidated List; Industry fraud blacklists
- Tier 2 (Review): FCA/MAS/DFSA/SCA/CMA/FINMA/SFC regulatory warnings; domain checks, AIS, GLEIF

**Data freshness:** User asked about information time validity. Agreed to include `dataSourceSyncedAt` timestamp per flag so compliance officers can see data age.

**Verdicts are recommendations:** User noted there is no human compliance review process built in. Clarified that Safe/Review/Block are display labels only — compliance officers decide themselves. No approval workflow.

**overallRisk retained:** Keep alongside new `verdict` field for backward compatibility with watchlist.

---

## Risk Label Precision

| Option | Description | Selected |
|--------|-------------|----------|
| Skip export_restricted, only sanctioned vs warning_listed | BIS data deferred to v2 | ✓ |
| Add type without data | Prep for v2 BIS data | |
| Scope reduction confirmed | Both warning_listed and sanctioned in scope | |

**User's choice:** Skip export_restricted — "本阶段跳过，仅实现 sanctioned vs warning_listed（推荐）"

**Tooltip method:**

| Option | Description | Selected |
|--------|-------------|----------|
| Tooltip showing source | Hover tooltip: "Sanctioned: OFAC SDN, EU FSF" | ✓ |
| Inline badge text with source | Would get long with multiple sources | |
| Side source tags | Takes more space | |

**Mobile handling:** User asked "mobile如何处理". Agreed: Desktop hover tooltip; mobile click shows floating window. Lightweight custom JS component, no third-party library.

---

## Director Sanction Check Details

| Option | Description | Selected |
|--------|-------------|----------|
| Directors + PSC (beneficial owners) | More complete coverage | ✓ |
| Directors only | PSC check deferred | |
| Confirm from DECISION-05 text | "director or shareholder" = 1-hop | |

**User's choice:** Directors + PSC (PSC harder to hide risk behind).

| Option | Description | Selected |
|--------|-------------|----------|
| Normalized fuzzy + high threshold | Reduces false positives from common names | ✓ |
| Exact match only | High miss rate for abbreviated names | |
| Fuzzy + nationality required | Most sanctions entries lack nationality | |

**User's choice:** Normalized fuzzy high threshold with confidence level shown.

| Option | Description | Selected |
|--------|-------------|----------|
| Sanctions + regulatory warnings | Full coverage, consistent with entity check | ✓ |
| Sanctions only | Regulatory warning check has high false-positive risk | |

**User's choice:** Both lists.

---

## PDF Audit Trail Content

| Option | Description | Selected |
|--------|-------------|----------|
| Update existing TradeReportDocument | Keep template, add new sections | ✓ |
| Redesign PDF layout | Better audit format but more work | |

**User's choice:** Update existing template.

**PDF button discovery:** Found that "↓ Download PDF" button already exists in TradeClient.tsx line 618. No new button needed — only update button text and PDF content.

| Option | Description | Selected |
|--------|-------------|----------|
| Add button on result page | Already exists, just update text | ✓ |
| Keep session-ID only access | Current state — less discoverable | |

**User's choice:** Result page button (already exists).

---

## Claude's Discretion

- Exact wording of flag explanation text for each FlagCode
- Tooltip component implementation approach (CSS hover + JS click handler)
- Exact trigram similarity threshold for director name matching
- Evidence string phrasing for RELATED_PARTY_RISK matches
- Whether `deriveVerdict()` is exported or internal to trade-rules.ts

## Deferred Ideas

- export_restricted (BIS/ECFR) label — v2
- Human review workflow / acknowledgment button — scope creep, not in requirements
- 2-hop UBO tracing — INTEL-02 v2
- Verdict override / manual review state — no workflow system in product

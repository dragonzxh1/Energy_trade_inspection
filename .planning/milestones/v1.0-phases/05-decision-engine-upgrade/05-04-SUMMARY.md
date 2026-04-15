---
phase: 05-decision-engine-upgrade
plan: 04
subsystem: pdf-audit-trail
tags: [pdf, trade-report, verdict-banner, related-party, flag-labels, audit-trail]
dependency_graph:
  requires:
    - 05-01-PLAN.md  # TradeVerdict type, TradeFlag with dataSource/dataSourceSyncedAt
    - 05-02-PLAN.md  # TradeCheckResult.verdict field, RELATED_PARTY_RISK flags
  provides:
    - VerdictBanner PDF component (block/review/safe with color + disclaimer)
    - FLAG_LABEL extended to 18 entries in PDF template
    - Per-flag data source attribution rows (Source + Last synced) in FlagSection
    - RelatedPartySection PDF component for RELATED_PARTY_RISK flags
  affects:
    - src/lib/pdf/trade-report.tsx
tech_stack:
  added: []
  patterns:
    - "@react-pdf/renderer View/Text composition for new PDF sections"
    - "Conditional render guard: result.verdict && <VerdictBanner> for old-session safety"
    - "flags.filter(f => f.code === 'RELATED_PARTY_RISK') for targeted section rendering"
key_files:
  created: []
  modified:
    - src/lib/pdf/trade-report.tsx
decisions:
  - "VerdictBanner label color applied to both label text and value text — matches existing RiskBanner pattern"
  - "marginBottom: 12 on VerdictBanner (vs 20 on RiskBanner) — tighter spacing to visually group verdict + risk as a pair"
  - "RelatedPartySection placed after VesselSection, before PortSection — per plan spec"
  - "Old-session guard uses result.verdict && (not ?? 'safe') — absence of banner is safer than displaying incorrect verdict for old rows"
metrics:
  duration: ~20min
  completed: 2026-04-14
  tasks_completed: 2
  files_modified: 1
---

# Phase 05 Plan 04: PDF Audit Trail Update Summary

Extended `src/lib/pdf/trade-report.tsx` with three new sections completing the DECISION-04 PDF audit trail: VerdictBanner before RiskBanner with block/review/safe color coding, per-flag data source attribution rows, and RelatedPartySection for director match flags.

## What Was Built

**VerdictBanner component** — New `function VerdictBanner({ verdict }: { verdict: TradeVerdict })` placed before `<RiskBanner>` in `TradeReportDocument`. Renders "COMPLIANCE VERDICT" label, the verdict value ("BLOCK" / "REVIEW REQUIRED" / "SAFE TO PROCEED") in the corresponding color (C.listed/#ef4444, C.warn/#f97316, C.clear/#22c55e), and a compliance disclaimer. Guarded with `{result.verdict && <VerdictBanner verdict={result.verdict} />}` so old JSONB sessions without the verdict field render nothing (no crash, no incorrect display).

**FLAG_LABEL extended to 18 entries** — The PDF's own `FLAG_LABEL` constant was expanded from 6 entries to 18, matching all FlagCodes in the `FlagCode` union. This ensures no raw code strings (e.g., "RELATED_PARTY_RISK") appear in the rendered PDF — all codes map to human-readable labels.

**Per-flag data source attribution** — Inside `FlagSection`, after the evidence lines block, each flag card now renders two `InfoRow`-style rows: "Source" showing `f.dataSource` and "Last synced" showing `fmtDate(f.dataSourceSyncedAt)` or "Unknown" if null. This provides data provenance for every flag in the audit document.

**RelatedPartySection component** — New `function RelatedPartySection({ flags }: { flags: TradeFlag[] })` filters flags by `f.code === 'RELATED_PARTY_RISK'` and renders them in amber-tinted cards after `VesselSection`. Each card shows evidence strings, data source attribution, and a verification disclaimer ("Name matching is probabilistic. A compliance officer must verify this finding before taking action."). Returns null when no RELATED_PARTY_RISK flags are present.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 9bb3023 | feat(05-04): add VerdictBanner, extend FLAG_LABEL to 18 entries, add flag data source rows |
| Task 2 | 9367f5d | feat(05-04): add RelatedPartySection to PDF document |

## Verification

- `npm run type-check` exits 0 (zero TypeScript errors) — verified after each task
- `npm run lint` — pre-existing infrastructure gap (Next.js 15 lint script broken); not blocking
- `function VerdictBanner(` present in trade-report.tsx (line 256)
- `result.verdict && <VerdictBanner` present (line 447)
- `RELATED_PARTY_RISK: 'Related Party Risk'` in FLAG_LABEL (line 185)
- `f.dataSource` in FlagSection data source row (line 309)
- `f.dataSourceSyncedAt` in FlagSection last synced row (lines 314–315)
- `function RelatedPartySection(` present (line 430)
- `f.code === 'RELATED_PARTY_RISK'` filter in RelatedPartySection (line 431)
- `<RelatedPartySection flags={result.flags} />` in TradeReportDocument (line 541)
- Placement: VesselSection (line 538) → RelatedPartySection (line 541) → PortSection (line 544) — correct order

## Checkpoint Pending: Human Verification Required

**Task 3 (checkpoint:human-verify) was not auto-executed** — `auto_advance` is `false` in config.

### What to Verify

1. Start the dev server: `npm run dev`
2. Navigate to http://localhost:3000/trade
3. Submit a trade check with seller "ROSNEFT" (or any seller likely to trigger flags)
4. On the results page, verify:
   a. The banner shows BLOCK/REVIEW/SAFE pill BEFORE the CRITICAL/HIGH/etc. badge
   b. Each flag card shows "What this means" section with description and "Source: ... · Last synced: ..." line
   c. The PDF download button reads "Export Audit PDF"
5. Click "Export Audit PDF" — wait for PDF download
6. Open the PDF and verify:
   a. "COMPLIANCE VERDICT" section appears at the top with BLOCK/REVIEW/SAFE and disclaimer text
   b. "OVERALL RISK ASSESSMENT" section follows immediately after
   c. Each flag card shows "Source" and "Last synced" rows
   d. Flag label text is human-readable (e.g., "Sanction Exposure") — NOT raw code strings
7. If a related party risk flag was raised, verify "RELATED PARTY RISK" section appears after Vessel section
8. To test old-session fallback: navigate to a previously generated PDF URL — verify it downloads without error

**Resume signal:** Type "approved" when all PDF sections are verified, or describe any issues found.

## Deviations from Plan

None — plan executed exactly as written. Both tasks completed atomically with individual commits.

## Known Stubs

None. All components render live data from `result` fields. `f.dataSourceSyncedAt` displaying "Unknown" when null is correct behavior (not a stub) — the null represents genuinely unavailable sync timestamps for static-rule flags.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundary changes. The `@react-pdf/renderer` renders React elements (not raw HTML), so dataSource strings from stored JSONB cannot create XSS vectors. T-5-05 mitigation (verdict guard for old sessions) is implemented as specified.

## Self-Check

### Files exist:
- `src/lib/pdf/trade-report.tsx` — FOUND (modified)
- `.planning/phases/05-decision-engine-upgrade/05-04-SUMMARY.md` — this file

### Commits exist:
- `9bb3023` — feat(05-04): add VerdictBanner, extend FLAG_LABEL to 18 entries, add flag data source rows
- `9367f5d` — feat(05-04): add RelatedPartySection to PDF document

## Self-Check: PASSED

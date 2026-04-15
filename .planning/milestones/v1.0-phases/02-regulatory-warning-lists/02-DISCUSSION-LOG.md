# Phase 2: Regulatory Warning Lists - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 02-regulatory-warning-lists
**Areas discussed:** Storage architecture, Warning badge display, Data access reliability, Entity matching strategy
**Language:** Chinese (user preference)

---

## Storage Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| New dedicated `regulatory_warnings` table | Independent table like `fraud_alerts` — clear semantic separation between sanctions, fraud alerts, and regulatory warnings | ✓ |
| Extend `sanctions_entries` with source flag | Add dataset discriminator to existing table — reuses fuzzy match logic but mixes distinct data types | |

**User's choice:** New dedicated `regulatory_warnings` table
**Notes:** None — immediate selection of recommended option.

---

## Warning Badge Display

| Option | Description | Selected |
|--------|-------------|----------|
| Per-source specific badges (FCA, MAS, DFSA, etc.) | Each regulator gets its own badge with abbreviation + jurisdiction | ✓ |
| Single generic "Warning Listed" badge | One badge for any regulator hit | |
| Single badge with tooltip listing sources | Hover/click reveals which regulators matched | |

**User's choice:** Per-source specific badges
**Notes:** User raised an important architectural concern: the current system conflates "sanctioned vs not sanctioned" but regulatory warnings and trade fraud risk are different concepts. User asked how scoring should work — whether to have separate sanction scores and fraud scores. Discussion resolved: Phase 2 warning badges are purely informational (no score impact); scoring architecture for warnings is deferred to Phase 4/5.

---

## Data Access Reliability

| Option | Description | Selected |
|--------|-------------|----------|
| All sources attempted, single failure doesn't block others | Follows `fraud-alerts.ts` pattern — independent sources, failure isolation | ✓ |
| Only reliable sources at launch (FCA only) | Start with CSV-based FCA, add HTML scrapers later | |
| All sources with degraded status on failure | Show "degraded" state in admin panel for failed sources, circuit-breaker style | |

**User's choice:** All sources attempted, failure isolation
**Notes:** None — immediate selection.

---

## Entity Matching Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Query-time fuzzy match | Match when entity page loads — same as `fraud_alerts` pattern | ✓ |
| Sync-time pre-matching | Pre-associate entries with entities at ingest — faster queries, more complex sync | |
| Exact string matching only | Low false-positive risk, but may miss name variants | |

**User's choice:** Query-time fuzzy match
**Notes:** None — immediate selection. Claude to determine appropriate similarity threshold (starting at 0.72, same as `sanctions_entries`).

---

## Claude's Discretion

- Exact `word_similarity` threshold for regulatory warnings (recommended: 0.72, tune as needed)
- Specific badge color hex values within amber/orange family
- Whether to use entry-level or page-level URLs for `list_url` field
- Sync schedule integration details (piggyback on existing cron vs separate trigger)

## Deferred Ideas

- Score impact of regulatory warning hits → Phase 4/5
- `warning_listed` vs `sanctioned` badge distinction in trade verdicts → Phase 5 DECISION-01
- BIS/ECFR export control list sync → v2 milestone (DATASRC-V2-01)

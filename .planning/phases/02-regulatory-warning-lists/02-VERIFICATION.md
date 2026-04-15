---
phase: 02-regulatory-warning-lists
verified: 2026-04-13T00:00:00Z
status: human_needed
score: 9/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Amber badge appears on entity page for a warning-listed entity"
    expected: "Amber 'FCA · UK' badge visible below RiskBadge in the sidebar; badge color is amber, distinct from red SanctionBadge; no glow/pulse animation"
    why_human: "Visual rendering requires a browser — cannot verify CSS color values or animation absence programmatically"
  - test: "Multiple warning list hits stack correctly"
    expected: "Two or more amber badges appear side-by-side in the flex container when an entity matches multiple sources"
    why_human: "Layout and visual stacking requires browser verification"
  - test: "Tooltip format is correct"
    expected: "Hovering over a badge shows tooltip: '{sourceName} — Regulatory Warning List' (em dash, not hyphen)"
    why_human: "Native title= tooltip display requires browser hover interaction"
  - test: "Badge disappears when entity is not on any list"
    expected: "No badge group rendered when warningHits.length === 0; the conditional div is absent from DOM"
    why_human: "Conditional rendering based on live DB data — requires server with empty regulatory_warnings table"
  - test: "Badges are F1 tier — visible to unauthenticated users"
    expected: "No ContentLock wrapper on the warning badge group; badges visible without login"
    why_human: "Authentication state testing requires a browser session — though code inspection confirms no ContentLock"
---

# Phase 2: Regulatory Warning Lists — Verification Report

**Phase Goal:** ETI screens entities against seven regulatory warning lists covering UK, Switzerland, Hong Kong, Singapore, UAE (Dubai DIFC), UAE (federal), and Oman — surfaces distinct warning badges on entity pages
**Verified:** 2026-04-13
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | An entity flagged on the FCA (UK) warning list shows a distinct badge naming "FCA" as the source regulator | ? HUMAN NEEDED | Code: WarningBadge.tsx renders `LABEL['fca'] = 'FCA \u00B7 UK'` with `color="var(--accent-amber)"`. Visual rendering requires browser. |
| 2 | An entity flagged on MAS, DFSA, SCA, or CMA Oman shows the appropriate regulator badge, each independently visible | ? HUMAN NEEDED | Code: LABEL map contains all 7 sources; entity pages conditionally render per-source badges. Visual confirmation needed. |
| 3 | An entity flagged on FINMA or SFC shows the appropriate badge | ? HUMAN NEEDED | Code: LABEL map entries confirmed for 'finma' → 'FINMA \u00B7 CH' and 'sfc' → 'SFC \u00B7 HK'. Visual confirmation needed. |
| 4 | Warning list data syncs automatically on the same schedule as existing sanctions sources | ✓ VERIFIED | `runSync('all')` at line 77 of index.ts includes `warninglists` branch. When `/api/admin/sync` is called with source='all' or any unrecognized source, all syncs run including warninglists. `SyncSource` union at line 11 includes 'warninglists'. |
| 5 | Entities not on any warning list show no badge — no false positives from the new sync | ? HUMAN NEEDED | Code: `{warningHits.length > 0 && (...)}` conditional confirmed in all three pages. Requires live DB to confirm no false positives. |
| 6 | syncRegulatoryWarnings() runs all 7 sources with per-source failure isolation | ✓ VERIFIED | regulatory-warnings.ts: SCRAPERS array has 7 entries. syncSource() wraps each in try/catch; error path returns result without throwing and logs to sanctions_sync_log. |
| 7 | getWarningHits() performs fuzzy matching at word_similarity >= 0.72 with deduplication | ✓ VERIFIED | warning-lists.ts lines 36-47: `WHERE word_similarity($1, normalized_name) >= 0.72`. Map deduplication confirmed lines 52-64. |
| 8 | The 'warninglists' SyncSource key is registered in index.ts | ✓ VERIFIED | index.ts line 11: `export type SyncSource = 'ofac' \| 'fraud' \| 'legitdomains' \| 'warninglists' \| 'all'`. Line 77: `if (source === 'warninglists' \|\| source === 'all')`. |
| 9 | The regulatory_warnings table has a GIN trigram index on normalized_name | ✓ VERIFIED | migration 031: `CREATE INDEX IF NOT EXISTS idx_regwarn_normalized ON regulatory_warnings USING GIN (normalized_name gin_trgm_ops)` at line 30-31. |
| 10 | All three entity page types (company, vessel, terminal) display WarningBadge groups in the sidebar below the RiskBadge | ✓ VERIFIED | All three pages: import confirmed, `getWarningHits()` called after data fetch, badge group placed immediately after `</div>` closing RiskBadge wrapper. No ContentLock wrapping. |

**Score:** 5/5 automated truths verified, 5/5 human-needed truths pending browser confirmation

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `db/migrations/031_regulatory_warnings.sql` | regulatory_warnings table DDL + trigram index | ✓ VERIFIED | All 9 columns present; GIN idx_regwarn_normalized + B-tree idx_regwarn_source both created |
| `src/lib/server/sync/regulatory-warnings.ts` | 7 scraper functions + syncRegulatoryWarnings() | ✓ VERIFIED | 7 scrapers in SCRAPERS array; syncRegulatoryWarnings() exported; WarningListSyncResult exported |
| `src/lib/server/sync/index.ts` | warninglists SyncSource registration | ✓ VERIFIED | Union type includes 'warninglists'; runSync case at line 77 |
| `src/lib/server/warning-lists.ts` | getWarningHits() fuzzy query function | ✓ VERIFIED | Exports getWarningHits and re-exports WarningHit; word_similarity >= 0.72; deduplication by source |
| `src/lib/types.ts` | WarningHit type export | ✓ VERIFIED | WarningHit interface at lines 144-152; SanctionStatus unchanged at line 5 |
| `src/components/entity/WarningBadge.tsx` | WarningBadge component | ✓ VERIFIED | Exports default WarningBadge; imports Badge; color="var(--accent-amber)"; background="rgba(245, 158, 11, 0.12)"; all 7 LABEL entries; no className (no animation) |
| `src/app/company/[slug]/page.tsx` | Company page with warning badge integration | ✓ VERIFIED | Imports WarningBadge + getWarningHits + WarningHit; getWarningHits called at line 749; badge group rendered at lines 829-840 after RiskBadge |
| `src/app/vessel/[imo]/page.tsx` | Vessel page with warning badge integration | ✓ VERIFIED | Imports confirmed; getWarningHits at line 452; badge group at lines 527-538 |
| `src/app/terminal/[id]/page.tsx` | Terminal page with warning badge integration | ✓ VERIFIED | Imports confirmed; getWarningHits at line 372; badge group at lines 437-448 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lib/server/sync/regulatory-warnings.ts` | regulatory_warnings (table) | DELETE FROM + INSERT batch | ✓ WIRED | Line 337: `await client.query('DELETE FROM regulatory_warnings WHERE source = $1', [source])`. Lines 352-362: batch INSERT with ON CONFLICT DO UPDATE. |
| `src/lib/server/warning-lists.ts` | regulatory_warnings (table) | word_similarity fuzzy query | ✓ WIRED | Lines 36-47: `FROM regulatory_warnings WHERE word_similarity($1, normalized_name) >= 0.72` |
| `src/lib/server/sync/index.ts` | syncRegulatoryWarnings | import + runSync switch case | ✓ WIRED | Line 9: `import { syncRegulatoryWarnings } from './regulatory-warnings'`. Lines 77-88: switch case calls syncRegulatoryWarnings() |
| `src/app/company/[slug]/page.tsx` | getWarningHits() | import from '@/lib/server/warning-lists' | ✓ WIRED | Line 20: `import { getWarningHits } from '@/lib/server/warning-lists'`. Line 749: `await getWarningHits(company.name, 'company')` |
| `src/components/entity/WarningBadge.tsx` | src/components/ui/Badge.tsx | import Badge from '@/components/ui/Badge' | ✓ WIRED | Line 1: `import Badge from '@/components/ui/Badge'`. Badge used in JSX at line 27. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/app/company/[slug]/page.tsx` | warningHits | `getWarningHits(company.name, 'company')` → `db.query(word_similarity)` → `regulatory_warnings` table | Yes — DB query with parameterized input, returns rows | ✓ FLOWING |
| `src/app/vessel/[imo]/page.tsx` | warningHits | `getWarningHits(vessel.name, 'vessel')` → same query path | Yes — same query | ✓ FLOWING |
| `src/app/terminal/[id]/page.tsx` | warningHits | `getWarningHits(terminal.name, 'terminal')` → same query path | Yes — same query | ✓ FLOWING |
| `src/components/entity/WarningBadge.tsx` | label (from LABEL map) | Hardcoded map keyed by hit.source | Yes — static lookup from live hit object; entity_name never used in label | ✓ FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED — Server-dependent behavior (entity page rendering, DB queries) requires a running server + populated DB. Cannot test without starting Next.js dev server and triggering a sync.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DATASRC-01 | 02-01, 02-02 | System syncs FCA (UK) warning list and displays badge on entity pages when warning present | ✓ SATISFIED | scrapeFca() in regulatory-warnings.ts; LABEL['fca'] = 'FCA · UK' in WarningBadge.tsx; entity pages import and render badges |
| DATASRC-02 | 02-01, 02-02 | System syncs FINMA (Switzerland) and SFC (Hong Kong) and displays badges | ✓ SATISFIED | scrapeFinma() + scrapeSfc() present; LABEL map entries 'finma' and 'sfc' confirmed |
| DATASRC-03 | 02-01, 02-02 | System syncs MAS (Singapore) investor alert list and displays badge | ✓ SATISFIED | scrapeMas() present; LABEL['mas'] = 'MAS · SG' confirmed |
| DATASRC-04 | 02-01, 02-02 | System syncs DFSA (Dubai DIFC), SCA (UAE federal), and CMA Oman and displays badges | ✓ SATISFIED | scrapeDfsa() + scrapeSca() + scrapeCmaOman() present; LABEL entries for 'dfsa', 'sca', 'cma' confirmed |

All 4 requirements declared in both plan frontmatter SATISFIED. No orphaned requirements found — REQUIREMENTS.md traceability table maps DATASRC-01 through DATASRC-04 to Phase 2, all covered.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/app/api/admin/sync/route.ts` | 158 | `'warninglists'` not in legacy source check — falls through to `'all'`, triggering all syncs instead of warning lists only | ⚠️ Warning | Posting `{ source: 'warninglists' }` to `/api/admin/sync` runs ALL sync sources (ofac, fraud, legitdomains, warninglists) instead of just warning lists. Does not affect correctness or the "same schedule" criterion — warninglists IS included in all-source runs — but the targeted invocation path is broken. |

No stub patterns, TODO/FIXME markers, placeholder returns, or hardcoded empty data found in any phase 2 files.

### Human Verification Required

The following items require a running dev server with a test row in `regulatory_warnings`. The code paths are verified correct; only visual/browser confirmation is pending.

#### 1. Amber Badge Rendering

**Test:** Insert a test row into `regulatory_warnings`: `INSERT INTO regulatory_warnings (id, source, source_name, jurisdiction, entity_name, normalized_name, list_url, warning_type, synced_at) VALUES ('fca:test-company', 'fca', 'FCA (UK)', 'UK', 'Test Company', 'test company', 'https://register.fca.org.uk', 'unauthorized_firm', NOW());` Then navigate to a company page whose name fuzzy-matches 'Test Company'.
**Expected:** An amber "FCA · UK" badge appears in the sidebar below the RiskBadge.
**Why human:** Visual color and placement requires browser.

#### 2. No-glow Confirmation

**Test:** Inspect the badge element in DevTools.
**Expected:** No `animation` CSS property active; no `badge-glow-*` class. SanctionBadge above it does pulse; WarningBadge does not.
**Why human:** Animation absence requires visual/DevTools inspection.

#### 3. Multiple Sources Stack

**Test:** Insert two rows for `fca` and `mas` for the same entity name. Navigate to that entity page.
**Expected:** Two amber badges appear side-by-side: "FCA · UK" and "MAS · SG".
**Why human:** Layout stacking requires browser render.

#### 4. Tooltip Format

**Test:** Hover over a badge.
**Expected:** Native browser tooltip reads "FCA (UK) — Regulatory Warning List" (em dash U+2014, not a hyphen).
**Why human:** Tooltip requires browser hover.

#### 5. F1 Visibility (Unauthenticated)

**Test:** Open entity page in an incognito window (no session).
**Expected:** Amber badge is visible — not behind a blur overlay or ContentLock.
**Why human:** Auth state requires a browser session.

### Gaps Summary

No blocking gaps found. All automated must-haves pass.

One warning noted in the admin sync route: the `'warninglists'` source key is not explicitly handled in the POST route's source-specific dispatch logic (lines 158-160), so it falls through to `runSync('all')` rather than `runSync('warninglists')`. This does not block the phase goal — warning lists ARE synced as part of `runSync('all')` — but it means a targeted `POST /api/admin/sync { source: 'warninglists' }` will run all data source syncs instead of just the warning lists. This is a minor operational inefficiency, not a correctness failure.

Status is `human_needed` because visual/browser verification of amber badge rendering, tooltip text, animation absence, stacking layout, and F1 visibility cannot be confirmed programmatically.

---

_Verified: 2026-04-13_
_Verifier: Claude (gsd-verifier)_

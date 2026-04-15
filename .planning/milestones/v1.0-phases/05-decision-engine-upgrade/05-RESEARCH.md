# Phase 5: Decision Engine Upgrade - Research

**Researched:** 2026-04-14
**Domain:** Trade risk verdict engine, TypeScript type extension, React PDF, tooltip UI, PostgreSQL trigram name matching
**Confidence:** HIGH

## Summary

Phase 5 upgrades the existing trade risk engine from a flag list output to a structured `Safe / Review / Block` verdict with typed reason codes, data-source attribution, a 1-hop director/PSC sanctions check, and an updated PDF audit trail. Every piece of infrastructure this phase needs already exists: `runTradeRules()` and `overallRiskFromFlags()` in `trade-rules.ts`, `renderToBuffer` with `@react-pdf/renderer` 4.3.3, `pg_trgm` extension for trigram fuzzy matching, director data in `metadata_json.directors`, PSC data via `getPscSummary()`, and the `sanctions_entries` and `regulatory_warnings` tables. No new npm packages are required. No schema migrations are required for the `entities` table (JSONB `result_json` in `trade_sessions` is additive).

The work is entirely additive: new fields on existing interfaces, new constants, a new pre-check function in `trade-service.ts`, badge prop extension with tooltip behavior, and PDF section additions. TypeScript strict mode is already enforced and passing clean — every interface change must satisfy it.

**Primary recommendation:** Implement in strict dependency order — (1) extend types in `trade-rules.ts`, (2) implement director pre-check in `trade-service.ts`, (3) update UI in `TradeClient.tsx` and `SanctionBadge.tsx`, (4) update PDF template. This order avoids mid-flight type errors.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01: Verdict Mapping Logic (DECISION-02)**
- Add `verdict: 'safe' | 'review' | 'block'` to `TradeCheckResult`
- Keep `overallRisk: RiskLevel` unchanged — watchlist stores `lastOverallRisk`
- Mapping — hybrid rules:
  | Condition | Verdict |
  |-----------|---------|
  | Any flag with code `SANCTION_EXPOSURE` present | `block` (hard) |
  | Any flag with code `KNOWN_FRAUD_ALERT` present | `block` (hard) |
  | Any flag with code `DOMAIN_SPOOFING_RISK` present | `block` (hard) |
  | Any flag with severity `critical` (other codes) | `block` |
  | Any flag with severity `high` (no block-triggering flags) | `review` |
  | `RELATED_PARTY_RISK` flag present | `review` (not hard block) |
  | Only `medium` / `low` severity flags | `safe` |
  | Zero flags | `safe` |
- Verdict is a recommendation, not a lock
- New function `deriveVerdict(flags: TradeFlag[]): TradeVerdict` in `trade-rules.ts`
- Each `TradeFlag` must carry `dataSource: string` and `dataSourceSyncedAt: string | null`

**D-02: Risk Label Precision (DECISION-01)**
- `export_restricted` (BIS/ECFR) is skipped this phase
- `WarningBadge` — no changes needed
- `SanctionBadge` upgrade: when `sanction_status === 'listed'`, show specific list sources in tooltip
- Tooltip: desktop = hover, mobile = tap/click
- Lightweight custom tooltip component — no third-party library
- `SanctionBadge` gains optional `sources?: string[]` prop

**D-03: 1-hop Director/Shareholder Check (DECISION-05)**
- Check both `metadata_json.directors` AND `beneficialOwners` (PSC data)
- Check both `sanctions_entries` AND `regulatory_warnings` tables
- Fuzzy match via trigram similarity — higher threshold than entity search
- If nationality available on both sides, use as tiebreaker (not strict requirement)
- Result includes confidence level ("high" / "medium") and candidate match name in `evidence[]`
- Flag raised: `RELATED_PARTY_RISK`, severity `high`, target `'seller'`
- Evidence format: `"Director [Name] matches [List Name] entry '[Matched Name]' (confidence: [high|medium])"`
- Verdict impact: `review` (not block)
- Implementation: in `trade-service.ts` as pre-check before `runTradeRules()`

**D-04: PDF Audit Trail Update (DECISION-04)**
- Update existing `TradeReportDocument` in `src/lib/pdf/trade-report.tsx` — do not rebuild
- New content: (1) Verdict banner at top before existing risk summary, (2) data source + sync date per flag card, (3) Related Party Risk section at end
- PDF button text: change from "↓ Download PDF" to "Export Audit PDF"
- `TradeCheckResult` gains `verdict: TradeVerdict` field — PDF reads it

**D-05: Reason Code Human-Readable Explanations (DECISION-03)**
- Static lookup map: `FLAG_EXPLANATIONS: Record<FlagCode, { title: string; description: string; sourceHint: string }>`
- Placed in `trade-rules.ts`
- Used by trade result UI (flag card expanded view) and PDF template

### Claude's Discretion
- Exact wording of flag explanation text for each FlagCode
- Tooltip component implementation (CSS vs. small JS state — no third-party library)
- Exact trigram similarity threshold for director name matching
- Evidence string phrasing for RELATED_PARTY_RISK matches
- Whether `deriveVerdict()` is exported or internal to trade-rules.ts

### Deferred Ideas (OUT OF SCOPE)
- `export_restricted` (BIS/ECFR) label — Requires BIS Entity List sync (DATASRC-V2-01)
- Human review workflow — confirmation button on Block verdicts
- 2-hop UBO tracing — Only 1-hop directors/PSC in scope
- Verdict override / manual review state
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DECISION-01 | Risk labels distinguish `sanctioned` vs `warning_listed` with distinct badge color and tooltip naming source | SanctionBadge receives `sources?: string[]` prop; custom tooltip component; WarningBadge already complete |
| DECISION-02 | Trade risk check returns structured Safe/Review/Block verdict with explicit reason codes | `deriveVerdict()` function in trade-rules.ts; `TradeVerdict` type; `TradeFlag` gains `dataSource` and `dataSourceSyncedAt` |
| DECISION-03 | Each reason code maps to human-readable explanation and data source | `FLAG_EXPLANATIONS` constant in trade-rules.ts; TradeClient flag card expanded view |
| DECISION-04 | Compliance officer can export trade verdict as PDF audit trail | Extend `TradeReportDocument` with verdict banner, flag data-source attribution, related-party section |
| DECISION-05 | If any direct director or shareholder is sanctioned/warning-listed, raise `related_party_risk` flag | Pre-check function in trade-service.ts using pg_trgm on `sanctions_entries` and `regulatory_warnings` |
</phase_requirements>

## Standard Stack

### Core (all already installed — no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@react-pdf/renderer` | 4.3.3 | PDF generation | Already in use in `trade-report.tsx` [VERIFIED: npm list output] |
| `pg` (node-postgres) | existing | Raw SQL DB queries | Established pattern; ORM explicitly forbidden in CLAUDE.md |
| TypeScript | 5.9.3 | Strict type safety | Already enforced; `tsc --noEmit` passes clean [VERIFIED: type-check output] |
| Next.js | 15.3.1 | App Router framework | Existing stack [VERIFIED: npm list output] |
| React | 19.0.0 | UI rendering | Existing stack [VERIFIED: npm list output] |

### No New Packages

All capabilities needed for this phase already exist:
- Trigram matching: `pg_trgm` extension enabled since migration 001 [VERIFIED: migration 031 references it]
- PDF: `renderToBuffer` from `@react-pdf/renderer` already wired in `route.tsx`
- Tooltip: Custom CSS/JS component — consistent with no-third-party-library convention

**Installation:** None required.

## Architecture Patterns

### Recommended File Change Order

```
1. src/lib/server/trade-rules.ts   — type extension + new functions + constants
2. src/lib/server/trade-service.ts — director pre-check + wire verdict into result
3. src/app/api/trade/route.ts      — re-exports TradeCheckResult (unchanged if types update correctly)
4. src/components/entity/SanctionBadge.tsx  — sources prop + tooltip
5. src/app/trade/TradeClient.tsx   — verdict banner update + FLAG_LABEL additions + button text
6. src/lib/pdf/trade-report.tsx    — verdict banner + flag attribution + related-party section
```

### Pattern 1: Type Extension — `TradeVerdict` and enriched `TradeFlag`

**What:** Add `TradeVerdict = 'safe' | 'review' | 'block'` type alias. Add `dataSource: string` and `dataSourceSyncedAt: string | null` to `TradeFlag` interface. Add `verdict: TradeVerdict` to `TradeCheckResult`.

**When to use:** Additive — existing flag consumers (`FlagSection` in PDF, `ResultsView` in TradeClient) that don't read `dataSource` still work because they only read `code`, `severity`, `target`, `reason`, `evidence`.

**Example:**
```typescript
// Source: src/lib/server/trade-rules.ts (VERIFIED: existing file)
export type TradeVerdict = 'safe' | 'review' | 'block'

export interface TradeFlag {
  code: FlagCode
  severity: RiskLevel
  target: 'seller' | 'vessel' | 'trade'
  reason: string
  evidence: string[]
  dataSource: string          // NEW: e.g. "OFAC SDN", "regulatory_warnings (FCA)"
  dataSourceSyncedAt: string | null  // NEW: ISO timestamp or null
}
```

**CRITICAL:** All existing `flags.push({ ... })` calls in `runTradeRules()` must add `dataSource` and `dataSourceSyncedAt`. There are 17 rules, each push site needs updating. Missing fields cause TypeScript errors since the interface is strict.

### Pattern 2: `deriveVerdict()` Function

**What:** Pure function that maps flags to a `TradeVerdict`. Placed in `trade-rules.ts` after `overallRiskFromFlags()`.

**When to use:** Called in `trade-service.ts` after `runTradeRules()` returns.

```typescript
// Source: Derived from CONTEXT.md D-01 verdict table [CITED: 05-CONTEXT.md]
const HARD_BLOCK_CODES: ReadonlySet<FlagCode> = new Set([
  'SANCTION_EXPOSURE',
  'KNOWN_FRAUD_ALERT',
  'DOMAIN_SPOOFING_RISK',
])

export function deriveVerdict(flags: TradeFlag[]): TradeVerdict {
  if (flags.length === 0) return 'safe'
  for (const f of flags) {
    if (HARD_BLOCK_CODES.has(f.code)) return 'block'
  }
  for (const f of flags) {
    if (f.severity === 'critical') return 'block'
  }
  for (const f of flags) {
    if (f.severity === 'high') return 'review'
  }
  return 'safe'
}
```

Note: `RELATED_PARTY_RISK` has severity `'high'`, so it flows naturally to `review` without special-casing.

### Pattern 3: Director Pre-Check in `trade-service.ts`

**What:** New async function `checkRelatedPartyRisk()` that queries `sanctions_entries` and `regulatory_warnings` for director/PSC name matches via trigram similarity. Called before `runTradeRules()`.

**DB queries needed:**
- Directors: from `sellerFullEntity.directors` (already fetched via `getEntityByKey`) or from `metadata_json.directors` in the raw DB entity row
- PSC/beneficial owners: from `sellerBeneficialOwners` (already fetched via `sellerFullEntity.beneficialOwners`)
- Trigram match against `sanctions_entries.normalized_name` (has GIN trgm index)
- Trigram match against `regulatory_warnings.normalized_name` (has GIN trgm index)
- Fetch `last_updated` from `sanctions_entries` for `dataSourceSyncedAt`, `synced_at` from `regulatory_warnings`

**Name normalization:** Use the same `normalizeEntityName()` or equivalent — lowercase, strip punctuation. CJK transliteration is "where possible" (CONTEXT D-03) — implement basic latin-only normalization if transliteration is too complex.

**Threshold decision (Claude's Discretion):** Entity search uses `HAVING similarity > 0.45`. Director name matching should use a higher threshold to reduce false positives on common names. Recommend `0.60` as the base, with `'high'` confidence at `>= 0.75` and `'medium'` confidence at `0.60–0.74`. This is for the planner to finalize.

```typescript
// Source: pattern derived from existing searchEntities() SQL in repository.ts [VERIFIED: repository.ts]
// Simplified structure — planner will fill threshold values
const { rows } = await db.query<{
  entity_name: string
  source_name: string
  sim: number
  last_updated: string | null
}>(
  `SELECT entity_name, 'OFAC SDN' AS source_name,
          similarity(normalized_name, $1) AS sim,
          last_updated
   FROM sanctions_entries
   WHERE similarity(normalized_name, $1) > $2
   ORDER BY sim DESC LIMIT 3`,
  [normalizedDirectorName, threshold]
)
```

**Integration point:** The pre-check builds a `RELATED_PARTY_RISK` flag (or empty array) and prepends it to the flags array passed to `runTradeRules()`. This matches CONTEXT D-03: "inject resulting RELATED_PARTY_RISK flags into the flag array passed to `runTradeRules()`."

**Data availability caveat:** Director data is only available when `sellerDbMatch` resolves to a full entity with `metadata_json.directors` populated, OR when `sellerFullEntity` (fetched via `getEntityByKey` for CH entities) has directors. The pre-check must guard for null/empty before querying.

### Pattern 4: `FLAG_EXPLANATIONS` Constant

**What:** Static `Record<FlagCode, { title: string; description: string; sourceHint: string }>` in `trade-rules.ts`.

**When to use:** Read by TradeClient flag card (expanded view) and PDF template. Both receive the result from the API, so `FLAG_EXPLANATIONS` must be importable in both client and server contexts. Since `trade-rules.ts` is a pure logic file (no DB imports), it can be safely imported client-side.

```typescript
// Source: CONTEXT.md D-05 [CITED: 05-CONTEXT.md]
export const FLAG_EXPLANATIONS: Record<FlagCode, { title: string; description: string; sourceHint: string }> = {
  SANCTION_EXPOSURE: {
    title: 'Sanctions Exposure',
    description: 'The counterparty or vessel appears on an official trade sanctions list. Proceeding with a sanctioned entity may violate OFAC, EU, or UN regulations.',
    sourceHint: 'OFAC SDN / EU FSF / UN Consolidated List',
  },
  RELATED_PARTY_RISK: {
    title: 'Related Party Risk',
    description: 'A director or beneficial owner of the counterparty company appears to match a sanctions or regulatory warning list entry. Name matching requires human verification.',
    sourceHint: 'OFAC SDN / EU FSF / FCA / MAS / DFSA / SCA / CMA / FINMA / SFC',
  },
  // ... all 18 FlagCodes
}
```

**FlagCodes to cover:** `NO_REGISTRY_MATCH`, `SANCTION_EXPOSURE`, `LIMITED_BUSINESS_FOOTPRINT`, `GEO_MISMATCH`, `NO_RECENT_ACTIVITY`, `INCONSISTENT_TRADE_STORY`, `NEWLY_INCORPORATED_SELLER`, `VESSEL_FLAG_ROUTE_MISMATCH`, `MULTIPLE_OPERATOR_CHANGES`, `VESSEL_COMPLIANCE_RISK`, `OFFSHORE_HOLDING_STRUCTURE`, `PSC_OFFSHORE_CONTROL`, `SPARSE_REGISTRY_DATA`, `OFFSHORE_LOW_SUBSTANCE`, `KNOWN_FRAUD_ALERT`, `DOMAIN_SPOOFING_RISK`, `DOMAIN_WHOIS_RISK`, `RELATED_PARTY_RISK` = 18 entries total.

### Pattern 5: SanctionBadge Tooltip

**What:** Upgrade `SanctionBadge` to accept `sources?: string[]` and render a custom tooltip when `status === 'listed'` and sources are provided.

**Pattern:** `WarningBadge` uses `title=` (native browser tooltip — no JS). The upgrade requires JS-driven tooltip for mobile tap support. Since the project uses no UI libraries, this means a small React `useState` toggle.

**Implementation approach (Claude's Discretion — two valid options):**
- Option A: CSS-only absolute-positioned `::after` content — no JS, but limited mobile support
- Option B: `useState(false)` in `SanctionBadge` + `onMouseEnter`/`onMouseLeave`/`onClick` handlers — works on mobile tap, consistent with project's "no third-party" convention

Option B is recommended per CONTEXT D-02 ("lightweight custom tooltip component" with "JS-driven for mobile support").

```typescript
// Source: CONTEXT.md D-02 [CITED: 05-CONTEXT.md]
// Pattern structure — exact styling is Claude's Discretion
export default function SanctionBadge({ status, size = 'md', sources }: SanctionBadgeProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const { label, color, background } = CONFIG[status]
  const showTooltip = status === 'listed' && sources && sources.length > 0

  return (
    <span
      style={{ position: 'relative', display: 'inline-block' }}
      onMouseEnter={() => showTooltip && setTooltipOpen(true)}
      onMouseLeave={() => setTooltipOpen(false)}
      onClick={() => showTooltip && setTooltipOpen(v => !v)}
    >
      <Badge label={label} color={color} background={background} size={size}
        className={...}
      />
      {showTooltip && tooltipOpen && (
        <span style={{ position: 'absolute', top: '100%', ... }}>
          Sanctioned: {sources.join(', ')}
        </span>
      )}
    </span>
  )
}
```

**Call sites:** Company and vessel page components that render `SanctionBadge` must be updated to pass `sources={entity.sanctionSources}`. Need to verify where `SanctionBadge` is rendered — likely in entity page components.

### Pattern 6: Verdict Banner in `ResultBanner` (TradeClient.tsx)

**What:** Add a `Safe / Review / Block` verdict label to the existing `ResultBanner` component. Map: Block → critical colors, Review → high colors, Safe → low colors.

```typescript
// Source: CONTEXT.md "Specifics" section [CITED: 05-CONTEXT.md]
// Uses existing RISK_BG/RISK_BORDER/RISK_COLOR tokens from TradeClient.tsx
const VERDICT_RISK_MAP: Record<TradeVerdict, RiskLevel> = {
  block:  'critical',
  review: 'high',
  safe:   'low',
}
```

The `ResultBanner` already uses `overallRisk` for its background and border. The verdict is displayed as an additional label — the verdict banner sits alongside/inside the existing banner, not replacing it.

**FLAG_LABEL additions needed:** `TradeClient.tsx` currently has `FLAG_LABEL` mapping for older codes. Add entries for: `PSC_OFFSHORE_CONTROL`, `SPARSE_REGISTRY_DATA`, `OFFSHORE_LOW_SUBSTANCE`, `KNOWN_FRAUD_ALERT`, `DOMAIN_SPOOFING_RISK`, `DOMAIN_WHOIS_RISK`, `RELATED_PARTY_RISK`.

### Pattern 7: PDF Template Updates

**What:** Add three new sections to `TradeReportDocument` in `trade-report.tsx`.

1. **Verdict banner** — new `<VerdictBanner>` component placed before `<RiskBanner>`. Uses verdict colors (block=C.listed, review=C.warn, safe=C.clear).

2. **Flag data source attribution** — inside `FlagSection`, each `FlagCard` adds two new `<InfoRow>`-style rows:
   - `Source: {flag.dataSource}`
   - `Last synced: {flag.dataSourceSyncedAt ?? 'Unknown'}`

3. **Related party section** — `<RelatedPartySection>` renders flags where `f.code === 'RELATED_PARTY_RISK'`, showing evidence strings. Placed after `VesselSection` and before Disclaimer.

**`FLAG_LABEL` in trade-report.tsx:** The PDF has its own `FLAG_LABEL` constant (lines 167-174). Currently only has 6 entries. Must be extended to match TradeClient.tsx's full map plus new codes.

**UTC timestamp requirement (DECISION-04):** The PDF `ReportHeader` already calls `fmtDateTime()` which uses `toLocaleString` with timezone. For explicit UTC in the audit trail, use `new Date().toISOString()` + format as `{UTC ISO string}` or render `toLocaleString('en-US', { timeZone: 'UTC', ... })`.

### Anti-Patterns to Avoid

- **Adding `dataSource` to `TradeRuleInput`:** The data source is static per rule (each rule knows which source triggered it). It belongs in the flag push, not as input. Exception: the director pre-check flags do need the actual `synced_at` from the DB row.
- **Fetching `synced_at` for every flag independently:** Most flags can use a static string (e.g., `"OFAC SDN"` for `SANCTION_EXPOSURE`). Only the director pre-check queries live `synced_at`. The `dataSourceSyncedAt` on most flags will be `null` or a global sync timestamp from the sync log.
- **Rebuilding `TradeReportDocument`:** CONTEXT D-04 explicitly says "do not rebuild." Extend the existing structure.
- **Breaking the `overallRisk` field:** `lastOverallRisk` in the watchlist is stored as this field. The `verdict` field is additive. Do not replace or rename `overallRisk`.
- **Using ORM or external library for fuzzy matching:** Use raw `pg` query with `similarity()` function. ORM is forbidden per CLAUDE.md.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fuzzy name matching for directors | Custom edit-distance in TypeScript | PostgreSQL `similarity()` via `pg_trgm` (already enabled) | Battle-tested, indexed, handles unicode, already in use for entity search |
| PDF generation | Custom HTML-to-PDF or puppeteer | `@react-pdf/renderer` (already installed, `renderToBuffer` wired) | Established in codebase; adding puppeteer would bloat bundle |
| Tooltip | Third-party tooltip library (Tippy, Radix, Floating UI) | Custom `useState` toggle + absolute positioning | Project convention: no UI component libraries |
| Type-safe verdict constants | Inline string literals scattered | Union type `TradeVerdict = 'safe' \| 'review' \| 'block'` in `trade-rules.ts` | Co-located with FlagCode for single source of truth |

**Key insight:** Every non-trivial sub-problem in this phase has an existing solution in the codebase. The work is wiring, not inventing.

## Common Pitfalls

### Pitfall 1: `TradeFlag` Interface Extension Breaks 17 Push Sites
**What goes wrong:** Adding required fields `dataSource` and `dataSourceSyncedAt` to `TradeFlag` immediately causes TypeScript errors at all 17 `flags.push({...})` calls in `runTradeRules()`.
**Why it happens:** Strict TypeScript requires all interface fields at instantiation.
**How to avoid:** Update all push sites in the same commit as the interface change. Each rule knows its static data source (e.g., Rule 1 = `"OFAC SDN"` / `"EU FSF"`, Rule 2 = `"Company Registry"`, etc.). The `dataSourceSyncedAt` for static rules is `null` (sync timestamp not easily available at rule evaluation time without a DB query per rule, which would destroy performance).
**Warning signs:** `tsc --noEmit` failing with "Property 'dataSource' is missing" on multiple lines.

### Pitfall 2: Director Data Availability is Conditional
**What goes wrong:** `checkRelatedPartyRisk()` assumes `directors` and `beneficialOwners` are populated, but they are only available for CH/ACRA entities fetched via `getEntityByKey`. For `gleif:` or `oc:` entities, these fields are undefined.
**Why it happens:** `sellerFullEntity` is fetched via `getEntityByKey(sellerDbMatch.registrationNumber)` only when `registrationNumber` exists. If the seller has no `registrationNumber`, `sellerFullEntity` is null.
**How to avoid:** Guard: `if (!sellerFullEntity || (!directors?.length && !beneficialOwners?.length)) return []`. This is explicitly noted in CONTEXT code_context section.
**Warning signs:** Empty flags array when director check was expected to fire; null reference errors in `checkRelatedPartyRisk`.

### Pitfall 3: `RELATED_PARTY_RISK` Not in `FlagCode` Union
**What goes wrong:** The new flag code must be added to the `FlagCode` union type before it can be used in `flags.push({ code: 'RELATED_PARTY_RISK' })`.
**Why it happens:** TypeScript will reject the string literal if not in the union.
**How to avoid:** Add to the union in the same step as creating the `FLAG_EXPLANATIONS` entry for it.
**Warning signs:** TypeScript error "Type 'RELATED_PARTY_RISK' is not assignable to type FlagCode."

### Pitfall 4: PDF FLAG_LABEL Out of Sync with TradeClient FLAG_LABEL
**What goes wrong:** `trade-report.tsx` has its own `FLAG_LABEL` map (lines 167–174) with only 6 entries, separate from the 12+ entry map in `TradeClient.tsx`. New flag codes render as raw code strings in the PDF.
**Why it happens:** Two separate constants — one in the PDF template, one in the client component.
**How to avoid:** Update both `FLAG_LABEL` maps in the same plan. Consider sharing via a common `src/lib/flag-labels.ts` file (but this is Claude's Discretion — the simpler option is updating both in-place).
**Warning signs:** PDF shows "RELATED_PARTY_RISK" instead of "Related Party Risk" in flag cards.

### Pitfall 5: `SanctionBadge` Call Sites Need `sources` Prop
**What goes wrong:** Adding optional `sources?: string[]` to `SanctionBadge` doesn't break callers, but the tooltip never appears because call sites don't pass the prop.
**Why it happens:** Prop is optional; TypeScript doesn't force the update at call sites.
**How to avoid:** Grep all `SanctionBadge` usages in entity page components and confirm they can pass `sanctionSources` from the intelligence snapshot. The tooltip only activates when `sources.length > 0` and `status === 'listed'`.
**Warning signs:** Badge renders but no tooltip appears on sanctioned entities; `sources` is always undefined.

### Pitfall 6: Verdict Field Missing from Stored JSONB on Old Sessions
**What goes wrong:** PDF route fetches `result_json` from `trade_sessions` and passes it to `TradeReportDocument`. Old sessions lack `verdict` field; new template accesses `result.verdict` and gets `undefined`.
**Why it happens:** JSONB in `trade_sessions.result_json` is a snapshot at check time. Old sessions don't have `verdict`.
**How to avoid:** Make `verdict` optional in the PDF template (`result.verdict ?? 'safe'` as fallback) or guard the verdict banner render on `result.verdict != null`. CONTEXT notes this: "old rows simply lack the field."
**Warning signs:** Verdict banner renders "undefined" or crashes on old PDF downloads.

### Pitfall 7: Director Trigram Threshold Too Low Causes False Positives
**What goes wrong:** Common names like "JOHN SMITH" or "ZHANG WEI" match multiple sanctions entries at low threshold, generating spurious `RELATED_PARTY_RISK` flags.
**Why it happens:** Trigram similarity is a surface-similarity metric, not semantic. Common name components share many trigrams.
**How to avoid:** Use a threshold materially higher than entity search (0.45). Recommend 0.60 minimum, with nationality tiebreaker where available. The confidence label ("medium" vs "high") communicates uncertainty to compliance officers.
**Warning signs:** Director pre-check fires on every seller regardless of director names.

## Code Examples

### `deriveVerdict` Function Structure

```typescript
// Source: CONTEXT.md D-01 verdict table [CITED: 05-CONTEXT.md]
// File: src/lib/server/trade-rules.ts

export type TradeVerdict = 'safe' | 'review' | 'block'

const HARD_BLOCK_CODES: ReadonlySet<FlagCode> = new Set<FlagCode>([
  'SANCTION_EXPOSURE',
  'KNOWN_FRAUD_ALERT',
  'DOMAIN_SPOOFING_RISK',
])

export function deriveVerdict(flags: TradeFlag[]): TradeVerdict {
  if (flags.length === 0) return 'safe'
  // Hard blocks: specific codes always block regardless of severity
  if (flags.some(f => HARD_BLOCK_CODES.has(f.code))) return 'block'
  // Severity-based block (other critical flags)
  if (flags.some(f => f.severity === 'critical')) return 'block'
  // High severity (including RELATED_PARTY_RISK at severity 'high') → review
  if (flags.some(f => f.severity === 'high')) return 'review'
  return 'safe'
}
```

### Director Pre-Check Query Pattern

```typescript
// Source: based on existing searchEntities() SQL pattern [VERIFIED: repository.ts lines 401+]
// Uses pg_trgm similarity() — extension enabled since migration 001
// File: src/lib/server/trade-service.ts

async function checkRelatedPartyRisk(
  directors: Director[],
  beneficialOwners: BeneficialOwner[],
): Promise<TradeFlag[]> {
  const people = [
    ...directors.map(d => ({ name: d.name, nationality: d.nationality, role: d.role })),
    ...beneficialOwners.map(b => ({ name: b.name, nationality: b.nationality, role: 'PSC' })),
  ]
  if (people.length === 0) return []

  const flags: TradeFlag[] = []
  const HIGH_CONFIDENCE_THRESHOLD = 0.75
  const MEDIUM_CONFIDENCE_THRESHOLD = 0.60

  for (const person of people) {
    const normalized = person.name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim()
    if (!normalized || normalized.length < 3) continue

    // Check sanctions_entries
    const { rows: sanctionMatches } = await db.query<{
      entity_name: string; source: string; sim: number; last_updated: string | null
    }>(
      `SELECT entity_name, source, similarity(normalized_name, $1) AS sim, last_updated
       FROM sanctions_entries
       WHERE similarity(normalized_name, $1) >= $2
       ORDER BY sim DESC LIMIT 3`,
      [normalized, MEDIUM_CONFIDENCE_THRESHOLD]
    )

    // Check regulatory_warnings
    const { rows: warningMatches } = await db.query<{
      entity_name: string; source_name: string; sim: number; synced_at: string | null
    }>(
      `SELECT entity_name, source_name, similarity(normalized_name, $1) AS sim, synced_at
       FROM regulatory_warnings
       WHERE similarity(normalized_name, $1) >= $2
       ORDER BY sim DESC LIMIT 3`,
      [normalized, MEDIUM_CONFIDENCE_THRESHOLD]
    )

    const best = [...sanctionMatches, ...warningMatches].sort((a, b) =>
      (b as { sim: number }).sim - (a as { sim: number }).sim
    )[0]

    if (best) {
      const confidence = (best as { sim: number }).sim >= HIGH_CONFIDENCE_THRESHOLD ? 'high' : 'medium'
      const isSanction = 'source' in best
      const listName = isSanction ? `${(best as { source: string }).source.toUpperCase()} Sanctions` : (best as { source_name: string }).source_name
      const syncedAt = isSanction ? (best as { last_updated: string | null }).last_updated : (best as { synced_at: string | null }).synced_at

      flags.push({
        code: 'RELATED_PARTY_RISK',
        severity: 'high',
        target: 'seller',
        reason: `Director or beneficial owner of the counterparty appears to match a sanctions or regulatory warning list entry. Manual verification required.`,
        evidence: [
          `Director ${person.name} matches ${listName} entry '${best.entity_name}' (confidence: ${confidence})`,
        ],
        dataSource: listName,
        dataSourceSyncedAt: syncedAt ?? null,
      })
      break // One flag per seller is sufficient per Rule 12 precedent
    }
  }

  return flags
}
```

### PDF Verdict Banner Component

```typescript
// Source: based on existing RiskBanner pattern [VERIFIED: trade-report.tsx lines 221-230]
// File: src/lib/pdf/trade-report.tsx

const VERDICT_COLOR: Record<string, string> = {
  block:  C.listed,   // #ef4444
  review: C.warn,     // #f97316
  safe:   C.clear,    // #22c55e
}
const VERDICT_LABEL: Record<string, string> = {
  block:  'BLOCK',
  review: 'REVIEW REQUIRED',
  safe:   'SAFE TO PROCEED',
}

function VerdictBanner({ verdict }: { verdict: string }) {
  const color = VERDICT_COLOR[verdict] ?? C.textMuted
  return (
    <View style={[s.riskBanner, { backgroundColor: `${color}18`, border: `1 solid ${color}50` }]}>
      <Text style={[s.riskBannerLabel, { color }]}>Compliance Verdict</Text>
      <Text style={[s.riskBannerValue, { color }]}>{VERDICT_LABEL[verdict] ?? verdict.toUpperCase()}</Text>
      <Text style={[s.riskBannerSummary, { color: C.textSec }]}>
        This verdict is a compliance tool recommendation. Authorized compliance officers are responsible for final decisions.
      </Text>
    </View>
  )
}
```

### `TradeCheckResult` Interface Addition

```typescript
// Source: src/lib/server/trade-service.ts [VERIFIED: existing file]
// Add to TradeCheckResult interface:
export interface TradeCheckResult {
  id: string
  checkedAt: string
  input: { ... }  // unchanged
  seller: TradePartyResult
  vessel: TradeVesselResult
  port: TradePortResult | null
  flags: TradeFlag[]
  overallRisk: RiskLevel          // unchanged — watchlist reads this
  verdict: TradeVerdict           // NEW — Safe / Review / Block
  summary: string
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Risk level only (critical/high/medium/low) | Risk level + structured verdict (safe/review/block) | Phase 5 | Compliance officers get actionable recommendation, not just severity label |
| Flag list with reason text | Flag list + typed code + data source + sync timestamp | Phase 5 | Audit trail shows data provenance |
| Sanction badge with no source detail | Sanction badge with tooltip listing specific lists (OFAC SDN, EU FSF) | Phase 5 | Compliance officers can verify which list triggered the badge |
| PDF shows overall risk only | PDF shows verdict banner + per-flag data source + related-party section | Phase 5 | Document is a complete audit artifact |

**Deprecated/outdated in this phase:**
- `FLAG_LABEL` in `trade-report.tsx` only has 6 entries — stale, must be expanded to 18 entries
- `ResultBanner` in `TradeClient.tsx` uses `overallRisk` for headline text only — verdict label must be added
- PDF button text "↓ Download PDF" — changes to "Export Audit PDF" per CONTEXT D-04

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `sanctions_entries.last_updated` column is `TIMESTAMPTZ NOT NULL DEFAULT NOW()` — available for `dataSourceSyncedAt` on sanction-triggered flags | Director Pre-Check, Standard Stack | Low — verified in migration 003. Risk: column may not reflect actual sync time (it may be the row creation time, not the last sync). Alternative: join to `sanctions_sync_log` for the latest sync timestamp per source. |
| A2 | `SanctionBadge` call sites in entity pages currently have access to `sanctionSources` from the intelligence snapshot | SanctionBadge Pattern | Low — `TradePartyResult.sanctionSources` is already populated in trade-service.ts. On entity pages, `sanctionSources` depends on intelligence snapshot shape; grep needed to confirm. |
| A3 | Trigram similarity threshold of 0.60 is appropriate for director name matching | Director Pre-Check | Medium — this is a judgment call. Too low = false positives; too high = missed matches. The exact value is Claude's Discretion. |

## Open Questions

1. **`dataSourceSyncedAt` for static-rule flags (non-director)**
   - What we know: Rules 1–17 in `runTradeRules()` know their data source name statically (e.g., "OFAC SDN", "AIS Tracking System") but do not have the timestamp without a DB query.
   - What's unclear: Should `dataSourceSyncedAt` be fetched once per check (e.g., the latest `sanctions_sync_log.synced_at` for `source='ofac'`) and passed as a parameter, or left `null` for non-director flags?
   - Recommendation: Pass `null` for flags where the sync timestamp isn't naturally available. The planner can optionally fetch the latest `sanctions_sync_log` entry once at the top of `runTradeCheck()` and thread it through. This is a data quality improvement, not a blocking requirement.

2. **Where `SanctionBadge` with `sources` renders on entity pages**
   - What we know: `SanctionBadge` is used in entity page components (company/vessel pages). Need to verify how `sanctionSources` is surfaced from the intelligence snapshot.
   - What's unclear: Exact prop chain from intelligence API response to badge component.
   - Recommendation: Grep `SanctionBadge` usages as a Wave 0 task in the plan.

3. **Director name normalization for non-Latin scripts**
   - What we know: CONTEXT D-03 says "transliterate CJK where possible." There is no existing CJK transliteration utility in the codebase.
   - What's unclear: How to implement this without adding a new dependency.
   - Recommendation: Implement basic latin-only normalization (lowercase, strip punctuation). Add a comment that CJK transliteration is a future enhancement. The `pg_trgm` similarity will simply score lower for CJK names, which is acceptable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v24.11.1 | — |
| PostgreSQL + pg_trgm | Director name fuzzy matching | Yes (confirmed in migrations 001, 031) | 16 (per CLAUDE.md) | — |
| `@react-pdf/renderer` | PDF audit trail | Yes | 4.3.3 | — |
| TypeScript | Type enforcement | Yes | 5.9.3 | — |
| Next.js App Router | API routes, pages | Yes | 15.3.1 | — |

All dependencies available. No blocking gaps.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — no jest.config, vitest.config, pytest.ini found in project root |
| Config file | None — Wave 0 must install a framework |
| Quick run command | `npx tsc --noEmit` (type-check as proxy for correctness) |
| Full suite command | `npm run type-check && npm run lint` |

**Note:** REQUIREMENTS.md and OUT OF SCOPE table explicitly state: "Automated test suite — Not in scope for this milestone — explicit technical debt." The `nyquist_validation: true` config is overridden by this project-level explicit exclusion. Type-check and lint are the available automated validation tools.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DECISION-01 | SanctionBadge renders sources tooltip | manual-only | — | N/A |
| DECISION-02 | `deriveVerdict()` returns correct TradeVerdict | type-check + manual | `npm run type-check` | ❌ no unit test file |
| DECISION-02 | TradeCheckResult shape includes `verdict` field | type-check | `npm run type-check` | ✅ via tsc |
| DECISION-03 | `FLAG_EXPLANATIONS` covers all 18 FlagCodes | type-check | `npm run type-check` (Record<FlagCode, ...> enforces exhaustiveness) | ❌ Wave 0 gap |
| DECISION-04 | PDF renders without crash, verdict banner present | manual-only | — | N/A |
| DECISION-05 | RELATED_PARTY_RISK flag raised for matched directors | manual-only (requires DB) | — | N/A |

### Sampling Rate
- **Per task commit:** `npm run type-check`
- **Per wave merge:** `npm run type-check && npm run lint`
- **Phase gate:** TypeScript clean + lint clean + manual PDF download test before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] TypeScript exhaustiveness check for `FLAG_EXPLANATIONS` — the `Record<FlagCode, ...>` type enforces all codes are covered, but this is validated only at compile time. No new test file needed.
- [ ] No framework install needed — project explicitly defers automated testing to post-milestone.

*(Existing `npm run type-check` infrastructure covers all compile-time phase requirements.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not changed this phase |
| V3 Session Management | No | PDF route already uses existing session auth |
| V4 Access Control | Yes (PDF) | PDF endpoint already enforces Starter+ plan check — no change needed |
| V5 Input Validation | Yes (director names) | Director names from DB (not user input directly) — still normalize before SQL query parameter |
| V6 Cryptography | No | No cryptographic operations added |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection in trigram query | Tampering | Parameterized queries (already established pattern in repository.ts) |
| PDF generation with unsanitized content | Tampering | `@react-pdf/renderer` renders React elements, not raw HTML — XSS not applicable; content comes from DB, not user input |
| Unauthorized PDF access (old session IDs) | Elevation of Privilege | `WHERE id = $1 AND user_id = $2` in PDF route — already enforced |
| Verdict field tampering in stored JSON | Tampering | `verdict` is recomputed from flags at trade check time and stored. PDF reads from stored JSONB (immutable after write). No re-computation at PDF render time. |

## Sources

### Primary (HIGH confidence)
- [VERIFIED: src/lib/server/trade-rules.ts] — FlagCode union (17 codes), TradeFlag interface, runTradeRules(), overallRiskFromFlags(), generateSummary()
- [VERIFIED: src/lib/server/trade-service.ts] — TradeCheckResult, runTradeCheck(), director/PSC data flow, sanctions checks
- [VERIFIED: src/lib/pdf/trade-report.tsx] — TradeReportDocument, RiskBanner, FlagSection, existing FLAG_LABEL map (6 entries)
- [VERIFIED: src/app/trade/TradeClient.tsx] — ResultBanner, RISK_BG/RISK_BORDER/RISK_COLOR tokens, FLAG_LABEL (12 entries), PDF download link
- [VERIFIED: src/components/entity/SanctionBadge.tsx] — Current props interface (no sources), Badge primitive usage
- [VERIFIED: src/components/entity/WarningBadge.tsx] — native title= tooltip pattern, no className glow
- [VERIFIED: src/components/ui/Badge.tsx] — BadgeProps interface, inline-flex span pattern
- [VERIFIED: db/migrations/003_sanctions_cache.sql] — sanctions_entries schema (id, source, normalized_name, last_updated)
- [VERIFIED: db/migrations/031_regulatory_warnings.sql] — regulatory_warnings schema (source_name, normalized_name, synced_at, GIN trgm index)
- [VERIFIED: src/lib/types.ts] — Director, BeneficialOwner, Company, SanctionStatus, WarningHit types
- [VERIFIED: src/app/api/trade/[id]/report/route.tsx] — PDF endpoint, auth pattern, plan gating
- [VERIFIED: npm list output] — @react-pdf/renderer@4.3.3, Next.js 15.3.1, React 19.0.0, TypeScript 5.9.3, Node v24.11.1
- [VERIFIED: npm run type-check] — TypeScript currently passes clean (zero errors)
- [VERIFIED: .planning/config.json] — nyquist_validation: true, commit_docs: true

### Secondary (MEDIUM confidence)
- [CITED: 05-CONTEXT.md] — All implementation decisions D-01 through D-05, deferred items

### Tertiary (LOW confidence)
- None in this research — all claims based on verified codebase inspection or cited context decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified via npm list; all key files read in full
- Architecture: HIGH — derived directly from verified codebase structure and locked context decisions
- Pitfalls: HIGH — derived from direct reading of the 17 flag push sites, interface shape, PDF template, and conditional data availability
- Trigram threshold: LOW — judgment call, Claude's Discretion, not empirically validated

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable tech stack; 30-day window appropriate)

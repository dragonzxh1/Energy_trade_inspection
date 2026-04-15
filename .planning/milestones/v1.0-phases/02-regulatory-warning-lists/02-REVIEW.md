---
phase: 02-regulatory-warning-lists
reviewed: 2026-04-13T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - db/migrations/031_regulatory_warnings.sql
  - src/lib/server/sync/regulatory-warnings.ts
  - src/lib/server/warning-lists.ts
  - src/lib/types.ts
  - src/lib/server/sync/index.ts
  - src/components/entity/WarningBadge.tsx
  - src/app/company/[slug]/page.tsx
  - src/app/vessel/[imo]/page.tsx
  - src/app/terminal/[id]/page.tsx
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-13
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This phase adds regulatory warning list support: a migration creates the `regulatory_warnings` table, a sync module scrapes 7 financial regulators (FCA, FINMA, SFC, MAS, DFSA, SCA, CMA Oman), a query module performs fuzzy name matching against the table, and all three entity page server components (company, vessel, terminal) are wired to display `WarningBadge` items.

The overall design is sound. The migration schema is well-structured, the transaction logic in the sync module is correct (BEGIN → DELETE → INSERT), type definitions are clean, and the badge component renders correctly. Three warnings were found: a normalize asymmetry that will produce false negatives in match queries, an inconsistent async pattern on the terminal page, and a silent error swallow in the FCA CSV fallback path. Three info items cover a dead prop, an unbounded query result set, and a slug-based primary key collision risk.

---

## Warnings

### WR-01: Normalize asymmetry — query uses stripGeneric=false, stored data uses stripGeneric=true

**File:** `src/lib/server/warning-lists.ts:33`

**Issue:** The query normalizes the input name with `normalizeEntityName(entityName, false)` — generic legal suffixes like "Ltd", "Inc", "Corp" are preserved. The stored `normalized_name` column in `regulatory_warnings` is populated via `makeEntry` with `normalizeEntityName(entity_name, true)` — generic suffixes are stripped. This asymmetry means a search for "BP Trading Ltd" produces a query token set of `["bp", "trading", "ltd"]`, while the stored entry contains `["bp", "trading"]`. The `word_similarity()` function measures the fraction of query trigrams that appear in the document string. When the query has a suffix token ("ltd") that is absent from the stored string, similarity decreases — potentially below the 0.72 threshold — causing genuine matches to be missed (false negatives).

The comment on line 32 says `stripGeneric=false` is used to "preserve intent", but the effect is the opposite: it introduces tokens that are absent from the reference data and lowers scores against it.

**Fix:** Align the query normalization with the stored normalization direction:

```typescript
// src/lib/server/warning-lists.ts line 33 — change:
const normalizedQuery = normalizeEntityName(entityName, false)

// To:
const normalizedQuery = normalizeEntityName(entityName, true)
```

---

### WR-02: Terminal page — getWarningHits awaited sequentially; inconsistent with company/vessel pages

**File:** `src/app/terminal/[id]/page.tsx:366-372`

**Issue:** On the terminal page, the watchlist check and the warning hits fetch are two sequential awaits:

```typescript
// lines 366-370
const isWatching =
  !!session?.user &&
  (plan === 'professional' || plan === 'enterprise')
    ? await getEntityWatchState(session.user.id, terminal.id)
    : false

// line 372
const warningHits: WarningHit[] = await getWarningHits(terminal.name, 'terminal')
```

Both `getEntityWatchState` and `getWarningHits` hit the database independently. They are not parallelized, so their round-trip latencies add in series. The company page (line 740) and vessel page (line 443) both run their equivalent calls inside a `Promise.all`, which runs them concurrently. The terminal page's pattern is inconsistent and slower.

Additionally, if `getEntityWatchState` throws on the terminal page, it propagates unhandled. The inline conditional `await` pattern is also harder to extend when a third async operation is added later.

**Fix:** Align with the company/vessel pattern by using `Promise.all`:

```typescript
const [watchState, warningHits] = await Promise.all([
  session?.user && (plan === 'professional' || plan === 'enterprise')
    ? getEntityWatchState(session.user.id, terminal.id)
    : Promise.resolve(false),
  getWarningHits(terminal.name, 'terminal'),
])
const isWatching = watchState as boolean
```

---

### WR-03: FCA scraper silently discards the CSV error before attempting HTML fallback

**File:** `src/lib/server/sync/regulatory-warnings.ts:118-129`

**Issue:** The `catch` block in `scrapeFca` swallows the original CSV fetch error before attempting the HTML fallback. If the HTML fallback also fails, the rethrown error contains only the HTML failure reason; the CSV error is lost. More problematically, if the HTML fallback succeeds but produces zero rows (because the DOM structure changed), `scrapeFca` returns an empty array with no error — `syncSource` logs 0 records with `status: 'success'`, and the FCA source is silently wiped from the database.

```typescript
// lines 118-129
} catch {
  // no reference to the caught error — it is discarded
  const html = await fetchHtml(LIST_URL)
  // if this succeeds but returns 0 rows → silent empty result
}
```

**Fix:** Capture the CSV error and propagate it if both paths fail or produce empty results:

```typescript
} catch (csvError) {
  console.warn('[fca] CSV fetch failed, trying HTML fallback:', String(csvError))
  const html = await fetchHtml(LIST_URL)  // allowed to throw — caller handles it
  const $ = cheerioLoad(html)
  $('table tr td:first-child').each((_, el) => {
    const name = $(el).text().trim()
    if (name && name.length >= 2 && !seen.has(name) && !/^(firm name|name)$/i.test(name)) {
      seen.add(name)
      entries.push(makeEntry('fca', 'FCA (UK)', 'UK', LIST_URL, name, 'unauthorized_firm'))
    }
  })
  // If the HTML fallback also returned nothing, surface the original failure
  if (entries.length === 0) {
    throw new Error(`FCA: CSV failed (${String(csvError)}) and HTML fallback returned 0 entries`)
  }
}
```

---

## Info

### IN-01: WarningBadge — `jurisdiction` prop is declared and received but never used

**File:** `src/components/entity/WarningBadge.tsx:6,21`

**Issue:** The `jurisdiction` prop is part of the `WarningBadgeProps` interface and all three call sites pass it, but the component immediately discards it via the `_jurisdiction` alias:

```typescript
// line 21
export default function WarningBadge({ source, sourceName, jurisdiction: _jurisdiction, size = 'md' }: WarningBadgeProps) {
```

The badge label and tooltip are derived entirely from `source` and `sourceName`. The `_` prefix is a TypeScript/JS convention for intentionally unused parameters, but it leaves callers required to provide a value that has no effect. All three entity pages pass the `jurisdiction` field from the `WarningHit` data, so there is no runtime risk — but the prop is dead API surface.

**Fix:** Either remove the prop from the interface and all call sites, or add a comment documenting it as reserved for future use:

```typescript
// Option A: remove dead prop from interface
interface WarningBadgeProps {
  source: string
  sourceName: string
  size?: 'sm' | 'md'
}

// Option B: document intent if this is intentional
interface WarningBadgeProps {
  source: string
  sourceName: string
  jurisdiction: string  // Reserved: may be used for Phase 3 per-jurisdiction filtering
  size?: 'sm' | 'md'
}
```

---

### IN-02: getWarningHits query has no LIMIT — result set is unbounded before deduplication

**File:** `src/lib/server/warning-lists.ts:36-49`

**Issue:** The SQL query in `getWarningHits` selects all rows from `regulatory_warnings` that pass the similarity threshold, with no `LIMIT`. Post-query deduplication reduces the returned TypeScript array to at most 7 elements (one per regulator source), but the database must still materialize and sort all matching rows before the result is returned to the application layer. For short or generic entity names that produce high-similarity hits across many entries, this could be a large, unbounded sort.

```sql
WHERE word_similarity($1, normalized_name) >= 0.72
ORDER BY similarity DESC
-- no LIMIT
```

**Fix:** Add a `LIMIT` that is generous relative to the maximum expected matches (7 sources × a few high-scoring entries each) but prevents runaway result sets:

```sql
WHERE word_similarity($1, normalized_name) >= 0.72
ORDER BY similarity DESC
LIMIT 50
```

---

### IN-03: Slug-based primary key risks silent collision between distinct entity names

**File:** `src/lib/server/sync/regulatory-warnings.ts:81`

**Issue:** The primary key for each warning entry is `"${source}:${slugify(entity_name)}"`. The `slugify` function lowercases, collapses non-alphanumeric sequences to `-`, and truncates to 80 characters. Distinct entity names can produce identical slugs:

- `"ABC-Trading"` and `"ABC Trading"` both become `fca:abc-trading`
- Two entity names that differ only after character 80 both produce the same truncated key

The per-scraper `seen` Set (e.g., line 103) deduplicates by the original `entity_name`, so exact-name duplicates are prevented. However, two distinct names with the same slug are not caught by `seen`. When both are in the same batch, the second `INSERT ... ON CONFLICT DO UPDATE` silently overwrites the first. The winner is determined by insertion order within the batch — the `entity_name` stored in the database reflects only the last entry written for that slug.

This is a latent data integrity risk. It will surface silently in production when two differently-named entities on the same regulator's list happen to slugify to the same key.

**Fix:** Use a collision-resistant hash instead of a slug for the primary key:

```typescript
import { createHash } from 'crypto'

function makeId(source: string, entityName: string): string {
  // Deterministic, collision-resistant: SHA-1 of the exact entity name
  const hash = createHash('sha1').update(`${source}:${entityName}`).digest('hex').slice(0, 16)
  return `${source}:${hash}`
}

// In makeEntry, replace:
id: `${source}:${slugify(entity_name)}`,
// With:
id: makeId(source, entity_name),
```

The human-readable `entity_name` column is already stored for display — the `id` only needs to be stable and unique, not readable.

---

_Reviewed: 2026-04-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---
phase: 09-data-enrichment-foundations
reviewed: 2026-04-16T10:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - db/migrations/036_icij_sanctions_linkage.sql
  - scripts/sync-icij-offshore.mjs
  - src/app/company/[slug]/page.tsx
  - src/app/vessel/[imo]/page.tsx
  - src/components/entity/FraudAlertsPanel.tsx
  - src/lib/server/repository.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-04-16T10:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 9 adds ICIJ↔sanctions data linkage (migration 036, sync script update) and a FraudAlertsPanel component for company and vessel detail pages. The SQL queries in `repository.ts` are consistently parameterized — no SQL injection risk. The React components render database values as text content (not `innerHTML`), which is safe by default in JSX.

The main findings are:

1. **Critical:** `scam_url` from the database is used directly as an `href` without protocol validation, allowing a `javascript:` URL stored in the DB to execute as XSS.
2. **Warning:** `upsertBatch` silently drops `source_url` on every sync run — the column is built by `mapRow` but not included in the INSERT statement, so the field is always NULL in the DB despite being populated at the application layer.
3. **Warning:** `matchSanctions()` runs a full-table correlated subquery that will be extremely slow on a large ICIJ dataset (potentially millions of rows × sanctions entries). There is no index on `icij_entities.name` for `word_similarity` lookups.
4. **Warning:** `getVesselFraudAlerts` issues one DB query per operator/manager name in a loop. With the current schema this is at most two queries, but the pattern is fragile — if `normalizedNames` ever grows, it silently becomes an N+1.
5. **Info:** The `matchSanctions()` UPDATE updates every row (including those with no name match), resetting `is_sanctioned = FALSE` on all rows. This is intentional but costs significant I/O on large re-imports.
6. **Info:** `loadEnv()` in the sync script does not strip surrounding quotes from values (e.g. `DATABASE_URL="postgres://..."` will include the literal quote characters).
7. **Info:** `FraudAlertRow.source_url` is fetched by both `getCompanyFraudAlerts` and `getVesselFraudAlerts` but is never consumed by `FraudAlertsPanel`.

---

## Critical Issues

### CR-01: Unvalidated `javascript:` URL in scam_url anchor

**File:** `src/components/entity/FraudAlertsPanel.tsx:132`

**Issue:** `alert.scam_url` is passed directly to `href` without protocol validation. If a `javascript:` URL is stored in the `fraud_alerts.scam_url` column — either through a compromised scraping source or a direct DB write — it will execute JavaScript in the user's browser when clicked. The fraud-alerts sync script validates `startsWith('http')` at write-time (line 344 of `fraud-alerts.ts`), but this is not the only path into the DB, and relying on ingestion-time sanitization without rendering-time validation is a defense-in-depth failure.

React does not automatically strip `javascript:` from `href` attributes the way it does from `src`. An authenticated paid user who clicks the "Fake site" link would trigger execution.

**Fix:**
```tsx
// Add a helper:
function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// In the render:
{alert.scam_url && isSafeUrl(alert.scam_url) && (
  <p style={{ fontSize: '11px', marginTop: '4px' }}>
    <span style={{ color: 'var(--text-muted)' }}>Fake site: </span>
    <a
      href={alert.scam_url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: 'var(--accent-primary)', textDecoration: 'none' }}
    >
      {alert.scam_url}
    </a>
  </p>
)}
```

---

## Warnings

### WR-01: `source_url` silently dropped on every sync — field always NULL

**File:** `scripts/sync-icij-offshore.mjs:199–226`

**Issue:** `mapRow()` computes `source_url` (line 185) and includes it in the returned object, but `upsertBatch` pushes only 11 values per row and its INSERT statement lists only 11 columns — `source_url` is absent from both. The `ON CONFLICT DO UPDATE` also does not set `source_url`. As a result, every ICIJ entity's `source_url` column stays NULL in the database, making the ICIJ profile links (rendered in `OffshoreLeaksPanel`) always empty.

**Fix:** Add `source_url` to the INSERT column list, the value push, and the `ON CONFLICT` update:

```javascript
// In upsertBatch, change the multiplier:
const b = i * 12  // was 11

vals.push(
  r.node_id, r.name, r.dataset, r.entity_type,
  r.countries, r.jurisdiction, r.status,
  r.incorporation_date, r.inactivation_date,
  r.struck_off_date, r.address, r.source_url  // added
)
return `($${b+1},...,$${b+12})`  // 12 placeholders

// INSERT columns:
(node_id, name, dataset, entity_type, countries, jurisdiction, status,
 incorporation_date, inactivation_date, struck_off_date, address, source_url)

// ON CONFLICT add:
source_url = EXCLUDED.source_url,
```

### WR-02: `matchSanctions()` full-table correlated subquery — O(n × m) without suitable index

**File:** `scripts/sync-icij-offshore.mjs:397–420`

**Issue:** The UPDATE in `matchSanctions()` uses a correlated subquery that, for every row in `icij_entities`, scans `sanctions_entries` with `word_similarity(lower(ie2.name), se.search_text) > 0.72`. The `idx_os_search` GIN index on `sanctions_entries.search_text` supports `%` (trigram) operators but `word_similarity` requires a `gin_trgm_ops` index on the *left* operand (`lower(ie2.name)`) to be used efficiently — which does not exist on `icij_entities.name` for this direction of comparison. With hundreds of thousands of ICIJ rows and tens of thousands of sanctions entries, this query can take hours and holds a connection for the entire duration.

**Fix:** Rewrite as a single set-based UPDATE using a lateral join, which lets PostgreSQL use the GIN index on `search_text` for each ICIJ name:

```sql
UPDATE icij_entities ie
SET
  is_sanctioned   = (m.matched_name IS NOT NULL),
  sanctions_match = m.matched_name
FROM icij_entities ie2
CROSS JOIN LATERAL (
  SELECT se.name AS matched_name
  FROM sanctions_entries se
  WHERE se.sanctions IS NOT NULL
    AND se.search_text % lower(ie2.name)   -- uses GIN idx_os_search
    AND word_similarity(lower(ie2.name), se.search_text) > 0.72
  ORDER BY word_similarity(lower(ie2.name), se.search_text) DESC
  LIMIT 1
) m
WHERE ie.node_id = ie2.node_id
```

The `%` pre-filter on the indexed column narrows candidates before the `word_similarity` threshold check, which is the standard PostgreSQL pattern for fuzzy searches.

### WR-03: `getVesselFraudAlerts` issues DB queries inside a loop

**File:** `src/lib/server/repository.ts:1578–1602`

**Issue:** `getVesselFraudAlerts` iterates `normalizedNames` and executes a separate DB query per name. Currently `names` can be at most 2 elements (operator + manager), so this is at most 2 sequential queries. However, the function signature accepts an open-ended array path (the `manager` parameter exists for future Phase 11 extension per the docstring). If the pattern is copied or extended, each additional name adds a serial round-trip. More concretely, the two queries are issued sequentially rather than in parallel, adding unnecessary latency on each vessel page load for paid users.

**Fix:** Issue queries in parallel with `Promise.all`, or rewrite as a single query using `unnest` to pass all names at once:

```typescript
// Option A: parallel (minimal change)
const queryResults = await Promise.all(
  normalizedNames.map((normalized) =>
    db.query<FraudAlertRow & { sim: number }>(
      `SELECT ... FROM fraud_alerts WHERE ... LIMIT 50`,
      [normalized]
    )
  )
)
// then flatten and deduplicate as before

// Option B: single query (preferred)
const { rows } = await db.query<FraudAlertRow & { sim: number }>(
  `SELECT DISTINCT ON (source, company_name)
     source, source_name, source_url, company_name,
     list_type, fraud_type, description, scam_url, synced_at,
     GREATEST(
       MAX(similarity(normalized_name, n)),
       MAX(word_similarity(n, normalized_name))
     ) AS sim
   FROM fraud_alerts
   CROSS JOIN unnest($1::text[]) AS n
   WHERE normalized_name % n OR n %> normalized_name
   GROUP BY source, source_name, source_url, company_name,
            list_type, fraud_type, description, scam_url, synced_at
   ORDER BY source, company_name,
            CASE list_type WHEN 'blacklist' THEN 0 ELSE 1 END,
            synced_at DESC`,
  [normalizedNames]
)
```

---

## Info

### IN-01: `matchSanctions()` resets `is_sanctioned` on all rows, not just updated ones

**File:** `scripts/sync-icij-offshore.mjs:397–420`

**Issue:** The UPDATE joins every `icij_entities` row to the derived table `m` (which includes all rows, not just those with a match). When `matched_name IS NULL`, `is_sanctioned` is set to `FALSE`. This is logically correct for a full re-match, but it means rows where `is_sanctioned` was previously `TRUE` due to a manual override or earlier state get cleared. This is presumably intentional, but the comment only says "full re-match" — if the sanctions DB has a gap (e.g. partial sync), this silently clears all flags. A note in the code would help future maintainers.

### IN-02: `loadEnv()` does not strip surrounding quotes from `.env.local` values

**File:** `scripts/sync-icij-offshore.mjs:89–91`

**Issue:** The regex `^([A-Z_]+)=(.+)$` captures everything after `=`. If `.env.local` contains `DATABASE_URL="postgres://..."` (with surrounding double-quotes, which is common when generated by tools), the parsed value will include the literal `"` characters, causing the `pg.Pool` connection to fail with a cryptic error. The standard dotenv library strips surrounding quotes; this hand-rolled parser does not.

**Fix:**
```javascript
let val = m[2].trim()
if ((val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))) {
  val = val.slice(1, -1)
}
if (!process.env[m[1]]) process.env[m[1]] = val
```

### IN-03: `FraudAlertRow.source_url` is fetched but never consumed by the component

**File:** `src/lib/server/repository.ts:1510`, `src/components/entity/FraudAlertsPanel.tsx`

**Issue:** Both `getCompanyFraudAlerts` and `getVesselFraudAlerts` SELECT `source_url` from `fraud_alerts` and expose it in the `FraudAlertRow` type, but `FraudAlertsPanel` never renders it. The field occupies space in the query result and the TypeScript interface without being used. This is a minor dead-field issue; the `source_url` presumably would be used to link to the source blacklist page, which would be a useful UI addition, but for now it is dead data.

**Fix:** Either render `source_url` in the panel (e.g. as a "Source" link next to the source badge), or remove it from the SELECT and the `FraudAlertRow` interface until it is needed.

---

_Reviewed: 2026-04-16T10:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

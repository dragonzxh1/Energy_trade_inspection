/**
 * Regulatory Warning List query module.
 *
 * Provides fuzzy entity matching against the regulatory_warnings table.
 * Called by entity page server components (company, vessel, terminal).
 *
 * Matching uses PostgreSQL word_similarity() with threshold 0.72 —
 * same threshold as sanctions_entries fuzzy matching. Regulators list
 * exact legal names so false positives should be rare at this threshold.
 */

import { db } from '@/lib/server/db'
import { normalizeEntityName } from '@/lib/server/normalize'
import type { WarningHit } from '@/lib/types'

export type { WarningHit }

/**
 * Returns all regulatory warning list entries that fuzzy-match the given entity name.
 *
 * @param entityName - The entity's display name (will be normalized for matching)
 * @param _entityType - Unused in Phase 2; reserved for future source filtering by entity type
 * @returns Array of WarningHit objects, deduplicated by source (one hit per regulator)
 */
export async function getWarningHits(
  entityName: string,
  _entityType?: 'company' | 'vessel' | 'terminal'
): Promise<WarningHit[]> {
  if (!entityName || entityName.trim().length < 2) return []

  // Normalize the query name without stripping generic words (stripGeneric=false)
  // This preserves intent: "BP Trading" should still match "bp trading"
  const normalizedQuery = normalizeEntityName(entityName, false)
  if (!normalizedQuery || normalizedQuery.trim().length < 2) return []

  const { rows } = await db.query<WarningHit & { similarity: number }>(
    `SELECT
       source,
       source_name,
       jurisdiction,
       entity_name,
       list_url,
       warning_type,
       word_similarity($1, normalized_name) AS similarity
     FROM regulatory_warnings
     WHERE word_similarity($1, normalized_name) >= 0.72
     ORDER BY similarity DESC`,
    [normalizedQuery]
  )

  // Deduplicate by source: keep the highest-similarity hit per regulator
  const bySource = new Map<string, WarningHit>()
  for (const row of rows) {
    if (!bySource.has(row.source)) {
      bySource.set(row.source, {
        source: row.source,
        source_name: row.source_name,
        jurisdiction: row.jurisdiction,
        entity_name: row.entity_name,
        list_url: row.list_url,
        warning_type: row.warning_type,
      })
    }
  }

  return Array.from(bySource.values())
}

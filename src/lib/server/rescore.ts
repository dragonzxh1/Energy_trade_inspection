/**
 * Orchestrates authenticity re-scoring for a single entity.
 *
 * Reads from ais_cache and intelligence_cache, calls computeScore(),
 * and writes authenticity_score / risk_level / score_breakdown_json back to entities.
 *
 * Safe for fire-and-forget usage; it never throws.
 */

import { db } from './db'
import { computeScore, type IntelligenceSnapshot } from './scoring'
import type { VesselAisData } from '@/lib/ais-types'

// 鈹€鈹€ Cache readers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

async function getAisCache(imo: string): Promise<VesselAisData | null> {
  try {
    const { rows } = await db.query<{ data_json: unknown }>(
      `SELECT data_json FROM ais_cache WHERE imo = $1 LIMIT 1`,
      [imo],
    )
    return (rows[0]?.data_json as VesselAisData) ?? null
  } catch {
    return null
  }
}

async function getIntelligenceCache(
  entityType: string,
  entityKey: string,
): Promise<IntelligenceSnapshot | null> {
  try {
    const { rows } = await db.query<{ data_json: unknown }>(
      `SELECT data_json FROM intelligence_cache
       WHERE entity_type = $1 AND entity_key = $2 LIMIT 1`,
      [entityType, entityKey],
    )
    return (rows[0]?.data_json as IntelligenceSnapshot) ?? null
  } catch {
    return null
  }
}

// 鈹€鈹€ Main entry 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

interface EntityMinimal {
  id:                  string
  entity_type:         'company' | 'vessel' | 'terminal'
  sanction_status:     'not_listed' | 'listed' | 'unknown'
  country:             string
  imo:                 string | null
  slug:                string | null
  registration_number: string | null
}

export async function rescoreEntity(entityId: string): Promise<void> {
  try {
    // 1. Load entity basics
    const { rows } = await db.query<EntityMinimal>(
      `SELECT id, entity_type, sanction_status, country, imo, slug, registration_number
         FROM entities WHERE id = $1 LIMIT 1`,
      [entityId],
    )
    if (!rows[0]) return
    const e = rows[0]

    // 2. Gather available data
    const aisData = (e.entity_type === 'vessel' && e.imo)
      ? await getAisCache(e.imo)
      : null

    // Intelligence is keyed by IMO for vessels, slug/id for others
    const intelKey = e.entity_type === 'vessel'
      ? (e.imo ?? e.id)
      : (e.slug ?? e.id)
    const intelligence = await getIntelligenceCache(e.entity_type, intelKey)

    // 3. Compute new score
    const result = computeScore({
      entityType:         e.entity_type,
      sanctionStatus:     e.sanction_status,
      country:            e.country,
      registrationNumber: e.registration_number,
      imo:                e.imo,
      aisData,
      intelligence,
    })

    // 4. Persist
    await db.query(
      `UPDATE entities
          SET authenticity_score   = $1,
              risk_level           = $2,
              score_breakdown_json = $3,
              last_verified        = NOW(),
              updated_at           = NOW()
        WHERE id = $4`,
      [result.total, result.riskLevel, JSON.stringify(result.breakdown), entityId],
    )

    console.log(
      `[rescore] ${e.entity_type} ${entityId}: score=${result.total} risk=${result.riskLevel}`,
    )
  } catch (err) {
    console.error(
      '[rescore] failed for', entityId,
      err instanceof Error ? err.message : err,
    )
  }
}


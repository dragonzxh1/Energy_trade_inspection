/**
 * GET /api/ais/vessel/[imo]/draft-check?locode=XXXX
 *
 * Check whether a vessel (identified by IMO) can physically berth at a given port.
 *
 * Draught source priority:
 *   1. Live AIS cache (`ais_cache`) for the most recent position
 *   2. Vessel metadata stored in entities table (static fallback)
 *
 * Returns DraftRiskResult: canBerth, margin, STS zone flag, and a human-readable warning.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { checkDraftRisk, getEntityByKey } from '@/lib/server/repository'
import type { DraftRiskResult } from '@/lib/server/repository'
import type { VesselAisData } from '@/lib/ais-types'
import type { Vessel } from '@/lib/types'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ imo: string }> },
) {
  const { imo } = await params
  if (!/^\d{7}$/.test(imo)) {
    return NextResponse.json({ error: 'Invalid IMO number.' }, { status: 400 })
  }

  const locode = req.nextUrl.searchParams.get('locode')?.trim().toUpperCase()
  if (!locode || !/^[A-Z]{2}[A-Z0-9]{3}$/.test(locode)) {
    return NextResponse.json(
      { error: 'Query param "locode" is required (e.g. SGSIN, CNSHA).' },
      { status: 400 }
    )
  }

  // Resolve draught.

  // 1. Try AIS cache first because it best reflects the current load.
  let vesselDraftM: number | null = null
  try {
    const { rows } = await db.query<{ data_json: VesselAisData }>(
      `SELECT data_json FROM ais_cache WHERE imo = $1 AND expires_at > NOW() LIMIT 1`,
      [imo]
    )
    const aisData = rows[0]?.data_json
    if (aisData?.position?.draught) {
      vesselDraftM = aisData.position.draught
    }
  } catch {
    // Non-fatal: fall through to entity metadata.
  }

  // 2. Fall back to vessel metadata (grossTonnage/type don't give draught, but
  //    some importers store a design draught in metadata_json.designDraughtM)
  if (vesselDraftM == null) {
    try {
      const entity = await getEntityByKey(imo)
      if (entity?.type === 'vessel') {
        const vessel = entity as Vessel
        // Some entity rows store design draught under metadata via rescore
        const meta = (vessel as unknown as Record<string, unknown>)
        const designDraught = (meta.metadata_json as Record<string, unknown>)?.designDraughtM
        if (typeof designDraught === 'number') {
          vesselDraftM = designDraught
        }
      }
    } catch {
      // Ignore errors and proceed with a null draught.
    }
  }

  // Run the port draft check.
  const result: DraftRiskResult = await checkDraftRisk(locode, vesselDraftM)

  return NextResponse.json({
    imo,
    locode,
    draughtSource: vesselDraftM != null
      ? (result.vesselDraftM === vesselDraftM ? 'ais_cache' : 'entity_metadata')
      : 'unavailable',
    ...result,
  })
}




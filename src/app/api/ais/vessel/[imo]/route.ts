import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getVesselAis } from '@/lib/server/ais'
import { getEntityByKey, saveVesselMmsi } from '@/lib/server/repository'
import { rescoreEntity } from '@/lib/server/rescore'
import type { Vessel } from '@/lib/types'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ imo: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { imo } = await params
  if (!/^\d{7}$/.test(imo)) {
    return NextResponse.json({ error: 'Invalid IMO' }, { status: 400 })
  }

  // Look up any cached MMSI from the entity record so aisstream can filter by it
  let knownMmsi:  string | undefined
  let entityId:   string | undefined
  try {
    const entity = await getEntityByKey(imo)
    if (entity?.type === 'vessel') {
      knownMmsi = (entity as Vessel).mmsi
      entityId  = entity.id
    }
  } catch {
    // Non-fatal: proceed without an MMSI hint.
  }

  const data = await getVesselAis(imo, { mmsi: knownMmsi })

  // When aisstream discovers a new MMSI, cache it for future requests
  if (!knownMmsi && data.mmsi && data.provider === 'aisstream') {
    saveVesselMmsi(imo, data.mmsi).catch(console.error)
  }

  // Rescore the entity after a non-mock AIS refresh.
  if (entityId && data.provider !== 'mock') {
    rescoreEntity(entityId).catch(console.error)
  }

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'private, max-age=3600, stale-while-revalidate=7200',
    },
  })
}


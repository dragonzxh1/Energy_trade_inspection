import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { applyMigrations } from '@/lib/server/migrations'
import { getEntityByKey } from '@/lib/server/repository'
import { researchVessel } from '@/lib/server/intelligence'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ imo: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
  }

  const { imo } = await params
  await applyMigrations()
  const entity = await getEntityByKey(imo)
  if (!entity || entity.type !== 'vessel') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const result = await researchVessel(entity.imo, {
    vesselName: entity.name ?? undefined,
    flag: (entity as import('@/lib/types').Vessel).flag ?? undefined,
    maxResults: 5,
  })

  return NextResponse.json(result ?? { error: 'Intelligence unavailable' }, {
    headers: { 'Cache-Control': 'private, max-age=86400' },
  })
}

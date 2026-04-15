import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getEntityByKey } from '@/lib/server/repository'
import { researchVessel } from '@/lib/server/intelligence'
import { fetchHifleetPsc } from '@/lib/server/ais'
import { readIntelligenceCache, writeIntelligenceCache } from '@/lib/server/intelligence-cache'
import { rescoreEntity } from '@/lib/server/rescore'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ imo: string }> },
) {
  const session = (await auth())!
  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
  }

  const { imo } = await params
  const entity = await getEntityByKey(imo)
  if (!entity || entity.type !== 'vessel') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // 鍛戒腑缂撳瓨鐩存帴杩斿洖
  const cached = await readIntelligenceCache('vessel', entity.imo)
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': 'private, max-age=86400' } })
  }

  // 骞惰鑾峰彇锛歍avily 缃戠粶鎯呮姤 + HiFleet 缁撴瀯鍖?PSC 璁板綍
  const [tavilyResult, pscRecords] = await Promise.all([
    researchVessel(entity.imo, {
      vesselName: entity.name ?? undefined,
      flag: (entity as import('@/lib/types').Vessel).flag ?? undefined,
      maxResults: 5,
    }),
    fetchHifleetPsc(entity.imo),
  ])

  if (!tavilyResult) {
    return NextResponse.json({ error: 'Intelligence unavailable' }, { status: 502 })
  }

  const payload = { ...tavilyResult, psc_records: pscRecords ?? [] }
  await writeIntelligenceCache('vessel', entity.imo, payload as Record<string, unknown>)

  // 鍚庡彴寮傛閲嶇畻鐪熷疄鎬ц瘎鍒嗭紙鍖呭惈鏈€鏂?PSC 鏁版嵁锛?  rescoreEntity(entity.id).catch(console.error)

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=86400' } })
}




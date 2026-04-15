import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getEntityByKey } from '@/lib/server/repository'
import { researchTerminal } from '@/lib/server/intelligence'
import { readIntelligenceCache, writeIntelligenceCache } from '@/lib/server/intelligence-cache'
import { rescoreEntity } from '@/lib/server/rescore'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = (await auth())!
  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
  }

  const { id } = await params

  // 鍛戒腑缂撳瓨鐩存帴杩斿洖
  const cached = await readIntelligenceCache('terminal', id)
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': 'private, max-age=86400' } })
  }

  // id 鍙互鏄?entity id 鎴?slug锛涜嫢鏌ヤ笉鍒板垯鐢?id 鏈韩浣滀负鍚嶇О鐩存帴鎼滅储
  let name = decodeURIComponent(id)
  let location: string | undefined
  let entityId: string | undefined

  try {
    const entity = await getEntityByKey(id)
    if (entity) {
      name     = entity.name
      location = entity.country ?? undefined
      entityId = entity.id
    }
  } catch {
  // Non-fatal: fall back to using the route id as the terminal name.
  }

  const result = await researchTerminal(name, { location, maxResults: 5 })

  if (!result) {
    return NextResponse.json({ error: 'Intelligence unavailable' }, { status: 502 })
  }

  await writeIntelligenceCache('terminal', id, result as unknown as Record<string, unknown>)
  // terminal 鍙兘娌℃湁瀵瑰簲 entity 璁板綍锛屽彧鍦ㄦ煡鍒版椂閲嶇畻
  if (entityId) rescoreEntity(entityId).catch(console.error)

  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, max-age=86400' } })
}




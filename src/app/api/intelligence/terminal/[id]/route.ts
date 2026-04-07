import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { applyMigrations } from '@/lib/server/migrations'
import { getEntityByKey } from '@/lib/server/repository'
import { researchTerminal } from '@/lib/server/intelligence'
import { readIntelligenceCache, writeIntelligenceCache } from '@/lib/server/intelligence-cache'
import { rescoreEntity } from '@/lib/server/rescore'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
  }

  const { id } = await params
  await applyMigrations()

  // 命中缓存直接返回
  const cached = await readIntelligenceCache('terminal', id)
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': 'private, max-age=86400' } })
  }

  // id 可以是 entity id 或 slug；若查不到则用 id 本身作为名称直接搜索
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
    // 非致命 — 直接用 id 作为名称搜索
  }

  const result = await researchTerminal(name, { location, maxResults: 5 })

  if (!result) {
    return NextResponse.json({ error: 'Intelligence unavailable' }, { status: 502 })
  }

  await writeIntelligenceCache('terminal', id, result as unknown as Record<string, unknown>)
  // terminal 可能没有对应 entity 记录，只在查到时重算
  if (entityId) rescoreEntity(entityId).catch(console.error)

  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, max-age=86400' } })
}

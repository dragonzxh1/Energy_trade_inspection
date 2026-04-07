import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { applyMigrations } from '@/lib/server/migrations'
import { getEntityByKey } from '@/lib/server/repository'
import { researchVessel } from '@/lib/server/intelligence'
import { fetchHifleetPsc } from '@/lib/server/ais'
import { readIntelligenceCache, writeIntelligenceCache } from '@/lib/server/intelligence-cache'
import { rescoreEntity } from '@/lib/server/rescore'

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

  // 命中缓存直接返回
  const cached = await readIntelligenceCache('vessel', entity.imo)
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': 'private, max-age=86400' } })
  }

  // 并行获取：Tavily 网络情报 + HiFleet 结构化 PSC 记录
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

  // 后台异步重算真实性评分（包含最新 PSC 数据）
  rescoreEntity(entity.id).catch(console.error)

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, max-age=86400' } })
}

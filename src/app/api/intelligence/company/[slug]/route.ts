import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getEntityByKey } from '@/lib/server/repository'
import { researchCompany } from '@/lib/server/intelligence'
import { readIntelligenceCache, writeIntelligenceCache } from '@/lib/server/intelligence-cache'
import { rescoreEntity } from '@/lib/server/rescore'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = (await auth())!
  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
  }

  const { slug } = await params
  const entity = await getEntityByKey(slug)
  if (!entity || entity.type !== 'company') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // 鍛戒腑缂撳瓨鐩存帴杩斿洖
  const cached = await readIntelligenceCache('company', slug)
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': 'private, max-age=86400' } })
  }

  const result = await researchCompany(entity.name, {
    country: entity.country ?? undefined,
    maxResults: 5,
  })

  if (!result) {
    return NextResponse.json({ error: 'Intelligence unavailable' }, { status: 502 })
  }

  await writeIntelligenceCache('company', slug, result as unknown as Record<string, unknown>)
  rescoreEntity(entity.id).catch(console.error)

  return NextResponse.json(result, { headers: { 'Cache-Control': 'private, max-age=86400' } })
}



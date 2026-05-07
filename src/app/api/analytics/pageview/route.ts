import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { recordPageView } from '@/lib/server/repository'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const path = typeof body?.path === 'string' ? body.path : '/'

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? '127.0.0.1'

    const ipHash = createHash('sha256').update(ip).digest('hex')

    await recordPageView(path, ipHash)

    return new NextResponse(null, { status: 204 })
  } catch {
    return new NextResponse(null, { status: 204 })
  }
}

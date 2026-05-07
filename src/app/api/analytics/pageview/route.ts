import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { recordPageView } from '@/lib/server/repository'

export const runtime = 'nodejs'

async function lookupCountry(ip: string): Promise<string | null> {
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return 'Localhost'
  }
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=country`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json() as { country?: string }
    return data.country ?? null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const path = typeof body?.path === 'string' ? body.path : '/'

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? '127.0.0.1'

    const ipHash = createHash('sha256').update(ip).digest('hex')
    const country = await lookupCountry(ip)

    await recordPageView(path, ipHash, ip, country)

    return new NextResponse(null, { status: 204 })
  } catch {
    return new NextResponse(null, { status: 204 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized } from '@/lib/server/admin-auth'
import { persistTelegramInput } from '@/lib/server/seo-repository'
import { normalizeTelegramInput } from '@/lib/server/telegram-input'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const authResult = isAdminAuthorized(req)
  if (!authResult.authorized) {
    const status = authResult.reason === 'no_session' ? 401 : 403
    return NextResponse.json(
      { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
      { status },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  try {
    const input = normalizeTelegramInput(body)
    const result = await persistTelegramInput(input)

    return NextResponse.json(result, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const status = /required|must be|invalid|SHA-256|non-negative|timezone/i.test(message) ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

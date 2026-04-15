import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { isAdminAuthorized } from '@/lib/server/admin-auth'
import { getAdminStats } from '@/lib/server/repository'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const session = await auth()
  const authResult = isAdminAuthorized(req, session?.user?.email)
  if (!authResult.authorized) {
    const status = authResult.reason === 'no_session' ? 401 : 403
    return NextResponse.json(
      { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
      { status }
    )
  }

  try {
    const stats = await getAdminStats()
    return NextResponse.json(stats, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { isAdminAuthorized } from '@/lib/server/admin-auth'
import { getRecentPageViews } from '@/lib/server/repository'

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
    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '200', 10)
    const rows = await getRecentPageViews(Math.min(limit, 500))
    return NextResponse.json(rows, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'
import { isAdminAuthorized } from '@/lib/server/admin-auth'

export const runtime = 'nodejs'

const ALLOWED_PLANS = ['free', 'starter', 'professional', 'enterprise'] as const
type AllowedPlan = typeof ALLOWED_PLANS[number]

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  const authResult = isAdminAuthorized(req, session?.user?.email)
  if (!authResult.authorized) {
    const status = authResult.reason === 'no_session' ? 401 : 403
    return NextResponse.json(
      { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
      { status }
    )
  }

  const { id } = await params

  let plan: string
  try {
    const body = await req.json()
    plan = String(body.plan ?? '')
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!ALLOWED_PLANS.includes(plan as AllowedPlan)) {
    return NextResponse.json({ error: 'Invalid plan value.' }, { status: 400 })
  }

  try {
    await db.query(
      'UPDATE users SET plan = $1 WHERE id = $2',
      [plan, id]
    )
    return NextResponse.json({ id, plan })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

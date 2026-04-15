import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getQuotaStatus } from '@/lib/server/quota'

export const runtime = 'nodejs'

export async function GET() {
  const session = (await auth())!

  try {
    const plan = session.user.plan ?? 'free'
    const quota = await getQuotaStatus(session.user.id, plan)

    return NextResponse.json(
      {
        plan,
        quota,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('[quota]', error)
    return NextResponse.json({ error: 'Quota unavailable' }, { status: 500 })
  }
}



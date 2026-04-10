import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { runTradeCheck } from '@/lib/server/trade-service'

export const runtime = 'nodejs'

export type {
  TradeCheckInput,
  TradeCheckResult,
  TradePartyResult,
  TradePortResult,
  TradeVesselResult,
} from '@/lib/server/trade-service'

export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'Trade checks require a Starter or higher plan.' },
      { status: 403 }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const seller = String(body.seller ?? '').trim()
  const vessel = String(body.vessel ?? '').trim()
  const date = body.date ? String(body.date).trim() : null
  const loadingPort = body.loadingPort ? String(body.loadingPort).trim().toUpperCase() : null
  const commodity = body.commodity ? String(body.commodity).trim() : null
  const imoField = body.imo ? String(body.imo).trim() : undefined

  if (!seller || seller.length < 2) {
    return NextResponse.json({ error: 'Field \"seller\" is required (min 2 chars).' }, { status: 400 })
  }
  if (!vessel || vessel.length < 2) {
    return NextResponse.json({ error: 'Field \"vessel\" is required (min 2 chars).' }, { status: 400 })
  }

  try {
    const result = await runTradeCheck(session.user.id, {
      seller,
      vessel,
      date,
      loadingPort,
      commodity,
      imoField,
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[trade]', error)
    return NextResponse.json({ error: 'Trade check failed.' }, { status: 500 })
  }
}



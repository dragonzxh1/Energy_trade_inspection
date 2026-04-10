/**
 * GET  /api/watchlist/trades lists watched trade patterns for the current user.
 * POST /api/watchlist/trades saves or toggles off a trade pattern watch.
 *
 * Access: Starter+ plan users only (Professional plan required for entity watchlist,
 * but trade watches are available from Starter since they're tied to the trade check).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'

// 鈹€鈹€ GET 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json({ error: 'Starter plan required.' }, { status: 403 })
  }

  const [{ rows: trades }, { rows: alerts }] = await Promise.all([
    db.query(
      `SELECT id, seller_name, vessel_name, vessel_imo, loading_port, trade_date,
              last_overall_risk, last_flag_count,
              last_seller_sanctioned, last_vessel_sanctioned, last_psc_detentions,
              last_checked_at, created_at
       FROM watched_trades
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [session.user.id]
    ),
    db.query<{ watched_trade_id: string; count: string }>(
      `SELECT watched_trade_id, COUNT(*) AS count
       FROM watched_trade_alerts
       WHERE user_id = $1 AND read_at IS NULL
       GROUP BY watched_trade_id`,
      [session.user.id]
    ),
  ])

  const alertCountById = Object.fromEntries(
    alerts.map(r => [r.watched_trade_id, parseInt(r.count, 10)])
  )

  const items = trades.map(t => ({
    ...t,
    unreadAlerts: alertCountById[t.id] ?? 0,
  }))

  return NextResponse.json({ items })
}

// 鈹€鈹€ POST 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json({ error: 'Starter plan required.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const sellerName  = String(body.sellerName  ?? '').trim()
  const vesselName  = String(body.vesselName  ?? '').trim()
  const vesselImo   = body.vesselImo   ? String(body.vesselImo).trim()   : null
  const loadingPort = body.loadingPort ? String(body.loadingPort).trim() : null
  const tradeDate   = body.tradeDate   ? String(body.tradeDate).trim()   : null
  const lastOverallRisk      = String(body.lastOverallRisk ?? 'low')
  const lastFlagCount        = Number(body.lastFlagCount ?? 0)
  const lastSellerSanctioned = Boolean(body.lastSellerSanctioned)
  const lastVesselSanctioned = Boolean(body.lastVesselSanctioned)
  const lastPscDetentions    = body.lastPscDetentions != null ? Number(body.lastPscDetentions) : null

  if (!sellerName || sellerName.length < 2) {
    return NextResponse.json({ error: 'sellerName is required.' }, { status: 400 })
  }
  if (!vesselName || vesselName.length < 2) {
    return NextResponse.json({ error: 'vesselName is required.' }, { status: 400 })
  }

  // Toggle: if already watching, remove it
  const { rows: existing } = await db.query<{ id: string }>(
    `SELECT id FROM watched_trades WHERE user_id = $1 AND seller_name = $2 AND vessel_name = $3`,
    [session.user.id, sellerName, vesselName]
  )

  if (existing.length > 0) {
    await db.query(
      `DELETE FROM watched_trades WHERE id = $1`,
      [existing[0].id]
    )
    return NextResponse.json({ watching: false })
  }

  await db.query(
    `INSERT INTO watched_trades
       (user_id, seller_name, vessel_name, vessel_imo, loading_port, trade_date,
        last_overall_risk, last_flag_count, last_seller_sanctioned, last_vessel_sanctioned,
        last_psc_detentions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      session.user.id, sellerName, vesselName, vesselImo, loadingPort, tradeDate,
      lastOverallRisk, lastFlagCount, lastSellerSanctioned, lastVesselSanctioned,
      lastPscDetentions,
    ]
  )

  return NextResponse.json({ watching: true })
}



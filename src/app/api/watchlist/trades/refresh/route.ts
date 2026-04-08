/**
 * POST /api/watchlist/trades/refresh
 *
 * For each watched trade:
 *   1. Re-run sanctions check on seller and vessel names.
 *   2. If vessel has IMO, compare live PSC detention count against stored baseline.
 *   3. Create an alert for each change detected.
 *   4. Update stored risk snapshot.
 *
 * Returns: { checked: number, alertsCreated: number }
 */

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'
import { applyMigrations } from '@/lib/server/migrations'
import { checkSanctions } from '@/lib/server/sync/sanctions'
import { getPscSummary } from '@/lib/server/repository'

export const runtime = 'nodejs'

export async function POST() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json({ error: 'Starter plan required.' }, { status: 403 })
  }

  await applyMigrations()

  const { rows: trades } = await db.query<{
    id: string
    seller_name: string
    vessel_name: string
    vessel_imo: string | null
    last_seller_sanctioned: boolean
    last_vessel_sanctioned: boolean
    last_psc_detentions: number | null
    last_overall_risk: string
  }>(
    `SELECT id, seller_name, vessel_name, vessel_imo,
            last_seller_sanctioned, last_vessel_sanctioned, last_psc_detentions,
            last_overall_risk
     FROM watched_trades
     WHERE user_id = $1`,
    [session.user.id]
  )

  let alertsCreated = 0

  for (const trade of trades) {
    const alerts: Array<{ alert_type: string; detail: string }> = []

    // ── Sanctions re-check ──────────────────────────────────────────────────
    const [sellerSanction, vesselSanction] = await Promise.all([
      checkSanctions(trade.seller_name).catch(() => ({ listed: false, sources: [] as string[] })),
      checkSanctions(trade.vessel_name).catch(() => ({ listed: false, sources: [] as string[] })),
    ])

    if (sellerSanction.listed && !trade.last_seller_sanctioned) {
      alerts.push({
        alert_type: 'sanction_exposure',
        detail: `Seller "${trade.seller_name}" is now listed on sanctions — status has changed since this trade was saved.`,
      })
    }

    if (vesselSanction.listed && !trade.last_vessel_sanctioned) {
      alerts.push({
        alert_type: 'sanction_exposure',
        detail: `Vessel "${trade.vessel_name}" is now listed on sanctions — status has changed since this trade was saved.`,
      })
    }

    // ── PSC detention re-check (vessels with IMO only) ──────────────────────
    let livePscDetentions: number | null = null
    if (trade.vessel_imo) {
      const psc = await getPscSummary(trade.vessel_imo).catch(() => null)
      livePscDetentions = psc?.detentions ?? null

      if (
        livePscDetentions != null &&
        trade.last_psc_detentions != null &&
        livePscDetentions > trade.last_psc_detentions
      ) {
        const newDetentions = livePscDetentions - trade.last_psc_detentions
        alerts.push({
          alert_type: 'psc_detention',
          detail: `Vessel "${trade.vessel_name}" (IMO ${trade.vessel_imo}) has ${newDetentions} new PSC detention(s) since this trade was saved. Total: ${livePscDetentions}.`,
        })
      }
    }

    // ── Derive new overall risk (simplified: sanctions-only escalation) ─────
    const RISK_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    let newRisk = trade.last_overall_risk
    if (sellerSanction.listed || vesselSanction.listed) {
      newRisk = 'critical'
    } else if (livePscDetentions != null && livePscDetentions > (trade.last_psc_detentions ?? 0)) {
      // PSC detention escalates to at least high
      if ((RISK_ORDER[newRisk] ?? 3) > RISK_ORDER['high']) newRisk = 'high'
    }

    if (
      newRisk !== trade.last_overall_risk &&
      (RISK_ORDER[newRisk] ?? 3) < (RISK_ORDER[trade.last_overall_risk] ?? 3)
    ) {
      alerts.push({
        alert_type: 'risk_escalation',
        detail: `Overall risk for trade "${trade.seller_name} / ${trade.vessel_name}" escalated from ${trade.last_overall_risk.toUpperCase()} to ${newRisk.toUpperCase()}.`,
      })
    }

    // ── Persist alerts ──────────────────────────────────────────────────────
    for (const alert of alerts) {
      await db.query(
        `INSERT INTO watched_trade_alerts (user_id, watched_trade_id, alert_type, detail)
         VALUES ($1, $2, $3, $4)`,
        [session.user.id, trade.id, alert.alert_type, alert.detail]
      )
      alertsCreated++
    }

    // ── Update snapshot ─────────────────────────────────────────────────────
    await db.query(
      `UPDATE watched_trades
          SET last_seller_sanctioned = $1,
              last_vessel_sanctioned = $2,
              last_psc_detentions    = COALESCE($3, last_psc_detentions),
              last_overall_risk      = $4,
              last_checked_at        = NOW()
        WHERE id = $5`,
      [
        sellerSanction.listed,
        vesselSanction.listed,
        livePscDetentions,
        newRisk,
        trade.id,
      ]
    )
  }

  return NextResponse.json({ checked: trades.length, alertsCreated })
}

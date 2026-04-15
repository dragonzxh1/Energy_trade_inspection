/**
 * GET /api/cron/fraud-sync
 *
 * Runs fraud alert sync for all configured sources (storagespoofing, fuelscamalert).
 * Results are written to fraud_sync_log and fraud_alerts tables.
 *
 * Auth: Authorization: Bearer <ADMIN_SECRET>
 *
 * Intended to be called by a scheduler (system crontab, GitHub Actions, etc.)
 * on a daily schedule. Safe to call repeatedly — each run deletes stale rows
 * for the source and re-inserts fresh data.
 *
 * System crontab example (runs daily at 04:15):
 *   15 4 * * * curl -sf -H "Authorization: Bearer $ADMIN_SECRET" https://your-domain/api/cron/fraud-sync
 */

import { NextRequest, NextResponse } from 'next/server'
import { syncFraudAlerts } from '@/lib/server/sync/fraud-alerts'

export const runtime = 'nodejs'
export const maxDuration = 120

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET ?? process.env.SYNC_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  const start = Date.now()
  const results = await syncFraudAlerts()

  const summary = results.map((r) => ({
    source:     r.source,
    success:    !r.error,
    count:      r.count,
    error:      r.error ?? null,
    durationMs: r.durationMs,
  }))

  const hasError = results.some((r) => r.error)
  console.log('[cron/fraud-sync] completed in', Date.now() - start, 'ms', summary)

  return NextResponse.json(
    { ok: !hasError, durationMs: Date.now() - start, results: summary },
    { status: hasError ? 207 : 200 }
  )
}

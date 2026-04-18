/**
 * GET /api/cron/gleif-delta
 *
 * Daily GLEIF Golden Copy delta sync:
 *   1. syncLeiDelta()      — Level 1 LEI2 delta (~3 MB)
 *   2. syncLeiLevel2()     — Level 2 RR delta (ownership chain, ~32 MB)
 *   3. syncLeiExceptions() — REPEX delta (reporting exceptions, ~58 MB)
 *
 * Auth: Authorization: Bearer <ADMIN_SECRET>
 *
 * Schedule: daily at 02:00 UTC (GLEIF Golden Copy updates ~01:00 UTC)
 *
 * Vercel cron.json example:
 *   { "crons": [{ "path": "/api/cron/gleif-delta", "schedule": "0 2 * * *" }] }
 *
 * PM2/crontab example:
 *   0 2 * * * curl -H "Authorization: Bearer $ADMIN_SECRET" https://yourapp.com/api/cron/gleif-delta
 */

import { NextRequest, NextResponse } from 'next/server'
import { syncLeiDelta, syncLeiLevel2, syncLeiExceptions } from '@/lib/server/sync/gleif-golden-copy'

export const runtime = 'nodejs'

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

  const startMs = Date.now()

  try {
    // Run sequentially — all three write to lei_cache; concurrent writes cause deadlocks.
    // 5s pause before exceptions lets autovacuum clear dead tuples from delta/level2 commits,
    // reducing deadlock probability. One retry on deadlock as belt-and-suspenders.
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const withDeadlockRetry = async (fn: () => Promise<{ count: number }>) => {
      try { return await fn() } catch (e) {
        if (String(e).includes('deadlock')) { await sleep(3000); return await fn() }
        throw e
      }
    }

    const deltaResult = await syncLeiDelta().then((v) => ({ status: 'fulfilled' as const, value: v })).catch((e) => ({ status: 'rejected' as const, reason: e }))
    const level2Result = await syncLeiLevel2().then((v) => ({ status: 'fulfilled' as const, value: v })).catch((e) => ({ status: 'rejected' as const, reason: e }))
    await sleep(5000)
    const exceptionsResult = await withDeadlockRetry(syncLeiExceptions).then((v) => ({ status: 'fulfilled' as const, value: v })).catch((e) => ({ status: 'rejected' as const, reason: e }))

    const counts = {
      delta: deltaResult.status === 'fulfilled' ? deltaResult.value.count : 0,
      level2: level2Result.status === 'fulfilled' ? level2Result.value.count : 0,
      exceptions: exceptionsResult.status === 'fulfilled' ? exceptionsResult.value.count : 0,
    }

    const errors = [
      deltaResult.status === 'rejected' ? `delta: ${String(deltaResult.reason)}` : null,
      level2Result.status === 'rejected' ? `level2: ${String(level2Result.reason)}` : null,
      exceptionsResult.status === 'rejected' ? `exceptions: ${String(exceptionsResult.reason)}` : null,
    ].filter(Boolean)

    const durationMs = Date.now() - startMs
    console.log(`[cron/gleif-delta] complete: counts=${JSON.stringify(counts)}, duration=${durationMs}ms, errors=${errors.length}`)

    return NextResponse.json({
      ok: errors.length === 0,
      counts,
      durationMs,
      errors: errors.length > 0 ? errors : undefined,
    }, {
      status: errors.length > 0 ? 207 : 200,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[cron/gleif-delta] fatal error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * GET /api/cron/cleanup
 *
 * Deletes screening_sessions and trade_sessions older than 90 days.
 *
 * Auth: Authorization: Bearer <ADMIN_SECRET>
 *
 * Intended to be called by a scheduler (Vercel Cron, GitHub Actions, etc.)
 * on a daily or weekly schedule. Safe to call repeatedly because it is idempotent.
 *
 * Vercel cron.json example:
 *   { "crons": [{ "path": "/api/cron/cleanup", "schedule": "0 3 * * 0" }] }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'

const TTL_DAYS = 90

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

  const cutoff = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [screenRes, tradeRes] = await Promise.all([
    db.query(
      `DELETE FROM screening_sessions WHERE created_at < $1`,
      [cutoff]
    ),
    db.query(
      `DELETE FROM trade_sessions WHERE created_at < $1`,
      [cutoff]
    ),
  ])

  const deleted = {
    screening_sessions: screenRes.rowCount ?? 0,
    trade_sessions:     tradeRes.rowCount ?? 0,
  }

  console.log('[cron/cleanup] Deleted:', deleted)

  return NextResponse.json({
    ok: true,
    cutoff,
    ttlDays: TTL_DAYS,
    deleted,
  })
}




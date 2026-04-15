import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'
import { runSync, runFraudSourceSync, getSyncStatus, type SyncSource } from '@/lib/server/sync'

export const runtime = 'nodejs'
export const maxDuration = 300

// Warn if ADMIN_SECRET is not set in production — localhost bypass is insecure
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_SECRET && !process.env.SYNC_SECRET) {
  console.warn('[admin/sync] WARNING: ADMIN_SECRET is not set in production. Localhost bypass is active — this is insecure.')
}

interface AuthResult {
  authorized: boolean
  reason: 'no_session' | 'bearer_valid' | 'admin_email' | 'not_admin'
}

function isAuthorized(req: NextRequest, userEmail?: string | null): AuthResult {
  const adminSecret = process.env.ADMIN_SECRET ?? process.env.SYNC_SECRET
  if (adminSecret) {
    const authHeader = req.headers.get('authorization') ?? ''
    if (authHeader === `Bearer ${adminSecret}`) {
      return { authorized: true, reason: 'bearer_valid' }
    }
  }

  // No ADMIN_SECRET set — localhost bypass (dev only)
  if (!adminSecret) {
    const host = req.headers.get('host') ?? ''
    if (host.startsWith('localhost') || host.startsWith('127.')) {
      return { authorized: true, reason: 'bearer_valid' }
    }
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)

  if (!userEmail) {
    return { authorized: false, reason: 'no_session' }
  }

  if (adminEmails.includes(userEmail)) {
    return { authorized: true, reason: 'admin_email' }
  }

  return { authorized: false, reason: 'not_admin' }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  const authResult = isAuthorized(req, session?.user?.email)
  if (!authResult.authorized) {
    const status = authResult.reason === 'no_session' ? 401 : 403
    return NextResponse.json(
      { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
      { status }
    )
  }

  try {
    const [syncStatus, countRows, recentLogs, fraudCountRows] = await Promise.all([
      getSyncStatus(),
      db.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM sanctions_entries'),
      db.query(`
        SELECT source, synced_at, record_count, status, error_message, duration_ms, version
        FROM sanctions_sync_log
        ORDER BY synced_at DESC
        LIMIT 10
      `),
      db.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM fraud_alerts').catch(() => ({ rows: [{ n: '0' }] })),
    ])

    return NextResponse.json({
      entries: parseInt(countRows.rows[0]?.n ?? '0', 10),
      fraud_entries: parseInt(fraudCountRows.rows[0]?.n ?? '0', 10),
      sync_status: syncStatus,
      recent_logs: recentLogs.rows,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const authResult = isAuthorized(req, session?.user?.email)
  if (!authResult.authorized) {
    const status = authResult.reason === 'no_session' ? 401 : 403
    return NextResponse.json(
      { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
      { status }
    )
  }

  let source = 'opensanctions'
  let force = false
  try {
    const body = await req.json()
    if (body.source) source = String(body.source)
    if (body.force) force = true
  } catch {
    // default body handling
  }

  if (source === 'opensanctions') {
    const scriptPath = path.join(process.cwd(), 'scripts', 'sync-opensanctions.mjs')
    const child = spawn(process.execPath, [scriptPath], {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
        FORCE_SYNC: force ? '1' : '0',
      },
    })
    child.unref()

    return NextResponse.json({
      success: true,
      source: 'opensanctions',
      pid: child.pid,
      message: 'OpenSanctions sync started in the background. Check GET /api/admin/sync for progress.',
    })
  }

  // Fraud alert sync: POST { source: 'fraud' } or { source: 'fraud:storagespoofing' } etc.
  if (source === 'fraud') {
    try {
      const results = await runSync('fraud')
      const hasError = results.some((r) => !r.success)
      return NextResponse.json({ results }, { status: hasError ? 207 : 200 })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  if (source.startsWith('fraud:')) {
    const fraudSource = source.slice('fraud:'.length)
    try {
      const result = await runFraudSourceSync(fraudSource)
      return NextResponse.json(
        { results: [result] },
        { status: result.success ? 200 : 207 }
      )
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  const legacySource = (['ofac', 'all'] as SyncSource[]).includes(source as SyncSource)
    ? (source as SyncSource)
    : 'all'

  try {
    const results = await runSync(legacySource)
    const hasError = results.some((result) => !result.success)
    return NextResponse.json({ results }, { status: hasError ? 207 : 200 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

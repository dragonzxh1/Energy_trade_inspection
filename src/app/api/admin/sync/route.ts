/**
 * POST /api/admin/sync  — 触发数据同步
 * GET  /api/admin/sync  — 查询同步状态与记录数
 *
 * body.source 可选值：
 *   'opensanctions' （默认）— 下载 OpenSanctions CSV，覆盖 OFAC/EU/UN 等全部来源
 *   'ofac'          — 仅同步 OFAC XML（遗留，OpenSanctions 已包含 OFAC）
 *   'all'           — 触发 OFAC XML 同步
 *
 * 鉴权（二选一）：
 *   1. Authorization: Bearer <ADMIN_SECRET>（推荐用于 cron）
 *   2. 已登录用户 email 在 ADMIN_EMAILS 环境变量列表中
 */

import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { auth } from '@/auth'
import { applyMigrations } from '@/lib/server/migrations'
import { db } from '@/lib/server/db'
import { runSync, getSyncStatus, type SyncSource } from '@/lib/server/sync'

export const runtime = 'nodejs'
export const maxDuration = 300

// ─── 鉴权 ─────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest, userEmail?: string | null): boolean {
  const adminSecret = process.env.ADMIN_SECRET ?? process.env.SYNC_SECRET
  if (adminSecret) {
    const authHeader = req.headers.get('authorization') ?? ''
    if (authHeader === `Bearer ${adminSecret}`) return true
  }

  // 无 secret 时允许 localhost
  if (!adminSecret) {
    const host = req.headers.get('host') ?? ''
    if (host.startsWith('localhost') || host.startsWith('127.')) return true
  }

  // 管理员邮箱
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  if (userEmail && adminEmails.includes(userEmail)) return true

  return false
}

// ─── GET：查询状态 ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!isAuthorized(req, session?.user?.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await applyMigrations()

    const [syncStatus, countRows] = await Promise.all([
      getSyncStatus(),
      db.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM sanctions_entries`),
    ])

    // 最近 10 条同步日志（含 opensanctions）
    const { rows: recentLogs } = await db.query(`
      SELECT source, synced_at, record_count, status, error_message, duration_ms, version
      FROM sanctions_sync_log
      ORDER BY synced_at DESC
      LIMIT 10
    `)

    return NextResponse.json({
      entries: parseInt(countRows.rows[0]?.n ?? '0', 10),
      sync_status: syncStatus,
      recent_logs: recentLogs,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST：触发同步 ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!isAuthorized(req, session?.user?.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let source: string = 'opensanctions'
  let force = false
  try {
    const body = await req.json()
    if (body.source) source = body.source
    if (body.force) force = true
  } catch {
    // 无 body 或解析失败，使用默认值
  }

  await applyMigrations()

  // OpenSanctions 同步：后台运行（文件下载耗时较长）
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
      message: '同步已在后台启动（约 2-5 分钟）。通过 GET /api/admin/sync 查看最新日志。',
    })
  }

  // 遗留：OFAC XML 同步（同步执行）
  const legacySource = (['ofac', 'all'] as SyncSource[]).includes(source as SyncSource)
    ? (source as SyncSource)
    : 'all'

  try {
    const results = await runSync(legacySource)
    const hasError = results.some((r) => !r.success)
    return NextResponse.json({ results }, { status: hasError ? 207 : 200 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * 管理员同步触发接口
 * POST /api/admin/sync
 *
 * 用法：
 *   curl -X POST http://localhost:3001/api/admin/sync \
 *     -H "Authorization: Bearer YOUR_SYNC_SECRET" \
 *     -H "Content-Type: application/json" \
 *     -d '{"source": "ofac"}'
 *
 * 生产环境建议通过 Vercel Cron / GitHub Actions 定时触发
 */

import { NextRequest, NextResponse } from 'next/server'
import { applyMigrations } from '@/lib/server/migrations'
import { runSync, getSyncStatus, type SyncSource } from '@/lib/server/sync'

export const runtime = 'nodejs'
export const maxDuration = 300  // OFAC 同步可能需要最多 5 分钟

const SYNC_SECRET = process.env.SYNC_SECRET

function isAuthorized(request: NextRequest): boolean {
  if (!SYNC_SECRET) {
    // 未配置 secret 时仅允许本地开发环境调用
    const host = request.headers.get('host') ?? ''
    return host.startsWith('localhost') || host.startsWith('127.')
  }
  const auth = request.headers.get('authorization') ?? ''
  return auth === `Bearer ${SYNC_SECRET}`
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let source: SyncSource = 'all'
  try {
    const body = await request.json()
    if (['ofac', 'all'].includes(body.source)) {
      source = body.source as SyncSource
    }
  } catch {
    // body 解析失败则使用默认值 'all'
  }

  try {
    await applyMigrations()
    const results = await runSync(source)

    const hasError = results.some((r) => !r.success)
    return NextResponse.json(
      { results },
      { status: hasError ? 207 : 200 }
    )
  } catch (err) {
    console.error('[sync]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

/** GET /api/admin/sync — 查询各来源最新同步状态 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await applyMigrations()
    const status = await getSyncStatus()
    return NextResponse.json({ status })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

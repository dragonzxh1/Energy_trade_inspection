/**
 * GET /api/trade/[id]/report
 *
 * Fetch a previously saved trade check session by ID and render a PDF.
 *
 * Access: Starter+ only. The session must belong to the requesting user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'
import { TradeReportDocument } from '@/lib/pdf/trade-report'
import type { TradeCheckResult } from '@/app/api/trade/route'

function safeFilename(seller: string, vessel: string): string {
  const clean = (s: string) =>
    s.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').slice(0, 40)
  return `trade_check_${clean(seller)}_${clean(vessel)}.pdf`
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'PDF reports require a Starter or higher plan.' },
      { status: 403 }
    )
  }

  const { id } = await params
  if (!id || id.length < 8) {
    return NextResponse.json({ error: 'Invalid session ID.' }, { status: 400 })
  }

  // Fetch the session while enforcing user ownership.
  let result: TradeCheckResult
  try {
    const { rows } = await db.query<{ result_json: TradeCheckResult }>(
      `SELECT result_json FROM trade_sessions
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [id, session.user.id]
    )
    if (!rows[0]) {
      return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
    }
    result = rows[0].result_json
  } catch (err) {
    console.error('[trade/report] DB error:', err)
    return NextResponse.json({ error: 'Failed to load session.' }, { status: 500 })
  }

  // Render PDF
  let buffer: Buffer
  try {
    buffer = await renderToBuffer(<TradeReportDocument result={result} />)
  } catch (err) {
    console.error('[trade/report] PDF render error:', err)
    return NextResponse.json({ error: 'PDF generation failed.' }, { status: 500 })
  }

  const filename = safeFilename(result.input.seller, result.input.vessel)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'private, no-store',
    },
  })
}


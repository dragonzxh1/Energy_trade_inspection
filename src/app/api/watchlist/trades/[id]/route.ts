/**
 * DELETE /api/watchlist/trades/[id] removes a watched trade pattern.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = (await auth())!

  const { id } = await params
  const { rowCount } = await db.query(
    `DELETE FROM watched_trades WHERE id = $1 AND user_id = $2`,
    [id, session.user.id]
  )

  if (!rowCount) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  return NextResponse.json({ removed: true })
}


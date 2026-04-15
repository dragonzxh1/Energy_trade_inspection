import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'

// GET /api/watchlist lists all watched entities for the current user.
export async function GET() {
  const session = (await auth())!

  const { rows } = await db.query(
    `SELECT id, entity_id, entity_type, entity_key, entity_name, sanction_status, added_at
     FROM watchlist
     WHERE user_id = $1
     ORDER BY added_at DESC`,
    [session.user.id]
  )

  return NextResponse.json({ items: rows })
}

// POST /api/watchlist toggles a watch for an entity.
export async function POST(request: NextRequest) {
  const session = (await auth())!

  const plan = session.user.plan ?? 'free'
  if (plan !== 'professional' && plan !== 'enterprise') {
    return NextResponse.json({ error: 'Professional plan required' }, { status: 403 })
  }

  const { entityId, entityType, entityKey, entityName, sanctionStatus } = await request.json()

  if (!entityId || !entityType || !entityKey || !entityName) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const { rows: existing } = await db.query(
    `SELECT id FROM watchlist WHERE user_id = $1 AND entity_id = $2`,
    [session.user.id, entityId]
  )

  if (existing.length > 0) {
    await db.query(
      `DELETE FROM watchlist WHERE user_id = $1 AND entity_id = $2`,
      [session.user.id, entityId]
    )
    return NextResponse.json({ watching: false })
  }

  await db.query(
    `INSERT INTO watchlist (user_id, entity_id, entity_type, entity_key, entity_name, sanction_status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [session.user.id, entityId, entityType, entityKey, entityName, sanctionStatus ?? 'unknown']
  )
  return NextResponse.json({ watching: true })
}


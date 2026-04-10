import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'

/**
 * POST /api/watchlist/refresh
 *
 * Compares each watched entity's live sanction_status (from entities table)
 * against the last-known status stored in watchlist.current_sanction_status.
 * Creates a watchlist_alerts record for every detected change,
 * then updates current_sanction_status and last_checked_at.
 *
 * Returns: { checked: number, alertsCreated: number }
 */
export async function POST() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const plan = session.user.plan ?? 'free'
  if (plan !== 'professional' && plan !== 'enterprise') {
    return NextResponse.json({ error: 'Professional plan required' }, { status: 403 })
  }

  // Join watchlist against entities to get live sanction status
  const { rows: watched } = await db.query<{
    watchlist_id:             string
    entity_id:                string
    entity_name:              string
    entity_type:              string
    entity_key:               string
    current_sanction_status:  string
    live_sanction_status:     string | null
  }>(
    `SELECT
       w.id                      AS watchlist_id,
       w.entity_id,
       w.entity_name,
       w.entity_type,
       w.entity_key,
       w.current_sanction_status,
       e.sanction_status         AS live_sanction_status
     FROM watchlist w
     LEFT JOIN entities e ON e.id = w.entity_id
     WHERE w.user_id = $1`,
    [session.user.id],
  )

  let alertsCreated = 0

  for (const row of watched) {
    const live = row.live_sanction_status
    // Skip entities not in DB (external/API-only) or unchanged
    if (!live || live === row.current_sanction_status) continue

    // Create alert record
    await db.query(
      `INSERT INTO watchlist_alerts
         (user_id, entity_id, entity_name, entity_type, entity_key, alert_type, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5, 'sanction_status_change', $6, $7)`,
      [
        session.user.id,
        row.entity_id,
        row.entity_name,
        row.entity_type,
        row.entity_key,
        row.current_sanction_status,
        live,
      ],
    )

    // Update stored status so the next refresh won't re-alert
    await db.query(
      `UPDATE watchlist
          SET current_sanction_status = $1, last_checked_at = NOW()
        WHERE id = $2`,
      [live, row.watchlist_id],
    )

    alertsCreated++
  }

  // Stamp last_checked_at on all rows (including unchanged)
  await db.query(
    `UPDATE watchlist SET last_checked_at = NOW() WHERE user_id = $1`,
    [session.user.id],
  )

  return NextResponse.json({ checked: watched.length, alertsCreated })
}



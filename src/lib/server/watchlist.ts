import { db } from './db'

export interface WatchlistItemRow {
  id: string
  entity_id: string
  entity_type: 'company' | 'vessel' | 'terminal'
  entity_key: string
  entity_name: string
  sanction_status: string
  current_sanction_status: string
  last_checked_at: string | null
  added_at: string
}

export interface WatchlistAlertRow {
  id: string
  entity_id: string
  entity_name: string
  entity_type: string
  entity_key: string
  alert_type: string
  old_value: string | null
  new_value: string | null
  created_at: string
}

export interface WatchedTradeRow {
  id: string
  seller_name: string
  vessel_name: string
  vessel_imo: string | null
  loading_port: string | null
  last_overall_risk: string
  last_flag_count: number
  last_checked_at: string | null
  created_at: string
  unread_alerts: string
}

export async function getEntityWatchState(userId: string, entityId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM watchlist WHERE user_id = $1 AND entity_id = $2 LIMIT 1`,
    [userId, entityId]
  )
  return rows.length > 0
}

export async function getWatchlistPageData(userId: string) {
  const [{ rows: items }, { rows: alerts }, { rows: trades }] = await Promise.all([
    db.query<WatchlistItemRow>(
      `SELECT id, entity_id, entity_type, entity_key, entity_name,
              sanction_status, current_sanction_status, last_checked_at, added_at
       FROM watchlist
       WHERE user_id = $1
       ORDER BY added_at DESC`,
      [userId]
    ),
    db.query<WatchlistAlertRow>(
      `SELECT id, entity_id, entity_name, entity_type, entity_key,
              alert_type, old_value, new_value, created_at
       FROM watchlist_alerts
       WHERE user_id = $1 AND read_at IS NULL
       ORDER BY created_at DESC`,
      [userId]
    ),
    db.query<WatchedTradeRow>(
      `SELECT wt.id, wt.seller_name, wt.vessel_name, wt.vessel_imo, wt.loading_port,
              wt.last_overall_risk, wt.last_flag_count, wt.last_checked_at, wt.created_at,
              COALESCE(a.alert_count, '0') AS unread_alerts
       FROM watched_trades wt
       LEFT JOIN (
         SELECT watched_trade_id, COUNT(*)::TEXT AS alert_count
         FROM watched_trade_alerts
         WHERE user_id = $1 AND read_at IS NULL
         GROUP BY watched_trade_id
       ) a ON a.watched_trade_id = wt.id
       WHERE wt.user_id = $1
       ORDER BY wt.created_at DESC`,
      [userId]
    ).catch(() => ({ rows: [] as WatchedTradeRow[] })),
  ])

  const lastCheckedAt = items.reduce<string | null>((latest, row) => {
    if (!row.last_checked_at) return latest
    if (!latest) return row.last_checked_at
    return row.last_checked_at > latest ? row.last_checked_at : latest
  }, null)

  return { items, alerts, trades, lastCheckedAt }
}

export async function removeWatchlistItem(userId: string, id: string) {
  await db.query(`DELETE FROM watchlist WHERE id = $1 AND user_id = $2`, [id, userId])
}

export async function dismissWatchlistAlert(userId: string, alertId: string) {
  await db.query(`UPDATE watchlist_alerts SET read_at = NOW() WHERE id = $1 AND user_id = $2`, [alertId, userId])
}

export async function removeWatchedTrade(userId: string, id: string) {
  await db.query(`DELETE FROM watched_trades WHERE id = $1 AND user_id = $2`, [id, userId])
}


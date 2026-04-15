import { db } from './db'

export interface TradeSessionRow {
  id: string
  input_json: {
    seller: string
    vessel: string
    loadingPort?: string
    commodity?: string
  }
  overall_risk: string
  flag_count: number
  created_at: string
}

export interface ScreeningSessionRow {
  id: string
  filename: string
  overall_risk: string
  entity_count: number
  created_at: string
}

const PAGE_SIZE = 10

export async function getReportHistory(userId: string) {
  const [tradeResult, screeningResult, tradeTotalResult, screeningTotalResult] = await Promise.all([
    db.query<TradeSessionRow>(
      `SELECT id, input_json, overall_risk, flag_count, created_at
       FROM trade_sessions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, PAGE_SIZE]
    ),
    db.query<ScreeningSessionRow>(
      `SELECT
         id,
         filename,
         result_json->>'overallRisk' AS overall_risk,
         COALESCE(jsonb_array_length(result_json->'entities'), 0) AS entity_count,
         created_at
       FROM screening_sessions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, PAGE_SIZE]
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM trade_sessions WHERE user_id = $1`,
      [userId]
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM screening_sessions WHERE user_id = $1`,
      [userId]
    ),
  ])

  return {
    tradeSessions:      tradeResult.rows,
    screeningSessions:  screeningResult.rows,
    tradeTotal:         parseInt(tradeTotalResult.rows[0]?.count ?? '0', 10),
    screeningTotal:     parseInt(screeningTotalResult.rows[0]?.count ?? '0', 10),
    pageSize:           PAGE_SIZE,
  }
}

export async function getReportPage(
  userId: string,
  type: 'trade' | 'screening',
  offset: number,
  limit: number,
) {
  if (type === 'trade') {
    const result = await db.query<TradeSessionRow>(
      `SELECT id, input_json, overall_risk, flag_count, created_at
       FROM trade_sessions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    )
    return result.rows
  }

  const result = await db.query<ScreeningSessionRow>(
    `SELECT
       id,
       filename,
       result_json->>'overallRisk' AS overall_risk,
       COALESCE(jsonb_array_length(result_json->'entities'), 0) AS entity_count,
       created_at
     FROM screening_sessions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  )
  return result.rows
}

export async function deleteReport(
  userId: string,
  type: 'trade' | 'screening',
  id: string,
): Promise<boolean> {
  const table = type === 'trade' ? 'trade_sessions' : 'screening_sessions'
  const result = await db.query(
    `DELETE FROM ${table} WHERE id = $1 AND user_id = $2`,
    [id, userId]
  )
  return (result.rowCount ?? 0) > 0
}

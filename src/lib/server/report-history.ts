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

export async function getReportHistory(userId: string) {
  const [tradeResult, screeningResult] = await Promise.all([
    db.query<TradeSessionRow>(
      `SELECT id, input_json, overall_risk, flag_count, created_at
       FROM trade_sessions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [userId]
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
       LIMIT 30`,
      [userId]
    ),
  ])

  return {
    tradeSessions: tradeResult.rows,
    screeningSessions: screeningResult.rows,
  }
}

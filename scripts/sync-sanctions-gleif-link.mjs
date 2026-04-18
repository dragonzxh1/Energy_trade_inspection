#!/usr/bin/env node
import pg from 'pg'
const { Pool } = pg
const DB_URL = process.env.DATABASE_URL
const pool = new Pool({ connectionString: DB_URL, max: 3 })

async function run() {
  const startMs = Date.now()
  const client = await pool.connect()
  try {
    console.log('[sanctions-gleif-link] Starting...')
    const { rows: unlinked } = await client.query(`
      SELECT id, name, country FROM entities
      WHERE lei IS NULL AND entity_type = 'company' ORDER BY id
    `)
    console.log(`[sanctions-gleif-link] ${unlinked.length} unlinked companies`)
    let linked = 0, skipped = 0, processed = 0
    for (const entity of unlinked) {
      try {
        const cc = entity.country?.slice(0, 2).toUpperCase() ?? null
        const { rows } = await client.query(`
          SELECT lei, SIMILARITY(legal_name, $1) AS sim
          FROM lei_cache
          WHERE SIMILARITY(legal_name, $1) > 0.6
            AND (jurisdiction = $2 OR country = $2)
          ORDER BY sim DESC LIMIT 2
        `, [entity.name, cc])
        if (rows.length === 1) {
          await client.query(`UPDATE entities SET lei = $1 WHERE id = $2`, [rows[0].lei, entity.id])
          linked++
        } else { skipped++ }
      } catch { skipped++ }
      processed++
      if (processed % 500 === 0) {
        console.log(`[sanctions-gleif-link] ${processed}/${unlinked.length} done, linked=${linked} skipped=${skipped} (${((Date.now()-startMs)/1000).toFixed(0)}s)`)
      }
    }
    const dur = Date.now() - startMs
    console.log(`[sanctions-gleif-link] Done: linked=${linked} skipped=${skipped} in ${(dur/1000).toFixed(0)}s`)
    await client.query(
      `INSERT INTO sanctions_sync_log(source,status,record_count,duration_ms) VALUES('sanctions-gleif-link','success',$1,$2)`,
      [linked, dur]
    )
    process.exit(0)
  } catch(err) {
    console.error('[sanctions-gleif-link] Failed:', err?.message ?? err)
    process.exit(1)
  } finally { client.release(); await pool.end() }
}
run()

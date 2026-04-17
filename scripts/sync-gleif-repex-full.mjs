#!/usr/bin/env node
/**
 * sync-gleif-repex-full.mjs
 *
 * Downloads GLEIF REPEX full Golden Copy and upserts reporting exceptions
 * into lei_cache (reporting_exception_type, reporting_exception_reason).
 *
 * Strategy (avoids full-scan-per-batch OOM/slowness):
 *   Phase 1 — Stream all REPEX records into a temp staging table
 *             (bulk multi-row INSERT, no join overhead)
 *   Phase 2 — CREATE INDEX on staging.lei + ANALYZE
 *   Phase 3 — Single UPDATE lei_cache FROM staging
 *             (hash join: fast, ~seconds not hours)
 *   Phase 4 — Write sync log, DROP staging, exit
 *
 * The temp table lives only for this session and is dropped automatically.
 */

import { Readable } from 'node:stream'
import pg from 'pg'
import unzipper from 'unzipper'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/pick.js'
import { streamArray } from 'stream-json/streamers/stream-array.js'
import { chain } from 'stream-chain'

const { Pool } = pg

const DB_URL = process.env.DATABASE_URL ?? 'postgresql://eti:eti_password@127.0.0.1:5432/energy_trade_inspection'
const REPEX_URL = 'https://goldencopy.gleif.org/api/v2/golden-copies/publishes/repex/latest.json'
const INSERT_BATCH = 5000   // rows per multi-row INSERT into staging table

const pool = new Pool({ connectionString: DB_URL, max: 3 })
const val = (x) => x?.['$'] ?? null

async function run() {
  const startMs = Date.now()
  let totalStreamed = 0
  let batch = []

  const client = await pool.connect()
  try {
    console.log('[gleif:repex:full] Starting full REPEX import...')

    // ── Phase 1: create staging table ─────────────────────────────────────────
    await client.query(`
      CREATE TEMP TABLE IF NOT EXISTS gleif_repex_staging (
        lei       TEXT NOT NULL,
        exc_type  TEXT NOT NULL,
        exc_reason TEXT
      )
    `)
    console.log('[gleif:repex:full] Staging table created.')

    // ── Download + stream into staging ────────────────────────────────────────
    const res = await fetch(REPEX_URL, {
      redirect: 'follow',
      headers: { 'Accept': '*/*', 'User-Agent': 'EnergyTradeInspection/1.0' },
    })
    if (!res.ok || !res.body) throw new Error(`GLEIF download failed: HTTP ${res.status}`)
    console.log(`[gleif:repex:full] Connected (HTTP ${res.status}). Streaming into staging...`)

    const nodeStream = Readable.fromWeb(res.body)

    /**
     * Insert a batch into the staging table using a multi-row VALUES clause.
     * No index exists yet, so inserts are very fast.
     */
    const flushToStaging = async (rows) => {
      if (rows.length === 0) return
      // Build: INSERT INTO gleif_repex_staging VALUES ($1,$2,$3),($4,$5,$6),...
      const placeholders = rows.map((_, i) => `($${i*3+1},$${i*3+2},$${i*3+3})`).join(',')
      await client.query(
        `INSERT INTO gleif_repex_staging (lei, exc_type, exc_reason) VALUES ${placeholders}`,
        rows.flat(),
      )
      totalStreamed += rows.length
      if (totalStreamed % 500_000 === 0) {
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(0)
        console.log(`[gleif:repex:full] staged ${totalStreamed.toLocaleString()} records... (${elapsed}s)`)
      }
    }

    await new Promise((resolve, reject) => {
      nodeStream.pipe(unzipper.Parse()).on('entry', (entry) => {
        if (entry.name?.endsWith('.json') || entry.path?.endsWith('.json')) {
          const jsonStream = entry.pipe(chain([parser(), pick({ filter: 'exceptions' }), streamArray()]))
          let flushPromise = Promise.resolve()

          jsonStream.on('data', ({ value: r }) => {
            const lei      = val(r?.LEI)
            const excType  = val(r?.ExceptionCategory)
            const excReason = val(Array.isArray(r?.ExceptionReason) ? r.ExceptionReason[0] : r?.ExceptionReason)
            if (!lei || !excType) return

            batch.push([lei, excType, excReason])

            if (batch.length >= INSERT_BATCH) {
              const toFlush = batch.splice(0)
              jsonStream.pause()
              flushPromise = flushPromise
                .then(() => flushToStaging(toFlush))
                .then(() => jsonStream.resume())
                .catch((err) => { reject(err) })
            }
          })

          jsonStream.on('error', reject)
          jsonStream.on('end', () => {
            flushPromise
              .then(() => flushToStaging(batch.splice(0)))
              .then(resolve)
              .catch(reject)
          })
        } else {
          entry.autodrain()
        }
      }).on('error', reject)
    })

    const t1 = ((Date.now() - startMs) / 1000).toFixed(0)
    console.log(`[gleif:repex:full] Phase 1 done: ${totalStreamed.toLocaleString()} records staged in ${t1}s`)

    // ── Phase 2: index + analyze ──────────────────────────────────────────────
    console.log('[gleif:repex:full] Phase 2: building index on staging...')
    await client.query('CREATE INDEX ON gleif_repex_staging (lei)')
    await client.query('ANALYZE gleif_repex_staging')
    const t2 = ((Date.now() - startMs) / 1000).toFixed(0)
    console.log(`[gleif:repex:full] Phase 2 done in ${t2}s`)

    // ── Phase 3: single bulk UPDATE ───────────────────────────────────────────
    console.log('[gleif:repex:full] Phase 3: bulk UPDATE lei_cache from staging...')
    const { rowCount } = await client.query(`
      UPDATE lei_cache lc
         SET reporting_exception_type   = s.exc_type,
             reporting_exception_reason = s.exc_reason,
             last_synced_at             = NOW()
        FROM (
          SELECT DISTINCT ON (lei) lei, exc_type, exc_reason
            FROM gleif_repex_staging
           ORDER BY lei
        ) AS s
       WHERE lc.lei = s.lei
    `)
    const t3 = ((Date.now() - startMs) / 1000).toFixed(0)
    console.log(`[gleif:repex:full] Phase 3 done: ${rowCount.toLocaleString()} rows updated in ${t3}s`)

    // ── Phase 4: sync log ─────────────────────────────────────────────────────
    const durationMs = Date.now() - startMs
    await client.query(
      `INSERT INTO sanctions_sync_log(source,status,record_count,duration_ms)
       VALUES('gleif:exceptions:full','success',$1,$2)`,
      [rowCount, durationMs],
    )
    console.log(`[gleif:repex:full] Done in ${(durationMs / 1000).toFixed(0)}s — ${rowCount.toLocaleString()} lei_cache rows updated.`)
    process.exit(0)
  } catch (err) {
    const durationMs = Date.now() - startMs
    await client.query(
      `INSERT INTO sanctions_sync_log(source,status,error_message,duration_ms)
       VALUES('gleif:exceptions:full','error',$1,$2)`,
      [String(err?.message ?? err), durationMs],
    ).catch(() => {})
    console.error('[gleif:repex:full] Failed:', err?.message ?? err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

run()

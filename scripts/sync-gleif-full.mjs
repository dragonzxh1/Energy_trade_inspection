#!/usr/bin/env node
/**
 * sync-gleif-full.mjs
 *
 * Downloads GLEIF Golden Copy Level 1 (LEI2) JSON.zip and bulk-upserts
 * ACTIVE entities into the lei_cache table.
 *
 * Triggered by: syncLeiFull() in gleif-golden-copy.ts via child_process.spawn()
 *
 * Strategy:
 *   1. Fetch GLEIF v2 API URL (follows 302 redirect to ZIP on /storage/)
 *   2. Pipe response through unzipper.Parse() → stream-json StreamArray
 *   3. Filter: entity.status === 'ACTIVE' only (per D-02)
 *   4. Batch upsert 1000 rows at a time, commit every 10K rows (per RESEARCH.md Pitfall 6)
 *   5. Write to sanctions_sync_log on success or error
 *
 * Environment:
 *   DATABASE_URL  PostgreSQL connection string (required)
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
const GLEIF_URL = 'https://goldencopy.gleif.org/api/v2/golden-copies/publishes/lei2/latest.json'
const BATCH_SIZE = 1000

const pool = new Pool({ connectionString: DB_URL, max: 3 })

/** Extract string from GLEIF { "$": "value" } wrapper */
const val = (x) => x?.['$'] ?? null

async function run() {
  const startMs = Date.now()
  let totalCount = 0
  let batch = []
  let batchCommitCount = 0
  let lastProgressAt = 0

  const client = await pool.connect()

  try {
    console.log('[gleif:full] Starting full Level 1 import...')
    console.log('[gleif:full] Downloading from GLEIF Golden Copy API...')

    const res = await fetch(GLEIF_URL, {
      redirect: 'follow',
      headers: { 'Accept': '*/*', 'User-Agent': 'EnergyTradeInspection/1.0' },
    })
    if (!res.ok || !res.body) {
      throw new Error(`GLEIF download failed: HTTP ${res.status}`)
    }

    console.log(`[gleif:full] Connected to GLEIF (HTTP ${res.status}). Streaming ZIP...`)

    const nodeStream = Readable.fromWeb(res.body)

    await client.query('BEGIN')

    const flushBatch = async () => {
      if (batch.length === 0) return
      const cols = 9
      const placeholders = batch
        .map((_, i) => {
          const base = i * cols
          return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9})`
        })
        .join(',')
      await client.query(
        `INSERT INTO lei_cache
           (lei, legal_name, jurisdiction, country,
            registration_authority_id, registration_authority_entity_id,
            initial_registration_date, entity_status, last_synced_at)
         VALUES ${placeholders}
         ON CONFLICT (lei) DO UPDATE SET
           legal_name                       = EXCLUDED.legal_name,
           jurisdiction                     = EXCLUDED.jurisdiction,
           country                          = EXCLUDED.country,
           registration_authority_id        = EXCLUDED.registration_authority_id,
           registration_authority_entity_id = EXCLUDED.registration_authority_entity_id,
           initial_registration_date        = EXCLUDED.initial_registration_date,
           entity_status                    = EXCLUDED.entity_status,
           last_synced_at                   = NOW()`,
        batch.flat(),
      )
      totalCount += batch.length
      batchCommitCount += batch.length
      batch = []

      // Commit every 10K rows to prevent WAL overflow (RESEARCH.md Pitfall 6)
      if (batchCommitCount >= 10_000) {
        await client.query('COMMIT')
        await client.query('BEGIN')
        batchCommitCount = 0
      }

      // Progress report every 100K records (per D-03)
      if (totalCount - lastProgressAt >= 100_000) {
        const elapsed = ((Date.now() - startMs) / 1000).toFixed(0)
        console.log(`[gleif:full] processed ${totalCount.toLocaleString()} records... (${elapsed}s elapsed)`)
        lastProgressAt = totalCount
      }
    }

    await new Promise((resolve, reject) => {
      nodeStream
        .pipe(unzipper.Parse())
        .on('entry', (entry) => {
          if (entry.name?.endsWith('.json') || entry.path?.endsWith('.json')) {
            // GLEIF full export: {"records": [...]} — use Pick to select the array key
            const jsonStream = entry.pipe(chain([parser(), pick({ filter: 'records' }), streamArray()]))
            // Process records sequentially via promise chain to avoid async-callback races
            let processing = Promise.resolve()
            jsonStream.on('data', ({ value }) => {
              processing = processing.then(async () => {
                const lei = val(value?.LEI)
                const legalName = val(value?.Entity?.LegalName)
                if (!lei || !legalName) return

                // D-02: Active entities only for bulk import
                const status = val(value?.Entity?.EntityStatus)
                if (status !== 'ACTIVE') return

                const jurisdiction = val(value?.Entity?.LegalJurisdiction)
                const jur2 = jurisdiction ? jurisdiction.slice(0, 2).toUpperCase() : null

                batch.push([
                  lei,
                  legalName,
                  jur2,
                  val(value?.Entity?.LegalAddress?.Country),
                  val(value?.Entity?.RegistrationAuthority?.RegistrationAuthorityID),
                  val(value?.Entity?.RegistrationAuthority?.RegistrationAuthorityEntityID),
                  val(value?.Registration?.InitialRegistrationDate),
                  'ACTIVE',
                  new Date().toISOString(),
                ])

                if (batch.length >= BATCH_SIZE) {
                  await flushBatch()
                }
              }).catch((err) => { reject(err); return Promise.reject(err) })
            })
            jsonStream.on('error', reject)
            jsonStream.on('end', () => {
              processing.then(async () => {
                await flushBatch()
                resolve()
              }).catch(reject)
            })
          } else {
            entry.autodrain()
          }
        })
        .on('error', reject)
    })

    await client.query('COMMIT')

    const durationMs = Date.now() - startMs
    await client.query(
      `INSERT INTO sanctions_sync_log (source, status, record_count, duration_ms)
       VALUES ('gleif:full', 'success', $1, $2)`,
      [totalCount, durationMs],
    )

    console.log(`[gleif:full] Import complete: ${totalCount.toLocaleString()} ACTIVE records in ${(durationMs/1000).toFixed(0)}s`)
    process.exit(0)
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const durationMs = Date.now() - startMs
    await client.query(
      `INSERT INTO sanctions_sync_log (source, status, error_message, duration_ms)
       VALUES ('gleif:full', 'error', $1, $2)`,
      [String(err?.message ?? err), durationMs],
    ).catch(() => {})
    console.error('[gleif:full] Import failed:', err?.message ?? err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

run()

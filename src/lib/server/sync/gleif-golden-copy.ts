/**
 * GLEIF Golden Copy sync module.
 *
 * syncLeiFull()       — spawns sync-gleif-full.mjs child process (Level 1, 875 MB)
 * syncLeiDelta()      — in-process Level 1 delta (LEI2 LastDay, ~3 MB)
 * syncLeiLevel2()     — in-process Level 2 RR delta (ownership chain, ~32 MB delta)
 * syncLeiExceptions() — in-process REPEX delta (reporting exceptions, ~58 MB delta)
 */

import { Readable } from 'node:stream'
import path from 'node:path'
import { spawn } from 'node:child_process'
import unzipper from 'unzipper'
import { parser } from 'stream-json'
import { pick } from 'stream-json/filters/pick.js'
import { streamArray } from 'stream-json/streamers/stream-array.js'
import { chain } from 'stream-chain'
import { db } from '@/lib/server/db'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LeiCacheRow {
  lei: string
  legal_name: string
  jurisdiction: string | null
  country: string | null
  registration_authority_id: string | null
  registration_authority_entity_id: string | null
  initial_registration_date: string | null
  entity_status: string
  entity_category: string | null
  direct_parent_lei: string | null
  ultimate_parent_lei: string | null
  reporting_exception_type: string | null
  reporting_exception_reason: string | null
  last_synced_at: string
  created_at: string
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Extract the string value from GLEIF's XML-to-JSON { "$": "value" } wrapper. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const val = (x: any): string | null => x?.['$'] ?? null

const GLEIF_BASE = 'https://goldencopy.gleif.org/api/v2/golden-copies/publishes'

const URLS = {
  lei2Full:   `${GLEIF_BASE}/lei2/latest.json`,
  lei2Delta:  `${GLEIF_BASE}/lei2/latest.json?delta=LastDay`,
  rrFull:     `${GLEIF_BASE}/rr/latest.json`,
  rrDelta:    `${GLEIF_BASE}/rr/latest.json?delta=LastDay`,
  repexFull:  `${GLEIF_BASE}/repex/latest.json`,
  repexDelta: `${GLEIF_BASE}/repex/latest.json?delta=LastDay`,
} as const

const BATCH_SIZE = 1000

/**
 * Download a GLEIF ZIP file and stream individual JSON records.
 * The API returns a ZIP containing a single JSON file with structure { [arrayKey]: [...] }.
 * Calls onRecord for each item in the array, sequentially (not concurrent).
 */
async function streamGleifRecords(
  apiUrl: string,
  arrayKey: string,
  onRecord: (record: unknown) => Promise<void>,
): Promise<number> {
  const res = await fetch(apiUrl, {
    redirect: 'follow',
    headers: { 'Accept': '*/*', 'User-Agent': 'EnergyTradeInspection/1.0' },
  })
  if (!res.ok || !res.body) {
    throw new Error(`GLEIF download failed: HTTP ${res.status} for ${apiUrl}`)
  }

  // Convert Web ReadableStream → Node.js Readable
  const nodeStream = Readable.fromWeb(res.body as import('stream/web').ReadableStream)

  let count = 0
  return new Promise((resolve, reject) => {
    nodeStream
      .pipe(unzipper.Parse())
      .on('entry', (entry: { name: string; path: string; pipe: (dest: unknown) => unknown; autodrain: () => void }) => {
        // ZIP contains a single JSON file; skip directories
        if (entry.name?.endsWith('.json') || entry.path?.endsWith('.json')) {
          // GLEIF JSON format: { [arrayKey]: [...records] }
          // Use Pick to select the array, then StreamArray to iterate items.
          // Chain records sequentially via promise chain to avoid EventEmitter async-callback races.
          const jsonStream = (entry as unknown as NodeJS.ReadableStream).pipe(
            chain([parser(), pick({ filter: arrayKey }), streamArray()])
          ) as NodeJS.EventEmitter
          let processing = Promise.resolve()
          jsonStream.on('data', ({ value }: { value: unknown }) => {
            processing = processing.then(async () => {
              await onRecord(value)
              count++
            }).catch((err) => { reject(err); return Promise.reject(err) })
          })
          jsonStream.on('error', reject)
          jsonStream.on('end', () => { processing.then(() => resolve(count)).catch(reject) })
        } else {
          (entry as unknown as { autodrain(): void }).autodrain()
        }
      })
      .on('error', reject)
  })
}

async function writeSyncLog(
  source: string,
  status: 'success' | 'error',
  count: number,
  durationMs: number,
  errorMsg?: string,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO sanctions_sync_log (source, status, record_count, duration_ms, error_message)
       VALUES ($1, $2, $3, $4, $5)`,
      [source, status, status === 'success' ? count : null, durationMs, errorMsg ?? null],
    )
  } catch (err) {
    console.error('[gleif] sync log write failed:', err)
  }
}

// ── syncLeiFull — spawns child process ────────────────────────────────────────

/**
 * Triggers the full Level 1 LEI2 Golden Copy import as a detached child process.
 * The actual download + UPSERT is done in scripts/sync-gleif-full.mjs.
 * Returns immediately with the child PID.
 */
export async function syncLeiFull(): Promise<{ pid: number | undefined; message: string }> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'sync-gleif-full.mjs')
  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  })
  child.unref()
  console.log(`[gleif] Full sync started as background process PID ${child.pid}`)
  return { pid: child.pid, message: 'GLEIF full sync started in background. Check sanctions_sync_log for progress.' }
}

// ── syncLeiDelta — in-process Level 1 delta ──────────────────────────────────

/**
 * Downloads the LEI2 daily delta (LastDay, ~3 MB) and upserts into lei_cache.
 * Commits every 10K records to avoid long-running transactions.
 */
export async function syncLeiDelta(): Promise<{ count: number }> {
  const startMs = Date.now()
  let totalCount = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let batch: any[][] = []
  let batchCommitCount = 0

  const client = await db.connect()
  try {
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

      // Commit every 10K records to avoid WAL overflow (per RESEARCH.md Pitfall 6)
      if (batchCommitCount >= 10_000) {
        await client.query('COMMIT')
        await client.query('BEGIN')
        batchCommitCount = 0
        console.log(`[gleif:delta] committed ${totalCount.toLocaleString()} records...`)
      }
    }

    await client.query('BEGIN')

    await streamGleifRecords(URLS.lei2Delta, 'records', async (record: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = record as any
      const lei = val(r?.LEI)
      const legalName = val(r?.Entity?.LegalName)
      if (!lei || !legalName) return

      const jurisdiction = val(r?.Entity?.LegalJurisdiction)
      const jur2 = jurisdiction ? jurisdiction.slice(0, 2).toUpperCase() : null

      batch.push([
        lei,
        legalName,
        jur2,
        val(r?.Entity?.LegalAddress?.Country),
        val(r?.Entity?.RegistrationAuthority?.RegistrationAuthorityID),
        val(r?.Entity?.RegistrationAuthority?.RegistrationAuthorityEntityID),
        val(r?.Registration?.InitialRegistrationDate),
        val(r?.Entity?.EntityStatus) ?? 'ACTIVE',
        new Date().toISOString(),
      ])

      if (batch.length >= BATCH_SIZE) await flushBatch()
      if (totalCount % 100_000 === 0 && totalCount > 0) {
        console.log(`[gleif:delta] processed ${totalCount.toLocaleString()} records...`)
      }
    })

    await flushBatch()
    await client.query('COMMIT')

    await writeSyncLog('gleif:delta', 'success', totalCount, Date.now() - startMs)
    console.log(`[gleif:delta] sync complete: ${totalCount.toLocaleString()} records in ${Date.now() - startMs}ms`)
    return { count: totalCount }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    await writeSyncLog('gleif:delta', 'error', 0, Date.now() - startMs, String(err))
    throw err
  } finally {
    client.release()
  }
}

// ── syncLeiLevel2 — ownership chain (RR delta or full) ───────────────────────

async function runLeiLevel2Sync(url: string, label: string): Promise<{ count: number }> {
  const startMs = Date.now()
  let totalCount = 0

  const client = await db.connect()

  // Separate arrays for each relationship type — avoids per-row UPDATE locks held in a long tx.
  const directChildren: string[] = []
  const directParents: string[] = []
  const ultimateChildren: string[] = []
  const ultimateParents: string[] = []

  // Each flush is one short-lived auto-commit UPDATE via unnest — no long open transaction.
  const flushDirect = async () => {
    if (directChildren.length === 0) return
    await client.query(
      `UPDATE lei_cache AS t
       SET direct_parent_lei = v.parent, last_synced_at = NOW()
       FROM (SELECT unnest($1::text[]) AS child, unnest($2::text[]) AS parent) v
       WHERE t.lei = v.child`,
      [directChildren, directParents],
    )
    totalCount += directChildren.length
    directChildren.length = 0
    directParents.length = 0
  }

  const flushUltimate = async () => {
    if (ultimateChildren.length === 0) return
    await client.query(
      `UPDATE lei_cache AS t
       SET ultimate_parent_lei = v.parent, last_synced_at = NOW()
       FROM (SELECT unnest($1::text[]) AS child, unnest($2::text[]) AS parent) v
       WHERE t.lei = v.child`,
      [ultimateChildren, ultimateParents],
    )
    totalCount += ultimateChildren.length
    ultimateChildren.length = 0
    ultimateParents.length = 0
  }

  try {
    await streamGleifRecords(url, 'relations', async (record: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = record as any
      const rel = r?.RelationshipRecord?.Relationship
      if (!rel) return

      const childLei = val(rel?.StartNode?.NodeID)
      const parentLei = val(rel?.EndNode?.NodeID)
      const relType = val(rel?.RelationshipType)
      if (!childLei || !parentLei || !relType) return

      if (relType === 'IS_DIRECTLY_CONSOLIDATED_BY') {
        directChildren.push(childLei)
        directParents.push(parentLei)
        if (directChildren.length >= BATCH_SIZE) await flushDirect()
      } else if (relType === 'IS_ULTIMATELY_CONSOLIDATED_BY') {
        ultimateChildren.push(childLei)
        ultimateParents.push(parentLei)
        if (ultimateChildren.length >= BATCH_SIZE) await flushUltimate()
      }
    })

    await flushDirect()
    await flushUltimate()

    await writeSyncLog(label, 'success', totalCount, Date.now() - startMs)
    console.log(`[${label}] sync complete: ${totalCount.toLocaleString()} relationships in ${Date.now() - startMs}ms`)
    return { count: totalCount }
  } catch (err) {
    await writeSyncLog(label, 'error', 0, Date.now() - startMs, String(err))
    throw err
  } finally {
    client.release()
  }
}

/** Downloads the Level 2 RR daily delta and updates ownership chain on existing lei_cache rows. */
export async function syncLeiLevel2(): Promise<{ count: number }> {
  return runLeiLevel2Sync(URLS.rrDelta, 'gleif:level2')
}

/** Downloads the full Level 2 RR Golden Copy and updates ownership chain on all lei_cache rows. */
export async function syncLeiLevel2Full(): Promise<{ count: number }> {
  return runLeiLevel2Sync(URLS.rrFull, 'gleif:level2:full')
}

// ── syncLeiExceptions — reporting exceptions (REPEX delta or full) ────────────

async function runLeiExceptionsSync(url: string, label: string): Promise<{ count: number }> {
  const startMs = Date.now()
  let totalCount = 0

  const client = await db.connect()

  const leis: string[] = []
  const excTypes: string[] = []
  const excReasons: Array<string | null> = []

  const flushBatch = async () => {
    if (leis.length === 0) return
    await client.query(
      `UPDATE lei_cache AS t
       SET reporting_exception_type = v.exc_type,
           reporting_exception_reason = v.exc_reason,
           last_synced_at = NOW()
       FROM (
         SELECT unnest($1::text[]) AS lei,
                unnest($2::text[]) AS exc_type,
                unnest($3::text[]) AS exc_reason
       ) v
       WHERE t.lei = v.lei`,
      [leis, excTypes, excReasons],
    )
    totalCount += leis.length
    leis.length = 0
    excTypes.length = 0
    excReasons.length = 0
  }

  try {
    await streamGleifRecords(url, 'exceptions', async (record: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = record as any
      // REPEX format: fields are at root level; ExceptionReason is an array
      const lei = val(r?.LEI)
      const excType = val(r?.ExceptionCategory)
      const excReason = val(Array.isArray(r?.ExceptionReason) ? r.ExceptionReason[0] : r?.ExceptionReason)
      if (!lei || !excType) return

      leis.push(lei)
      excTypes.push(excType)
      excReasons.push(excReason)
      if (leis.length >= BATCH_SIZE) await flushBatch()
    })

    await flushBatch()
    await writeSyncLog(label, 'success', totalCount, Date.now() - startMs)
    console.log(`[${label}] sync complete: ${totalCount.toLocaleString()} records in ${Date.now() - startMs}ms`)
    return { count: totalCount }
  } catch (err) {
    await writeSyncLog(label, 'error', 0, Date.now() - startMs, String(err))
    throw err
  } finally {
    client.release()
  }
}

/** Downloads the REPEX daily delta and updates reporting exceptions on existing lei_cache rows. */
export async function syncLeiExceptions(): Promise<{ count: number }> {
  return runLeiExceptionsSync(URLS.repexDelta, 'gleif:exceptions')
}

/** Downloads the full REPEX Golden Copy and updates reporting exceptions on all lei_cache rows. */
export async function syncLeiExceptionsFull(): Promise<{ count: number }> {
  return runLeiExceptionsSync(URLS.repexFull, 'gleif:exceptions:full')
}

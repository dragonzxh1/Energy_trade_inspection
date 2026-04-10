import fs from 'node:fs'
import path from 'node:path'
import { db } from './db'

const migrationsDir = path.join(process.cwd(), 'db', 'migrations')
let applied = false
const MIGRATION_LOCK_ID = 402601

/** Wait for Postgres to become ready before applying migrations. */
async function waitForDb(maxRetries = 10, delayMs = 1000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const client = await db.connect()
      await client.query('SELECT 1')
      client.release()
      return
    } catch {
      if (i < maxRetries - 1) {
        console.log(`[migrations] DB not ready, retrying in ${delayMs}ms (${i + 1}/${maxRetries})`)
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }
  throw new Error('[migrations] Could not connect to the database after retries')
}

export async function applyMigrations(): Promise<void> {
  if (applied) return

  await waitForDb()

  const client = await db.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b))

    for (const filename of files) {
      const exists = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename]
      )
      if (exists.rowCount && exists.rowCount > 0) continue

      // Strip UTF-8 BOM if a Windows editor added one.
      const raw = fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
      const sql = raw.replace(/^\uFEFF/, '')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
      console.log(`[migrations] applied ${filename}`)
    }

    await client.query('COMMIT')
    applied = true
    console.log('[migrations] all migrations applied')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[migrations] 杩佺Щ澶辫触:', error)
    throw error
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {})
    client.release()
  }
}


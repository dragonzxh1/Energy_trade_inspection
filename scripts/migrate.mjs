import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const { Client } = pg

const connectionString = process.env.DATABASE_URL || 'postgresql://eti:eti_password@localhost:5432/energy_trade_inspection'
const migrationsDir = path.join(process.cwd(), 'db', 'migrations')

async function run() {
  const client = new Client({ connectionString })
  await client.connect()

  try {
    await client.query('BEGIN')
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
    for (const filename of files) {
      const exists = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename])
      if (exists.rowCount && exists.rowCount > 0) {
        console.log(`skip ${filename}`)
        continue
      }

      const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
      console.log(`applied ${filename}`)
    }

    await client.query('COMMIT')
    console.log('migrations complete')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

import fs from 'node:fs'
import path from 'node:path'
import { db } from './db'

const migrationsDir = path.join(process.cwd(), 'db', 'migrations')
let applied = false
const MIGRATION_LOCK_ID = 402601

/** 等待 Postgres 就绪，最多重试 N 次（Docker 启动时 DB 可能比应用慢） */
async function waitForDb(maxRetries = 10, delayMs = 1000): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const client = await db.connect()
      await client.query('SELECT 1')
      client.release()
      return
    } catch {
      if (i < maxRetries - 1) {
        console.log(`[migrations] DB 未就绪，${delayMs}ms 后重试 (${i + 1}/${maxRetries})…`)
        await new Promise((r) => setTimeout(r, delayMs))
      }
    }
  }
  throw new Error('[migrations] 无法连接到数据库，已超过最大重试次数')
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

      // 去掉 UTF-8 BOM（Windows 编辑器常见）
      const raw = fs.readFileSync(path.join(migrationsDir, filename), 'utf8')
      const sql = raw.replace(/^\uFEFF/, '')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
      console.log(`[migrations] ✓ ${filename}`)
    }

    await client.query('COMMIT')
    applied = true
    console.log('[migrations] 全部迁移已应用')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('[migrations] 迁移失败:', error)
    throw error
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {})
    client.release()
  }
}

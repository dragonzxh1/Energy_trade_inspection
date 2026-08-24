#!/usr/bin/env node
/**
 * sync-opensanctions.mjs
 *
 * 下载 OpenSanctions 合并 CSV 并通过 PostgreSQL COPY 高效导入。
 * 策略：PostgreSQL native COPY（不在 JS 中解析 CSV，避免内存爆炸）
 *
 *   1. 检查 index.json 版本 — 与上次相同则跳过
 *   2. 下载 CSV 到临时文件（流式，低内存）
 *   3. 创建 raw staging 表（16 列全为 TEXT）
 *   4. PostgreSQL COPY 导入 raw staging（通过 Docker exec psql 或直接 psql）
 *   5. INSERT ... SELECT 转换并合并到 sanctions_entries
 *   6. 删除不在 staging 中的旧条目
 *   7. 写日志，清理
 *
 * 环境变量：
 *   DATABASE_URL       PostgreSQL 连接串（必填）
 *   POSTGRES_CONTAINER Docker 容器名（默认 eti-postgres；设为空则用直接 psql）
 *   FORCE_SYNC         设为 "1" 忽略版本检查
 *   PSQL_PATH          psql 可执行路径（默认 psql）
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import pg from 'pg'
import { downloadToFile, fetchJson } from './lib/http-client.mjs'

const { Pool } = pg

const DB_URL    = process.env.DATABASE_URL
const INDEX_URL = 'https://data.opensanctions.org/datasets/latest/default/index.json'
const CSV_URL   = 'https://data.opensanctions.org/datasets/latest/default/targets.simple.csv'
const CONTAINER = process.env.POSTGRES_CONTAINER ?? 'eti-postgres'
const PSQL      = process.env.PSQL_PATH ?? 'psql'
const FORCE     = process.env.FORCE_SYNC === '1'
const SYNC_LOCK_ID = 402602
// LOCAL_CSV：指向已下载的 CSV 文件路径，跳过网络下载（e.g. LOCAL_CSV=./targets.simple.csv）
const LOCAL_CSV = process.env.LOCAL_CSV ?? null
const HTTP_OPTIONS = {
  headers: { 'User-Agent': 'EnergyTradeInspection/1.0' },
  maxRedirects: 5,
  timeoutMs: 30_000,
}

if (!DB_URL) {
  throw new Error('DATABASE_URL is required; refusing to use an embedded database credential')
}

const pool = new Pool({ connectionString: DB_URL, max: 3 })

// ─── Network helpers ──────────────────────────────────────────────────────────

/**
 * 流式下载 — 不把文件整体读入内存，直接写磁盘
 */
async function downloadFile(url, dest) {
  let lastReport = 0
  const { bytes } = await downloadToFile(url, dest, {
    ...HTTP_OPTIONS,
    onProgress(received) {
      if (received - lastReport >= 10_000_000) {
        process.stdout.write(`\r  已下载 ${(received / 1_000_000).toFixed(0)} MB...`)
        lastReport = received
      }
    },
  })
  process.stdout.write(`\r  已下载 ${(bytes / 1_000_000).toFixed(0)} MB\n`)
}

// ─── PostgreSQL COPY helpers ──────────────────────────────────────────────────

/**
 * 通过 Docker exec psql 执行 COPY FROM — 适用于本地 Docker 开发环境
 */
function databaseIdentity(dbUrl) {
  const parsed = new URL(dbUrl)
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported DATABASE_URL protocol: ${parsed.protocol}`)
  }
  return {
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    password: decodeURIComponent(parsed.password),
    user: decodeURIComponent(parsed.username),
    parsed,
  }
}

function postgresProcessEnv(dbUrl) {
  const { database, password, user, parsed } = databaseIdentity(dbUrl)
  const env = {
    ...process.env,
    PGDATABASE: database,
    PGHOST: parsed.hostname,
    PGPASSWORD: password,
    PGPORT: parsed.port || '5432',
    PGUSER: user,
  }
  delete env.DATABASE_URL
  const sslVariables = {
    sslcert: 'PGSSLCERT',
    sslcrl: 'PGSSLCRL',
    sslkey: 'PGSSLKEY',
    sslmode: 'PGSSLMODE',
    sslrootcert: 'PGSSLROOTCERT',
  }
  for (const [queryName, envName] of Object.entries(sslVariables)) {
    const value = parsed.searchParams.get(queryName)
    if (value) env[envName] = value
  }
  return env
}

function copyViaDocker(localFile, dbUrl, tableName) {
  // 将文件复制进容器
  const containerPath = `/tmp/opensanctions-${process.pid}-${Date.now()}.csv`
  const { database, user } = databaseIdentity(dbUrl)
  console.log(`[sync] 将 CSV 复制到容器 ${CONTAINER}...`)
  execFileSync('docker', ['cp', localFile, `${CONTAINER}:${containerPath}`], { stdio: 'inherit' })

  try {
    console.log('[sync] 执行 PostgreSQL COPY...')
    execFileSync('docker', [
      'exec', CONTAINER,
      'psql', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', database,
      '-c', `\\COPY ${tableName} FROM '${containerPath}' CSV HEADER`,
    ], { stdio: 'inherit' })
  } finally {
    try {
      execFileSync('docker', ['exec', CONTAINER, 'rm', '-f', containerPath], { stdio: 'ignore' })
    } catch {
      console.warn(`[sync] 警告：无法删除容器临时文件 ${containerPath}`)
    }
  }
}

/**
 * 通过宿主机 psql 执行 COPY FROM（生产/非 Docker 环境）
 */
function copyViaPsql(localFile, dbUrl, tableName) {
  const absFile = path.resolve(localFile).replace(/\\/g, '/').replaceAll("'", "''")
  const sql = `\\COPY ${tableName} FROM '${absFile}' CSV HEADER`
  console.log('[sync] 执行 psql COPY...')
  execFileSync(PSQL, ['-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: postgresProcessEnv(dbUrl),
    stdio: 'inherit',
  })
}

/**
 * 检测 Docker 是否可用且容器正在运行
 */
function isDockerAvailable() {
  try {
    const out = execFileSync(
      'docker',
      ['inspect', '--format={{.State.Running}}', CONTAINER],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
    return out === 'true'
  } catch {
    return false
  }
}

/**
 * 检测宿主机 psql 是否可用
 */
function isPsqlAvailable() {
  try {
    execFileSync(PSQL, ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function getLastVersion(client) {
  try {
    const { rows } = await client.query(`
      SELECT version FROM sanctions_sync_log
      WHERE source = 'opensanctions' AND status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    `)
    return rows[0]?.version ?? null
  } catch {
    return null
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  const startMs = Date.now()
  const client = await pool.connect()
  const stagingTable = `sanctions_staging_${process.pid}_${Date.now()}`
  let lockAcquired = false
  let tempDir = null
  let tempFile = null

  try {
    const { rows: lockRows } = await client.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [SYNC_LOCK_ID],
    )
    lockAcquired = lockRows[0]?.acquired === true
    if (!lockAcquired) {
      console.log('[sync] 已有 OpenSanctions 同步正在执行，本次安全跳过')
      return
    }

    // 1. 版本检查
    console.log('[sync] 正在获取 OpenSanctions 版本信息...')
    const index = await fetchJson(INDEX_URL, HTTP_OPTIONS)
    const version = index.updated_at ?? index.last_change ?? new Date().toISOString()
    console.log(`[sync] 远端版本: ${version}`)

    if (!FORCE) {
      const lastVersion = await getLastVersion(client)
      if (lastVersion && lastVersion === version) {
        console.log('[sync] 数据已是最新版本，无需同步。（使用 FORCE_SYNC=1 强制重新下载）')
        return
      }
      if (lastVersion) console.log(`[sync] 上次版本: ${lastVersion} → 检测到新数据`)
    } else {
      console.log('[sync] FORCE_SYNC=1，跳过版本检查')
    }

    // 2. 下载 CSV（或使用本地文件）
    let csvFile
    if (LOCAL_CSV) {
      const resolved = path.resolve(LOCAL_CSV)
      if (!fs.existsSync(resolved)) throw new Error(`LOCAL_CSV 文件不存在: ${resolved}`)
      csvFile = resolved
      console.log(`[sync] 使用本地 CSV: ${csvFile}`)
    } else {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eti-opensanctions-'))
      tempFile = path.join(tempDir, 'targets.simple.csv')
      csvFile = tempFile
      console.log(`[sync] 下载 CSV: ${CSV_URL}`)
      await downloadFile(CSV_URL, csvFile)
    }
    const fileSize = fs.statSync(csvFile).size
    console.log(`[sync] 文件大小: ${(fileSize / 1_000_000).toFixed(1)} MB`)

    // 3. 创建 raw staging 表（列名与 CSV header 一一对应，全部 TEXT）
    // 注：不加 PRIMARY KEY，让 COPY 直接写入，之后再建索引供 DELETE 使用
    await client.query(`
      CREATE TABLE ${stagingTable} (
        id          TEXT,
        schema      TEXT,
        name        TEXT,
        aliases     TEXT,
        birth_date  TEXT,
        countries   TEXT,
        addresses   TEXT,
        identifiers TEXT,
        sanctions   TEXT,
        phones      TEXT,
        emails      TEXT,
        program_ids TEXT,
        dataset     TEXT,
        first_seen  TEXT,
        last_seen   TEXT,
        last_change TEXT
      )
    `)

    // 4. 通过 PostgreSQL COPY 导入 CSV（由 PG 原生解析，极快且内存友好）
    if (isDockerAvailable()) {
      copyViaDocker(csvFile, DB_URL, stagingTable)
    } else if (isPsqlAvailable()) {
      copyViaPsql(csvFile, DB_URL, stagingTable)
    } else {
      throw new Error(
        '无法导入 CSV：Docker 容器未运行且未找到 psql 客户端。\n' +
        `请确保 Docker 容器 "${CONTAINER}" 正在运行，或安装 psql 并设置 PSQL_PATH。`
      )
    }

    // 验证数据量
    const { rows: stgCount } = await client.query(`SELECT COUNT(*)::text AS n FROM ${stagingTable} WHERE id IS NOT NULL AND id <> ''`)
    const totalRows = parseInt(stgCount[0].n, 10)
    console.log(`[sync] Staging 表已载入 ${totalRows.toLocaleString()} 条记录`)

    if (totalRows === 0) throw new Error('CSV 导入后 staging 表为空，请检查文件格式')

    // 建立 staging.id 索引（供 NOT EXISTS 删除查询使用，O(log n) 而非 O(n²)）
    console.log('[sync] 建立 staging 索引...')
    await client.query(`CREATE INDEX ${stagingTable}_id_idx ON ${stagingTable} (id)`)

    // 5. 合并到 sanctions_entries
    console.log('[sync] 合并到 sanctions_entries...')

    // 在事务外先记录当前条目数，用于判断是否需要删除
    const { rows: preMergeCount } = await client.query(`SELECT COUNT(*)::text AS n FROM sanctions_entries`)
    const existingBeforeMerge = parseInt(preMergeCount[0].n, 10)

    await client.query('BEGIN')

    const { rowCount: upserted } = await client.query(`
      INSERT INTO sanctions_entries
        (id, schema, name, search_text, countries, identifiers, sanctions, dataset, last_change, synced_at)
      SELECT
        id,
        COALESCE(NULLIF(schema, ''), 'Unknown'),
        name,
        -- search_text：主名称 + 别名，小写合并，用于 word_similarity() 查询
        lower(name) || CASE WHEN aliases <> '' THEN ' ' || lower(aliases) ELSE '' END,
        NULLIF(countries, ''),
        NULLIF(identifiers, ''),
        NULLIF(sanctions, ''),
        NULLIF(dataset, ''),
        CASE WHEN last_change <> '' THEN last_change::TIMESTAMPTZ ELSE NULL END,
        NOW()
      FROM ${stagingTable}
      WHERE id IS NOT NULL AND id <> '' AND name IS NOT NULL AND name <> ''
      ON CONFLICT (id) DO UPDATE SET
        schema      = EXCLUDED.schema,
        name        = EXCLUDED.name,
        search_text = EXCLUDED.search_text,
        countries   = EXCLUDED.countries,
        identifiers = EXCLUDED.identifiers,
        sanctions   = EXCLUDED.sanctions,
        dataset     = EXCLUDED.dataset,
        last_change = EXCLUDED.last_change,
        synced_at   = NOW()
      WHERE sanctions_entries.last_change IS DISTINCT FROM EXCLUDED.last_change
         OR sanctions_entries.search_text IS DISTINCT FROM EXCLUDED.search_text
    `)

    // 高效删除：用 NOT EXISTS + staging 主键索引（避免慢速 NOT IN）
    // 仅当合并前存在记录时才执行（首次同步跳过，因为 entries 是空的）
    let deleted = 0
    if (existingBeforeMerge > 0) {
      const { rowCount } = await client.query(`
        DELETE FROM sanctions_entries e
        WHERE NOT EXISTS (
          SELECT 1 FROM ${stagingTable} s WHERE s.id = e.id
        )
      `)
      deleted = rowCount ?? 0
    }

    await client.query('COMMIT')
    console.log(`[sync] 合并完成：${upserted} 行更新/新增，${deleted} 行已删除（制裁已撤销）`)

    // 6. 写入同步日志
    const durationMs = Date.now() - startMs
    await client.query(`
      INSERT INTO sanctions_sync_log (source, record_count, status, duration_ms, version)
      VALUES ('opensanctions', $1, 'success', $2, $3)
    `, [upserted, durationMs, version])

    // 最终统计
    const { rows: cntRows } = await client.query(`SELECT COUNT(*)::text AS n FROM sanctions_entries`)
    console.log(`[sync] 完成！共 ${parseInt(cntRows[0].n, 10).toLocaleString()} 条制裁记录，耗时 ${(durationMs / 1000).toFixed(1)}s`)

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    const durationMs = Date.now() - startMs
    await client.query(`
      INSERT INTO sanctions_sync_log (source, status, error_message, duration_ms)
      VALUES ('opensanctions', 'error', $1, $2)
    `, [String(err.message), durationMs]).catch(() => {})
    console.error('[sync] 同步失败:', err.message)
    process.exitCode = 1
  } finally {
    await client.query(`DROP TABLE IF EXISTS ${stagingTable}`).catch(() => {})
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock($1)', [SYNC_LOCK_ID]).catch(() => {})
    }
    client.release()
    await pool.end()
    // 仅删除我们自己下载的临时文件，保留 LOCAL_CSV 用户指定的文件
    if (tempFile) {
      try { fs.rmSync(tempFile, { force: true }) } catch {}
    }
    if (tempDir) {
      try { fs.rmdirSync(tempDir) } catch {}
    }
  }
}

run()

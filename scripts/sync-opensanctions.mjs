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
 *   DATABASE_URL       PostgreSQL 连接串（默认 eti:eti_password@127.0.0.1:5432/...）
 *   POSTGRES_CONTAINER Docker 容器名（默认 eti-postgres；设为空则用直接 psql）
 *   FORCE_SYNC         设为 "1" 忽略版本检查
 *   PSQL_PATH          psql 可执行路径（默认 psql）
 */

import fs from 'node:fs'
import https from 'node:https'
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { execSync, execFileSync } from 'node:child_process'
import pg from 'pg'

const { Pool } = pg

const DB_URL    = process.env.DATABASE_URL ?? 'postgresql://eti:eti_password@127.0.0.1:5432/energy_trade_inspection'
const INDEX_URL = 'https://data.opensanctions.org/datasets/latest/default/index.json'
const CSV_URL   = 'https://data.opensanctions.org/datasets/latest/default/targets.simple.csv'
const TEMP_FILE = path.join(os.tmpdir(), 'opensanctions-targets.csv')
const CONTAINER = process.env.POSTGRES_CONTAINER ?? 'eti-postgres'
const PSQL      = process.env.PSQL_PATH ?? 'psql'
const FORCE     = process.env.FORCE_SYNC === '1'
// LOCAL_CSV：指向已下载的 CSV 文件路径，跳过网络下载（e.g. LOCAL_CSV=./targets.simple.csv）
const LOCAL_CSV = process.env.LOCAL_CSV ?? null

const pool = new Pool({ connectionString: DB_URL, max: 3 })

// ─── Network helpers ──────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    mod.get(url, { headers: { 'User-Agent': 'EnergyTradeInspection/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return resolve(fetchJson(res.headers.location))
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`))
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

/**
 * 流式下载 — 不把文件整体读入内存，直接写磁盘
 */
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    let received = 0
    let lastReport = 0

    const doGet = (targetUrl) => {
      const mod = targetUrl.startsWith('https') ? https : http
      mod.get(targetUrl, { headers: { 'User-Agent': 'EnergyTradeInspection/1.0' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) return doGet(res.headers.location)
        if (res.statusCode !== 200) { file.destroy(); return reject(new Error(`HTTP ${res.statusCode}`)) }
        res.on('data', (chunk) => {
          received += chunk.length
          if (received - lastReport >= 10_000_000) {
            process.stdout.write(`\r  已下载 ${(received / 1_000_000).toFixed(0)} MB...`)
            lastReport = received
          }
        })
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          process.stdout.write(`\r  已下载 ${(received / 1_000_000).toFixed(0)} MB\n`)
          resolve()
        })
        file.on('error', (e) => { file.destroy(); reject(e) })
      }).on('error', (e) => { file.destroy(); reject(e) })
    }
    doGet(url)
  })
}

// ─── PostgreSQL COPY helpers ──────────────────────────────────────────────────

/**
 * 通过 Docker exec psql 执行 COPY FROM — 适用于本地 Docker 开发环境
 */
function copyViaDocker(localFile, dbUrl, tableName) {
  // 将文件复制进容器
  const containerPath = '/tmp/opensanctions.csv'
  console.log(`[sync] 将 CSV 复制到容器 ${CONTAINER}...`)
  execFileSync('docker', ['cp', localFile, `${CONTAINER}:${containerPath}`], { stdio: 'inherit' })

  console.log('[sync] 执行 PostgreSQL COPY...')
  execFileSync('docker', [
    'exec', CONTAINER,
    'psql', '-U', 'eti', '-d', 'energy_trade_inspection',
    '-c', `\\COPY ${tableName} FROM '${containerPath}' CSV HEADER`,
  ], { stdio: 'inherit' })

  // 清理容器内文件
  execFileSync('docker', ['exec', CONTAINER, 'rm', '-f', containerPath]).catch?.(() => {})
}

/**
 * 通过宿主机 psql 执行 COPY FROM（生产/非 Docker 环境）
 */
function copyViaPsql(localFile, dbUrl, tableName) {
  const absFile = path.resolve(localFile).replace(/\\/g, '/')
  const sql = `\\COPY ${tableName} FROM '${absFile}' CSV HEADER`
  console.log('[sync] 执行 psql COPY...')
  execFileSync(PSQL, [dbUrl, '-c', sql], { stdio: 'inherit' })
}

/**
 * 检测 Docker 是否可用且容器正在运行
 */
function isDockerAvailable() {
  try {
    const out = execSync(`docker inspect --format="{{.State.Running}}" ${CONTAINER} 2>&1`, { encoding: 'utf8' }).trim()
    return out.includes('true')
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

  try {
    // 1. 版本检查
    console.log('[sync] 正在获取 OpenSanctions 版本信息...')
    const index = await fetchJson(INDEX_URL)
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
    let csvFile = TEMP_FILE
    if (LOCAL_CSV) {
      const resolved = path.resolve(LOCAL_CSV)
      if (!fs.existsSync(resolved)) throw new Error(`LOCAL_CSV 文件不存在: ${resolved}`)
      csvFile = resolved
      console.log(`[sync] 使用本地 CSV: ${csvFile}`)
    } else {
      console.log(`[sync] 下载 CSV: ${CSV_URL}`)
      await downloadFile(CSV_URL, csvFile)
    }
    const fileSize = fs.statSync(csvFile).size
    console.log(`[sync] 文件大小: ${(fileSize / 1_000_000).toFixed(1)} MB`)

    // 3. 创建 raw staging 表（列名与 CSV header 一一对应，全部 TEXT）
    // 注：不加 PRIMARY KEY，让 COPY 直接写入，之后再建索引供 DELETE 使用
    await client.query('DROP TABLE IF EXISTS sanctions_staging')
    await client.query(`
      CREATE TABLE sanctions_staging (
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
      copyViaDocker(csvFile, DB_URL, 'sanctions_staging')
    } else if (isPsqlAvailable()) {
      copyViaPsql(csvFile, DB_URL, 'sanctions_staging')
    } else {
      throw new Error(
        '无法导入 CSV：Docker 容器未运行且未找到 psql 客户端。\n' +
        `请确保 Docker 容器 "${CONTAINER}" 正在运行，或安装 psql 并设置 PSQL_PATH。`
      )
    }

    // 验证数据量
    const { rows: stgCount } = await client.query(`SELECT COUNT(*)::text AS n FROM sanctions_staging WHERE id IS NOT NULL AND id <> ''`)
    const totalRows = parseInt(stgCount[0].n, 10)
    console.log(`[sync] Staging 表已载入 ${totalRows.toLocaleString()} 条记录`)

    if (totalRows === 0) throw new Error('CSV 导入后 staging 表为空，请检查文件格式')

    // 建立 staging.id 索引（供 NOT EXISTS 删除查询使用，O(log n) 而非 O(n²)）
    console.log('[sync] 建立 staging 索引...')
    await client.query(`CREATE INDEX idx_staging_id ON sanctions_staging (id)`)

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
      FROM sanctions_staging
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
          SELECT 1 FROM sanctions_staging s WHERE s.id = e.id
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
    process.exit(1)
  } finally {
    await client.query('DROP TABLE IF EXISTS sanctions_staging').catch(() => {})
    client.release()
    await pool.end()
    // 仅删除我们自己下载的临时文件，保留 LOCAL_CSV 用户指定的文件
    if (!LOCAL_CSV) fs.unlink(TEMP_FILE, () => {})
  }
}

run()

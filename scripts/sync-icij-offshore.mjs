#!/usr/bin/env node
/**
 * sync-icij-offshore.mjs
 *
 * Imports ICIJ Offshore Leaks data into the icij_entities table.
 *
 * The ICIJ ZIP contains files organized by node TYPE (not by dataset):
 *   nodes-entities.csv       ← companies (all datasets combined)
 *   nodes-officers.csv       ← people / directors
 *   nodes-intermediaries.csv ← registered agents
 *   relationships.csv        ← edges between nodes
 *
 * The dataset is identified by the `sourceID` column in each CSV row.
 *
 * Usage:
 *   # Point at the extracted directory
 *   node scripts/sync-icij-offshore.mjs --dir "C:\Users\You\Downloads\icij-offshoreleaks-csv"
 *
 *   # Or point at a specific CSV file
 *   node scripts/sync-icij-offshore.mjs --file "C:\Users\You\Downloads\nodes-entities.csv"
 *
 *   # Dry run (no DB writes)
 *   node scripts/sync-icij-offshore.mjs --dir /path/to/csv --dry-run
 *
 *   # Limit rows (for testing)
 *   node scripts/sync-icij-offshore.mjs --dir /path/to/csv --limit 5000
 *
 *   # Import only companies (skip officers/intermediaries)
 *   node scripts/sync-icij-offshore.mjs --dir /path/to/csv --entities-only
 */

import fs from 'node:fs'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import pg from 'pg'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir   = path.resolve(__dirname, '..')

// ── Args ──────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2)
const getArg  = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def }
const hasFlag = (flag) => args.includes(flag)

const DIR_ARG          = getArg('--dir',  null)
const FILE_ARG         = getArg('--file', null)
const LIMIT            = parseInt(getArg('--limit', '0'), 10)
const DRY_RUN          = hasFlag('--dry-run')
const ENTITIES_ONLY    = hasFlag('--entities-only')
const BATCH_SIZE       = 500

if (!DIR_ARG && !FILE_ARG) {
  console.error(`
Usage:
  node scripts/sync-icij-offshore.mjs --dir <path-to-extracted-zip-folder>
  node scripts/sync-icij-offshore.mjs --file <path-to-nodes-entities.csv>

Options:
  --dry-run        Print stats but don't write to DB
  --limit N        Only import first N rows (for testing)
  --entities-only  Skip officers and intermediaries
`)
  process.exit(1)
}

// ── sourceID → our dataset key ────────────────────────────────────────────────

const SOURCE_ID_MAP = {
  'panama papers':   'panama_papers',
  'pandora papers':  'pandora_papers',
  'offshore leaks':  'offshore_leaks',
  'bahamas leaks':   'bahamas_leaks',
  'paradise papers': 'paradise_papers',
}

function normalizeSourceId(raw) {
  if (!raw) return 'unknown'
  const key = raw.trim().toLowerCase()
  return SOURCE_ID_MAP[key] ?? key.replace(/\s+/g, '_')
}

// ── Database ──────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(rootDir, '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

// ── CSV parser ────────────────────────────────────────────────────────────────

function parseCSVLine(line) {
  const fields = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      fields.push(field); field = ''
    } else {
      field += ch
    }
  }
  fields.push(field)
  return fields
}

async function* streamCSV(filePath) {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  let leftover = ''
  let headers = null
  let rowCount = 0

  for await (const chunk of stream) {
    const text = leftover + chunk
    const lines = text.split('\n')
    leftover = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      if (!headers) {
        headers = parseCSVLine(line).map((h) => h.trim().replace(/^\uFEFF/, ''))
        continue
      }
      const values = parseCSVLine(line)
      const row = {}
      headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim() })
      yield row
      rowCount++
      if (LIMIT > 0 && rowCount >= LIMIT) return
    }
  }
  // last line
  if (leftover.trim() && headers) {
    const values = parseCSVLine(leftover)
    const row = {}
    headers.forEach((h, i) => { row[h] = (values[i] ?? '').trim() })
    yield row
  }
}

// ── Row mapper ────────────────────────────────────────────────────────────────
// ICIJ CSV columns (actual format):
//   node_id, name, labels, jurisdiction, jurisdiction_description,
//   company_type, address, incorporation_date, inactivation_date,
//   struck_off_date, closed_date, status, sourceID, valid_until, note,
//   country_codes, countries

function mapRow(row, defaultType) {
  const nodeId = row.node_id || row.nodeId || ''
  const name   = row.name    || row.NAME   || ''
  if (!nodeId || !name) return null

  const sourceId   = normalizeSourceId(row.sourceID || row.source_id || '')
  const entityType = row.labels || row.entity_type || defaultType || 'Entity'
  const countries  = row.countries || row.country_codes || ''
  const juris      = row.jurisdiction_description || row.jurisdiction || ''
  const sourceUrl  = nodeId
    ? `https://offshoreleaks.icij.org/nodes/${nodeId}`
    : null

  return {
    node_id:            nodeId,
    name,
    dataset:            sourceId,
    entity_type:        entityType,
    countries:          countries || null,
    jurisdiction:       juris || null,
    status:             row.status || null,
    incorporation_date: row.incorporation_date || null,
    inactivation_date:  row.inactivation_date  || null,
    struck_off_date:    row.struck_off_date    || null,
    address:            row.address            || null,
    source_url:         sourceUrl,
  }
}

// ── DB batch upsert ───────────────────────────────────────────────────────────

async function upsertBatch(client, batch) {
  if (!batch.length) return 0
  // Deduplicate by node_id within the batch (last write wins)
  const seen = new Map()
  for (const r of batch) seen.set(r.node_id, r)
  batch = [...seen.values()]

  const vals = []
  const placeholders = batch.map((r, i) => {
    const b = i * 11
    vals.push(
      r.node_id, r.name, r.dataset, r.entity_type,
      r.countries, r.jurisdiction, r.status,
      r.incorporation_date, r.inactivation_date,
      r.struck_off_date, r.address
    )
    return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`
  })
  await client.query(`
    INSERT INTO icij_entities
      (node_id, name, dataset, entity_type, countries, jurisdiction, status,
       incorporation_date, inactivation_date, struck_off_date, address)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (node_id) DO UPDATE SET
      name               = EXCLUDED.name,
      dataset            = EXCLUDED.dataset,
      entity_type        = EXCLUDED.entity_type,
      countries          = EXCLUDED.countries,
      jurisdiction       = EXCLUDED.jurisdiction,
      status             = EXCLUDED.status,
      incorporation_date = EXCLUDED.incorporation_date,
      inactivation_date  = EXCLUDED.inactivation_date,
      struck_off_date    = EXCLUDED.struck_off_date,
      address            = EXCLUDED.address,
      synced_at          = NOW()
  `, vals)
  return batch.length
}

// ── Import a single CSV file ──────────────────────────────────────────────────

async function importFile(filePath, defaultType) {
  if (!fs.existsSync(filePath)) {
    console.log(`  Skipping (not found): ${filePath}`)
    return 0
  }

  const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1)
  console.log(`  ${path.basename(filePath)} (${sizeMB} MB)`)

  const datasetCounts = {}
  let imported = 0
  let skipped  = 0

  if (DRY_RUN) {
    let count = 0
    for await (const row of streamCSV(filePath)) {
      count++
      const dataset = normalizeSourceId(row.sourceID || row.source_id || '')
      datasetCounts[dataset] = (datasetCounts[dataset] ?? 0) + 1
    }
    console.log(`  [dry-run] ${count} rows found`)
    console.log('  By dataset:', datasetCounts)
    return 0
  }

  const client = await pool.connect()
  try {
    let batch = []
    for await (const row of streamCSV(filePath)) {
      const mapped = mapRow(row, defaultType)
      if (!mapped) { skipped++; continue }
      batch.push(mapped)
      datasetCounts[mapped.dataset] = (datasetCounts[mapped.dataset] ?? 0) + 1

      if (batch.length >= BATCH_SIZE) {
        imported += await upsertBatch(client, batch)
        batch = []
        process.stdout.write(`\r  Imported ${imported}…`)
      }
    }
    if (batch.length) {
      imported += await upsertBatch(client, batch)
    }
    process.stdout.write(`\r  Imported ${imported} rows (skipped ${skipped} empty)\n`)
    console.log('  By dataset:', datasetCounts)
  } finally {
    client.release()
  }
  return imported
}

// ── Import relationships.csv ──────────────────────────────────────────────────
// relationships.csv columns:
//   node_id_start, node_id_end, rel_type, link, start_date, end_date, sourceID

async function importRelationships(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`  Skipping (not found): ${filePath}`)
    return 0
  }

  const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1)
  console.log(`  relationships.csv (${sizeMB} MB)`)

  if (DRY_RUN) {
    let count = 0
    const typeCounts = {}
    for await (const row of streamCSV(filePath)) {
      count++
      const t = row.rel_type || row.type || 'UNKNOWN'
      typeCounts[t] = (typeCounts[t] ?? 0) + 1
    }
    console.log(`  [dry-run] ${count} relationships`)
    console.log('  By type:', typeCounts)
    return 0
  }

  const client = await pool.connect()
  let imported = 0
  try {
    // Truncate first for clean re-import
    await client.query('TRUNCATE icij_relationships')

    let batch = []
    for await (const row of streamCSV(filePath)) {
      const fromId  = row.node_id_start || row.START_ID || ''
      const toId    = row.node_id_end   || row.END_ID   || ''
      const relType = row.rel_type      || row.type     || ''
      if (!fromId || !toId || !relType) continue

      batch.push({
        rel_type:     relType,
        link:         row.link || null,
        from_node_id: fromId,
        to_node_id:   toId,
        dataset:      normalizeSourceId(row.sourceID || ''),
        start_date:   row.start_date || null,
        end_date:     row.end_date   || null,
      })

      if (batch.length >= BATCH_SIZE) {
        const vals = []
        const ph = batch.map((r, i) => {
          const b = i * 7
          vals.push(r.rel_type, r.link, r.from_node_id, r.to_node_id, r.dataset, r.start_date, r.end_date)
          return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`
        })
        await client.query(
          `INSERT INTO icij_relationships (rel_type, link, from_node_id, to_node_id, dataset, start_date, end_date) VALUES ${ph.join(',')}`,
          vals
        )
        imported += batch.length
        batch = []
        process.stdout.write(`\r  Imported ${imported} relationships…`)
      }
    }
    if (batch.length) {
      const vals = []
      const ph = batch.map((r, i) => {
        const b = i * 7
        vals.push(r.rel_type, r.link, r.from_node_id, r.to_node_id, r.dataset, r.start_date, r.end_date)
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7})`
      })
      await client.query(
        `INSERT INTO icij_relationships (rel_type, link, from_node_id, to_node_id, dataset, start_date, end_date) VALUES ${ph.join(',')}`,
        vals
      )
      imported += batch.length
    }
    process.stdout.write(`\r  Imported ${imported} relationships\n`)
  } finally {
    client.release()
  }
  return imported
}

// ── Link ICIJ → our entities ──────────────────────────────────────────────────

async function linkToEntities() {
  console.log('\nLinking ICIJ entities to local company database…')
  const client = await pool.connect()
  try {
    const { rowCount } = await client.query(`
      UPDATE icij_entities i
      SET
        linked_entity_id = e.id,
        match_confidence = similarity(lower(i.name), lower(e.name))
      FROM entities e
      WHERE
        i.linked_entity_id IS NULL
        AND e.entity_type = 'company'
        AND similarity(lower(i.name), lower(e.name)) >= 0.7
    `)
    console.log(`Linked ${rowCount} ICIJ entries to local entities.`)
  } finally {
    client.release()
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('ICIJ Offshore Leaks import')
  if (DRY_RUN)       console.log('[DRY RUN]')
  if (LIMIT)         console.log(`[LIMIT: ${LIMIT} rows per file]`)
  if (ENTITIES_ONLY) console.log('[ENTITIES ONLY — skipping officers, intermediaries, relationships]')

  let total = 0

  if (FILE_ARG) {
    const filePath = path.resolve(FILE_ARG)
    console.log(`\nFile: ${filePath}`)
    total += await importFile(filePath, 'Entity')
  } else {
    const dir = path.resolve(DIR_ARG)
    console.log(`\nDirectory: ${dir}`)

    // 1. Node files
    const NODE_FILES = [
      { name: 'nodes-entities.csv',       type: 'Entity' },
      ...(!ENTITIES_ONLY ? [
        { name: 'nodes-officers.csv',       type: 'Officer' },
        { name: 'nodes-intermediaries.csv', type: 'Intermediary' },
      ] : []),
    ]
    for (const { name, type } of NODE_FILES) {
      console.log(`\n[${type}] ${name}`)
      total += await importFile(path.join(dir, name), type)
    }

    // 2. Relationships
    if (!ENTITIES_ONLY) {
      console.log('\n[Relationships] relationships.csv')
      await importRelationships(path.join(dir, 'relationships.csv'))
    }
  }

  if (!DRY_RUN && total > 0) {
    await linkToEntities()
  }

  console.log(`\nDone. Total node rows imported: ${total}`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  pool.end().catch(() => {})
  process.exit(1)
})

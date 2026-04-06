#!/usr/bin/env node
/**
 * sync-icij-offshore.mjs
 *
 * Downloads and imports ICIJ Offshore Leaks entity data into the icij_entities table.
 *
 * Usage:
 *   node scripts/sync-icij-offshore.mjs [--dataset panama_papers] [--limit 10000] [--dry-run]
 *
 * Datasets available:
 *   panama_papers | pandora_papers | offshore_leaks | bahamas_leaks | paradise_papers
 *   Use "all" (default) to import everything.
 *
 * ICIJ bulk data: https://offshoreleaks.icij.org/pages/database
 * Direct CSV:     https://offshoreleaks-data.icij.org/offshoreleaks/csv/full-oldb-[dataset].zip
 */

import fs from 'node:fs'
import path from 'node:path'
import { createReadStream, createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { Readable } from 'node:stream'
import pg from 'pg'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir   = path.resolve(__dirname, '..')

// ── Config ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const getArg = (flag, def) => {
  const i = args.indexOf(flag)
  return i !== -1 ? args[i + 1] : def
}
const hasFlag = (flag) => args.includes(flag)

const DATASET_ARG = getArg('--dataset', 'all')
const LIMIT       = parseInt(getArg('--limit', '0'), 10)   // 0 = no limit
const DRY_RUN     = hasFlag('--dry-run')
const BATCH_SIZE  = 500

// ICIJ dataset slugs → CSV URL base names
const DATASETS = {
  panama_papers:   'panama-papers',
  pandora_papers:  'pandora-papers',
  offshore_leaks:  'offshore-leaks',
  bahamas_leaks:   'bahamas-leaks',
  paradise_papers: 'paradise-papers',
}

const selectedDatasets = DATASET_ARG === 'all'
  ? Object.keys(DATASETS)
  : DATASET_ARG.split(',').map((d) => d.trim()).filter((d) => d in DATASETS)

if (selectedDatasets.length === 0) {
  console.error('No valid datasets specified. Use: panama_papers, pandora_papers, offshore_leaks, bahamas_leaks, paradise_papers, or all')
  process.exit(1)
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

// ── CSV parsing (no external deps — manual split) ─────────────────────────────

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
      fields.push(field)
      field = ''
    } else {
      field += ch
    }
  }
  fields.push(field)
  return fields
}

async function parseCSVStream(stream) {
  const rows = []
  let headerParsed = false
  let headers = []
  let leftover = ''

  for await (const chunk of stream) {
    const text = leftover + chunk.toString('utf8')
    const lines = text.split('\n')
    leftover = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      if (!headerParsed) {
        headers = parseCSVLine(line)
        headerParsed = true
        continue
      }
      const values = parseCSVLine(line)
      const row = {}
      headers.forEach((h, i) => { row[h.trim()] = (values[i] ?? '').trim() })
      rows.push(row)
      if (LIMIT > 0 && rows.length >= LIMIT) return { headers, rows }
    }
  }
  if (leftover.trim() && headerParsed) {
    const values = parseCSVLine(leftover)
    const row = {}
    headers.forEach((h, i) => { row[h.trim()] = (values[i] ?? '').trim() })
    rows.push(row)
  }
  return { headers, rows }
}

// ── Download helpers ──────────────────────────────────────────────────────────

async function downloadFile(url, destPath) {
  console.log(`  Downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const fileStream = createWriteStream(destPath)
  await pipeline(Readable.fromWeb(res.body), fileStream)
  console.log(`  Saved to ${destPath}`)
}

// ── Import logic ──────────────────────────────────────────────────────────────

function mapIcijRow(row, dataset) {
  // ICIJ CSV columns vary slightly by dataset; handle both formats
  return {
    node_id:            row.node_id || row.nodeId || '',
    name:               row.name || row.NAME || '',
    dataset,
    entity_type:        row.labels || row.entity_type || 'Entity',
    countries:          row.countries || row.country_codes || '',
    jurisdiction:       row.jurisdiction || row.jurisdiction_description || '',
    status:             row.status || '',
    incorporation_date: row.incorporation_date || row.inactivation_date ? (row.incorporation_date || '') : '',
    inactivation_date:  row.inactivation_date || '',
    struck_off_date:    row.struck_off_date || '',
    address:            row.address || row.registered_address || '',
    source_url: row.sourceID
      ? `https://offshoreleaks.icij.org/nodes/${row.node_id}`
      : null,
  }
}

async function upsertBatch(client, batch) {
  if (batch.length === 0) return 0
  const values = []
  const placeholders = batch.map((row, i) => {
    const base = i * 11
    values.push(
      row.node_id, row.name, row.dataset, row.entity_type,
      row.countries || null, row.jurisdiction || null, row.status || null,
      row.incorporation_date || null, row.inactivation_date || null,
      row.struck_off_date || null, row.address || null
    )
    return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9},$${base+10},$${base+11})`
  })

  await client.query(`
    INSERT INTO icij_entities
      (node_id, name, dataset, entity_type, countries, jurisdiction, status,
       incorporation_date, inactivation_date, struck_off_date, address)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (node_id) DO UPDATE SET
      name               = EXCLUDED.name,
      entity_type        = EXCLUDED.entity_type,
      countries          = EXCLUDED.countries,
      jurisdiction       = EXCLUDED.jurisdiction,
      status             = EXCLUDED.status,
      incorporation_date = EXCLUDED.incorporation_date,
      inactivation_date  = EXCLUDED.inactivation_date,
      struck_off_date    = EXCLUDED.struck_off_date,
      address            = EXCLUDED.address,
      synced_at          = NOW()
  `, values)

  return batch.length
}

async function importDataset(datasetKey) {
  const slug = DATASETS[datasetKey]
  const tmpDir = path.join(rootDir, 'tmp')
  fs.mkdirSync(tmpDir, { recursive: true })

  // ICIJ provides entities CSV — the node type we care about most
  // Full database ZIP: https://offshoreleaks-data.icij.org/offshoreleaks/csv/full-oldb-[slug].zip
  // Entities-only CSV is inside the ZIP as nodes-[slug].csv
  // For simplicity, we try a direct CSV URL first (ICIJ also provides per-type CSVs)
  const csvUrl  = `https://offshoreleaks-data.icij.org/offshoreleaks/csv/nodes-${slug}.csv`
  const csvPath = path.join(tmpDir, `icij-${datasetKey}.csv`)

  if (!fs.existsSync(csvPath)) {
    await downloadFile(csvUrl, csvPath)
  } else {
    console.log(`  Using cached ${csvPath}`)
  }

  const stream = createReadStream(csvPath)
  console.log('  Parsing CSV…')
  const { rows } = await parseCSVStream(stream)
  console.log(`  Parsed ${rows.length} rows`)

  if (DRY_RUN) {
    console.log('  [dry-run] First 3 rows:', rows.slice(0, 3))
    return 0
  }

  const client = await pool.connect()
  let imported = 0
  try {
    let batch = []
    for (const row of rows) {
      if (!row.node_id && !row.nodeId) continue
      if (!row.name && !row.NAME) continue
      const mapped = mapIcijRow(row, datasetKey)
      if (!mapped.node_id || !mapped.name) continue
      batch.push(mapped)
      if (batch.length >= BATCH_SIZE) {
        imported += await upsertBatch(client, batch)
        batch = []
        process.stdout.write(`\r  Imported ${imported}…`)
      }
    }
    if (batch.length > 0) {
      imported += await upsertBatch(client, batch)
    }
    process.stdout.write(`\r  Imported ${imported} rows\n`)
  } finally {
    client.release()
  }
  return imported
}

// ── Link matching: auto-link ICIJ entities to our entities table ──────────────

async function linkToEntities() {
  console.log('\nLinking ICIJ matches to local entity database…')
  const client = await pool.connect()
  try {
    // Use pg_trgm similarity to find probable matches (threshold 0.7)
    const { rowCount } = await client.query(`
      UPDATE icij_entities i
      SET
        linked_entity_id = e.id,
        match_confidence = similarity(lower(i.name), lower(e.name))
      FROM entities e
      WHERE
        linked_entity_id IS NULL
        AND similarity(lower(i.name), lower(e.name)) >= 0.7
        AND e.entity_type = 'company'
    `)
    console.log(`Linked ${rowCount} ICIJ entries to local entities.`)
  } finally {
    client.release()
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`ICIJ Offshore Leaks sync — datasets: ${selectedDatasets.join(', ')}`)
  if (DRY_RUN) console.log('[DRY RUN — no writes to DB]')
  if (LIMIT)   console.log(`[LIMIT: ${LIMIT} rows per dataset]`)

  let total = 0
  for (const dataset of selectedDatasets) {
    console.log(`\nDataset: ${dataset}`)
    try {
      const n = await importDataset(dataset)
      total += n
      console.log(`  Done: ${n} rows`)
    } catch (err) {
      console.error(`  Error importing ${dataset}:`, err.message)
    }
  }

  if (!DRY_RUN && total > 0) {
    await linkToEntities()
  }

  console.log(`\nTotal imported: ${total} rows`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  pool.end().catch(() => {})
  process.exit(1)
})

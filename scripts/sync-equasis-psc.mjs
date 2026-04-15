#!/usr/bin/env node
/**
 * sync-equasis-psc.mjs
 *
 * Fetches PSC inspection data from Equasis and stores it in psc_inspections.
 *
 * Requirements:
 *   EQUASIS_EMAIL    — your Equasis account email
 *   EQUASIS_PASSWORD — your Equasis account password
 *
 * Usage:
 *   # Single vessel by IMO
 *   node scripts/sync-equasis-psc.mjs --imo 9427366
 *
 *   # All vessels in our entities table
 *   node scripts/sync-equasis-psc.mjs --all
 *
 *   # Vessels missing PSC data (incremental sync)
 *   node scripts/sync-equasis-psc.mjs --missing
 *
 *   # Dry run (fetch but don't write to DB)
 *   node scripts/sync-equasis-psc.mjs --imo 9427366 --dry-run
 *
 *   # Limit number of vessels (for testing)
 *   node scripts/sync-equasis-psc.mjs --missing --limit 50
 */

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir   = path.resolve(__dirname, '..')

// ── Args ──────────────────────────────────────────────────────────────────────

const args    = process.argv.slice(2)
const getArg  = (flag, def) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def }
const hasFlag = (flag) => args.includes(flag)

const IMO_ARG   = getArg('--imo', null)
const ALL       = hasFlag('--all')
const MISSING   = hasFlag('--missing')
const DRY_RUN   = hasFlag('--dry-run')
const LIMIT     = parseInt(getArg('--limit', '0'), 10)
const DELAY_MS  = parseInt(getArg('--delay', '1500'), 10)  // polite delay between requests

if (!IMO_ARG && !ALL && !MISSING) {
  console.error(`
Usage:
  node scripts/sync-equasis-psc.mjs --imo <IMO_NUMBER>
  node scripts/sync-equasis-psc.mjs --all
  node scripts/sync-equasis-psc.mjs --missing

Options:
  --dry-run    Fetch data but don't write to DB
  --limit N    Only process first N vessels
  --delay N    Milliseconds between requests (default: 1500)
`)
  process.exit(1)
}

// ── Env ───────────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(rootDir, '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()

const EMAIL    = process.env.EQUASIS_EMAIL
const PASSWORD = process.env.EQUASIS_PASSWORD

if (!EMAIL || !PASSWORD) {
  console.error('Error: Set EQUASIS_EMAIL and EQUASIS_PASSWORD in .env.local')
  process.exit(1)
}

// ── Database ──────────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

// ── Equasis HTTP session ───────────────────────────────────────────────────────

const BASE = 'https://www.equasis.org/EquasisWeb'

class EquasisSession {
  #cookies = new Map()

  #parseCookies(headers) {
    const raw = headers.getSetCookie ? headers.getSetCookie() : []
    for (const c of raw) {
      const [pair] = c.split(';')
      const [k, v] = pair.split('=').map(s => s.trim())
      if (k) this.#cookies.set(k, v ?? '')
    }
  }

  #cookieHeader() {
    return [...this.#cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  async #fetch(url, options = {}) {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: this.#cookieHeader(),
      ...options.headers,
    }
    const res = await fetch(url, { ...options, headers, redirect: 'follow' })
    this.#parseCookies(res.headers)
    return res
  }

  async login() {
    // 1. Get initial session cookie
    await this.#fetch(`${BASE}/public/HomePage`)

    // 2. POST login form
    const body = new URLSearchParams({
      j_email:    EMAIL,
      j_password: PASSWORD,
    })
    const res = await this.#fetch(`${BASE}/authen/HomePage?fs=HomePage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    })
    const html = await res.text()

    // Check for login success — look for restricted menu items
    if (!html.includes('ShipSubcription') && !html.includes('My Equasis') && !html.includes('logout')) {
      throw new Error('Login failed — check EQUASIS_EMAIL and EQUASIS_PASSWORD')
    }
    console.log('Logged in to Equasis.')
    return this
  }

  /**
   * Fetch PSC inspection data for a vessel IMO.
   * Returns array of inspection objects, or null if vessel not found.
   */
  async fetchPscInspections(imo) {
    // Search for the vessel
    const searchBody = new URLSearchParams({
      P_PAGE:      '1',
      P_IMO:       imo,
      P_CALL_SIGN: '',
      P_NAME:      '',
      P_TOKEN:     '',
    })
    const searchRes = await this.#fetch(`${BASE}/restricted/Search?fs=Search`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    searchBody.toString(),
    })
    const searchHtml = await searchRes.text()

    // Extract vessel name from search results
    const vesselNameMatch = searchHtml.match(/class="shipName"[^>]*>([^<]+)</)
    const vesselName = vesselNameMatch ? vesselNameMatch[1].trim() : null

    // Fetch ship inspection page
    const inspRes = await this.#fetch(
      `${BASE}/restricted/ShipInspection?fs=ShipInspection&P_IMO=${imo}`
    )
    const inspHtml = await inspRes.text()

    if (inspHtml.includes('No inspection found') || inspHtml.includes('no inspection')) {
      return { vesselName, inspections: [] }
    }

    const inspections = parseInspectionTable(inspHtml, imo, vesselName)
    return { vesselName, inspections }
  }
}

// ── HTML parser ────────────────────────────────────────────────────────────────
// Actual Equasis column order (verified from live HTML):
//   Authority | Port of inspection | Date of report | Detention(Y/N) |
//   PSC Organisation | Type of inspection | Duration (days) | Number of deficiencies | Details

function parseInspectionTable(html, imo, vesselName) {
  const inspections = []

  // Table class is "tableLSDD table table-striped table-responsive"
  // Cells use uppercase <TD> tags with rowspan attributes
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i)
  if (!tbodyMatch) return inspections

  const rows = tbodyMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) ?? []

  for (const row of rows) {
    if (/<th/i.test(row)) continue  // skip header rows

    // Match both <td> and <TD> (Equasis uses uppercase)
    const cells = (row.match(/<[Tt][Dd][^>]*>([\s\S]*?)<\/[Tt][Dd]>/gi) ?? [])
      .map(td => td.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim())

    if (cells.length < 4) continue

    // Col 0: Authority, 1: Port, 2: Date, 3: Detained(Y/N),
    // 4: PSC Org, 5: Type, 6: Duration, 7: Deficiencies
    const authority    = cells[0] || 'Unknown'
    const portName     = cells[1] || null
    const rawDate      = cells[2] || ''
    const detainedStr  = cells[3] || ''
    const durationStr  = cells[6] || ''
    const defStr       = cells[7] || '0'

    const inspection_date = parseDate(rawDate)
    if (!inspection_date) continue

    const detained         = /^Y$/i.test(detainedStr.trim())
    const deficiency_count = parseInt(defStr, 10) || 0
    const durationDays     = parseInt(durationStr, 10)
    const detention_days   = detained && !isNaN(durationDays) ? durationDays : null

    const result = detained        ? 'detained'
      : deficiency_count > 0       ? 'deficiency'
      : 'no_deficiency'

    inspections.push({
      imo,
      vessel_name:      vesselName,
      inspection_date,
      port_name:        portName,
      authority,
      result,
      deficiency_count,
      detention_days,
      source_url: `https://www.equasis.org/EquasisWeb/restricted/ShipInspection?fs=ShipInspection&P_IMO=${imo}`,
    })
  }

  return inspections
}

function parseDate(raw) {
  if (!raw) return null
  // DD/MM/YYYY
  const d1 = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (d1) return `${d1[3]}-${d1[2]}-${d1[1]}`
  // YYYY-MM-DD
  const d2 = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (d2) return raw
  // MM/DD/YYYY
  const d3 = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (d3) return `${d3[3]}-${d3[1]}-${d3[2]}`
  return null
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertInspections(client, inspections) {
  if (!inspections.length) return 0
  let inserted = 0
  for (const r of inspections) {
    const res = await client.query(`
      INSERT INTO psc_inspections
        (imo, vessel_name, inspection_date, port_name, authority,
         result, deficiency_count, detention_days, source_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT DO NOTHING
    `, [
      r.imo, r.vessel_name, r.inspection_date, r.port_name, r.authority,
      r.result, r.deficiency_count, r.detention_days, r.source_url,
    ])
    inserted += res.rowCount
  }
  return inserted
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Equasis PSC Sync')
  if (DRY_RUN) console.log('[DRY RUN]')

  const session = await new EquasisSession().login()

  let imos = []

  if (IMO_ARG) {
    imos = [IMO_ARG.replace(/^IMO/i, '')]
  } else {
    const client = await pool.connect()
    try {
      let query = `
        SELECT DISTINCT v.imo
        FROM entities v
        WHERE v.entity_type = 'vessel'
          AND v.imo IS NOT NULL
          AND v.imo != ''
      `
      if (MISSING) {
        query += `
          AND NOT EXISTS (
            SELECT 1 FROM psc_inspections p WHERE p.imo = v.imo
          )
        `
      }
      query += ' ORDER BY v.imo'
      if (LIMIT > 0) query += ` LIMIT ${LIMIT}`

      const { rows } = await client.query(query)
      imos = rows.map(r => r.imo)
    } finally {
      client.release()
    }
  }

  console.log(`Vessels to process: ${imos.length}`)

  let totalInspections = 0
  let processed = 0
  let errors = 0

  for (const imo of imos) {
    try {
      process.stdout.write(`\r  [${processed + 1}/${imos.length}] IMO ${imo}…`)

      const { vesselName, inspections } = await session.fetchPscInspections(imo)

      if (DRY_RUN) {
        if (inspections.length) {
          console.log(`\n  ${imo} (${vesselName}): ${inspections.length} inspections`)
        }
      } else {
        const client = await pool.connect()
        try {
          const n = await upsertInspections(client, inspections)
          totalInspections += n
        } finally {
          client.release()
        }
      }

      processed++
    } catch (err) {
      console.error(`\n  Error fetching IMO ${imo}: ${err.message}`)
      errors++
    }

    // Polite delay to avoid hammering Equasis
    if (processed < imos.length) {
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  console.log(`\n\nDone.`)
  console.log(`  Vessels processed: ${processed}`)
  console.log(`  Inspections inserted: ${totalInspections}`)
  if (errors) console.log(`  Errors: ${errors}`)

  await pool.end()
}

main().catch(err => {
  console.error(err)
  pool.end().catch(() => {})
  process.exit(1)
})

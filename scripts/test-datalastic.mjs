#!/usr/bin/env node
/**
 * test-datalastic.mjs
 *
 * Quick smoke test for Datalastic API key and endpoints.
 * Usage:
 *   node scripts/test-datalastic.mjs
 *   node scripts/test-datalastic.mjs --imo 9525338
 *
 * Set DATALASTIC_API_KEY in .env.local first.
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Load .env.local
const envPath = join(ROOT, '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

const KEY = process.env.DATALASTIC_API_KEY
if (!KEY) {
  console.error('ERROR: DATALASTIC_API_KEY not set in .env.local')
  process.exit(1)
}

// Default test IMO: VLCC Advantage Sweet (a known large tanker, not sanctioned)
const imoArg = process.argv.indexOf('--imo')
const IMO = imoArg !== -1 ? process.argv[imoArg + 1] : '9525338'

const BASE = 'https://api.datalastic.com/api/v0'

async function call(endpoint, params) {
  const url = `${BASE}/${endpoint}?api-key=${encodeURIComponent(KEY)}&${params}`
  console.log(`\nGET ${BASE}/${endpoint}?api-key=***&${params}`)
  const t0  = Date.now()
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  console.log(`HTTP ${res.status} — ${Date.now() - t0}ms`)
  const json = await res.json()
  return json
}

console.log('=== Datalastic API Test ===')
console.log(`IMO: ${IMO}`)
console.log(`Key: ${KEY.slice(0, 8)}...`)

// 1. vessel (basic, cheapest)
console.log('\n--- /vessel (basic position) ---')
const basic = await call('vessel', `imo=${IMO}`)
if (basic?.meta?.success && basic.data) {
  const d = basic.data
  console.log(`  Name: ${d.name}`)
  console.log(`  MMSI: ${d.mmsi}`)
  console.log(`  IMO:  ${d.imo}`)
  console.log(`  Position: ${d.lat}, ${d.lon}`)
  console.log(`  Speed: ${d.speed} kn`)
  console.log(`  Status: ${d.navigational_status}`)
  console.log(`  Destination: ${d.destination}`)
  console.log(`  Last update: ${d.last_position_UTC}`)
} else {
  console.log('  FAILED:', JSON.stringify(basic).slice(0, 200))
}

// 2. vessel_pro (position + draught + ETA)
console.log('\n--- /vessel_pro (position + draught + ETA) ---')
const pro = await call('vessel_pro', `imo=${IMO}`)
if (pro?.meta?.success && pro.data) {
  const d = pro.data
  console.log(`  Current draught:  ${d.current_draught} m`)
  console.log(`  Maximum draught:  ${d.maximum_draught} m`)
  console.log(`  Load factor:      ${d.maximum_draught > 0 ? Math.round(d.current_draught / d.maximum_draught * 100) : '?'}%`)
  console.log(`  ETA:              ${d.eta ?? 'none'}`)
  console.log(`  Destination LOCODE: ${d.destination}`)
} else {
  console.log('  FAILED:', JSON.stringify(pro).slice(0, 200))
}

// 3. vessel_info (static particulars)
console.log('\n--- /vessel_info (static: GT, DWT, year built) ---')
const info = await call('vessel_info', `imo=${IMO}`)
if (info?.meta?.success && info.data) {
  const d = info.data
  console.log(`  Type:         ${d.type_specific}`)
  console.log(`  Gross Tonnage:  ${d.gross_tonnage}`)
  console.log(`  Deadweight:     ${d.deadweight}`)
  console.log(`  Year built:     ${d.year_built}`)
  console.log(`  Length:         ${d.length} m`)
  console.log(`  Flag:           ${d.country_name} (${d.country_iso})`)
  console.log(`  Callsign:       ${d.callsign}`)
} else {
  console.log('  FAILED:', JSON.stringify(info).slice(0, 200))
}

// 4. Try port calls (may or may not be available)
console.log('\n--- /vessel_portcalls (port call history — may require report tier) ---')
const calls = await call('vessel_portcalls', `imo=${IMO}&limit=5`)
if (calls?.meta?.success && Array.isArray(calls.data)) {
  console.log(`  Found ${calls.data.length} port calls`)
  for (const c of calls.data.slice(0, 3)) {
    console.log(`    ${c.port_name ?? c.unlocode} (${c.country_iso}) — arrived ${c.arrived ?? '?'}, departed ${c.departed ?? 'in port'}`)
  }
} else if (calls?.data?.status) {
  // async report API
  console.log(`  Async report API — status: ${calls.data.status}`)
  console.log('  (Port calls need background sync job, not suitable for real-time)')
} else {
  console.log('  Response:', JSON.stringify(calls).slice(0, 300))
}

console.log('\n=== Done ===')
console.log('If /vessel_pro worked, set in .env.local:')
console.log('  AIS_PROVIDER=datalastic')
console.log('  DATALASTIC_API_KEY=<your key>')

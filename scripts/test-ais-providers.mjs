#!/usr/bin/env node
/**
 * test-ais-providers.mjs
 *
 * Smoke test for all AIS data providers.
 * Usage:
 *   node scripts/test-ais-providers.mjs               # test all configured providers
 *   node scripts/test-ais-providers.mjs --imo 9525338 # test specific vessel
 *
 * Set in .env.local whichever keys you have:
 *   VESSELAPI_KEY=...    (free - vesselapi.com)
 *   AISSTREAM_KEY=...    (free - aisstream.io)
 *   DATALASTIC_API_KEY=  (paid - datalastic.com)
 */

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Load .env.local
const envPath = join(ROOT, '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}

// Default test: MAERSK CHENNAI (known container ship, always has AIS)
const imoArg = process.argv.indexOf('--imo')
const IMO  = imoArg !== -1 ? process.argv[imoArg + 1] : '9525338'

console.log('=== AIS Provider Test ===')
console.log(`IMO: ${IMO}\n`)

// ── VesselAPI (free REST) ─────────────────────────────────────────────────────
async function testVesselApi() {
  const key = process.env.VESSELAPI_KEY
  if (!key) {
    console.log('[VesselAPI] SKIP — VESSELAPI_KEY not set')
    console.log('  Sign up free at: https://vesselapi.com\n')
    return
  }

  console.log('[VesselAPI] Testing...')
  const t0  = Date.now()
  try {
    const res = await fetch(
      `https://api.vesselapi.com/v1/vessel/${IMO}/position?filter.idType=imo`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal:  AbortSignal.timeout(12_000),
      },
    )
    console.log(`  HTTP ${res.status} — ${Date.now() - t0}ms`)

    if (!res.ok) {
      const text = await res.text()
      console.log('  FAILED:', text.slice(0, 200))
      return
    }

    const json = await res.json()
    const v    = json.vessel
    if (!v) {
      console.log('  No vessel data:', JSON.stringify(json).slice(0, 200))
      return
    }

    console.log(`  Name:        ${v.name}`)
    console.log(`  MMSI:        ${v.mmsi}`)
    console.log(`  Position:    ${v.lat}, ${v.lon}`)
    console.log(`  Speed:       ${v.speed} kn`)
    console.log(`  Status:      ${v.navigationalStatus}`)
    console.log(`  Destination: ${v.destination ?? 'unknown'}`)
    console.log(`  Draught:     ${v.draught ?? 'n/a'} m`)
    console.log(`  Updated:     ${v.timestamp}`)
    console.log('  OK\n')

    // Return MMSI for aisstream test
    return v.mmsi ? String(v.mmsi) : null
  } catch (err) {
    console.log('  ERROR:', err.message, '\n')
  }
}

// ── aisstream.io (free WebSocket) ─────────────────────────────────────────────
async function testAisStream(mmsi) {
  const key = process.env.AISSTREAM_KEY
  if (!key) {
    console.log('[aisstream.io] SKIP — AISSTREAM_KEY not set')
    console.log('  Sign up free at: https://aisstream.io\n')
    return
  }
  if (!mmsi) {
    console.log('[aisstream.io] SKIP — need MMSI (set VESSELAPI_KEY to resolve from IMO)\n')
    return
  }

  console.log(`[aisstream.io] Testing MMSI ${mmsi}...`)
  const t0 = Date.now()

  return new Promise((resolve) => {
    let done = false
    const timeout = setTimeout(() => {
      if (!done) {
        done = true
        console.log('  TIMEOUT (8s) — vessel may be out of terrestrial AIS range')
        console.log('  This is normal for vessels in open ocean.\n')
        resolve()
      }
    }, 8_000)

    let ws
    try {
      const { WebSocket } = await import('ws').catch(() => ({ WebSocket: globalThis.WebSocket }))
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream')
    } catch {
      console.log('  SKIP — ws package not installed. Run: npm install ws\n')
      clearTimeout(timeout)
      resolve()
      return
    }

    ws.on('open', () => {
      ws.send(JSON.stringify({
        Apikey:             key,
        BoundingBoxes:      [[-90, -180], [90, 180]],
        FiltersShipMMSI:    [mmsi],
        FilterMessageTypes: ['PositionReport'],
      }))
      console.log('  Connected, waiting for position...')
    })

    ws.on('message', (raw) => {
      if (done) return
      try {
        const msg  = JSON.parse(raw.toString())
        const pos  = msg?.Message?.PositionReport
        const meta = msg?.MetaData
        if (!pos || !meta) return

        done = true
        clearTimeout(timeout)
        ws.close()

        console.log(`  ${Date.now() - t0}ms to first message`)
        console.log(`  Ship:        ${meta.ShipName}`)
        console.log(`  MMSI:        ${meta.MMSI}`)
        console.log(`  Position:    ${meta.latitude}, ${meta.longitude}`)
        console.log(`  Speed:       ${pos.Sog} kn`)
        console.log(`  Nav status:  ${pos.NavigationalStatus}`)
        console.log(`  Updated:     ${meta.time_utc}`)
        console.log('  OK\n')
        resolve()
      } catch { /* ignore */ }
    })

    ws.on('error', (err) => {
      if (!done) {
        done = true
        clearTimeout(timeout)
        console.log('  ERROR:', err.message, '\n')
        resolve()
      }
    })
  })
}

// ── Datalastic (paid) ─────────────────────────────────────────────────────────
async function testDatalastic() {
  const key = process.env.DATALASTIC_API_KEY
  if (!key) {
    console.log('[Datalastic] SKIP — DATALASTIC_API_KEY not set (paid, €199+/mo)\n')
    return
  }

  console.log('[Datalastic] Testing...')
  const t0  = Date.now()
  try {
    const res = await fetch(
      `https://api.datalastic.com/api/v0/vessel_pro?api-key=${encodeURIComponent(key)}&imo=${IMO}`,
      { signal: AbortSignal.timeout(12_000) },
    )
    console.log(`  HTTP ${res.status} — ${Date.now() - t0}ms`)
    const json = await res.json()
    if (json?.meta?.success && json.data) {
      const d = json.data
      console.log(`  Name:         ${d.name}`)
      console.log(`  Position:     ${d.lat}, ${d.lon}`)
      console.log(`  Draught:      ${d.current_draught}m / ${d.maximum_draught}m`)
      console.log('  OK\n')
    } else {
      console.log('  FAILED:', JSON.stringify(json).slice(0, 200), '\n')
    }
  } catch (err) {
    console.log('  ERROR:', err.message, '\n')
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────
const mmsi = await testVesselApi()
await testAisStream(mmsi)
await testDatalastic()

console.log('=== Summary ===')
console.log('Configure the provider that worked in .env.local:')
console.log('  AIS_PROVIDER=vesselapi   + VESSELAPI_KEY=...')
console.log('  AIS_PROVIDER=aisstream   + AISSTREAM_KEY=...  (+ VESSELAPI_KEY for MMSI resolution)')
console.log('  AIS_PROVIDER=datalastic  + DATALASTIC_API_KEY=...')

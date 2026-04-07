/**
 * Test aisstream MMSI-filtered subscription with a known coastal vessel.
 * Uses WINDCAT 39 (MMSI 235114376) — confirmed stopped in English Channel.
 */
import { WebSocket } from 'ws'

const KEY  = '3b56ad3fa81afa31da9344eb3cdf3ca975693b3e'
const MMSI = '235114376'  // WINDCAT 39 — stopped vessel, English Channel

const t0 = Date.now()
let settled = false
let draught = 0, maxDraught = 0, dest = ''

console.log(`Subscribing to MMSI ${MMSI} (WINDCAT 39)...`)
const ws = new WebSocket('wss://stream.aisstream.io/v0/stream')

const timeout = setTimeout(() => {
  if (!settled) {
    settled = true
    console.log('TIMEOUT (15s) — vessel not currently broadcasting')
    ws.close()
    process.exit(1)
  }
}, 15000)

ws.on('open', () => {
  ws.send(JSON.stringify({
    APIKey:             KEY,
    BoundingBoxes:      [[[-90, -180], [90, 180]]],
    FiltersShipMMSI:    [MMSI],
    FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
  }))
  console.log('Subscribed. Waiting for broadcast...')
})

ws.on('message', (raw) => {
  if (settled) return
  const msg  = JSON.parse(raw.toString())
  const type = msg?.MessageType
  const meta = msg?.MetaData

  if (msg?.error) {
    console.log('API ERROR:', msg.error)
    settled = true; clearTimeout(timeout); ws.close(); process.exit(1)
    return
  }

  if (type === 'ShipStaticData') {
    const s = msg?.Message?.ShipStaticData
    draught    = s?.MaximumStaticDraught ?? 0
    maxDraught = s?.MaximumStaticDraught ?? 0
    dest       = s?.Destination?.trim() ?? ''
    console.log(`ShipStaticData — draught: ${draught}m, dest: "${dest}"`)
  }

  if (type === 'PositionReport') {
    const pos = msg?.Message?.PositionReport
    settled = true
    clearTimeout(timeout)
    ws.close()

    console.log(`\nPositionReport in ${Date.now() - t0}ms:`)
    console.log('  Ship:     ', meta?.ShipName?.trim())
    console.log('  MMSI:     ', meta?.MMSI)
    console.log('  Lat/Lon:  ', meta?.latitude, meta?.longitude)
    console.log('  SOG:      ', pos?.Sog, 'kn')
    console.log('  NavStatus:', pos?.NavigationalStatus, '(0=underway, 1=anchored, 5=moored)')
    console.log('  Draught:  ', draught || '?', '/', maxDraught || '?', 'm')
    console.log('  Dest:     ', dest || meta?.Destination || '(unknown)')
    console.log('\nSUCCESS — aisstream MMSI filter working correctly')
    process.exit(0)
  }
})

ws.on('error', (e) => {
  console.log('WebSocket error:', e.message)
  process.exit(1)
})

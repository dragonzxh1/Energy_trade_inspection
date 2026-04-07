/**
 * Test aisstream without MMSI filter.
 * Uses a small bbox in the English Channel (very busy, always has ships).
 * If messages arrive → API key is valid, MAERSK CHENNAI was just out of range.
 * If timeout → API key invalid or network issue.
 */
import { WebSocket } from 'ws'

const KEY = '3b56ad3fa81afa31da9344eb3cdf3ca975693b3e'

// English Channel — one of the world's busiest shipping lanes
// bbox: [[lat_min, lon_min], [lat_max, lon_max]]
const BBOX = [[[49.5, -2.0], [51.5, 2.5]]]

console.log('Connecting to aisstream.io...')
console.log('BBox: English Channel (no MMSI filter — first vessel wins)')
const t0 = Date.now()
const ws = new WebSocket('wss://stream.aisstream.io/v0/stream')
let count = 0

const timeout = setTimeout(() => {
  console.log(`\nTIMEOUT (15s) — ${count} messages received`)
  if (count === 0) {
    console.log('DIAGNOSIS: API key likely invalid or network blocked')
    console.log('Check: https://aisstream.io → API Keys page → verify key is active')
  }
  ws.close()
  process.exit(count > 0 ? 0 : 1)
}, 15000)

ws.on('open', () => {
  console.log('Connected. Sending subscription...')
  ws.send(JSON.stringify({
    APIKey: KEY,
    BoundingBoxes: BBOX,
    FilterMessageTypes: ['PositionReport'],
  }))
})

ws.on('message', (raw) => {
  const msg  = JSON.parse(raw.toString())
  count++

  if (msg?.error) {
    console.log('API ERROR:', msg.error)
    clearTimeout(timeout); ws.close(); process.exit(1)
    return
  }

  const meta = msg?.MetaData
  const pos  = msg?.Message?.PositionReport

  if (pos && meta) {
    if (count === 1) {
      console.log(`\nFirst message in ${Date.now() - t0}ms:`)
      console.log('  Ship:    ', meta.ShipName)
      console.log('  MMSI:    ', meta.MMSI)
      console.log('  Lat/Lon: ', meta.latitude, meta.longitude)
      console.log('  Speed:   ', pos.Sog, 'kn')
      console.log('  NavStatus:', pos.NavigationalStatus)
    }
    if (count <= 5) {
      console.log(`  [${count}] ${meta.ShipName} @ ${meta.latitude.toFixed(3)}, ${meta.longitude.toFixed(3)} — ${pos.Sog}kn`)
    }
    if (count === 5) {
      console.log(`\nAPI KEY VALID — receiving live AIS data.`)
      console.log('MAERSK CHENNAI (566093000) is just out of terrestrial AIS range.')
      console.log('Solution: search for a vessel currently in a port or coastal area.')
      clearTimeout(timeout); ws.close(); process.exit(0)
    }
  }
})

ws.on('error', (e) => {
  console.log('WebSocket error:', e.message)
  process.exit(1)
})

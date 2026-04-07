import { WebSocket } from 'ws'

const KEY  = '3b56ad3fa81afa31da9344eb3cdf3ca975693b3e'
// MAERSK CHENNAI — busy container ship, always visible
const MMSI = '566093000'

console.log('Connecting to aisstream.io...')
const t0 = Date.now()
const ws = new WebSocket('wss://stream.aisstream.io/v0/stream')

const timeout = setTimeout(() => {
  console.log('TIMEOUT (12s) — vessel out of AIS range, or auth/network issue')
  ws.close()
  process.exit(1)
}, 12000)

ws.on('open', () => {
  console.log('Connected. Subscribing to MMSI ' + MMSI + '...')
  ws.send(JSON.stringify({
    APIKey: KEY,
    BoundingBoxes: [[[-90, -180], [90, 180]]],   // outer=list of boxes, inner=two corners
    FiltersShipMMSI: [MMSI],
    FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
  }))
})

ws.on('message', (raw) => {
  const msg  = JSON.parse(raw.toString())
  const meta = msg?.MetaData
  const type = msg?.MessageType

  if (msg?.error) {
    console.log('API ERROR:', msg.error)
    clearTimeout(timeout); ws.close(); process.exit(1)
    return
  }

  console.log('MSG:', type, '— ship:', meta?.ShipName ?? '?')

  if (type === 'PositionReport') {
    const pos = msg.Message.PositionReport
    clearTimeout(timeout)
    console.log('\nGOT POSITION in ' + (Date.now() - t0) + 'ms:')
    console.log('  Ship:    ', meta.ShipName)
    console.log('  MMSI:    ', meta.MMSI)
    console.log('  Lat/Lon: ', meta.latitude, meta.longitude)
    console.log('  Speed:   ', pos.Sog, 'kn')
    console.log('  NavStatus:', pos.NavigationalStatus, '(0=underway,1=anchored,5=moored)')
    console.log('  Updated: ', meta.time_utc)
    ws.close(); process.exit(0)
  }

  if (type === 'ShipStaticData') {
    const s = msg.Message.ShipStaticData
    console.log('  IMO:', s.ImoNumber, '| Draught:', s.MaximumStaticDraught, 'm | Dest:', s.Destination)
  }
})

ws.on('error', (e) => {
  console.log('WebSocket error:', e.message)
  process.exit(1)
})

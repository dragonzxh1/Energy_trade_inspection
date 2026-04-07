/**
 * AIS vessel tracking data layer.
 *
 * Supported providers (set AIS_PROVIDER in .env.local):
 *
 *   vesselapi   — Free REST API. Sign up at vesselapi.com, set VESSELAPI_KEY.
 *                 Best for on-demand vessel lookup by IMO.
 *
 *   aisstream   — Free WebSocket stream. Sign up at aisstream.io, set AISSTREAM_KEY.
 *                 Requires MMSI (not IMO). Good for monitoring known fleets.
 *
 *   hifleet     — Commercial REST API. Contact hifleet.com (021-20956899) for token.
 *                 Set HIFLEET_KEY. Requires MMSI for position/port-calls; uses IMO for PSC.
 *                 Returns position + 12-month port call history in one bundle.
 *
 *   datalastic  — Paid (€199+/mo). Set DATALASTIC_API_KEY.
 *                 Best data quality; port calls, draught, ETA.
 *
 * Without AIS_PROVIDER set, deterministic mock data is used (good for dev/demo).
 */

// ── Types (re-exported from shared client-safe module) ─────────────────────────
export type {
  AisNavStatus,
  AisPosition,
  PortCall,
  AisDarkPeriod,
  VesselAisData,
} from '@/lib/ais-types'

import type {
  AisNavStatus,
  AisPosition,
  PortCall,
  AisDarkPeriod,
  VesselAisData,
} from '@/lib/ais-types'

// ── VesselAPI provider (free) ─────────────────────────────────────────────────
//
// Docs: https://vesselapi.com/docs/vessels
// Sign up: https://vesselapi.com  (free tier, no credit card)
// Set: VESSELAPI_KEY=your_api_key
//
// Endpoint: GET https://api.vesselapi.com/v1/vessel/{imo}/position
//   ?filter.idType=imo   (auto-resolves if wrong type passed)
//
// Response: { vessel: { name, mmsi, imo, lat, lon, speed, course, heading,
//                        navigationalStatus (int 0-15), destination, eta,
//                        draught, timestamp } }

interface VesselApiPosition {
  vessel_name:        string
  mmsi:               string | number
  imo:                string | number
  latitude:           number
  longitude:          number
  sog:                number
  cog:                number
  heading?:           number
  nav_status:         number | string
  destination?:       string
  eta?:               string | null
  draught?:           number
  timestamp:          string
}

function mapNavStatusInt(raw: number | string | undefined): AisNavStatus {
  const n = typeof raw === 'string' ? parseInt(raw, 10) : (raw ?? 15)
  if (n === 0)  return 'underway_engine'
  if (n === 1)  return 'anchored'
  if (n === 5)  return 'moored'
  if (n === 3)  return 'restricted_manoeuvrability'
  if (n === 4)  return 'not_under_command'
  return 'undefined'
}

async function fetchVesselApi(imo: string): Promise<VesselAisData | null> {
  const key = process.env.VESSELAPI_KEY
  if (!key) return null

  try {
    const res = await fetch(
      `https://api.vesselapi.com/v1/vessel/${imo}/position?filter.idType=imo`,
      {
        headers: { Authorization: `Bearer ${key}` },
        signal:  AbortSignal.timeout(12_000),
      },
    )

    if (!res.ok) {
      console.error(`[ais:vesselapi] HTTP ${res.status} for IMO ${imo}`)
      return null
    }

    const json = await res.json() as { vesselPosition?: VesselApiPosition; _meta?: unknown }
    const v    = json.vesselPosition
    if (!v?.latitude || !v?.longitude) {
      console.error('[ais:vesselapi] no position data for IMO', imo)
      return null
    }

    return {
      imo,
      mmsi: v.mmsi ? String(v.mmsi) : null,
      position: {
        lat:         v.latitude,
        lon:         v.longitude,
        speed:       v.sog       ?? 0,
        course:      v.cog       ?? 0,
        status:      mapNavStatusInt(v.nav_status),
        destination: v.destination ?? '',
        eta:         v.eta ?? null,
        draught:     v.draught   ?? 0,
        maxDraught:  0, // VesselAPI free tier 不含最大吃水
        lastUpdate:  v.timestamp ?? new Date().toISOString(),
      },
      portCalls:   [],
      darkPeriods: [],
      provider:    'vesselapi',
      fetchedAt:   new Date().toISOString(),
    }
  } catch (err) {
    console.error('[ais:vesselapi]', err instanceof Error ? err.message : err)
    return null
  }
}

// ── aisstream.io provider (free WebSocket) ────────────────────────────────────
//
// Docs: https://aisstream.io/documentation
// Sign up: https://aisstream.io  (completely free)
// Set: AISSTREAM_KEY=your_api_key
//
// Note: aisstream is a streaming API. We open a WebSocket, wait for the first
// position report for this vessel's MMSI, then close. Requires MMSI, not IMO.
// We collect ShipStaticData (draught/destination) if it arrives before PositionReport.
// Timeout: 15 seconds. Vessels in open ocean have no terrestrial AIS coverage.
//
// Subscription format (CRITICAL — from docs):
//   APIKey: string
//   BoundingBoxes: [[[lat1, lon1], [lat2, lon2]], ...]  ← 3 levels of nesting
//   FiltersShipMMSI: ["mmsi1", ...]  ← strings
//   FilterMessageTypes: ["PositionReport", ...]

async function fetchAisStream(mmsi: string): Promise<VesselAisData | null> {
  const key = process.env.AISSTREAM_KEY
  if (!key || !mmsi) return null

  return new Promise((resolve) => {
    let settled  = false
    let draught  = 0
    let maxDraught = 0
    let destination = ''

    const timeout = setTimeout(() => {
      if (!settled) { settled = true; resolve(null) }
    }, 15_000)

    // Use dynamic import so the ws package is optional (not a hard dependency)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    import('ws' as any).then(({ default: WebSocket }: any) => {
      const ws = new WebSocket('wss://stream.aisstream.io/v0/stream')

      ws.on('open', () => {
        ws.send(JSON.stringify({
          APIKey:             key,
          BoundingBoxes:      [[[-90, -180], [90, 180]]],  // global, [[corner1, corner2]]
          FiltersShipMMSI:    [String(mmsi)],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        }))
      })

      ws.on('message', (raw: Buffer) => {
        if (settled) return
        try {
          const msg  = JSON.parse(raw.toString())
          const type = msg?.MessageType
          const meta = msg?.MetaData

          // Error from API (invalid key, throttle, etc.)
          if (msg?.error) {
            console.error('[ais:aisstream] error:', msg.error)
            settled = true; clearTimeout(timeout); ws.close(); resolve(null)
            return
          }

          // Collect static data (draught, destination) — arrives less frequently
          if (type === 'ShipStaticData') {
            const s = msg?.Message?.ShipStaticData
            if (s) {
              draught     = s.MaximumStaticDraught ?? 0
              maxDraught  = s.MaximumStaticDraught ?? 0
              destination = s.Destination?.trim() ?? ''
            }
          }

          // Position report — resolve as soon as we get one
          if (type === 'PositionReport') {
            const pos = msg?.Message?.PositionReport
            if (!pos || !meta) return

            settled = true
            clearTimeout(timeout)
            ws.close()

            resolve({
              imo:  '',   // filled by caller
              mmsi: String(meta.MMSI),
              position: {
                lat:         meta.latitude,
                lon:         meta.longitude,
                speed:       pos.Sog  ?? 0,
                course:      pos.Cog  ?? 0,
                status:      mapNavStatusInt(pos.NavigationalStatus),
                destination: destination || (meta.Destination?.trim() ?? ''),
                eta:         null,
                draught,
                maxDraught,
                lastUpdate:  meta.time_utc ?? new Date().toISOString(),
              },
              portCalls:   [],
              darkPeriods: [],
              provider:    'aisstream',
              fetchedAt:   new Date().toISOString(),
            })
          }
        } catch { /* ignore parse errors */ }
      })

      ws.on('error', () => {
        if (!settled) { settled = true; clearTimeout(timeout); resolve(null) }
      })
    }).catch(() => {
      if (!settled) { settled = true; clearTimeout(timeout); resolve(null) }
    })
  })
}

// ── Datalastic provider ────────────────────────────────────────────────────────
//
// API docs: https://datalastic.com/api-reference/
//
// Endpoints used:
//   /vessel_pro — live position + draught + ETA (1 credit/call)
//   /vessel_info — static particulars: GT, DWT, year built, etc. (1 credit/call)
//
// Port call history: Datalastic's vessel_portcalls is an async report API
// (takes 2-5 min to generate). Not suitable for real-time page loads.
// Port calls remain as mock data; replace with a background sync job when ready.
//
// Response format (vessel_pro):
//   { data: { uuid, name, mmsi, imo, lat, lon, speed, course, heading,
//             navigational_status (string), destination, eta, current_draught,
//             maximum_draught, last_position_UTC, ... }, meta: {...} }

interface DatalasticVesselPro {
  uuid:                string
  name:                string
  mmsi:                string
  imo:                 string
  country_iso:         string
  type:                string
  type_specific:       string
  lat:                 number
  lon:                 number
  speed:               number
  course:              number
  heading:             number
  navigational_status: string
  destination:         string
  eta:                 string | null
  current_draught:     number | null
  maximum_draught:     number | null
  last_position_UTC:   string
}

interface DatalasticResponse<T> {
  data:  T
  meta:  { success: boolean; endpoint: string; duration: number }
}

function mapNavStatusString(raw: string | undefined): AisNavStatus {
  if (!raw) return 'undefined'
  const s = raw.toLowerCase()
  if (s.includes('under way') || s.includes('underway'))    return 'underway_engine'
  if (s.includes('anchor'))                                  return 'anchored'
  if (s.includes('moor'))                                    return 'moored'
  if (s.includes('restricted'))                              return 'restricted_manoeuvrability'
  if (s.includes('not under command'))                       return 'not_under_command'
  return 'undefined'
}

async function fetchDatalastic(imo: string): Promise<VesselAisData | null> {
  const key = process.env.DATALASTIC_API_KEY
  if (!key) return null

  const BASE = 'https://api.datalastic.com/api/v0'
  const opts: RequestInit = { signal: AbortSignal.timeout(12_000) }

  try {
    // vessel_pro gives position + draught + ETA in one call
    const proRes = await fetch(
      `${BASE}/vessel_pro?api-key=${encodeURIComponent(key)}&imo=${imo}`,
      opts,
    )

    if (!proRes.ok) {
      console.error(`[ais:datalastic] vessel_pro HTTP ${proRes.status} for IMO ${imo}`)
      return null
    }

    const proJson = await proRes.json() as DatalasticResponse<DatalasticVesselPro>
    if (!proJson.meta?.success || !proJson.data) {
      console.error('[ais:datalastic] vessel_pro returned no data for IMO', imo)
      return null
    }

    const v = proJson.data

    return {
      imo,
      mmsi: v.mmsi ?? null,
      position: {
        lat:         v.lat,
        lon:         v.lon,
        speed:       v.speed ?? 0,
        course:      v.course ?? 0,
        status:      mapNavStatusString(v.navigational_status),
        destination: v.destination ?? '',
        eta:         v.eta ?? null,
        draught:     v.current_draught ?? 0,
        maxDraught:  v.maximum_draught ?? 0,
        lastUpdate:  v.last_position_UTC ?? new Date().toISOString(),
      },
      portCalls:   [], // populated by background sync (see scripts/sync-ais-portcalls.mjs)
      darkPeriods: [], // not available in standard Datalastic tier
      provider:    'datalastic',
      fetchedAt:   new Date().toISOString(),
    }
  } catch (err) {
    console.error('[ais:datalastic]', err instanceof Error ? err.message : err)
    return null
  }
}

// ── HiFleet provider ──────────────────────────────────────────────────────────
//
// Docs: https://www.hifleet.com/data/documentation-for-api.html (showdoc)
// Contact: 021-20956899 / 17717038095 to obtain a usertoken
// Set: HIFLEET_KEY=your_usertoken
//
// Endpoints used:
//   /position/position/get/token    — real-time position (by MMSI)
//   /position/getcallport/token     — port call history (by MMSI + time range)
//
// Notes:
//   - Position requires MMSI; resolve via caller options or VesselAPI fallback.
//   - Coordinates (la/lo) are in arc-minutes; divide by 60 for decimal degrees.
//   - All timestamps returned as UTC+8; we convert to UTC on ingestion.

interface HifleetPositionItem {
  m:                    string   // MMSI
  n:                    string   // vessel name
  sp:                   string   // speed (knots)
  co:                   string   // course (degrees)
  ti:                   string   // last update time (UTC+8)
  la:                   string   // latitude (arc-minutes; ÷60 → decimal degrees)
  lo:                   string   // longitude (arc-minutes; ÷60 → decimal degrees)
  h:                    string   // heading (degrees)
  draught:              string   // draught (m)
  eta:                  string   // ETA (UTC, or '-')
  destination:          string   // AIS-reported destination
  destinationIdentified: string  // matched port name
  imonumber:            string   // IMO number from static data
  status:               string   // navigational status text
}

interface HifleetPositionResponse {
  result: string   // "ok" | other
  num:    number
  list:   HifleetPositionItem | null
}

interface HifleetPortCallItem {
  lon:         string   // longitude (decimal degrees)
  lat:         string   // latitude (decimal degrees)
  mleavetime:  string   // departure time (UTC+8)
  portcode:    string   // port LOCODE (e.g. "KWMEA")
  mportname:   string   // English port name
  country:     string   // country (English)
  mupdatetime: string   // arrival time (UTC+8)
  fre:         number   // number of calls at this port in period
}

interface HifleetPortCallResponse {
  result: string
  num:    number
  list:   { shipRouteFeature: HifleetPortCallItem[]; total: number } | null
}

/** Convert HiFleet UTC+8 datetime string ("yyyy-mm-dd hh:mm:ss") to UTC ISO. */
function hifleetToUtc(t: string | null | undefined): string {
  if (!t || t === '-' || t.trim() === '') return new Date().toISOString()
  try {
    return new Date(t.replace(' ', 'T') + '+08:00').toISOString()
  } catch {
    return new Date().toISOString()
  }
}

/** Extract ISO-3166-1 alpha-2 country code from LOCODE prefix (first two chars). */
function locodeToCountryCode(locode: string): string {
  return (locode ?? '').slice(0, 2).toLowerCase()
}

// ─── HiFleet PSC (public API surface) ─────────────────────────────────────────

export interface HifleetPscDeficiency {
  seq_no:      number
  code:        string | null
  description: string | null
  ground:      string | null   // "Yes" → detention ground
}

export interface HifleetPscInspection {
  mou:       string            // e.g. "Tokyo MoU", "Paris MoU"
  port:      string            // inspection port name
  authority: string            // inspecting country
  num:       string            // deficiency count (as string from API)
  detained:  string | null     // "Y" | "N" | null
  risk:      string | null     // risk category text
  detail:    HifleetPscDeficiency[]
  type_ins:  string            // "initial" | "follow-up" | etc.
  date_ins:  string            // "YYYY-MM-DD"
}

/**
 * Fetch PSC inspection history for a vessel from HiFleet.
 * Uses IMO as the lookup key. Returns null on error or no key configured.
 */
export async function fetchHifleetPsc(imo: string): Promise<HifleetPscInspection[] | null> {
  const token = process.env.HIFLEET_KEY
  if (!token) return null

  try {
    const res = await fetch(
      `https://api.hifleet.com/pscapi/get?imo=${encodeURIComponent(imo)}&usertoken=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(12_000) },
    )
    if (!res.ok) {
      console.error(`[ais:hifleet:psc] HTTP ${res.status} for IMO ${imo}`)
      return null
    }
    const json = await res.json() as { status: string; msg?: string; data?: HifleetPscInspection[] }
    if (json.status !== '1' || !Array.isArray(json.data)) return null
    return json.data
  } catch (err) {
    console.error('[ais:hifleet:psc]', err instanceof Error ? err.message : err)
    return null
  }
}

async function fetchHifleet(mmsi: string, imo: string): Promise<VesselAisData | null> {
  const token = process.env.HIFLEET_KEY
  if (!token || !mmsi) return null

  const BASE = 'https://api.hifleet.com'
  const opts: RequestInit = { signal: AbortSignal.timeout(15_000) }

  try {
    // 1. Real-time position (by MMSI)
    const posRes = await fetch(
      `${BASE}/position/position/get/token?mmsi=${encodeURIComponent(mmsi)}&usertoken=${encodeURIComponent(token)}`,
      opts,
    )
    if (!posRes.ok) {
      console.error(`[ais:hifleet] position HTTP ${posRes.status} for MMSI ${mmsi}`)
      return null
    }
    const posJson = await posRes.json() as HifleetPositionResponse
    if (posJson.result !== 'ok' || !posJson.list) {
      console.error('[ais:hifleet] no position data for MMSI', mmsi)
      return null
    }
    const p = posJson.list

    // la/lo are in arc-minutes; divide by 60 to get decimal degrees
    const lat = parseFloat(p.la) / 60
    const lon = parseFloat(p.lo) / 60

    // 2. Port call history — last 12 months
    const now    = new Date()
    const start  = new Date(now.getTime() - 365 * 86_400_000)
    const fmtHf  = (d: Date) =>
      d.toISOString().replace('T', ' ').slice(0, 19)

    const portRes = await fetch(
      `${BASE}/position/getcallport/token?mmsi=${encodeURIComponent(mmsi)}&usertoken=${encodeURIComponent(token)}&starttime=${encodeURIComponent(fmtHf(start))}&endtime=${encodeURIComponent(fmtHf(now))}`,
      opts,
    )

    let portCalls: PortCall[] = []
    if (portRes.ok) {
      const portJson = await portRes.json() as HifleetPortCallResponse
      if (portJson.result === 'ok' && portJson.list?.shipRouteFeature?.length) {
        portCalls = portJson.list.shipRouteFeature.map((pc) => {
          const arrival   = hifleetToUtc(pc.mupdatetime)
          const departure = (pc.mleavetime && pc.mleavetime !== '-')
            ? hifleetToUtc(pc.mleavetime)
            : null
          const durationHours = departure
            ? Math.round((new Date(departure).getTime() - new Date(arrival).getTime()) / 3_600_000)
            : null
          return {
            portName:     pc.mportname.trim(),
            portCountry:  pc.country,
            countryCode:  locodeToCountryCode(pc.portcode),
            locode:       pc.portcode ?? '',
            arrival,
            departure,
            durationHours,
            event: 'port_call' as const,
          }
        })
      }
    }

    return {
      imo,
      mmsi,
      position: {
        lat,
        lon,
        speed:       parseFloat(p.sp) || 0,
        course:      parseFloat(p.co) || 0,
        status:      mapNavStatusString(p.status),
        destination: p.destinationIdentified || p.destination || '',
        eta:         (p.eta && p.eta !== '-') ? p.eta : null,
        draught:     parseFloat(p.draught) || 0,
        maxDraught:  0,   // not returned by HiFleet position endpoint
        lastUpdate:  hifleetToUtc(p.ti),
      },
      portCalls,
      darkPeriods: [],   // HiFleet does not expose dark-period events
      provider:    'hifleet',
      fetchedAt:   now.toISOString(),
    }
  } catch (err) {
    console.error('[ais:hifleet]', err instanceof Error ? err.message : err)
    return null
  }
}

// ── Mock implementation ────────────────────────────────────────────────────────
// Deterministic based on IMO so page renders are consistent.

function imoHash(imo: string): number {
  return Math.abs(imo.split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7))
}

interface MockScenario {
  status: AisNavStatus
  lat: number
  lon: number
  destination: string
  speed: number
  draught: number
  maxDraught: number
  portCalls: Array<{
    portName: string; portCountry: string; countryCode: string; locode: string
    daysAgo: number; durationHours: number | null
  }>
  darkPeriods: Array<{ location: string; daysAgoStart: number; durationHours: number }>
}

const MOCK_SCENARIOS: MockScenario[] = [
  {
    // Hormuz anchorage — likely loading Iranian crude
    status: 'anchored', lat: 26.85, lon: 56.32, destination: 'CNZSN', speed: 0,
    draught: 19.2, maxDraught: 21.5,
    portCalls: [
      { portName: 'Kharg Island', portCountry: 'Iran', countryCode: 'ir', locode: 'IRKHK', daysAgo: 12, durationHours: 72 },
      { portName: 'Zhoushan', portCountry: 'China', countryCode: 'cn', locode: 'CNZSN', daysAgo: 45, durationHours: 48 },
      { portName: 'Kharg Island', portCountry: 'Iran', countryCode: 'ir', locode: 'IRKHK', daysAgo: 72, durationHours: 68 },
      { portName: 'Rizhao', portCountry: 'China', countryCode: 'cn', locode: 'CNRZH', daysAgo: 110, durationHours: 52 },
      { portName: 'Bandar Imam Khomeini', portCountry: 'Iran', countryCode: 'ir', locode: 'IRBIK', daysAgo: 145, durationHours: 80 },
    ],
    darkPeriods: [
      { location: 'Persian Gulf', daysAgoStart: 13, durationHours: 18 },
      { location: 'South China Sea', daysAgoStart: 43, durationHours: 6 },
    ],
  },
  {
    // Arabian Sea, underway toward Singapore
    status: 'underway_engine', lat: 22.31, lon: 60.14, destination: 'SGSIN', speed: 11.2,
    draught: 14.8, maxDraught: 20.8,
    portCalls: [
      { portName: 'Fujairah Anchorage', portCountry: 'UAE', countryCode: 'ae', locode: 'AEFJR', daysAgo: 5, durationHours: 36 },
      { portName: 'Jebel Ali', portCountry: 'UAE', countryCode: 'ae', locode: 'AEJEA', daysAgo: 22, durationHours: 24 },
      { portName: 'Singapore', portCountry: 'Singapore', countryCode: 'sg', locode: 'SGSIN', daysAgo: 42, durationHours: 30 },
      { portName: 'Ras Tanura', portCountry: 'Saudi Arabia', countryCode: 'sa', locode: 'SARTN', daysAgo: 62, durationHours: 60 },
      { portName: 'Busan', portCountry: 'South Korea', countryCode: 'kr', locode: 'KRBSN', daysAgo: 95, durationHours: 38 },
    ],
    darkPeriods: [],
  },
  {
    // Kuwait terminal, loading
    status: 'moored', lat: 29.07, lon: 48.13, destination: 'JPYOK', speed: 0,
    draught: 20.1, maxDraught: 21.0,
    portCalls: [
      { portName: 'Mina Al Ahmadi', portCountry: 'Kuwait', countryCode: 'kw', locode: 'KWMAA', daysAgo: 1, durationHours: null },
      { portName: 'Yokohama', portCountry: 'Japan', countryCode: 'jp', locode: 'JPYOK', daysAgo: 24, durationHours: 40 },
      { portName: 'Mina Al Ahmadi', portCountry: 'Kuwait', countryCode: 'kw', locode: 'KWMAA', daysAgo: 47, durationHours: 55 },
      { portName: 'Yeosu', portCountry: 'South Korea', countryCode: 'kr', locode: 'KRYOS', daysAgo: 72, durationHours: 35 },
      { portName: 'Ras al-Khair', portCountry: 'Saudi Arabia', countryCode: 'sa', locode: 'SARAX', daysAgo: 100, durationHours: 62 },
    ],
    darkPeriods: [],
  },
  {
    // Red Sea, AIS dark, suspicious routing
    status: 'anchored', lat: 21.55, lon: 39.14, destination: '', speed: 0,
    draught: 8.5, maxDraught: 16.2,
    portCalls: [
      { portName: 'Port Sudan', portCountry: 'Sudan', countryCode: 'sd', locode: 'SDPZU', daysAgo: 8, durationHours: 96 },
      { portName: 'Jeddah', portCountry: 'Saudi Arabia', countryCode: 'sa', locode: 'SAJED', daysAgo: 38, durationHours: 20 },
      { portName: 'Aden', portCountry: 'Yemen', countryCode: 'ye', locode: 'YEADE', daysAgo: 62, durationHours: 12 },
      { portName: 'Djibouti', portCountry: 'Djibouti', countryCode: 'dj', locode: 'DJJIB', daysAgo: 82, durationHours: 48 },
      { portName: 'Bandar Abbas', portCountry: 'Iran', countryCode: 'ir', locode: 'IRBND', daysAgo: 115, durationHours: 58 },
    ],
    darkPeriods: [
      { location: 'Red Sea', daysAgoStart: 10, durationHours: 30 },
      { location: 'Gulf of Aden', daysAgoStart: 63, durationHours: 14 },
    ],
  },
]

function buildMock(imo: string): VesselAisData {
  const h   = imoHash(imo)
  const s   = MOCK_SCENARIOS[h % MOCK_SCENARIOS.length]
  const now = new Date()

  const portCalls: PortCall[] = s.portCalls.map((pc) => {
    const arrival   = new Date(now.getTime() - pc.daysAgo * 86_400_000)
    const departure = pc.durationHours != null
      ? new Date(arrival.getTime() + pc.durationHours * 3_600_000)
      : null
    return {
      portName:     pc.portName,
      portCountry:  pc.portCountry,
      countryCode:  pc.countryCode,
      locode:       pc.locode,
      arrival:      arrival.toISOString(),
      departure:    departure?.toISOString() ?? null,
      durationHours: pc.durationHours,
      event:        'port_call',
    }
  })

  const darkPeriods: AisDarkPeriod[] = s.darkPeriods.map((dp) => {
    const start = new Date(now.getTime() - dp.daysAgoStart * 86_400_000)
    const end   = new Date(start.getTime() + dp.durationHours * 3_600_000)
    return {
      start:         start.toISOString(),
      end:           end.toISOString(),
      location:      dp.location,
      durationHours: dp.durationHours,
    }
  })

  const eta = new Date(now.getTime() + (3 + (h % 10)) * 86_400_000)
  const latJitter = ((h >> 4) % 100) * 0.005
  const lonJitter = ((h >> 8) % 100) * 0.005

  return {
    imo,
    mmsi: `23${imo.slice(-5)}`,
    position: {
      lat:        s.lat + latJitter,
      lon:        s.lon + lonJitter,
      speed:      s.speed,
      course:     h % 360,
      status:     s.status,
      destination: s.destination,
      eta:        s.status === 'underway_engine' ? eta.toISOString() : null,
      draught:    s.draught,
      maxDraught: s.maxDraught,
      lastUpdate: new Date(now.getTime() - (h % 120) * 60_000).toISOString(),
    },
    portCalls,
    darkPeriods,
    provider:  'mock',
    fetchedAt: now.toISOString(),
  }
}

// ── PostgreSQL 缓存层 ──────────────────────────────────────────────────────────
//
// TTL 策略（软过期）：
//   航行中 (SOG > 0)        → 10 分钟（位置变化快）
//   锚泊 / 靠泊 (SOG = 0)   → 45 分钟（位置稳定）
//   aisstream 超时（无信号） → 5  分钟（短 TTL，下次可能进入覆盖区）
//   mock 数据               → 不缓存
//
// Stale-While-Revalidate（SWR）：
//   当缓存在软过期（expires_at）后的宽限窗口内（= 再加一个 TTL）时，
//   立即返回旧数据，同时在后台异步刷新缓存；超出宽限窗口则同步等待新数据。

function cacheTtlMinutes(data: VesselAisData): number | null {
  if (data.provider === 'mock') return null
  if (!data.position)                        return 5   // 无信号
  return data.position.speed > 0 ? 10 : 45
}

interface CacheRow {
  data_json:  unknown
  fetched_at: Date
  expires_at: Date
}

interface CacheResult {
  data:  VesselAisData
  stale: boolean   // true = 软过期但在宽限窗口内，需后台刷新
}

async function readCache(imo: string): Promise<CacheResult | null> {
  try {
    const { db } = await import('./db')
    const { rows } = await db.query<CacheRow>(
      `SELECT data_json, fetched_at, expires_at FROM ais_cache WHERE imo = $1 LIMIT 1`,
      [imo],
    )
    if (!rows[0]) return null

    const now       = Date.now()
    const expiresMs = rows[0].expires_at.getTime()
    const fetchedMs = rows[0].fetched_at.getTime()
    const originalTtlMs = expiresMs - fetchedMs          // 原始 TTL（毫秒）
    const graceEndMs    = expiresMs + originalTtlMs      // 宽限截止 = 2× TTL

    if (now <= expiresMs) {
      // 新鲜命中
      return { data: rows[0].data_json as VesselAisData, stale: false }
    }
    if (now <= graceEndMs) {
      // 软过期，宽限窗口内 → 返回旧数据并后台刷新
      return { data: rows[0].data_json as VesselAisData, stale: true }
    }
    // 超出宽限窗口，视为缓存失效
    return null
  } catch {
    return null
  }
}

async function writeCache(imo: string, data: VesselAisData): Promise<void> {
  const ttl = cacheTtlMinutes(data)
  if (ttl === null) return
  try {
    const { db } = await import('./db')
    await db.query(
      `INSERT INTO ais_cache (imo, mmsi, data_json, provider, fetched_at, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW() + ($5 || ' minutes')::INTERVAL)
       ON CONFLICT (imo) DO UPDATE
         SET mmsi       = EXCLUDED.mmsi,
             data_json  = EXCLUDED.data_json,
             provider   = EXCLUDED.provider,
             fetched_at = EXCLUDED.fetched_at,
             expires_at = EXCLUDED.expires_at`,
      [imo, data.mmsi ?? null, JSON.stringify(data), data.provider, String(ttl)],
    )
  } catch (err) {
    console.error('[ais:cache] write failed:', err instanceof Error ? err.message : err)
  }
}

// 追踪正在后台刷新的 IMO，避免同一船舶并发重复拉取
const refreshingSet = new Set<string>()

// ── Public API ─────────────────────────────────────────────────────────────────

export interface GetVesselAisOptions {
  /** MMSI if already known (e.g. from vessel entity in DB). Skips VesselAPI resolution. */
  mmsi?: string | null
}

/**
 * 调用实际 AIS provider（不走缓存）。
 * 供 getVesselAis 和后台 SWR 刷新共用。
 */
async function fetchFromProvider(
  imo: string,
  options: GetVesselAisOptions,
): Promise<VesselAisData> {
  const provider = process.env.AIS_PROVIDER
  let data: VesselAisData | null = null

  if (provider === 'vesselapi') {
    data = await fetchVesselApi(imo)
  }

  if (!data && provider === 'aisstream') {
    let mmsi: string | null = options.mmsi ?? null
    if (!mmsi) {
      const resolved = await fetchVesselApi(imo)
      mmsi = resolved?.mmsi ?? null
    }
    if (mmsi) {
      const streamed = await fetchAisStream(mmsi)
      if (streamed) data = { ...streamed, imo }
    }
    if (!data) console.warn('[ais] aisstream: no MMSI for IMO', imo, '— falling back to mock')
  }

  if (!data && provider === 'hifleet') {
    let mmsi: string | null = options.mmsi ?? null
    if (!mmsi) {
      const resolved = await fetchVesselApi(imo)
      mmsi = resolved?.mmsi ?? null
    }
    if (mmsi) {
      data = await fetchHifleet(mmsi, imo)
    }
    if (!data) console.warn('[ais] hifleet: no MMSI for IMO', imo, '— falling back to mock')
  }

  if (!data && provider === 'datalastic') {
    data = await fetchDatalastic(imo)
  }

  return data ?? buildMock(imo)
}

export async function getVesselAis(
  imo: string,
  options: GetVesselAisOptions = {},
): Promise<VesselAisData> {
  // 1. 查缓存（含 SWR 宽限窗口逻辑）
  const cached = await readCache(imo)

  if (cached) {
    if (!cached.stale) {
      // 新鲜命中，直接返回
      console.log(`[ais] cache hit for IMO ${imo} (provider: ${cached.data.provider})`)
      return cached.data
    }

    // 软过期（宽限窗口内）：立即返回旧数据，后台异步刷新
    if (!refreshingSet.has(imo)) {
      refreshingSet.add(imo)
      console.log(`[ais] stale cache for IMO ${imo}, triggering background refresh`)
      fetchFromProvider(imo, options)
        .then((fresh) => writeCache(imo, fresh))
        .catch((err) => console.error('[ais] background refresh failed:', err instanceof Error ? err.message : err))
        .finally(() => refreshingSet.delete(imo))
    }
    return cached.data
  }

  // 2. 缓存完全失效或首次请求 → 同步拉取
  const result = await fetchFromProvider(imo, options)

  // 3. 写入缓存（mock 数据不缓存）
  writeCache(imo, result).catch(console.error)

  return result
}

export { navStatusLabel, navStatusColor } from '@/lib/ais-utils'

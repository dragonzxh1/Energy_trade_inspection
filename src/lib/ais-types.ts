/**
 * Shared AIS type definitions — client-safe, no server imports.
 * Import from here in client components instead of @/lib/server/ais.
 */

export type AisNavStatus =
  | 'underway_engine'
  | 'anchored'
  | 'moored'
  | 'restricted_manoeuvrability'
  | 'not_under_command'
  | 'undefined'

export interface AisPosition {
  lat: number
  lon: number
  speed: number
  course: number
  status: AisNavStatus
  destination: string
  eta: string | null
  draught: number
  maxDraught: number
  lastUpdate: string
}

export interface PortCall {
  portName: string
  portCountry: string
  countryCode: string
  locode: string
  arrival: string
  departure: string | null
  durationHours: number | null
  event: 'port_call' | 'anchorage' | 'sts'
}

export interface AisDarkPeriod {
  start: string
  end: string | null
  location: string
  durationHours: number | null
}

export interface VesselAisData {
  imo: string
  mmsi: string | null
  position: AisPosition | null
  portCalls: PortCall[]
  darkPeriods: AisDarkPeriod[]
  provider: 'vesselapi' | 'aisstream' | 'hifleet' | 'datalastic' | 'mock'
  fetchedAt: string
}

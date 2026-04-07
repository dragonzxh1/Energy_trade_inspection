/**
 * Client-safe AIS utility functions.
 * Import from here in client components instead of @/lib/server/ais.
 */

import type { AisNavStatus } from './ais-types'

export function navStatusLabel(status: AisNavStatus): string {
  const MAP: Record<AisNavStatus, string> = {
    underway_engine:            'Underway (Engine)',
    anchored:                   'Anchored',
    moored:                     'Moored',
    restricted_manoeuvrability: 'Restricted Manoeuvrability',
    not_under_command:          'Not Under Command',
    undefined:                  'Unknown',
  }
  return MAP[status] ?? 'Unknown'
}

export function navStatusColor(status: AisNavStatus): string {
  if (status === 'underway_engine') return 'var(--status-clear)'
  if (status === 'anchored')        return '#eab308'
  if (status === 'moored')          return 'var(--accent-primary)'
  return 'var(--text-muted)'
}

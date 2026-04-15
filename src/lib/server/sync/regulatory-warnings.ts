/**
 * Regulatory Warning List Synchronization
 *
 * Fetches and stores warning lists from 7 financial regulators.
 * Each source is independent — a single failure does not block others.
 *
 * Sources:
 *   fca    FCA (UK)             register.fca.org.uk — CSV
 *   finma  FINMA (Switzerland)  finma.ch — HTML
 *   sfc    SFC (Hong Kong)      sfc.hk — HTML
 *   mas    MAS (Singapore)      eservices.mas.gov.sg — HTML
 *   dfsa   DFSA (Dubai DIFC)    dfsa.ae — HTML
 *   sca    SCA (UAE federal)    sca.gov.ae — HTML
 *   cma    CMA Oman             cma.gov.om — HTML
 */

import { load as cheerioLoad } from 'cheerio'
import type { PoolClient } from 'pg'
import { db } from '@/lib/server/db'
import { normalizeEntityName } from '@/lib/server/normalize'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WarningEntry {
  id: string
  source: string
  source_name: string
  jurisdiction: string
  entity_name: string
  normalized_name: string
  list_url: string
  warning_type: string | null
}

export interface WarningListSyncResult {
  source: string
  count: number
  error?: string
  durationMs: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'EnergyTradeInspection/1.0 (compliance@energytradeinspection.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`)
  return response.text()
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'EnergyTradeInspection/1.0 (compliance@energytradeinspection.com)',
      Accept: 'text/csv,text/plain,*/*',
    },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`)
  return response.text()
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

function makeEntry(
  source: string,
  source_name: string,
  jurisdiction: string,
  list_url: string,
  entity_name: string,
  warning_type: string | null
): WarningEntry {
  return {
    id: `${source}:${slugify(entity_name)}`,
    source,
    source_name,
    jurisdiction,
    entity_name,
    normalized_name: normalizeEntityName(entity_name, true),
    list_url,
    warning_type,
  }
}

// ── FCA (UK) — CSV ────────────────────────────────────────────────────────────
// CSV from https://register.fca.org.uk/s/search?predefined=U
// Each row: firm name + type. Filter rows where type indicates warning.
// FCA warning list CSV URL (unauthorized firms):
//   https://register.fca.org.uk/services/V0.1/Registers/Unauthorised

async function scrapeFca(): Promise<WarningEntry[]> {
  const LIST_URL = 'https://register.fca.org.uk/s/search?predefined=U'
  // FCA publishes a downloadable CSV at this endpoint (unauthenticated)
  const CSV_URL = 'https://register.fca.org.uk/services/V0.1/Registers/Unauthorised'
  const entries: WarningEntry[] = []
  const seen = new Set<string>()

  try {
    const csvText = await fetchText(CSV_URL)
    const lines = csvText.split(/\r?\n/).filter(l => l.trim())
    // First line is header — skip it
    for (let i = 1; i < lines.length; i++) {
      // CSV columns: typically "Firm Name","Reference Number","Type",...
      // Parse first quoted field as entity name
      const match = lines[i].match(/^"([^"]+)"/)
      const name = match ? match[1].trim() : lines[i].split(',')[0].replace(/"/g, '').trim()
      if (!name || name.length < 2 || seen.has(name)) continue
      seen.add(name)
      entries.push(makeEntry('fca', 'FCA (UK)', 'UK', LIST_URL, name, 'unauthorized_firm'))
    }
  } catch {
    // Fallback: HTML scrape of search results page if CSV fails
    const html = await fetchHtml(LIST_URL)
    const $ = cheerioLoad(html)
    $('table tr td:first-child').each((_, el) => {
      const name = $(el).text().trim()
      if (name && name.length >= 2 && !seen.has(name) && !/^(firm name|name)$/i.test(name)) {
        seen.add(name)
        entries.push(makeEntry('fca', 'FCA (UK)', 'UK', LIST_URL, name, 'unauthorized_firm'))
      }
    })
  }

  return entries
}

// ── FINMA (Switzerland) — HTML ────────────────────────────────────────────────
// https://www.finma.ch/en/warning-list/

async function scrapeFinma(): Promise<WarningEntry[]> {
  const LIST_URL = 'https://www.finma.ch/en/warning-list/'
  const html = await fetchHtml(LIST_URL)
  const $ = cheerioLoad(html)
  const entries: WarningEntry[] = []
  const seen = new Set<string>()

  // FINMA uses a table structure; each row is one entity
  $('table tr').each((_, el) => {
    const cells = $(el).find('td')
    if (cells.length === 0) return
    const name = $(cells[0]).text().trim()
    if (!name || name.length < 2 || seen.has(name)) return
    seen.add(name)
    entries.push(makeEntry('finma', 'FINMA (Switzerland)', 'CH', LIST_URL, name, 'unauthorized_firm'))
  })

  // Fallback: list items
  if (entries.length < 3) {
    $('ul li, ol li').each((_, el) => {
      const name = $(el).text().trim().split(/\n/)[0].trim()
      if (name && name.length >= 2 && !seen.has(name)) {
        seen.add(name)
        entries.push(makeEntry('finma', 'FINMA (Switzerland)', 'CH', LIST_URL, name, 'unauthorized_firm'))
      }
    })
  }

  return entries
}

// ── SFC (Hong Kong) — HTML ────────────────────────────────────────────────────
// https://www.sfc.hk/en/Regulatory-functions/Intermediaries/Licensing/Disciplinary-actions-and-other-regulatory-actions/Investor-alert-list

async function scrapeSfc(): Promise<WarningEntry[]> {
  const LIST_URL = 'https://www.sfc.hk/en/Regulatory-functions/Intermediaries/Licensing/Disciplinary-actions-and-other-regulatory-actions/Investor-alert-list'
  const html = await fetchHtml(LIST_URL)
  const $ = cheerioLoad(html)
  const entries: WarningEntry[] = []
  const seen = new Set<string>()

  $('table tr').each((_, el) => {
    const cells = $(el).find('td')
    if (cells.length === 0) return
    const name = $(cells[0]).text().trim()
    if (!name || name.length < 2 || seen.has(name)) return
    seen.add(name)
    entries.push(makeEntry('sfc', 'SFC (Hong Kong)', 'HK', LIST_URL, name, 'unauthorized_firm'))
  })

  if (entries.length < 3) {
    $('ul li, ol li').each((_, el) => {
      const name = $(el).text().trim().split(/\n/)[0].trim()
      if (name && name.length >= 2 && !seen.has(name)) {
        seen.add(name)
        entries.push(makeEntry('sfc', 'SFC (Hong Kong)', 'HK', LIST_URL, name, 'unauthorized_firm'))
      }
    })
  }

  return entries
}

// ── MAS (Singapore) — HTML ────────────────────────────────────────────────────
// https://eservices.mas.gov.sg/ialist/

async function scrapeMas(): Promise<WarningEntry[]> {
  const LIST_URL = 'https://eservices.mas.gov.sg/ialist/'
  const html = await fetchHtml(LIST_URL)
  const $ = cheerioLoad(html)
  const entries: WarningEntry[] = []
  const seen = new Set<string>()

  $('table tr').each((_, el) => {
    const cells = $(el).find('td')
    if (cells.length === 0) return
    const name = $(cells[0]).text().trim()
    if (!name || name.length < 2 || seen.has(name) || /^(entity|name|company)/i.test(name)) return
    seen.add(name)
    entries.push(makeEntry('mas', 'MAS (Singapore)', 'SG', LIST_URL, name, 'investor_alert'))
  })

  if (entries.length < 3) {
    $('ul li, .entity-name, [class*="entity"], [class*="name"]').each((_, el) => {
      const name = $(el).text().trim().split(/\n/)[0].trim()
      if (name && name.length >= 2 && !seen.has(name)) {
        seen.add(name)
        entries.push(makeEntry('mas', 'MAS (Singapore)', 'SG', LIST_URL, name, 'investor_alert'))
      }
    })
  }

  return entries
}

// ── DFSA (Dubai DIFC) — HTML ──────────────────────────────────────────────────
// https://www.dfsa.ae/investor-protection/fraud-and-scam-alert

async function scrapeDfsa(): Promise<WarningEntry[]> {
  const LIST_URL = 'https://www.dfsa.ae/investor-protection/fraud-and-scam-alert'
  const html = await fetchHtml(LIST_URL)
  const $ = cheerioLoad(html)
  const entries: WarningEntry[] = []
  const seen = new Set<string>()

  $('table tr').each((_, el) => {
    const cells = $(el).find('td')
    if (cells.length === 0) return
    const name = $(cells[0]).text().trim()
    if (!name || name.length < 2 || seen.has(name)) return
    seen.add(name)
    entries.push(makeEntry('dfsa', 'DFSA (Dubai DIFC)', 'AE-DU', LIST_URL, name, 'unauthorized_firm'))
  })

  if (entries.length < 3) {
    $('ul li, h3, h4, .alert-entity, [class*="company"], [class*="entity"]').each((_, el) => {
      const name = $(el).text().trim().split(/\n/)[0].trim()
      if (
        name && name.length >= 2 && !seen.has(name) &&
        !/^(fraud|scam|warning|alert|notice)/i.test(name)
      ) {
        seen.add(name)
        entries.push(makeEntry('dfsa', 'DFSA (Dubai DIFC)', 'AE-DU', LIST_URL, name, 'unauthorized_firm'))
      }
    })
  }

  return entries
}

// ── SCA (UAE federal) — HTML ──────────────────────────────────────────────────
// https://www.sca.gov.ae/en/services/warning-list.aspx

async function scrapeSca(): Promise<WarningEntry[]> {
  const LIST_URL = 'https://www.sca.gov.ae/en/services/warning-list.aspx'
  const html = await fetchHtml(LIST_URL)
  const $ = cheerioLoad(html)
  const entries: WarningEntry[] = []
  const seen = new Set<string>()

  $('table tr').each((_, el) => {
    const cells = $(el).find('td')
    if (cells.length === 0) return
    const name = $(cells[0]).text().trim()
    if (!name || name.length < 2 || seen.has(name)) return
    seen.add(name)
    entries.push(makeEntry('sca', 'SCA (UAE)', 'AE', LIST_URL, name, 'unauthorized_firm'))
  })

  if (entries.length < 3) {
    $('ul li, h3, h4, [class*="company"], [class*="entity"]').each((_, el) => {
      const name = $(el).text().trim().split(/\n/)[0].trim()
      if (name && name.length >= 2 && !seen.has(name) && !/^(warning|alert|list)/i.test(name)) {
        seen.add(name)
        entries.push(makeEntry('sca', 'SCA (UAE)', 'AE', LIST_URL, name, 'unauthorized_firm'))
      }
    })
  }

  return entries
}

// ── CMA Oman — HTML ───────────────────────────────────────────────────────────
// https://www.cma.gov.om/Home/WarningList/indexEn

async function scrapeCmaOman(): Promise<WarningEntry[]> {
  const LIST_URL = 'https://www.cma.gov.om/Home/WarningList/indexEn'
  const html = await fetchHtml(LIST_URL)
  const $ = cheerioLoad(html)
  const entries: WarningEntry[] = []
  const seen = new Set<string>()

  $('table tr').each((_, el) => {
    const cells = $(el).find('td')
    if (cells.length === 0) return
    const name = $(cells[0]).text().trim()
    if (!name || name.length < 2 || seen.has(name)) return
    seen.add(name)
    entries.push(makeEntry('cma', 'CMA (Oman)', 'OM', LIST_URL, name, 'unauthorized_firm'))
  })

  if (entries.length < 3) {
    $('ul li, h3, h4, [class*="company"], [class*="entity"]').each((_, el) => {
      const name = $(el).text().trim().split(/\n/)[0].trim()
      if (name && name.length >= 2 && !seen.has(name) && !/^(warning|alert|list)/i.test(name)) {
        seen.add(name)
        entries.push(makeEntry('cma', 'CMA (Oman)', 'OM', LIST_URL, name, 'unauthorized_firm'))
      }
    })
  }

  return entries
}

// ── Database upsert ───────────────────────────────────────────────────────────

async function upsertWarnings(client: PoolClient, source: string, entries: WarningEntry[]): Promise<number> {
  if (entries.length === 0) return 0

  // Delete stale entries for this source, then batch-insert fresh data
  await client.query('DELETE FROM regulatory_warnings WHERE source = $1', [source])

  const BATCH_SIZE = 200
  let inserted = 0

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    const placeholders = batch
      .map((_, j) => {
        const b = j * 9
        return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9})`
      })
      .join(',')

    await client.query(
      `INSERT INTO regulatory_warnings
         (id, source, source_name, jurisdiction, entity_name, normalized_name, list_url, warning_type, synced_at)
       VALUES ${placeholders}
       ON CONFLICT (id) DO UPDATE SET
         entity_name     = EXCLUDED.entity_name,
         normalized_name = EXCLUDED.normalized_name,
         source_name     = EXCLUDED.source_name,
         jurisdiction    = EXCLUDED.jurisdiction,
         list_url        = EXCLUDED.list_url,
         warning_type    = EXCLUDED.warning_type,
         synced_at       = NOW()`,
      batch.flatMap(e => [
        e.id, e.source, e.source_name, e.jurisdiction,
        e.entity_name, e.normalized_name, e.list_url, e.warning_type, new Date(),
      ])
    )
    inserted += batch.length
  }

  return inserted
}

// ── Per-source sync ───────────────────────────────────────────────────────────

const SCRAPERS: { source: string; fn: () => Promise<WarningEntry[]> }[] = [
  { source: 'fca',   fn: scrapeFca },
  { source: 'finma', fn: scrapeFinma },
  { source: 'sfc',   fn: scrapeSfc },
  { source: 'mas',   fn: scrapeMas },
  { source: 'dfsa',  fn: scrapeDfsa },
  { source: 'sca',   fn: scrapeSca },
  { source: 'cma',   fn: scrapeCmaOman },
]

async function syncSource(source: string, scraper: () => Promise<WarningEntry[]>): Promise<WarningListSyncResult> {
  const startMs = Date.now()
  const client = await db.connect()
  try {
    const entries = await scraper()
    await client.query('BEGIN')
    const count = await upsertWarnings(client, source, entries)

    // Log to sanctions_sync_log with source key 'warn:{source}'
    await client.query(
      `INSERT INTO sanctions_sync_log (source, status, record_count, duration_ms)
       VALUES ($1, 'success', $2, $3)`,
      [`warn:${source}`, count, Date.now() - startMs]
    )
    await client.query('COMMIT')
    return { source, count, durationMs: Date.now() - startMs }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    const errMsg = String(error)
    await db.query(
      `INSERT INTO sanctions_sync_log (source, status, error_message, duration_ms)
       VALUES ($1, 'error', $2, $3)`,
      [`warn:${source}`, errMsg, Date.now() - startMs]
    )
    return { source, count: 0, error: errMsg, durationMs: Date.now() - startMs }
  } finally {
    client.release()
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Sync all 7 regulatory warning list sources. Returns per-source results. */
export async function syncRegulatoryWarnings(): Promise<WarningListSyncResult[]> {
  const results: WarningListSyncResult[] = []
  // Sequential to avoid hammering external regulators in parallel
  for (const { source, fn } of SCRAPERS) {
    results.push(await syncSource(source, fn))
  }
  return results
}

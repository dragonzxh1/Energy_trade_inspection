/**
 * Fraud Alert Synchronization
 *
 * Scrapes industry blacklists and whitelists to populate fraud_alerts.
 * Each source is independent — a single source failing does not block others.
 *
 * Sources:
 *   storagespoofing  Rotterdam Port Blacklist & Whitelist (storagespoofing.nl)
 *   fuelscamalert    Fuel Scam Alert — tank farms & terminals (fuelscamalert.com)
 *   ametheus         Ametheus Storage Spoofing Blacklist (ametheus.com)
 *   glo-innovations  Global Innovations Storage Spoofing Blacklist (glo-innovations.com)
 *   capitalgaslogistics Capital Gas Logistics Fraud Alert (capitalgaslogistics.us)
 *
 * Traceability: every fraud_alerts row records source + source_url so users can
 * follow the original reference to verify the listing.
 */

import { load as cheerioLoad } from 'cheerio'
import type { PoolClient } from 'pg'
import { db } from '@/lib/server/db'
import { normalizeEntityName } from '@/lib/server/normalize'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FraudEntry {
  id: string
  source: string
  source_name: string
  source_url: string
  company_name: string
  normalized_name: string
  list_type: 'blacklist' | 'whitelist'
  fraud_type: string | null
  description: string | null
  scam_url: string | null
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'EnergyTradeInspection/1.0 (compliance@energytradeinspection.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`)
  }
  return response.text()
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// ── storagespoofing.nl ────────────────────────────────────────────────────────
// Rotterdam Port Blacklist & Whitelist.
//
// Blacklist page structure: table rows with company name + broken URL.
//   Each <tr> first cell is the organisation name.
//
// Whitelist page structure: <p> tags, each containing one company (possibly
//   with multiple name aliases separated by <br>) and a trailing <a href>.
//   E.g. <p>AGLOBIS<br /><a href="http://www.aglobis.com/">www.aglobis.com</a></p>

async function scrapeStorageSpoofing(): Promise<FraudEntry[]> {
  const entries: FraudEntry[] = []

  // ── Blacklist ────────────────────────────────────────────────────────────────
  {
    const url = 'https://storagespoofing.nl/en/blacklist/'
    const html = await fetchHtml(url)
    const $ = cheerioLoad(html)
    const candidates: string[] = []

    $('table tr td:first-child, table tr th:first-child').each((_, el) => {
      const text = $(el).text().trim()
      if (text) candidates.push(text)
    })

    if (candidates.length < 3) {
      $('ul li, ol li').each((_, el) => {
        const text = $(el).clone().children('a, span').first().text().trim()
          || $(el).text().trim()
        if (text) candidates.push(text)
      })
    }

    if (candidates.length < 3) {
      $('h2, h3, h4, .company-name, .entry-title, [class*="company"], [class*="name"]').each(
        (_, el) => {
          const text = $(el).text().trim()
          if (text) candidates.push(text)
        }
      )
    }

    const companyNames = candidates.filter(
      (t) => t.length >= 3 && t.length <= 200 && !/^(company|naam|name|#|no\.?)$/i.test(t)
    )

    for (const name of companyNames) {
      const normalized = normalizeEntityName(name, true)
      if (!normalized || normalized.length < 2) continue
      entries.push({
        id: `storagespoofing:blacklist:${slugify(name)}`,
        source: 'storagespoofing',
        source_name: 'Rotterdam Port Blacklist',
        source_url: url,
        company_name: name,
        normalized_name: normalized,
        list_type: 'blacklist',
        fraud_type: 'storage-spoofing',
        description: null,
        scam_url: null,
      })
    }
  }

  // ── Whitelist ────────────────────────────────────────────────────────────────
  // Each company occupies one <p> tag. Structure:
  //   <p>PRIMARY NAME<br />[ALIAS1<br />...]<a href="URL">www.site.com</a></p>
  // We extract the first non-empty text node (primary name) from each <p> that
  // contains an external <a> link.
  {
    const url = 'https://storagespoofing.nl/en/whitelist/'
    const html = await fetchHtml(url)
    const $ = cheerioLoad(html)
    const seen = new Set<string>()

    $('p').each((_, el) => {
      const $p = $(el)
      const externalLink = $p.find('a[href^="http"]').first()
      if (!externalLink.length) return  // no external link — not a company paragraph

      const officialUrl = externalLink.attr('href') ?? null

      // Extract name lines: clone the <p>, remove the <a> link, split on <br>
      const $clone = $p.clone()
      $clone.find('a').remove()

      // cheerio renders <br> as newlines in .text(); also handle &amp; etc.
      const rawText = $clone.text()
      const lines = rawText
        .split(/\n|<br\s*\/?>/)
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter((l) => l.length >= 3)

      if (lines.length === 0) return

      // Primary name is the first line
      const primaryName = lines[0]
      if (seen.has(primaryName)) return
      seen.add(primaryName)

      const normalized = normalizeEntityName(primaryName, true)
      if (!normalized || normalized.length < 2) return

      entries.push({
        id: `storagespoofing:whitelist:${slugify(primaryName)}`,
        source: 'storagespoofing',
        source_name: 'Rotterdam Port Whitelist',
        source_url: url,
        company_name: primaryName,
        normalized_name: normalized,
        list_type: 'whitelist',
        fraud_type: null,
        description: null,
        scam_url: officialUrl,
      })

      // Also add aliases (additional lines) as separate whitelist entries so
      // fuzzy matching can find them by old names like "KOOLE TANKSTORAGE BOTLEK".
      for (let i = 1; i < lines.length; i++) {
        const alias = lines[i]
        // Strip "(was: ...)" or "(formerly: ...)" annotations — keep the name part.
        const cleanAlias = alias.replace(/\s*\((?:was|formerly|formerly:|was:)[^)]*\)/gi, '').trim()
        if (cleanAlias.length < 4 || seen.has(cleanAlias)) continue
        seen.add(cleanAlias)
        const aliasNormalized = normalizeEntityName(cleanAlias, true)
        if (!aliasNormalized || aliasNormalized.length < 2) continue
        entries.push({
          id: `storagespoofing:whitelist:${slugify(cleanAlias)}`,
          source: 'storagespoofing',
          source_name: 'Rotterdam Port Whitelist',
          source_url: url,
          company_name: cleanAlias,
          normalized_name: aliasNormalized,
          list_type: 'whitelist',
          fraud_type: null,
          description: null,
          scam_url: officialUrl,
        })
      }
    })
  }

  return entries
}

// ── fuelscamalert.com ─────────────────────────────────────────────────────────
// Lists scam tank farms and terminals.
// Page structure: cards or list items with company name + possibly a fake website URL.

async function scrapeFuelScamAlert(): Promise<FraudEntry[]> {
  const url = 'https://www.fuelscamalert.com/scam-tank-farms-terminals'
  const html = await fetchHtml(url)
  const $ = cheerioLoad(html)
  const entries: FraudEntry[] = []

  // Try to find company blocks: each scam listing has a name + optionally a URL
  const seen = new Set<string>()

  // Pattern: article/section/div with heading + optional link to scam site
  $('article, .entry, .post, section[class*="company"], div[class*="scam"], div[class*="company"]').each(
    (_, el) => {
      const heading = $(el).find('h1, h2, h3, h4').first().text().trim()
      const scamLink = $(el).find('a[href^="http"]').first().attr('href') ?? null
      if (heading && !seen.has(heading)) {
        seen.add(heading)
        entries.push(makeEntry('fuelscamalert', 'Fuel Scam Alert', url, heading, 'fuel-scam', null, scamLink))
      }
    }
  )

  // Fallback: list items with links
  if (entries.length < 3) {
    $('ul li, ol li').each((_, el) => {
      const text = $(el).text().trim()
      const link = $(el).find('a[href^="http"]').first().attr('href') ?? null
      if (text && text.length >= 3 && !seen.has(text)) {
        seen.add(text)
        entries.push(makeEntry('fuelscamalert', 'Fuel Scam Alert', url, text, 'fuel-scam', null, link))
      }
    })
  }

  // Fallback: headings on the page
  if (entries.length < 3) {
    $('h2, h3').each((_, el) => {
      const text = $(el).text().trim()
      if (text && text.length >= 3 && text.length <= 150 && !seen.has(text)) {
        seen.add(text)
        entries.push(makeEntry('fuelscamalert', 'Fuel Scam Alert', url, text, 'fuel-scam', null, null))
      }
    })
  }

  return entries
}

// ── ametheus.com ──────────────────────────────────────────────────────────────
// Ametheus blacklisted storage spoofing companies.
// Page structure: list or table of company names.

async function scrapeAmetheus(): Promise<FraudEntry[]> {
  const url = 'https://ametheus.com/blacklisted-storage-spoofing-companies/'
  const html = await fetchHtml(url)
  const $ = cheerioLoad(html)
  const entries: FraudEntry[] = []
  const seen = new Set<string>()

  $('table tr td, ul li, ol li, h3, h4, .company, [class*="blacklist"] li').each(
    (_, el) => {
      const text = $(el).children().length > 2
        ? $(el).find('td:first-child, h3, h4').first().text().trim()
        : $(el).text().trim()
      if (text && text.length >= 3 && text.length <= 200 && !seen.has(text)) {
        seen.add(text)
        entries.push(makeEntry('ametheus', 'Ametheus Blacklist', url, text, 'storage-spoofing', null, null))
      }
    }
  )

  return entries
}

// ── glo-innovations.com ───────────────────────────────────────────────────────
// Global Innovations Storage Spoofing Blacklist.
// Lists suspected storage-spoofing websites/companies.

async function scrapeGloInnovations(): Promise<FraudEntry[]> {
  const url = 'https://glo-innovations.com/storage-spoofing-blacklist/'
  const html = await fetchHtml(url)
  const $ = cheerioLoad(html)
  const entries: FraudEntry[] = []
  const seen = new Set<string>()

  // Companies listed with their scam website URLs
  $('table tr, ul li, ol li, article, .entry').each((_, el) => {
    const name = $(el).find('td:first-child, h2, h3, h4, strong').first().text().trim()
      || $(el).text().trim()
    const scamLink = $(el).find('a[href^="http"]').first().attr('href') ?? null
    if (name && name.length >= 3 && name.length <= 200 && !seen.has(name)) {
      seen.add(name)
      entries.push(
        makeEntry('glo-innovations', 'Global Innovations Storage Spoofing Blacklist', url, name, 'storage-spoofing', null, scamLink)
      )
    }
  })

  return entries
}

// ── capitalgaslogistics.us ────────────────────────────────────────────────────
// Capital Gas Logistics Fraud Alert.
// Lists known fraud websites and impersonation cases.

async function scrapeCapitalGasLogistics(): Promise<FraudEntry[]> {
  const url = 'https://capitalgaslogistics.us/fraud-alert/'
  const html = await fetchHtml(url)
  const $ = cheerioLoad(html)
  const entries: FraudEntry[] = []
  const seen = new Set<string>()

  // Look for sections about impersonation: company name + scam website
  $('h2, h3, h4, .company-name, strong').each((_, el) => {
    const text = $(el).text().trim()
    // Skip generic headings like "Fraud Alert", "Warning", etc.
    if (
      text.length >= 3 &&
      text.length <= 150 &&
      !seen.has(text) &&
      !/^(fraud|warning|alert|notice|important|disclaimer|caution|beware)/i.test(text)
    ) {
      seen.add(text)
      // Find the nearest link to the scam site
      const scamLink = $(el).next('a, p a').first().attr('href') ?? null
      entries.push(
        makeEntry(
          'capitalgaslogistics',
          'Capital Gas Logistics Fraud Alert',
          url,
          text,
          'impersonation',
          null,
          scamLink?.startsWith('http') ? scamLink : null
        )
      )
    }
  })

  return entries
}

// ── Entry builder ─────────────────────────────────────────────────────────────

function makeEntry(
  source: string,
  source_name: string,
  source_url: string,
  company_name: string,
  fraud_type: string | null,
  description: string | null,
  scam_url: string | null
): FraudEntry {
  const normalized = normalizeEntityName(company_name, true)
  return {
    id: `${source}:${slugify(company_name)}`,
    source,
    source_name,
    source_url,
    company_name,
    normalized_name: normalized,
    list_type: 'blacklist',
    fraud_type,
    description,
    scam_url,
  }
}

// ── Database upsert ───────────────────────────────────────────────────────────

async function upsertEntries(
  client: PoolClient,
  source: string,
  entries: FraudEntry[]
): Promise<number> {
  if (entries.length === 0) return 0

  // Deduplicate by id — two different company names can produce the same slug.
  // Keep the first occurrence (earlier in the list = higher priority scraper path).
  const seen = new Set<string>()
  const deduped = entries.filter((e) => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })

  // Delete stale entries for this source, then insert fresh data.
  await client.query(`DELETE FROM fraud_alerts WHERE source = $1`, [source])

  const BATCH_SIZE = 200
  let inserted = 0

  for (let i = 0; i < deduped.length; i += BATCH_SIZE) {
    const batch = deduped.slice(i, i + BATCH_SIZE)
    const placeholders = batch
      .map((_, j) => {
        const b = j * 11
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`
      })
      .join(',')

    await client.query(
      `INSERT INTO fraud_alerts
         (id, source, source_name, source_url, company_name, normalized_name,
          list_type, fraud_type, description, scam_url, synced_at)
       VALUES ${placeholders}
       ON CONFLICT (id) DO UPDATE SET
         company_name    = EXCLUDED.company_name,
         normalized_name = EXCLUDED.normalized_name,
         source_name     = EXCLUDED.source_name,
         source_url      = EXCLUDED.source_url,
         list_type       = EXCLUDED.list_type,
         fraud_type      = EXCLUDED.fraud_type,
         description     = EXCLUDED.description,
         scam_url        = EXCLUDED.scam_url,
         synced_at       = NOW()`,
      batch.flatMap((e) => [
        e.id,
        e.source,
        e.source_name,
        e.source_url,
        e.company_name,
        e.normalized_name,
        e.list_type,
        e.fraud_type,
        e.description,
        e.scam_url,
        new Date(),
      ])
    )
    inserted += batch.length
  }

  return inserted
}

// ── Per-source sync ───────────────────────────────────────────────────────────

const SCRAPERS: {
  source: string
  fn: () => Promise<FraudEntry[]>
}[] = [
  { source: 'storagespoofing', fn: scrapeStorageSpoofing },
  { source: 'fuelscamalert', fn: scrapeFuelScamAlert },
  // ametheus.com — removed: HTTP 404, site no longer exists
  // glo-innovations.com — removed: page content is sparse and only lists external
  //   links to legitimate companies; no reliable blacklist data extractable
  // capitalgaslogistics.us — removed: fraud alert is about 2 individual impostors,
  //   external links captured were all legitimate companies being impersonated
]

export interface FraudSyncResult {
  source: string
  count: number
  error?: string
  durationMs: number
}

async function syncSource(
  source: string,
  scraper: () => Promise<FraudEntry[]>
): Promise<FraudSyncResult> {
  const startMs = Date.now()
  const client = await db.connect()
  try {
    const entries = await scraper()

    await client.query('BEGIN')
    const count = await upsertEntries(client, source, entries)

    await client.query(
      `INSERT INTO fraud_sync_log (source, status, record_count, duration_ms)
       VALUES ($1, 'success', $2, $3)`,
      [source, count, Date.now() - startMs]
    )
    await client.query('COMMIT')

    return { source, count, durationMs: Date.now() - startMs }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    const errMsg = String(error)

    await db.query(
      `INSERT INTO fraud_sync_log (source, status, error_message, duration_ms)
       VALUES ($1, 'error', $2, $3)`,
      [source, errMsg, Date.now() - startMs]
    )

    return { source, count: 0, error: errMsg, durationMs: Date.now() - startMs }
  } finally {
    client.release()
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Sync all fraud alert sources. Returns per-source results. */
export async function syncFraudAlerts(): Promise<FraudSyncResult[]> {
  // Run sources sequentially to avoid hammering external sites
  const results: FraudSyncResult[] = []
  for (const { source, fn } of SCRAPERS) {
    results.push(await syncSource(source, fn))
  }
  return results
}

/** Sync a single fraud alert source by key. */
export async function syncFraudSource(source: string): Promise<FraudSyncResult> {
  const scraper = SCRAPERS.find((s) => s.source === source)
  if (!scraper) throw new Error(`Unknown fraud source: ${source}`)
  return syncSource(scraper.source, scraper.fn)
}

/** Return last sync status per source from fraud_sync_log. */
export async function getFraudSyncStatus() {
  const { rows } = await db.query(`
    SELECT DISTINCT ON (source)
      source, status, record_count, error_message, duration_ms, synced_at
    FROM fraud_sync_log
    ORDER BY source, synced_at DESC
  `)
  return rows
}

/**
 * Two-phase Wikipedia → Wikidata energy company domain discovery.
 *
 * Phase 1: Fetch all internal article links from curated Wikipedia list pages.
 * Phase 2: Batch-query Wikidata to get official website (P856) for those articles.
 *
 * Usage:
 *   node scripts/preview-wikipedia-companies.mjs
 *   node scripts/preview-wikipedia-companies.mjs > tmp/wikipedia-companies.csv
 *
 * Requires VPN from mainland China.
 * Review the CSV, then add curated entries to MANUAL_SEED.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs'

// ── Config ────────────────────────────────────────────────────────────────────

const WIKIPEDIA_API  = 'https://en.wikipedia.org/w/api.php'
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'
const BATCH_SIZE     = 40   // Wikidata VALUES clause limit per request
const RATE_LIMIT_MS  = 1200 // be polite to Wikidata

// Wikipedia pages to scrape — ordered by relevance to energy trade
const WIKIPEDIA_SOURCES = [
  'List of oil exploration and production companies',
  'List of largest oil and gas companies by revenue',
  'National oil company',
]

// Titles to skip — non-company articles that appear as links on these pages
const SKIP_PATTERN = /^(\d{4}|List of|Category:|Wikipedia:|Template:|Oil crisis|Oil glut|Oil shock|Oil embargo|Oil price|Oil spill|Energy crisis|Energy policy|History of|Petroleum industry|Natural gas|OPEC|Barrel|Refinery|Pipeline|Well drilling)/i

// ── Read existing MANUAL_SEED domains from source ────────────────────────────

function getExistingDomains() {
  const src = readFileSync('src/lib/server/sync/legitimate-domains.ts', 'utf8')
  const matches = [...src.matchAll(/domain:\s*'([^']+)'/g)]
  return new Set(matches.map(m => m[1]))
}

// ── Domain extraction ─────────────────────────────────────────────────────────

function extractDomain(rawUrl) {
  try {
    const url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
    return url.hostname.replace(/^www\./, '').toLowerCase()
  } catch { return null }
}

// ── Phase 1: Wikipedia links (paginated) ─────────────────────────────────────

async function getWikipediaLinks(pageTitle) {
  const links = []
  let plcontinue = null

  do {
    const params = new URLSearchParams({
      action:      'query',
      titles:      pageTitle,
      prop:        'links',
      pllimit:     '500',
      plnamespace: '0',
      format:      'json',
      origin:      '*',
    })
    if (plcontinue) params.set('plcontinue', plcontinue)

    const res = await fetch(`${WIKIPEDIA_API}?${params}`, {
      headers: { 'User-Agent': 'EnergyTradeInspection/1.0 (https://etiverify.com)' },
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json()
    const pg = Object.values(data.query?.pages ?? {})[0]
    if (pg?.links) links.push(...pg.links.map(l => l.title))
    plcontinue = data.continue?.plcontinue ?? null
  } while (plcontinue)

  return links
}

// ── Phase 2: Wikidata batch lookup via Wikipedia article URL ──────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function queryWikidataForTitles(titles) {
  // Use Wikipedia article URLs as Wikidata sitelink identifiers — most reliable
  const values = titles
    .map(t => `<https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}>`)
    .join('\n    ')

  const query = `
SELECT DISTINCT ?item ?itemLabel ?website ?countryCode WHERE {
  VALUES ?wpPage {
    ${values}
  }
  ?wpPage schema:about ?item .
  ?item wdt:P856 ?website .
  OPTIONAL { ?item wdt:P17 ?country . ?country wdt:P297 ?countryCode . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}`.trim()

  const url = new URL(WIKIDATA_SPARQL)
  url.searchParams.set('query', query)
  url.searchParams.set('format', 'json')

  const res = await fetch(url.toString(), {
    headers: {
      'Accept':     'application/sparql-results+json',
      'User-Agent': 'EnergyTradeInspection/1.0 (https://etiverify.com)',
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    console.error(`  Wikidata error ${res.status} for batch of ${titles.length}`)
    return []
  }

  const data = await res.json()
  return data.results.bindings
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const existingDomains = getExistingDomains()
  console.error(`Existing MANUAL_SEED domains: ${existingDomains.size}`)

  // ── Phase 1 ──────────────────────────────────────────────────────────────────
  console.error('\nPhase 1: Fetching Wikipedia company lists...')
  const allTitles = new Set()

  for (const source of WIKIPEDIA_SOURCES) {
    console.error(`  "${source}"...`)
    try {
      const links = await getWikipediaLinks(source)
      // Filter obvious non-company articles before hitting Wikidata
      const companies = links.filter(t => !SKIP_PATTERN.test(t))
      companies.forEach(t => allTitles.add(t))
      console.error(`  → ${links.length} total links, ${companies.length} after filter`)
    } catch (e) {
      console.error(`  → Error: ${e.message}`)
    }
  }

  const titleArray = [...allTitles]
  console.error(`\nUnique article candidates: ${titleArray.length}`)

  // ── Phase 2 ──────────────────────────────────────────────────────────────────
  console.error('\nPhase 2: Looking up official websites in Wikidata...')
  const allBindings = []
  const totalBatches = Math.ceil(titleArray.length / BATCH_SIZE)

  for (let i = 0; i < titleArray.length; i += BATCH_SIZE) {
    const batch = titleArray.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    process.stderr.write(`  Batch ${batchNum}/${totalBatches} (${batch.length} titles)...`)

    try {
      const bindings = await queryWikidataForTitles(batch)
      allBindings.push(...bindings)
      process.stderr.write(` ${bindings.length} hits\n`)
    } catch (e) {
      process.stderr.write(` Error: ${e.message}\n`)
    }

    if (i + BATCH_SIZE < titleArray.length) await sleep(RATE_LIMIT_MS)
  }

  // ── Dedup + classify ──────────────────────────────────────────────────────────
  console.error(`\nTotal Wikidata hits: ${allBindings.length}`)
  const seen = new Map()

  for (const b of allBindings) {
    const websiteUrl  = b.website?.value
    const companyName = b.itemLabel?.value
    if (!websiteUrl || !companyName) continue
    if (/^Q\d+$/.test(companyName)) continue  // skip Q-label fallbacks

    const domain = extractDomain(websiteUrl)
    if (!domain || domain.length < 4) continue
    if (seen.has(domain)) continue

    const rawCode = b.countryCode?.value ?? ''
    const countryCode = rawCode.length === 2 ? rawCode.toUpperCase() : ''
    const status = existingDomains.has(domain) ? 'DUPLICATE' : 'NEW'

    seen.set(domain, { domain, companyName, countryCode, status, websiteUrl })
  }

  const entries   = [...seen.values()].sort((a, b) =>
    (a.status === 'NEW' ? -1 : 1) - (b.status === 'NEW' ? -1 : 1) ||
    a.domain.localeCompare(b.domain)
  )
  const newCount  = entries.filter(e => e.status === 'NEW').length
  const dupeCount = entries.filter(e => e.status === 'DUPLICATE').length

  console.error(`After dedup: ${entries.length} unique domains`)
  console.error(`  NEW (not in MANUAL_SEED): ${newCount}`)
  console.error(`  DUPLICATE:                ${dupeCount}`)

  // ── CSV output ────────────────────────────────────────────────────────────────
  const lines = [
    'status,domain,company_name,country_code,source_url',
    ...entries.map(e => [
      e.status,
      e.domain,
      `"${e.companyName.replace(/"/g, '""')}"`,
      e.countryCode,
      e.websiteUrl,
    ].join(',')),
  ]
  const csv = lines.join('\n')

  if (process.stdout.isTTY) {
    mkdirSync('tmp', { recursive: true })
    const outFile = 'tmp/wikipedia-companies.csv'
    writeFileSync(outFile, csv, 'utf8')
    console.error(`\nWritten to ${outFile}`)
    console.error('Open in Excel/Sheets, filter status=NEW, pick relevant ones.')
    console.error('Then add curated entries to MANUAL_SEED in:')
    console.error('  src/lib/server/sync/legitimate-domains.ts')
  } else {
    process.stdout.write(csv + '\n')
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1) })

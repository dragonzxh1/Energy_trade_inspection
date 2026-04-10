/**
 * Preview Wikidata energy domain sync — no database writes.
 *
 * Fetches oil companies / NOCs / petroleum-industry firms from Wikidata
 * and prints what syncLegitDomains() would import, in CSV format.
 *
 * Usage:
 *   node scripts/preview-wikidata-domains.mjs
 *   node scripts/preview-wikidata-domains.mjs > tmp/wikidata-domains.csv
 *
 * Review the output, then trigger the real sync on production:
 *   POST /api/admin/sync  { "source": "legitdomains" }
 */

import { writeFileSync, mkdirSync } from 'fs'

const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql'

// Mirrors the query in src/lib/server/sync/legitimate-domains.ts
const QUERY = `
SELECT DISTINCT ?company ?companyLabel ?website ?countryCode WHERE {
  {
    ?company wdt:P31 wd:Q35790 .
  } UNION {
    ?company wdt:P31 wd:Q2348054 .
  } UNION {
    ?company wdt:P452 wd:Q130901 .
  } UNION {
    ?company wdt:P452 wd:Q40858 .
  }
  ?company wdt:P856 ?website .
  OPTIONAL { ?company wdt:P17 ?country . ?country wdt:P297 ?countryCode . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
}
LIMIT 1000
`.trim()

// ── Domain extraction (mirrors extractDomain in domain-check.ts) ──────────────

function extractDomain(rawUrl) {
  try {
    const url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`)
    return url.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

// ── Fetch from Wikidata ───────────────────────────────────────────────────────

async function fetchFromWikidata() {
  const url = new URL(WIKIDATA_SPARQL_URL)
  url.searchParams.set('query', QUERY)
  url.searchParams.set('format', 'json')

  console.error('Querying Wikidata SPARQL...')
  const res = await fetch(url.toString(), {
    headers: {
      'Accept':     'application/sparql-results+json',
      'User-Agent': 'EnergyTradeInspection/1.0 (https://etiverify.com)',
    },
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    throw new Error(`Wikidata SPARQL ${res.status}: ${res.statusText}`)
  }

  const data = await res.json()
  return data.results.bindings
}

// ── Deduplicate ───────────────────────────────────────────────────────────────

function dedup(entries) {
  const seen = new Map()
  for (const e of entries) {
    if (!seen.has(e.domain)) seen.set(e.domain, e)
  }
  return [...seen.values()]
}

// ── Manual seed domains (to flag duplicates) ──────────────────────────────────

const MANUAL_DOMAINS = new Set([
  'vitol.com','trafigura.com','glencore.com','gunvorgroup.com','mercuria.com',
  'freepointcommodities.com','litasco.com','unipec.com','castletoncommodities.com',
  'phibro.com','shell.com','bp.com','exxonmobil.com','totalenergies.com',
  'chevron.com','equinor.com','repsol.com','eni.com','conocophillips.com',
  'lukoil.com','rosneft.com','aramco.com','adnoc.ae','kpc.com.kw','petronas.com',
  'petrobras.com.br','sinopec.com','cnpc.com.cn','cnooc.com.cn','nayaraenergy.com',
  'ril.com','iocl.com','wfscorp.com','bunker-holding.com','bomin.com',
  'mabanaft.com','pumaenergy.com','peninsulapetroleumgroup.com','chemoil.com',
  'vivoenergy.com','kochsupplyandtrading.com','bunge.com','cargill.com','ldc.com',
  'socartrading.com','freeportlng.com','trafi.com','qatarenergy.com','oq.com',
  'socar.az','pttplc.com','pertamina.com','omv.com','galp.com','orlen.pl',
  'mol.hu','enoc.com','bharatpetroleum.com','hindustanpetroleum.com','pttep.com',
  'ypf.com','ecopetrol.com.co','monjasa.com','minervabunkering.com',
  'cockettmarine.com','integr8fuels.com','tfgmarine.com','falenergy.com',
  'glander-international.com','mcleanswatson.com','vopak.com','oiltanking.com',
  'vtti.com','stolt-nielsen.com','standic.com','oiltankinggroup.com','odfjell.com',
  'nustarenergy.com','kindermorgan.com','horizonterminals.com','broogepetroleum.com',
  'rubis-terminal.com','clh.es','zenithenergy.com','euronav.com','frontline.bm',
  'hafnia.com','scorpiotankers.com','bwgroup.com','tenn.gr','dhtankers.com',
  'ardmoreshipping.com','thenamaris.com','teekay.com','aframax.com',
  'navig8group.com','bureauveritas.com','lr.org','dnv.com','sgs.com',
  'intertek.com','abs.org','rina.org','classnk.or.jp',
])

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const bindings = await fetchFromWikidata()
  console.error(`Raw results from Wikidata: ${bindings.length}`)

  const entries = []
  for (const b of bindings) {
    const websiteUrl  = b.website?.value
    const companyName = b.companyLabel?.value
    if (!websiteUrl || !companyName) continue
    if (/^Q\d+$/.test(companyName)) continue   // skip Q-label fallbacks

    const domain = extractDomain(websiteUrl)
    if (!domain || domain.length < 4) continue

    const rawCode = b.countryCode?.value ?? ''
    const countryCode = rawCode.length === 2 ? rawCode.toUpperCase() : ''
    const inManual = MANUAL_DOMAINS.has(domain)

    entries.push({ domain, companyName, countryCode, inManual, websiteUrl })
  }

  const deduped = dedup(entries)
  const newEntries  = deduped.filter(e => !e.inManual)
  const dupeEntries = deduped.filter(e => e.inManual)

  console.error(`After dedup: ${deduped.length} unique domains`)
  console.error(`  Already in MANUAL_SEED: ${dupeEntries.length}`)
  console.error(`  New (wikidata-only):    ${newEntries.length}`)

  // ── CSV output ──────────────────────────────────────────────────────────────
  const lines = [
    'status,domain,company_name,country_code,source_url',
    ...deduped
      .sort((a, b) => a.domain.localeCompare(b.domain))
      .map(e => [
        e.inManual ? 'DUPLICATE' : 'NEW',
        e.domain,
        `"${e.companyName.replace(/"/g, '""')}"`,
        e.countryCode,
        e.websiteUrl,
      ].join(','))
  ]

  const csv = lines.join('\n')

  // Write to tmp/ if no stdout redirect, otherwise print
  const isTTY = process.stdout.isTTY
  if (isTTY) {
    mkdirSync('tmp', { recursive: true })
    const outFile = 'tmp/wikidata-domains.csv'
    writeFileSync(outFile, csv, 'utf8')
    console.error(`\nWritten to ${outFile}`)
    console.error('Open it in Excel/Sheets to review, then run the production sync:')
    console.error('  POST /api/admin/sync  { "source": "legitdomains" }')
  } else {
    process.stdout.write(csv + '\n')
  }
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})

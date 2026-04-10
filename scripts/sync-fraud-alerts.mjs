/**
 * Fraud alert sync script.
 * Run directly: node scripts/sync-fraud-alerts.mjs
 * Or for a single source: node scripts/sync-fraud-alerts.mjs storagespoofing
 *
 * Scrapes industry blacklists and inserts into fraud_alerts table.
 * Source traceability: every row stores source_name + source_url.
 */

import pg from 'pg'

const { Pool } = pg

const DB_URL =
  process.env.DATABASE_URL ||
  'postgresql://eti:eti_password@localhost:5432/energy_trade_inspection'

// ── Normalization (mirrors normalize.ts) ─────────────────────────────────────

const LEGAL_SUFFIXES =
  /\b(sa|sarl|sas|srl|spa|sl|sc|se|sk|ltd|limited|inc|incorporated|corp|corporation|co|company|bv|nv|gmbh|ag|kg|ug|kgaa|pte|fze|fzco|fzc|llc|llp|lp|lllp|plc|as|asa|ab|oy|oyj|aps|sdn|bhd|pvt|jsc|ojsc|ooo|zao|pjsc|kft|nyrt|bt|ev|ek|hb|kb|nb|mb)\b\.?/gi

const GENERIC_WORDS =
  /\b(energy|trading|marine|maritime|shipping|petroleum|oil|gas|lng|lpg|commodities|cargo|logistics|services|solutions|resources|group|holdings|holding|international|management|investment|investments|capital|finance|financial|partners|partnership|ventures|venture|enterprise|enterprises)\b/gi

function normalizeEntityName(text, stripGeneric = false) {
  let s = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(LEGAL_SUFFIXES, ' ')
  if (stripGeneric) s = s.replace(GENERIC_WORDS, ' ')
  return s
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// ── HTTP fetch ────────────────────────────────────────────────────────────────

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'EnergyTradeInspection/1.0 (compliance@energytradeinspection.com)',
      Accept: 'text/html,application/xhtml+xml',
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.text()
}

// ── Basic HTML text extraction (no cheerio in .mjs scripts) ──────────────────

/** Strip all HTML tags and return visible text. */
function stripHtml(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, ' ')
}

/** Extract all text segments from <li> tags. */
function extractListItems(html) {
  const items = []
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const text = stripHtml(m[1]).trim().replace(/\s+/g, ' ')
    if (text) items.push(text)
  }
  return items
}

/** Extract text from table first cells. */
function extractTableFirstCells(html) {
  const cells = []
  const re = /<tr[^>]*>[\s\S]*?<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const text = stripHtml(m[1]).trim().replace(/\s+/g, ' ')
    if (text) cells.push(text)
  }
  return cells
}

/** Extract all heading texts (h2, h3, h4). */
function extractHeadings(html) {
  const heads = []
  const re = /<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const text = stripHtml(m[1]).trim().replace(/\s+/g, ' ')
    if (text) heads.push(text)
  }
  return heads
}

/** Extract href from first <a href> inside a string. */
function extractFirstHref(html) {
  const m = html.match(/href=["']([^"']+)["']/i)
  return m ? m[1] : null
}

/** Common navigation/UI words that should never be treated as company names. */
const NAV_BLACKLIST = new Set([
  'about','about us','home','contact','contact us','services','blog','news',
  'portfolio','team','careers','faq','login','register','search','sitemap',
  'privacy','terms','cookie','disclaimer','address','phone','email','follow us',
  'follow','share','subscribe','newsletter','read more','learn more','more info',
  'back','next','previous','submit','send','close','menu','navigation',
  'header','footer','sidebar','content','main','page','section',
  'consultancy','financing','marketing','crypto scams','other scams',
  'real sellers','scammers fuel scams','book a date today',
  'book a date today!', 'performance beyond excellence',
])

/** Looks like a navigation/UI phrase rather than a company name. */
function isNavItem(text) {
  const lower = text.toLowerCase().trim()
  if (NAV_BLACKLIST.has(lower)) return true
  // Very short single word that's not an abbreviation
  if (text.split(/\s+/).length === 1 && text.length < 5 && !/^[A-Z]{2,4}$/.test(text)) return true
  // Sentence-case phrases with common action verbs are likely UI elements
  if (/^(click|view|visit|see|read|find|get|buy|sell|learn|contact|follow|check)\b/i.test(lower)) return true
  return false
}

/** Generic extractor: tries table cells → list items → headings. */
function extractNames(html) {
  let candidates = extractTableFirstCells(html)
  if (candidates.length < 3) candidates = extractListItems(html)
  if (candidates.length < 3) candidates = extractHeadings(html)
  return candidates.filter(
    (t) =>
      t.length >= 4 &&
      t.length <= 200 &&
      !isNavItem(t) &&
      !/^(company|naam|name|#|no\.?|nr\.?|warning|fraud|alert|notice|disclaimer|caution|beware)$/i.test(t)
  )
}

/** Domains that should never be stored as fraud entries (social media, CDNs, etc.). */
const EXCLUDED_DOMAINS = new Set([
  'facebook.com','twitter.com','linkedin.com','instagram.com','youtube.com',
  'google.com','googleapis.com','fonts.googleapis.com','gstatic.com',
  'cloudflare.com','akamai.com','fastly.com','cdn.com','jsdelivr.net',
  'wp.com','wordpress.com','squarespace.com','wix.com','shopify.com',
  'paypal.com','stripe.com','apple.com','microsoft.com','amazon.com',
  'amazonaws.com','github.com','gitlab.com',
])

function makeEntry(source, sourceName, sourceUrl, companyName, listType, fraudType, scamUrl = null) {
  // Skip excluded domains
  if (EXCLUDED_DOMAINS.has(companyName.toLowerCase())) return null
  // Skip numbered entries like "2. Francis Jerry" or "1. Muhammad Meekael"
  if (/^\d+\.\s/.test(companyName)) return null
  // Skip entries that are clearly sentences/phrases
  if (/^(official website|persona non grata)/i.test(companyName)) return null
  const normalized = normalizeEntityName(companyName, true)
  if (!normalized || normalized.length < 2) return null
  return {
    id: `${source}:${listType}:${slugify(companyName)}`,
    source,
    source_name: sourceName,
    source_url: sourceUrl,
    company_name: companyName,
    normalized_name: normalized,
    list_type: listType,
    fraud_type: fraudType,
    description: null,
    scam_url: scamUrl,
  }
}

// ── Scrapers ──────────────────────────────────────────────────────────────────

async function scrapeStorageSpoofing() {
  const entries = []

  // ── Blacklist: table rows with company name in first column ───────────────
  {
    const url = 'https://storagespoofing.nl/en/blacklist/'
    const html = await fetchHtml(url)
    const names = extractNames(html)
    for (const name of names) {
      const e = makeEntry('storagespoofing', 'Rotterdam Port Blacklist', url, name, 'blacklist', 'storage-spoofing')
      if (e) entries.push(e)
    }
    console.log(`  storagespoofing blacklist: ${names.length} candidates`)
  }

  // ── Whitelist: <p> tags containing company name(s) + <a href> ─────────────
  // Structure: <p>NAME<br />[ALIAS<br />...]<a href="URL">www.site.com</a></p>
  {
    const url = 'https://storagespoofing.nl/en/whitelist/'
    const html = await fetchHtml(url)
    const seen = new Set()

    // Extract each <p> block
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi
    let pm
    let whitelistCount = 0
    while ((pm = pRe.exec(html)) !== null) {
      const inner = pm[1]
      // Only process <p> tags that contain an external <a href>
      const aMatch = inner.match(/href=[\"'](https?:\/\/[^\"']+)[\"']/i)
      if (!aMatch) continue
      const officialUrl = aMatch[1]

      // Remove the <a>...</a> tag, then split the remaining text on <br> or newlines
      const withoutLink = inner.replace(/<a[^>]*>[\s\S]*?<\/a>/gi, '')
      const lines = withoutLink
        .replace(/<[^>]+>/g, '\n')  // convert all tags to newlines
        .split(/\n/)
        .map(l => l.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(l => l.length >= 3)

      if (lines.length === 0) continue

      // Primary name: first line
      const primaryName = lines[0]
      if (!seen.has(primaryName)) {
        seen.add(primaryName)
        const e = makeEntry('storagespoofing', 'Rotterdam Port Whitelist', url, primaryName, 'whitelist', null, officialUrl)
        if (e) { entries.push(e); whitelistCount++ }
      }

      // Aliases: strip "(was: ...)" / "(formerly: ...)" annotations
      for (let i = 1; i < lines.length; i++) {
        const alias = lines[i].replace(/\s*\((?:was|formerly|formerly:|was:)[^)]*\)/gi, '').trim()
        if (alias.length < 4 || seen.has(alias)) continue
        seen.add(alias)
        const e = makeEntry('storagespoofing', 'Rotterdam Port Whitelist', url, alias, 'whitelist', null, officialUrl)
        if (e) { entries.push(e); whitelistCount++ }
      }
    }
    console.log(`  storagespoofing whitelist: ${whitelistCount} candidates`)
  }

  return entries
}

async function scrapeFuelScamAlert() {
  const url = 'https://www.fuelscamalert.com/scam-tank-farms-terminals'
  const html = await fetchHtml(url)

  // fuelscamalert uses individual sub-pages per company:
  // /scam-tank-farms-terminals/[company-slug]
  // Extract hrefs matching this pattern — each is a scam company entry
  const entries = []
  const seen = new Set()
  const linkRe = /href=["'](https?:\/\/www\.fuelscamalert\.com\/scam-tank-farms-terminals\/([^"'/]+))["']/gi
  let m
  while ((m = linkRe.exec(html)) !== null) {
    const subUrl = m[1]
    const slug = m[2]
    if (!slug || seen.has(slug)) continue
    seen.add(slug)
    // Convert slug to readable name: "houston-tank-terminal" → "Houston Tank Terminal"
    const name = slug
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
    const e = makeEntry('fuelscamalert', 'Fuel Scam Alert', subUrl, name, 'blacklist', 'fuel-scam')
    if (e) entries.push(e)
  }

  // Fallback: if no sub-links found, try heading extraction with tight filter
  if (entries.length === 0) {
    const heads = extractHeadings(html).filter(
      (t) => t.length >= 5 && t.length <= 100 && !isNavItem(t) &&
        !/^(tank farm|terminal|storage|fuel|scam|fraud|alert|warning)/i.test(t)
    )
    for (const name of heads) {
      const e = makeEntry('fuelscamalert', 'Fuel Scam Alert', url, name, 'blacklist', 'fuel-scam')
      if (e) entries.push(e)
    }
  }

  console.log(`  fuelscamalert: ${entries.length} candidates`)
  return entries
}

async function scrapeAmetheus() {
  const url = 'https://ametheus.com/blacklisted-storage-spoofing-companies/'
  const html = await fetchHtml(url)
  const names = extractNames(html)
  const entries = []
  for (const name of names) {
    const e = makeEntry('ametheus', 'Ametheus Blacklist', url, name, 'blacklist', 'storage-spoofing')
    if (e) entries.push(e)
  }
  console.log(`  ametheus: ${names.length} candidates`)
  return entries
}

async function scrapeGloInnovations() {
  const url = 'https://glo-innovations.com/storage-spoofing-blacklist/'
  const html = await fetchHtml(url)

  // glo-innovations lists fake storage/shipping websites — extract domain/URL mentions.
  // These appear as links (hrefs) or plain text that look like URLs.
  // Also look for company names in <strong> or <b> tags within the blacklist section.
  const entries = []
  const seen = new Set()

  // Extract <strong> and <b> text — often used for company names in blog-style posts
  const strongRe = /<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi
  let m
  while ((m = strongRe.exec(html)) !== null) {
    const text = stripHtml(m[1]).trim().replace(/\s+/g, ' ')
    if (text.length >= 4 && text.length <= 150 && !isNavItem(text) && !seen.has(text)) {
      seen.add(text)
      const e = makeEntry('glo-innovations', 'Global Innovations Storage Spoofing Blacklist', url, text, 'blacklist', 'storage-spoofing')
      if (e) entries.push(e)
    }
  }

  // Extract external domain links (fake company websites listed on the page)
  const linkRe = /href=["'](https?:\/\/(?!glo-innovations\.com)[^"']+)["']/gi
  while ((m = linkRe.exec(html)) !== null) {
    try {
      const domain = new URL(m[1]).hostname.replace(/^www\./, '')
      if (domain.length < 5 || seen.has(domain)) continue
      seen.add(domain)
      // Convert domain to readable name: "fakecompany.com" → "fakecompany.com"
      const e = makeEntry('glo-innovations', 'Global Innovations Storage Spoofing Blacklist', url, domain, 'blacklist', 'storage-spoofing')
      if (e) entries.push(e)
    } catch { /* skip invalid URLs */ }
  }

  console.log(`  glo-innovations: ${entries.length} candidates`)
  return entries
}

async function scrapeCapitalGasLogistics() {
  const url = 'https://capitalgaslogistics.us/fraud-alert/'
  const html = await fetchHtml(url)

  // capitalgaslogistics fraud alert page lists fake company names and scam websites.
  // Look for: <strong>/<b> tags (company names), and external URLs (scam sites).
  const entries = []
  const seen = new Set()

  // Extract <strong> and <b> text — company names emphasized in the fraud alert text
  const strongRe = /<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi
  let m
  while ((m = strongRe.exec(html)) !== null) {
    const text = stripHtml(m[1]).trim().replace(/\s+/g, ' ')
    if (
      text.length >= 4 &&
      text.length <= 150 &&
      !isNavItem(text) &&
      !/^(fraud|warning|alert|notice|important|disclaimer|caution|beware|phone|email|address|follow)/i.test(text) &&
      !seen.has(text)
    ) {
      seen.add(text)
      const e = makeEntry('capitalgaslogistics', 'Capital Gas Logistics Fraud Alert', url, text, 'blacklist', 'impersonation')
      if (e) entries.push(e)
    }
  }

  // Extract external URLs mentioned as scam websites
  const linkRe = /href=["'](https?:\/\/(?!capitalgaslogistics\.us)[^"']+)["']/gi
  while ((m = linkRe.exec(html)) !== null) {
    try {
      const domain = new URL(m[1]).hostname.replace(/^www\./, '')
      if (domain.length < 5 || seen.has(domain)) continue
      seen.add(domain)
      const e = makeEntry('capitalgaslogistics', 'Capital Gas Logistics Fraud Alert', url, domain, 'blacklist', 'impersonation')
      if (e) entries.push(e)
    } catch { /* skip invalid URLs */ }
  }

  console.log(`  capitalgaslogistics: ${entries.length} candidates`)
  return entries
}

// ── DB upsert ─────────────────────────────────────────────────────────────────

async function upsertSource(client, source, entries) {
  await client.query(`DELETE FROM fraud_alerts WHERE source = $1`, [source])
  if (entries.length === 0) return 0

  // Deduplicate by id — same normalized name produces the same slug/id
  const seen = new Set()
  const deduped = entries.filter((e) => {
    if (seen.has(e.id)) return false
    seen.add(e.id)
    return true
  })

  const BATCH = 100
  let total = 0
  for (let i = 0; i < deduped.length; i += BATCH) {
    const batch = deduped.slice(i, i + BATCH)
    const placeholders = batch.map((_, j) => {
      const b = j * 10
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10})`
    }).join(',')

    await client.query(
      `INSERT INTO fraud_alerts
         (id, source, source_name, source_url, company_name, normalized_name,
          list_type, fraud_type, description, scam_url)
       VALUES ${placeholders}
       ON CONFLICT (id) DO UPDATE SET
         company_name    = EXCLUDED.company_name,
         normalized_name = EXCLUDED.normalized_name,
         source_url      = EXCLUDED.source_url,
         fraud_type      = EXCLUDED.fraud_type,
         scam_url        = EXCLUDED.scam_url,
         synced_at       = NOW()`,
      batch.flatMap(e => [e.id, e.source, e.source_name, e.source_url, e.company_name, e.normalized_name, e.list_type, e.fraud_type, e.description, e.scam_url])
    )
    total += batch.length
  }
  return total
}

// ── Main ──────────────────────────────────────────────────────────────────────

const SCRAPERS = [
  { source: 'storagespoofing', fn: scrapeStorageSpoofing },
  { source: 'fuelscamalert',   fn: scrapeFuelScamAlert },
  // ametheus.com — removed: HTTP 404, site no longer exists
  // glo-innovations.com — removed: sparse content, only captures legitimate company links
  // capitalgaslogistics.us — removed: fraud alert about 2 individuals, captures legitimate sites as scam
]

const targetSource = process.argv[2] ?? 'all'

const pool = new Pool({ connectionString: DB_URL })

let overall = { success: 0, failed: 0, total: 0 }

for (const { source, fn } of SCRAPERS) {
  if (targetSource !== 'all' && targetSource !== source) continue

  console.log(`\n[${source}] Scraping...`)
  const startMs = Date.now()
  const client = await pool.connect()
  try {
    const entries = await fn()
    await client.query('BEGIN')
    const count = await upsertSource(client, source, entries)
    await client.query(
      `INSERT INTO fraud_sync_log (source, status, record_count, duration_ms)
       VALUES ($1, 'success', $2, $3)`,
      [source, count, Date.now() - startMs]
    )
    await client.query('COMMIT')
    console.log(`  ✓ inserted ${count} entries (${Date.now() - startMs}ms)`)
    overall.success++
    overall.total += count
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    await pool.query(
      `INSERT INTO fraud_sync_log (source, status, error_message, duration_ms)
       VALUES ($1, 'error', $2, $3)`,
      [source, String(err), Date.now() - startMs]
    ).catch(() => {})
    console.error(`  ✗ failed: ${err.message}`)
    overall.failed++
  } finally {
    client.release()
  }
}

await pool.end()
console.log(`\nDone: ${overall.success} sources OK, ${overall.failed} failed, ${overall.total} total entries`)

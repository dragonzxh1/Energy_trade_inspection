/**
 * Legitimate Domain Registry Sync
 *
 * Populates the legitimate_domains table from two sources:
 *
 *   whitelist — Rotterdam Port Whitelist entries that carry an official website URL.
 *               Extracted from fraud_alerts WHERE list_type='whitelist' AND scam_url IS NOT NULL.
 *               scam_url in the whitelist context holds the company's *official* website.
 *
 *   manual    — Curated list of major global energy traders, oil majors, and tank terminal
 *               operators whose domains are commonly impersonated in energy trade fraud.
 *
 * Run via: POST /api/admin/sync { source: "legitdomains" }
 * or as part of: POST /api/admin/sync { source: "all" }
 */

import { db } from '@/lib/server/db'
import { extractDomain } from '@/lib/server/domain-check'

// ── Company name normalization ────────────────────────────────────────────────
// Strips legal suffixes and generic words to produce a stable normalized name
// suitable for fuzzy matching.

const LEGAL_SUFFIXES =
  /\b(sa|sarl|sas|srl|spa|sl|se|ltd|limited|inc|incorporated|corp|corporation|co|company|bv|nv|gmbh|ag|kg|pte|fze|fzco|llc|llp|plc|as|asa|ab|oy|aps|pvt|jsc|ojsc|ooo|pjsc)\b\.?/gi

const GENERIC_WORDS =
  /\b(energy|trading|marine|maritime|shipping|petroleum|oil|gas|lng|lpg|commodities|cargo|logistics|services|solutions|resources|group|holdings|holding|international|management|investment|capital|finance|financial|partners|ventures|enterprise|enterprises|bunker|bunkering)\b/gi

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(LEGAL_SUFFIXES, ' ')
    .replace(GENERIC_WORDS, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Manual seed ───────────────────────────────────────────────────────────────
// Major energy traders, oil majors, and terminal operators whose domains are
// commonly cloned or typosquatted in storage-spoofing and fuel-scam fraud.

interface SeedEntry {
  domain: string
  company_name: string
  country_code: string | null
}

const MANUAL_SEED: SeedEntry[] = [
  // ── Global commodity traders ────────────────────────────────────────────
  { domain: 'vitol.com',                   company_name: 'Vitol Group',                          country_code: 'NL' },
  { domain: 'trafigura.com',               company_name: 'Trafigura',                            country_code: 'SG' },
  { domain: 'glencore.com',                company_name: 'Glencore',                             country_code: 'CH' },
  { domain: 'gunvorgroup.com',             company_name: 'Gunvor Group',                         country_code: 'CH' },
  { domain: 'mercuria.com',                company_name: 'Mercuria Energy',                      country_code: 'CH' },
  { domain: 'freepointcommodities.com',    company_name: 'Freepoint Commodities',                country_code: 'US' },
  { domain: 'litasco.com',                 company_name: 'Litasco SA',                           country_code: 'CH' },
  { domain: 'unipec.com',                  company_name: 'Unipec',                               country_code: 'CN' },
  { domain: 'castletoncommodities.com',    company_name: 'Castleton Commodities International',  country_code: 'US' },
  { domain: 'phibro.com',                  company_name: 'Phibro LLC',                           country_code: 'US' },
  // ── Oil majors ──────────────────────────────────────────────────────────
  { domain: 'shell.com',                   company_name: 'Shell',                                country_code: 'GB' },
  { domain: 'bp.com',                      company_name: 'BP',                                   country_code: 'GB' },
  { domain: 'exxonmobil.com',              company_name: 'ExxonMobil',                           country_code: 'US' },
  { domain: 'totalenergies.com',           company_name: 'TotalEnergies',                        country_code: 'FR' },
  { domain: 'chevron.com',                 company_name: 'Chevron',                              country_code: 'US' },
  { domain: 'equinor.com',                 company_name: 'Equinor',                              country_code: 'NO' },
  { domain: 'repsol.com',                  company_name: 'Repsol',                               country_code: 'ES' },
  { domain: 'eni.com',                     company_name: 'Eni',                                  country_code: 'IT' },
  { domain: 'conocophillips.com',          company_name: 'ConocoPhillips',                       country_code: 'US' },
  { domain: 'lukoil.com',                  company_name: 'Lukoil',                               country_code: 'RU' },
  { domain: 'rosneft.com',                 company_name: 'Rosneft',                              country_code: 'RU' },
  { domain: 'aramco.com',                  company_name: 'Saudi Aramco',                         country_code: 'SA' },
  { domain: 'adnoc.ae',                    company_name: 'ADNOC',                                country_code: 'AE' },
  { domain: 'kpc.com.kw',                  company_name: 'Kuwait Petroleum Corporation',         country_code: 'KW' },
  { domain: 'petronas.com',                company_name: 'Petronas',                             country_code: 'MY' },
  { domain: 'petrobras.com.br',            company_name: 'Petrobras',                            country_code: 'BR' },
  { domain: 'sinopec.com',                 company_name: 'Sinopec',                              country_code: 'CN' },
  { domain: 'cnpc.com.cn',                 company_name: 'CNPC',                                 country_code: 'CN' },
  { domain: 'cnooc.com.cn',                company_name: 'CNOOC',                                country_code: 'CN' },
  { domain: 'nayaraenergy.com',            company_name: 'Nayara Energy',                        country_code: 'IN' },
  { domain: 'ril.com',                     company_name: 'Reliance Industries',                  country_code: 'IN' },
  { domain: 'iocl.com',                    company_name: 'Indian Oil Corporation',               country_code: 'IN' },
  // ── Bunker & marine fuel ────────────────────────────────────────────────
  { domain: 'wfscorp.com',                 company_name: 'World Fuel Services',                  country_code: 'US' },
  { domain: 'bunker-holding.com',          company_name: 'Bunker Holding',                       country_code: 'DK' },
  { domain: 'bomin.com',                   company_name: 'Bomin Bunker Oil',                     country_code: 'DE' },
  { domain: 'mabanaft.com',                company_name: 'Mabanaft',                             country_code: 'DE' },
  { domain: 'pumaenergy.com',              company_name: 'Puma Energy',                          country_code: 'SG' },
  { domain: 'peninsulapetroleumgroup.com', company_name: 'Peninsula Petroleum',                  country_code: 'IE' },
  { domain: 'chemoil.com',                 company_name: 'Chemoil',                              country_code: 'SG' },
  { domain: 'vivoenergy.com',              company_name: 'Vivo Energy',                          country_code: 'GB' },
  // ── Additional commodity traders ────────────────────────────────────────
  { domain: 'kochsupplyandtrading.com',    company_name: 'Koch Supply & Trading',                country_code: 'US' },
  { domain: 'bunge.com',                   company_name: 'Bunge',                                country_code: 'US' },
  { domain: 'cargill.com',                 company_name: 'Cargill',                              country_code: 'US' },
  { domain: 'ldc.com',                     company_name: 'Louis Dreyfus Company',                country_code: 'NL' },
  { domain: 'socartrading.com',            company_name: 'SOCAR Trading',                        country_code: 'CH' },
  { domain: 'freeportlng.com',             company_name: 'Freeport LNG',                         country_code: 'US' },
  { domain: 'trafi.com',                   company_name: 'Trafi',                                country_code: 'LT' },
  // ── Additional NOCs & regional majors ───────────────────────────────────
  { domain: 'qatarenergy.com',             company_name: 'QatarEnergy',                          country_code: 'QA' },
  { domain: 'oq.com',                      company_name: 'OQ (Oman Oil)',                        country_code: 'OM' },
  { domain: 'socar.az',                    company_name: 'SOCAR',                                country_code: 'AZ' },
  { domain: 'pttplc.com',                  company_name: 'PTT',                                  country_code: 'TH' },
  { domain: 'pertamina.com',               company_name: 'Pertamina',                            country_code: 'ID' },
  { domain: 'omv.com',                     company_name: 'OMV',                                  country_code: 'AT' },
  { domain: 'galp.com',                    company_name: 'Galp',                                 country_code: 'PT' },
  { domain: 'orlen.pl',                    company_name: 'PKN Orlen',                            country_code: 'PL' },
  { domain: 'mol.hu',                      company_name: 'MOL Group',                            country_code: 'HU' },
  { domain: 'enoc.com',                    company_name: 'Emirates National Oil Company',        country_code: 'AE' },
  { domain: 'bharatpetroleum.com',         company_name: 'Bharat Petroleum',                    country_code: 'IN' },
  { domain: 'hindustanpetroleum.com',      company_name: 'Hindustan Petroleum',                  country_code: 'IN' },
  { domain: 'pttep.com',                   company_name: 'PTTEP',                                country_code: 'TH' },
  { domain: 'ypf.com',                     company_name: 'YPF',                                  country_code: 'AR' },
  { domain: 'ecopetrol.com.co',            company_name: 'Ecopetrol',                            country_code: 'CO' },
  // ── Additional bunker & marine fuel ─────────────────────────────────────
  { domain: 'monjasa.com',                 company_name: 'Monjasa',                              country_code: 'DK' },
  { domain: 'minervabunkering.com',        company_name: 'Minerva Bunkering',                    country_code: 'US' },
  { domain: 'cockettmarine.com',           company_name: 'Cockett Marine Oil',                   country_code: 'GB' },
  { domain: 'integr8fuels.com',            company_name: 'Integr8 Fuels',                        country_code: 'GB' },
  { domain: 'tfgmarine.com',               company_name: 'TFG Marine',                           country_code: 'SG' },
  { domain: 'falenergy.com',               company_name: 'FAL Energy',                           country_code: 'AE' },
  { domain: 'glander-international.com',   company_name: 'Glander International Bunkering',      country_code: 'DE' },
  { domain: 'mcleanswatson.com',           company_name: 'McLeans Watson',                       country_code: 'SG' },
  // ── Tank terminals & storage ─────────────────────────────────────────────
  { domain: 'vopak.com',                   company_name: 'Vopak',                                country_code: 'NL' },
  { domain: 'oiltanking.com',              company_name: 'Oiltanking',                           country_code: 'DE' },
  { domain: 'vtti.com',                    company_name: 'VTTI',                                 country_code: 'NL' },
  { domain: 'stolt-nielsen.com',           company_name: 'Stolt-Nielsen',                        country_code: 'GB' },
  { domain: 'standic.com',                 company_name: 'Standic',                              country_code: 'NL' },
  { domain: 'oiltankinggroup.com',         company_name: 'Oiltanking Group',                     country_code: 'DE' },
  { domain: 'odfjell.com',                 company_name: 'Odfjell',                              country_code: 'NO' },
  { domain: 'nustarenergy.com',            company_name: 'NuStar Energy',                        country_code: 'US' },
  { domain: 'kindermorgan.com',            company_name: 'Kinder Morgan',                        country_code: 'US' },
  { domain: 'horizonterminals.com',        company_name: 'Horizon Terminals',                    country_code: 'AE' },
  { domain: 'broogepetroleum.com',         company_name: 'Brooge Energy',                        country_code: 'AE' },
  { domain: 'rubis-terminal.com',          company_name: 'Rubis Terminal',                       country_code: 'FR' },
  { domain: 'clh.es',                      company_name: 'CLH',                                  country_code: 'ES' },
  { domain: 'zenithenergy.com',            company_name: 'Zenith Energy',                        country_code: 'CA' },
  // ── Tanker operators ────────────────────────────────────────────────────
  { domain: 'euronav.com',                 company_name: 'Euronav',                              country_code: 'BE' },
  { domain: 'frontline.bm',               company_name: 'Frontline',                            country_code: 'BM' },
  { domain: 'hafnia.com',                  company_name: 'Hafnia',                               country_code: 'DK' },
  { domain: 'scorpiotankers.com',          company_name: 'Scorpio Tankers',                      country_code: 'MC' },
  { domain: 'bwgroup.com',                 company_name: 'BW Group',                             country_code: 'SG' },
  { domain: 'tenn.gr',                     company_name: 'Tsakos Energy Navigation',             country_code: 'GR' },
  { domain: 'dhtankers.com',               company_name: 'DHT Holdings',                         country_code: 'BM' },
  { domain: 'ardmoreshipping.com',         company_name: 'Ardmore Shipping',                     country_code: 'IE' },
  { domain: 'thenamaris.com',              company_name: 'Thenamaris',                           country_code: 'GR' },
  { domain: 'teekay.com',                  company_name: 'Teekay',                               country_code: 'BM' },
  { domain: 'aframax.com',                 company_name: 'Aframax International',                country_code: 'CY' },
  { domain: 'navig8group.com',             company_name: 'Navig8 Group',                         country_code: 'GB' },
  // ── Inspection & certification bodies ───────────────────────────────────
  { domain: 'bureauveritas.com',           company_name: 'Bureau Veritas',                       country_code: 'FR' },
  { domain: 'lr.org',                      company_name: "Lloyd's Register",                     country_code: 'GB' },
  { domain: 'dnv.com',                     company_name: 'DNV',                                  country_code: 'NO' },
  { domain: 'sgs.com',                     company_name: 'SGS',                                  country_code: 'CH' },
  { domain: 'intertek.com',               company_name: 'Intertek',                             country_code: 'GB' },
  { domain: 'abs.org',                     company_name: 'American Bureau of Shipping',          country_code: 'US' },
  { domain: 'rina.org',                    company_name: 'RINA',                                 country_code: 'IT' },
  { domain: 'classnk.or.jp',              company_name: 'ClassNK',                              country_code: 'JP' },
]

// ── Rotterdam whitelist import ────────────────────────────────────────────────

interface WhitelistRow {
  company_name: string
  scam_url: string  // in whitelist context, this is the company's official website
}

async function loadFromWhitelist(): Promise<SeedEntry[]> {
  const { rows } = await db.query<WhitelistRow>(
    `SELECT company_name, scam_url
     FROM fraud_alerts
     WHERE list_type = 'whitelist'
       AND scam_url IS NOT NULL
       AND scam_url != ''`
  )

  const entries: SeedEntry[] = []
  for (const row of rows) {
    const domain = extractDomain(row.scam_url)
    if (!domain || domain.length < 4) continue
    entries.push({
      domain,
      company_name: row.company_name,
      country_code: null,  // Rotterdam whitelist doesn't carry country
    })
  }
  return entries
}

// ── Database upsert ───────────────────────────────────────────────────────────

async function upsertLegitDomains(
  entries: Array<SeedEntry & { source: 'whitelist' | 'manual'; source_url: string | null }>
): Promise<number> {
  if (entries.length === 0) return 0

  // Deduplicate by domain — manual seed takes precedence over whitelist
  const seen = new Map<string, typeof entries[0]>()
  for (const e of entries) {
    // If domain already seen as 'manual', don't overwrite with 'whitelist'
    const existing = seen.get(e.domain)
    if (!existing || existing.source !== 'manual') {
      seen.set(e.domain, e)
    }
  }
  const deduped = [...seen.values()]

  const BATCH = 50
  let inserted = 0

  for (let i = 0; i < deduped.length; i += BATCH) {
    const batch = deduped.slice(i, i + BATCH)
    const placeholders = batch
      .map((_, j) => {
        const b = j * 6
        return `($${b+1},$${b+2},$${b+3},$${b+4}::char(2),$${b+5},$${b+6}::text,NOW())`
      })
      .join(',')

    await db.query(
      `INSERT INTO legitimate_domains
         (domain, company_name, normalized_name, country_code, source, source_url, synced_at)
       VALUES ${placeholders}
       ON CONFLICT (domain) DO UPDATE SET
         company_name    = EXCLUDED.company_name,
         normalized_name = EXCLUDED.normalized_name,
         country_code    = COALESCE(EXCLUDED.country_code, legitimate_domains.country_code),
         source          = EXCLUDED.source,
         source_url      = EXCLUDED.source_url,
         synced_at       = NOW()`,
      batch.flatMap((e) => [
        e.domain,
        e.company_name,
        normalizeName(e.company_name),
        e.country_code,
        e.source,
        e.source_url,
      ])
    )
    inserted += batch.length
  }

  return inserted
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface LegitDomainsSyncResult {
  fromWhitelist: number
  fromManual: number
  total: number
  durationMs: number
}

/**
 * Sync legitimate domains from Rotterdam whitelist + manual seed.
 * Safe to call repeatedly — uses ON CONFLICT upsert.
 */
export async function syncLegitDomains(): Promise<LegitDomainsSyncResult> {
  const start = Date.now()

  const [whitelistEntries] = await Promise.all([
    loadFromWhitelist().catch(() => [] as SeedEntry[]),
  ])

  const tagged = [
    ...whitelistEntries.map((e) => ({ ...e, source: 'whitelist' as const, source_url: null })),
    ...MANUAL_SEED.map((e) => ({ ...e, source: 'manual' as const, source_url: null })),
  ]

  const total = await upsertLegitDomains(tagged)

  return {
    fromWhitelist: whitelistEntries.length,
    fromManual: MANUAL_SEED.length,
    total,
    durationMs: Date.now() - start,
  }
}

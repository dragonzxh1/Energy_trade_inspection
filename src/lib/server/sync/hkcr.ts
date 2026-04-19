/**
 * Hong Kong Companies Registry sync module.
 *
 * Strategy: CSV batch download + local cache import (gleif-golden-copy.ts pattern)
 * Reason: data.gov.hk CKAN API does NOT provide searchable company database.
 *
 * syncHKCRFull()    — batch download CSV files + import to hkcr_cache
 * searchHKCRCache() — query local cache table (Tier 2 integration)
 * mightBeHKNumber() — detect 7-digit HK registration number
 * hkcrToSearchResult() — convert cache row to SearchResult format
 */

import { parse } from 'csv-parse'
import { db } from '@/lib/server/db'
import { riskLevel } from '@/lib/server/scoring'

// ── Types ──────────────────────────────────────────────────────────────────────

/** HK company cache row (per D-02) */
export interface HKCRCacheRow {
  company_number: string
  company_name: string
  company_name_chinese?: string
  company_type?: string
  company_status?: string
  date_of_incorporation?: Date
  nature_of_business?: string
}

/** CSV row format from data.gov.hk (column names may vary) */
interface HKCRCSVRow {
  // Actual CSV field names from data.gov.hk
  'Current Company Name in English'?: string
  'Current Company Name in Chinese'?: string
  'BR Number'?: string          // HK registration number (8-digit)
  'Date of Incorporation'?: string
  'Date of Change of name'?: string
  // Fallback variants
  'Company Number'?: string
  'Company Name'?: string
  'Company Name (Chinese)'?: string
  'company_number'?: string
  'company_name'?: string
  'company_name_chinese'?: string
  'date_of_incorporation'?: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CKAN_PACKAGE_URL = 'https://data.gov.hk/en-data/api/3/action/package_show?id=hk-cr-crdata-list-newly-registered-companies-2526'
const HK_NUMBER_REGEX = /^\d{7,8}$/
const BATCH_SIZE = 1000

// ── Registration number detection (D-04) ───────────────────────────────────────

/** Detect 7-8 digit HK company BR registration number (no prefix letters). */
export function mightBeHKNumber(s: string): boolean {
  return HK_NUMBER_REGEX.test(s.trim())
}

// ── Score computation (per D-02) ───────────────────────────────────────────────

/**
 * Compute authenticity score for HK company from cache.
 * entityExistence: Live status in HK official registry (max 20/25)
 * documentConsistency: date_of_incorporation + company_type (max 8/10)
 */
export function computeHKCRScore(company: HKCRCacheRow): number {
  const isLive = company.company_status === 'Live'
  const entityExistence = isLive ? 20 : 0
  const documentConsistency =
    (company.date_of_incorporation ? 4 : 0) +
    (company.company_type ? 4 : 0)
  return entityExistence + documentConsistency
}

// ── Result conversion (类比 chToSearchResult) ───────────────────────────────────

/** Convert HK cache row to SearchResult format. */
export function hkcrToSearchResult(company: HKCRCacheRow) {
  const authenticityScore = computeHKCRScore(company)
  return {
    id: `hkcr:${company.company_number}`,
    name: company.company_name,
    type: 'company' as const,
    country: 'Hong Kong',
    jurisdictionFlag: '🇭🇰',
    sanctionStatus: 'unknown' as const,
    authenticityScore,
    riskLevel: riskLevel(authenticityScore, 'unknown'),
    registrationNumber: company.company_number,
    slug: `hk-${company.company_number}`,
  }
}

// ── Local cache query (per D-01) ───────────────────────────────────────────────

/**
 * Search hkcr_cache table for Hong Kong companies.
 *
 * If query matches HK number pattern (7 digits), do exact lookup.
 * Otherwise, do pg_trgm fuzzy name search on both English and Chinese names.
 */
export async function searchHKCRCache(query: string, limit = 5): Promise<HKCRCacheRow[]> {
  if (!query || query.trim().length < 2) return []

  const normalizedQuery = query.trim()

  // Check if query is a HK number (D-04)
  if (mightBeHKNumber(normalizedQuery)) {
    const { rows } = await db.query<HKCRCacheRow>(
      `SELECT company_number, company_name, company_name_chinese,
              company_type, company_status, date_of_incorporation, nature_of_business
       FROM hkcr_cache
       WHERE company_number = $1
       LIMIT $2`,
      [normalizedQuery, limit]
    )
    return rows
  }

  // Name search with pg_trgm (GIN index)
  const { rows } = await db.query<HKCRCacheRow>(
    `SELECT company_number, company_name, company_name_chinese,
            company_type, company_status, date_of_incorporation, nature_of_business
     FROM hkcr_cache
     WHERE company_name ILIKE $1
        OR company_name_chinese ILIKE $1
     ORDER BY company_name <-> $2
     LIMIT $3`,
    [`%${normalizedQuery}%`, normalizedQuery, limit]
  )

  return rows
}

// ── CSV batch sync (per D-01, gleif-golden-copy.ts pattern) ────────────────────

/**
 * Fetch CSV resource URLs from CKAN package_show API.
 * Returns list of CSV/XLSX file URLs for weekly newly registered companies.
 */
async function fetchCSVResourceUrls(): Promise<string[]> {
  const response = await fetch(CKAN_PACKAGE_URL, {
    headers: { 'User-Agent': 'ETI-Bot/1.0' },
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    throw new Error(`CKAN package fetch failed: HTTP ${response.status}`)
  }

  const data = await response.json() as { success?: boolean; result?: { resources?: Array<{ format?: string; url?: string }> } }
  if (!data.success) {
    throw new Error('CKAN package fetch failed: success=false')
  }

  // Extract CSV/XLSX resource URLs
  const resources = data.result?.resources ?? []
  return resources
    .filter((r) =>
      r.format?.toUpperCase() === 'CSV' || r.format?.toUpperCase() === 'XLSX'
    )
    .map((r) => r.url)
    .filter((url): url is string => Boolean(url))
}

/**
 * Download and parse a single CSV file.
 * Returns array of normalized HKCRCacheRow objects.
 */
async function parseCSVFile(url: string): Promise<HKCRCacheRow[]> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(60000),
    })

    if (!response.ok) {
      console.error(`[hkcr] CSV download failed: ${url}`)
      return []
    }

    const text = await response.text()
    const parser = parse(text, { columns: true, skip_empty_lines: true })

    const records: HKCRCacheRow[] = []
    for await (const record of parser) {
      const raw = record as HKCRCSVRow
      // Normalize CSV column names (actual fields from data.gov.hk)
      const normalized: HKCRCacheRow = {
        company_number: raw['BR Number'] ?? raw['Company Number'] ?? raw.company_number ?? '',
        company_name: raw['Current Company Name in English'] ?? raw['Company Name'] ?? raw.company_name ?? '',
        company_name_chinese: raw['Current Company Name in Chinese'] ?? raw['Company Name (Chinese)'] ?? raw.company_name_chinese ?? undefined,
        company_type: undefined,  // Not provided in weekly CSV
        company_status: 'Live',   // Newly registered companies are Live by default
        date_of_incorporation: raw['Date of Incorporation'] ?? raw.date_of_incorporation
          ? new Date(raw['Date of Incorporation'] ?? raw.date_of_incorporation ?? '')
          : undefined,
        nature_of_business: undefined,  // Not provided in weekly CSV
      }

      // Skip rows without required fields
      if (!normalized.company_number || !normalized.company_name) continue

      records.push(normalized)
    }

    return records
  } catch (err) {
    console.error(`[hkcr] CSV parse error for ${url}:`, err)
    return []
  }
}

/**
 * Batch insert HK company records into hkcr_cache.
 * Uses ON CONFLICT UPSERT to handle duplicates.
 */
async function batchInsertHKCR(records: HKCRCacheRow[]): Promise<number> {
  if (records.length === 0) return 0

  const client = await db.connect()
  try {
    await client.query('BEGIN')

    let inserted = 0
    const batch: HKCRCacheRow[] = []

    const flushBatch = async () => {
      if (batch.length === 0) return

      const cols = 7
      const placeholders = batch
        .map((_, i) => {
          const base = i * cols
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`
        })
        .join(',')

      const values = batch.flatMap((r) => [
        r.company_number,
        r.company_name,
        r.company_name_chinese ?? null,
        r.company_type ?? null,
        r.company_status ?? null,
        r.date_of_incorporation ?? null,
        r.nature_of_business ?? null,
      ])

      await client.query(
        `INSERT INTO hkcr_cache
           (company_number, company_name, company_name_chinese,
            company_type, company_status, date_of_incorporation, nature_of_business)
         VALUES ${placeholders}
         ON CONFLICT (company_number) DO UPDATE SET
           company_name = EXCLUDED.company_name,
           company_status = EXCLUDED.company_status,
           company_type = EXCLUDED.company_type,
           date_of_incorporation = EXCLUDED.date_of_incorporation,
           nature_of_business = EXCLUDED.nature_of_business,
           last_synced_at = NOW()`,
        values
      )

      inserted += batch.length
      batch.length = 0

      if (inserted % 10000 === 0) {
        console.log(`[hkcr] inserted ${inserted.toLocaleString()} records...`)
      }
    }

    for (const record of records) {
      batch.push(record)
      if (batch.length >= BATCH_SIZE) await flushBatch()
    }

    await flushBatch()
    await client.query('COMMIT')

    return inserted
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { })
    throw err
  } finally {
    client.release()
  }
}

async function writeSyncLog(
  source: string,
  status: 'success' | 'error',
  count: number,
  durationMs: number,
  errorMsg?: string,
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO sanctions_sync_log (source, status, record_count, duration_ms, error_message)
       VALUES ($1, $2, $3, $4, $5)`,
      [source, status, status === 'success' ? count : null, durationMs, errorMsg ?? null]
    )
  } catch (err) {
    console.error('[hkcr] sync log write failed:', err)
  }
}

/**
 * Full sync: download all CSV files from data.gov.hk and import to hkcr_cache.
 * Per D-01: batch download + local cache import pattern.
 */
export async function syncHKCRFull(): Promise<{ inserted: number; errors: number }> {
  const startMs = Date.now()
  let totalInserted = 0
  let totalErrors = 0

  console.log('[hkcr] Starting full sync...')

  try {
    const csvUrls = await fetchCSVResourceUrls()
    console.log(`[hkcr] Found ${csvUrls.length} CSV resources`)

    for (const url of csvUrls) {
      try {
        console.log(`[hkcr] Processing ${url}`)
        const records = await parseCSVFile(url)

        if (records.length > 0) {
          const inserted = await batchInsertHKCR(records)
          totalInserted += inserted
          console.log(`[hkcr] Inserted ${inserted} records from ${url}`)
        }
      } catch (err) {
        totalErrors++
        console.error(`[hkcr] Failed to process ${url}:`, err)
      }
    }

    // Log sync result
    await writeSyncLog('hkcr:full', totalErrors === 0 ? 'success' : 'error', totalInserted, Date.now() - startMs, totalErrors > 0 ? `${totalErrors} files failed` : undefined)
    console.log(`[hkcr] Full sync complete: ${totalInserted.toLocaleString()} records in ${Date.now() - startMs}ms`)

    return { inserted: totalInserted, errors: totalErrors }
  } catch (err) {
    await writeSyncLog('hkcr:full', 'error', 0, Date.now() - startMs, String(err))
    throw err
  }
}
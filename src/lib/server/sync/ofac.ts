/**
 * OFAC SDN锛堢壒鍒寚瀹氬浗姘戯級鍒惰鍚嶅崟鍚屾
 * 鏉ユ簮锛氱編鍥借储鏀块儴娴峰璧勪骇鎺у埗鍔炲叕瀹? * URL锛歨ttps://www.treasury.gov/ofac/downloads/sdn_advanced.xml
 * 鏇存柊棰戠巼锛氭瘡鏃ワ紙宸ヤ綔鏃ワ級
 * 璁稿彲锛氬叕鍏遍鍩燂紝鏃犱娇鐢ㄩ檺鍒? */

import { XMLParser } from 'fast-xml-parser'
import { db } from '@/lib/server/db'
import { normalizeEntityName } from '@/lib/server/normalize'

const OFAC_XML_URL = 'https://www.treasury.gov/ofac/downloads/sdn_advanced.xml'

// OFAC 瀹炰綋绫诲瀷鏄犲皠
const ENTITY_TYPE_MAP: Record<string, string> = {
  Individual: 'individual',
  Entity: 'entity',
  Vessel: 'vessel',
  Aircraft: 'aircraft',
}

interface OFACEntry {
  uid: number
  firstName?: string
  lastName: string
  sdnType: string
  programList?: { program: string | string[] }
  akaList?: {
    aka: OFACAka | OFACAka[]
  }
  addressList?: {
    address: OFACAddress | OFACAddress[]
  }
  remarks?: string
}

interface OFACAka {
  uid: number
  type: string
  category: string
  firstName?: string
  lastName: string
}

interface OFACAddress {
  uid: number
  country?: string
  city?: string
}

// normalizeText replaced by shared normalizeEntityName from normalize.ts
function normalizeText(text: string): string {
  return normalizeEntityName(text, true)
}

function toArray<T>(val: T | T[] | undefined): T[] {
  if (!val) return []
  return Array.isArray(val) ? val : [val]
}

function buildFullName(entry: { firstName?: string; lastName: string }): string {
  return [entry.firstName, entry.lastName].filter(Boolean).join(' ').trim()
}

export async function syncOFAC(): Promise<{ count: number }> {
  const startMs = Date.now()

  // OFAC blocks generic requests, so send a user agent.
  const response = await fetch(OFAC_XML_URL, {
    headers: {
      'User-Agent': 'EnergyTradeInspection/1.0 (compliance@energytradeinspection.com)',
    },
  })

  if (!response.ok) {
    throw new Error(`OFAC 涓嬭浇澶辫触: HTTP ${response.status}`)
  }

  const xmlText = await response.text()

  // 瑙ｆ瀽 XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    isArray: (name) => ['sdnEntry', 'aka', 'address', 'program', 'nationality'].includes(name),
  })

  const parsed = parser.parse(xmlText)
  const entries: OFACEntry[] = parsed?.sdnList?.sdnEntry ?? []

  if (entries.length === 0) {
    throw new Error('OFAC XML 瑙ｆ瀽鍚庢棤鏉＄洰锛屽彲鑳芥牸寮忓凡鍙樻洿')
  }

  // 鎵归噺 upsert 鍒?sanctions_entries
  const client = await db.connect()
  let upsertCount = 0

  try {
    await client.query('BEGIN')

    // 鍏堝垹闄ゆ棫鐨?OFAC 鏁版嵁
    await client.query("DELETE FROM sanctions_entries WHERE source = 'ofac'")

    const BATCH_SIZE = 500
    let batch: unknown[][] = []

    async function flushBatch() {
      if (batch.length === 0) return

      // 鏋勫缓鎵归噺 INSERT
      const placeholders = batch
        .map((_, i) => {
          const base = i * 8
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6}::jsonb,$${base + 7},$${base + 8}::jsonb)`
        })
        .join(',')

      await client.query(
        `INSERT INTO sanctions_entries
           (id, source, entity_name, normalized_name, entity_type, aliases, country, programs)
         VALUES ${placeholders}
         ON CONFLICT (id) DO UPDATE SET
           entity_name = EXCLUDED.entity_name,
           normalized_name = EXCLUDED.normalized_name,
           entity_type = EXCLUDED.entity_type,
           aliases = EXCLUDED.aliases,
           country = EXCLUDED.country,
           programs = EXCLUDED.programs,
           last_updated = NOW()`,
        batch.flat()
      )
      upsertCount += batch.length
      batch = []
    }

    for (const entry of entries) {
      const fullName = buildFullName(entry)
      if (!fullName) continue

      const entityType = ENTITY_TYPE_MAP[entry.sdnType] ?? 'entity'
      const programs = toArray(entry.programList?.program).map(String)
      const akas = toArray(entry.akaList?.aka).map((a) => buildFullName(a))
      const addresses = toArray(entry.addressList?.address)
      const country = addresses.find((a) => a.country)?.country ?? null

      // programs 瀛樹负 JSONB 鏁扮粍
      const programsJson = JSON.stringify(programs)
      const aliasesJson = JSON.stringify(akas)

      batch.push([
        `ofac:${entry.uid}`,        // id
        'ofac',                     // source
        fullName,                   // entity_name
        normalizeText(fullName),    // normalized_name
        entityType,                 // entity_type
        aliasesJson,                // aliases (jsonb)
        country,                    // country
        programsJson,               // programs (jsonb -> text[])
      ])

      if (batch.length >= BATCH_SIZE) {
        await flushBatch()
      }
    }

    await flushBatch()

    // 璁板綍鍚屾鏃ュ織
    await client.query(
      `INSERT INTO sanctions_sync_log (source, status, record_count, duration_ms)
       VALUES ('ofac', 'success', $1, $2)`,
      [upsertCount, Date.now() - startMs]
    )

    await client.query('COMMIT')
    return { count: upsertCount }
  } catch (error) {
    await client.query('ROLLBACK')

    await db.query(
      `INSERT INTO sanctions_sync_log (source, status, error_message, duration_ms)
       VALUES ('ofac', 'error', $1, $2)`,
      [String(error), Date.now() - startMs]
    )

    throw error
  } finally {
    client.release()
  }
}

/** 鏌ヨ鏈湴 OFAC 缂撳瓨锛岃繑鍥炲尮閰嶇殑鍒惰鏉＄洰 */
export async function checkOFAC(name: string): Promise<boolean> {
  const normalized = normalizeText(name)
  if (!normalized || normalized.length < 2) return false

  const { rows } = await db.query(
    `SELECT 1 FROM sanctions_entries
     WHERE source = 'ofac'
       AND (
         normalized_name % $1
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(aliases) alias
           WHERE lower(alias) % $1
         )
       )
     LIMIT 1`,
    [normalized]
  )

  return rows.length > 0
}


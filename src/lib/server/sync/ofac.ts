/**
 * OFAC SDN（特别指定国民）制裁名单同步
 * 来源：美国财政部海外资产控制办公室
 * URL：https://www.treasury.gov/ofac/downloads/sdn_advanced.xml
 * 更新频率：每日（工作日）
 * 许可：公共领域，无使用限制
 */

import { XMLParser } from 'fast-xml-parser'
import { db } from '@/lib/server/db'

const OFAC_XML_URL = 'https://www.treasury.gov/ofac/downloads/sdn_advanced.xml'

// OFAC 实体类型映射
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

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(sa|ltd|limited|inc|corp|bv|gmbh|pte|fze|fzco|llc|plc|co|company)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

  // 下载 OFAC XML（需要 User-Agent 否则返回 403）
  const response = await fetch(OFAC_XML_URL, {
    headers: {
      'User-Agent': 'EnergyTradeInspection/1.0 (compliance@energytradeinspection.com)',
    },
  })

  if (!response.ok) {
    throw new Error(`OFAC 下载失败: HTTP ${response.status}`)
  }

  const xmlText = await response.text()

  // 解析 XML
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '_',
    isArray: (name) => ['sdnEntry', 'aka', 'address', 'program', 'nationality'].includes(name),
  })

  const parsed = parser.parse(xmlText)
  const entries: OFACEntry[] = parsed?.sdnList?.sdnEntry ?? []

  if (entries.length === 0) {
    throw new Error('OFAC XML 解析后无条目，可能格式已变更')
  }

  // 批量 upsert 到 sanctions_entries
  const client = await db.connect()
  let upsertCount = 0

  try {
    await client.query('BEGIN')

    // 先删除旧的 OFAC 数据
    await client.query("DELETE FROM sanctions_entries WHERE source = 'ofac'")

    const BATCH_SIZE = 500
    let batch: unknown[][] = []

    async function flushBatch() {
      if (batch.length === 0) return

      // 构建批量 INSERT
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

      // programs 存为 JSONB 数组
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

    // 记录同步日志
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

/** 查询本地 OFAC 缓存，返回匹配的制裁条目 */
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

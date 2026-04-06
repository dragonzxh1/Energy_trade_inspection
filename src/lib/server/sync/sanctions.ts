/**
 * 统一制裁筛查
 * 来源：sanctions.network — 免费 API，聚合 OFAC、EU FSF、UN 制裁名单
 * 一次请求覆盖全部来源，无需 API key，商业使用免费
 */

const SANCTIONS_API = 'https://api.sanctions.network'

interface SanctionsEntry {
  id: string
  target_type: string
  source: string        // 'ofac' | 'eu' | 'un'
  source_id: string
  names: string[]
  listed_on?: string
}

/**
 * 检查实体名称是否命中任意制裁名单（OFAC + EU + UN）
 * 返回命中的来源列表，为空则表示未命中
 */
export async function checkSanctions(
  name: string
): Promise<{ listed: boolean; sources: string[] }> {
  if (!name || name.trim().length < 2) return { listed: false, sources: [] }

  try {
    const url = new URL('/rpc/search_sanctions', SANCTIONS_API)
    url.searchParams.set('name', name.trim())

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'EnergyTradeInspection/1.0',
      },
      signal: AbortSignal.timeout(4000),
    })

    if (!response.ok) return { listed: false, sources: [] }

    const results: SanctionsEntry[] = await response.json()
    if (!Array.isArray(results) || results.length === 0) {
      return { listed: false, sources: [] }
    }

    // 名称精确匹配度：至少一个别名与查询名称相似
    const normalizedQuery = name.toLowerCase().trim()
    const hits = results.filter((entry) =>
      entry.names.some((n) => {
        const dist = normalizedQuery.length - n.toLowerCase().trim().length
        return Math.abs(dist) <= 5 &&
          n.toLowerCase().includes(normalizedQuery.slice(0, 6))
      })
    )

    if (hits.length === 0) return { listed: false, sources: [] }

    const sources = [...new Set(hits.map((h) => h.source))]
    return { listed: true, sources }
  } catch {
    // API 不可用时降级，不阻断主流程
    return { listed: false, sources: [] }
  }
}

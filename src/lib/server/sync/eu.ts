/**
 * EU 制裁名单查询
 * 来源：sanctions.network（免费开源 API，聚合了 OFAC、UN 及 EU FSF 数据）
 * API：https://api.sanctions.network/rpc/search_sanctions
 * 许可：免费，包括商业用途
 * 方式：实时查询（无需本地同步）
 */

const EU_API_BASE = 'https://api.sanctions.network'

interface SanctionsNetworkResult {
  name: string
  source: string
  match_score?: number
  [key: string]: unknown
}

/**
 * 实时查询 EU 制裁数据库
 * 匹配 EU FSF（欧盟金融制裁档案）及其他来源
 */
export async function checkEUSanctions(name: string): Promise<boolean> {
  if (!name || name.trim().length < 2) return false

  try {
    const url = new URL('/rpc/search_sanctions', EU_API_BASE)
    url.searchParams.set('name', name.trim())

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'EnergyTradeInspection/1.0',
      },
      // 3 秒超时，防止阻塞页面渲染
      signal: AbortSignal.timeout(3000),
    })

    if (!response.ok) return false

    const results: SanctionsNetworkResult[] = await response.json()

    // 有结果且匹配分数较高则认为命中
    if (!Array.isArray(results) || results.length === 0) return false

    const topScore = results[0]?.match_score ?? 1
    return topScore >= 0.85
  } catch {
    // 网络超时或 API 不可用时，不阻断流程，返回 false（降级处理）
    return false
  }
}

/**
 * 批量查询多个名称
 * 串行执行以避免超出 API 限制
 */
export async function checkEUSanctionsBatch(
  names: string[]
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>()
  for (const name of names) {
    results.set(name, await checkEUSanctions(name))
  }
  return results
}

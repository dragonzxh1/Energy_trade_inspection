/**
 * EU 鍒惰鍚嶅崟鏌ヨ
 * 鏉ユ簮锛歴anctions.network锛堝厤璐瑰紑婧?API锛岃仛鍚堜簡 OFAC銆乁N 鍙?EU FSF 鏁版嵁锛? * API锛歨ttps://api.sanctions.network/rpc/search_sanctions
 * 璁稿彲锛氬厤璐癸紝鍖呮嫭鍟嗕笟鐢ㄩ€? * 鏂瑰紡锛氬疄鏃舵煡璇紙鏃犻渶鏈湴鍚屾锛? */

const EU_API_BASE = 'https://api.sanctions.network'

interface SanctionsNetworkResult {
  name: string
  source: string
  match_score?: number
  [key: string]: unknown
}

/**
 * 瀹炴椂鏌ヨ EU 鍒惰鏁版嵁搴? * 鍖归厤 EU FSF锛堟鐩熼噾铻嶅埗瑁佹。妗堬級鍙婂叾浠栨潵婧? */
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
      // 3 绉掕秴鏃讹紝闃叉闃诲椤甸潰娓叉煋
      signal: AbortSignal.timeout(3000),
    })

    if (!response.ok) return false

    const results: SanctionsNetworkResult[] = await response.json()

    // 鏈夌粨鏋滀笖鍖归厤鍒嗘暟杈冮珮鍒欒涓哄懡涓?    if (!Array.isArray(results) || results.length === 0) return false

    const topScore = results[0]?.match_score ?? 1
    return topScore >= 0.85
  } catch {
    // 缃戠粶瓒呮椂鎴?API 涓嶅彲鐢ㄦ椂锛屼笉闃绘柇娴佺▼锛岃繑鍥?false锛堥檷绾у鐞嗭級
    return false
  }
}

/**
 * 鎵归噺鏌ヨ澶氫釜鍚嶇О
 * 涓茶鎵ц浠ラ伩鍏嶈秴鍑?API 闄愬埗
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


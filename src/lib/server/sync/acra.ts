/**
 * ACRA 鏂板姞鍧″叕鍙告敞鍐屽眬鏁版嵁
 * 鏉ユ簮锛歞ata.gov.sg 寮€鏀炬暟鎹?API锛堝熀浜?CKAN锛? * 鏁版嵁闆嗭細Entities with Unique Entity Number锛圲EN 鏁版嵁闆嗭級
 * 鏇存柊棰戠巼锛氭瘡鏈? * 璁稿彲锛氭柊鍔犲潯寮€鏀炬暟鎹鍙紝鍏佽鍟嗕笟浣跨敤
 */

const DATA_GOV_SG = 'https://data.gov.sg/api/action/datastore_search'

// UEN 瀹炰綋鏁版嵁闆嗚祫婧?ID锛堝寘鍚墍鏈夋敞鍐屽疄浣擄級
const ACRA_RESOURCE_ID = 'd_3f960c10fed6145404ca7b821f263b87'

export interface ACRAEntity {
  uen: string
  entity_name: string
  entity_type: string      // e.g. "LOCAL COMPANY", "FOREIGN COMPANY", "SOLE PROPRIETORSHIP"
  registration_date: string
  uen_status: string       // "Live" | "Cancelled" | "Struck Off"
  primary_ssic_code?: string
  primary_ssic_description?: string
  secondary_ssic_code?: string
  secondary_ssic_description?: string
  issuance_agency_id?: string
  street_name?: string
  postal_code?: string
  country_of_incorporation?: string
}

interface DataGovResponse {
  success: boolean
  result: {
    resource_id: string
    total: number
    records: ACRAEntity[]
  }
}

/**
 * 鎸夊叕鍙稿悕绉版悳绱?ACRA 鏁版嵁闆? * 杩斿洖鏈€澶?10 鏉″尮閰嶇粨鏋? */
export async function searchACRA(query: string, limit = 10): Promise<ACRAEntity[]> {
  if (!query || query.trim().length < 2) return []

  try {
    const url = new URL(DATA_GOV_SG)
    url.searchParams.set('resource_id', ACRA_RESOURCE_ID)
    url.searchParams.set('q', query.trim())
    url.searchParams.set('limit', String(limit))

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'EnergyTradeInspection/1.0',
      },
      signal: AbortSignal.timeout(5000),
      // Cache upstream results for 5 minutes.
      next: { revalidate: 300 },
    } as RequestInit)

    if (!response.ok) return []

    const data: DataGovResponse = await response.json()
    if (!data.success) return []

    // Only keep live businesses.
    return data.result.records.filter(
      (r) => r.uen_status?.toLowerCase() === 'live'
    )
  } catch {
    return []
  }
}

/**
 * 鎸?UEN 绮剧‘鏌ヨ鍗曚釜瀹炰綋
 */
export async function getACRAByUEN(uen: string): Promise<ACRAEntity | null> {
  if (!uen) return null

  try {
    const url = new URL(DATA_GOV_SG)
    url.searchParams.set('resource_id', ACRA_RESOURCE_ID)
    url.searchParams.set('q', uen.trim())
    url.searchParams.set('limit', '5')

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'EnergyTradeInspection/1.0',
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) return null

    const data: DataGovResponse = await response.json()
    if (!data.success) return null

    // 绮剧‘鍖归厤 UEN
    return data.result.records.find(
      (r) => r.uen.toLowerCase() === uen.toLowerCase()
    ) ?? null
  } catch {
    return null
  }
}

/**
 * 灏?ACRA 瀹炰綋绫诲瀷鏄犲皠鍒版湰绯荤粺鐨?EntityType
 */
export function mapACRAEntityType(acraType: string): 'company' | 'terminal' {
  // 鏂板姞鍧?ACRA 鐨勫疄浣撶被鍨嬪叏閮ㄥ綊绫讳负 company
  return 'company'
}

/**
 * Compute authenticity score components for an ACRA entity.
 * Called from both search results (no sanctions) and entity builds (with sanctions).
 *
 * entityExistence: active status in official SG registry (max 18/25)
 * documentConsistency: registration date + street address (max 9/10)
 * communityReputation: sanction screen result (max 8/10)
 * assetReality + tradingTrackRecord: always 0 (no registry data for these)
 */
export function computeACRAScore(
  entity: ACRAEntity,
  sanctionStatus: 'not_listed' | 'listed' | 'unknown' = 'unknown',
) {
  const isActive           = entity.uen_status?.toLowerCase() === 'live'
  const entityExistence    = isActive ? 18 : 0
  const documentConsistency =
    (entity.registration_date ? 5 : 0) +
    (entity.street_name       ? 4 : 0)
  const communityReputation = sanctionStatus === 'not_listed' ? 8 : 0
  const total = entityExistence + documentConsistency + communityReputation

  return {
    authenticityScore: total,
    scoreBreakdown: {
      entityExistence:     { score: entityExistence,     maxScore: 25 },
      assetReality:        { score: 0,                   maxScore: 30 },
      tradingTrackRecord:  { score: 0,                   maxScore: 25 },
      documentConsistency: { score: documentConsistency, maxScore: 10 },
      communityReputation: { score: communityReputation, maxScore: 10 },
    },
  }
}

/**
 * 灏?ACRA 缁撴灉杞崲涓?SearchResult 鏍煎紡
 */
export function acraToSearchResult(entity: ACRAEntity) {
  const { authenticityScore } = computeACRAScore(entity)  // no sanctions in search path
  return {
    id: `acra:${entity.uen}`,
    name: entity.entity_name,
    type: 'company' as const,
    country: 'Singapore',
    jurisdictionFlag: '🇸🇬',
    sanctionStatus: 'unknown' as const,
    authenticityScore,
    riskLevel: 'medium' as const,
    registrationNumber: entity.uen,
    slug: entity.uen.toLowerCase().replace(/[^a-z0-9]/g, '-'),
  }
}


/**
 * ACRA 新加坡公司注册局数据
 * 来源：data.gov.sg 开放数据 API（基于 CKAN）
 * 数据集：Entities with Unique Entity Number（UEN 数据集）
 * 更新频率：每月
 * 许可：新加坡开放数据许可，允许商业使用
 */

const DATA_GOV_SG = 'https://data.gov.sg/api/action/datastore_search'

// UEN 实体数据集资源 ID（包含所有注册实体）
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
 * 按公司名称搜索 ACRA 数据集
 * 返回最多 10 条匹配结果
 */
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
      // 结果缓存 5 分钟（data.gov.sg 支持 ETag）
      next: { revalidate: 300 },
    } as RequestInit)

    if (!response.ok) return []

    const data: DataGovResponse = await response.json()
    if (!data.success) return []

    // 只返回在营企业
    return data.result.records.filter(
      (r) => r.uen_status?.toLowerCase() === 'live'
    )
  } catch {
    return []
  }
}

/**
 * 按 UEN 精确查询单个实体
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

    // 精确匹配 UEN
    return data.result.records.find(
      (r) => r.uen.toLowerCase() === uen.toLowerCase()
    ) ?? null
  } catch {
    return null
  }
}

/**
 * 将 ACRA 实体类型映射到本系统的 EntityType
 */
export function mapACRAEntityType(acraType: string): 'company' | 'terminal' {
  // 新加坡 ACRA 的实体类型全部归类为 company
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
      tradingTrackRecord:  { score: 0,                   maxScore: 25, phase2Pending: true as const },
      documentConsistency: { score: documentConsistency, maxScore: 10 },
      communityReputation: { score: communityReputation, maxScore: 10 },
    },
  }
}

/**
 * 将 ACRA 结果转换为 SearchResult 格式
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

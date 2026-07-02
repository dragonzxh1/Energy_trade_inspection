import { db } from './db'
import {
  type DistributionStatus,
  DISTRIBUTION_STATUS,
  ensureCommoditySlug,
  type IntelligenceCommoditySlug,
  isIntelligenceContentType,
  type ReviewStatus,
  REVIEW_STATUS,
  slugifyContentValue,
} from '@/lib/intelligence'

export interface SeoFact {
  fact: string
  source_index?: number
}

export interface SeoFaqItem {
  question: string
  answer: string
}

export interface LanguageVariants {
  website_en?: {
    title?: string
    summary?: string
    article?: string
  }
  wechat_zh?: {
    title?: string
    summary?: string
    article?: string
    image_suggestions?: string[]
    alternate_titles?: string[]
  }
}

export interface SourceDocumentMeta {
  source_file_name?: string
  source_date?: string
  media_type?: string
  sender_label?: string
  storage_path?: string
  source_url?: string
}

export interface SeoContent {
  id: string
  content_type:
    | 'case_study'
    | 'risk_topic'
    | 'country_profile'
    | 'market_brief'
    | 'commodity_update'
    | 'intelligence_article'
  slug: string
  title: string
  year: number | null
  verified_facts: SeoFact[]
  source_urls: string[]
  source_level: string
  source_kind: string
  risk_types: string[]
  entities: string[]
  industry_focus: string | null
  amount_usd: number | null
  legal_disclaimer: string
  narrative: string | null
  meta_description: string | null
  meta_keywords: string[] | null
  faq: SeoFaqItem[] | null
  structured_data: Record<string, unknown> | null
  published: boolean
  indexed_at: Date | null
  page_views: number
  created_at: Date
  updated_at: Date
  commodity: IntelligenceCommoditySlug | null
  subcommodity: string | null
  region: string | null
  content_subtype: string | null
  source_channel: string | null
  source_message_id: string | null
  source_file_hash: string | null
  source_file_name: string | null
  source_published_at: Date | null
  parser_confidence: number | null
  review_status: ReviewStatus
  distribution_status: DistributionStatus
  language_variants: LanguageVariants | null
  source_document_json: SourceDocumentMeta | null
  key_facts: string[] | null
  why_it_matters: string | null
  internal_only: boolean
}

export interface ListSeoFilters {
  type?:
    | 'case_study'
    | 'risk_topic'
    | 'country_profile'
    | 'market_brief'
    | 'commodity_update'
    | 'intelligence_article'
  types?: SeoContent['content_type'][]
  published?: boolean
  year?: number
  risk_type?: string
  entity?: string
  industry_focus?: string
  source_kind?: string
  commodity?: IntelligenceCommoditySlug
  region?: string
  content_subtype?: string
  review_status?: ReviewStatus
  distribution_status?: DistributionStatus
  internal_only?: boolean
  limit?: number
  offset?: number
  orderBy?: string
  orderDir?: 'ASC' | 'DESC'
}

export interface ContentIngestionItem {
  id: string
  source_channel: string
  source_message_id: string
  sender_label: string | null
  media_type: string
  file_name: string
  file_hash: string | null
  file_size_bytes: number | null
  message_timestamp: Date
  storage_path: string | null
  source_url: string | null
  processing_status: 'queued' | 'parsed' | 'drafted' | 'review' | 'published' | 'failed'
  parser_confidence: number | null
  commodity: IntelligenceCommoditySlug | null
  region: string | null
  extracted_title: string | null
  extracted_summary: string | null
  raw_payload_json: Record<string, unknown> | null
  error_message: string | null
  created_at: Date
  updated_at: Date
}

export interface IngestionQueueInput {
  source_channel: string
  source_message_id: string
  sender_label?: string | null
  media_type: string
  file_name: string
  file_hash?: string | null
  file_size_bytes?: number | null
  message_timestamp: string
  storage_path?: string | null
  source_url?: string | null
  processing_status?: ContentIngestionItem['processing_status']
  parser_confidence?: number | null
  commodity?: string | null
  region?: string | null
  extracted_title?: string | null
  extracted_summary?: string | null
  raw_payload_json?: Record<string, unknown> | null
  error_message?: string | null
}

export interface IntelligenceStats {
  totalPublished: number
  totalDrafts: number
  commodityCounts: Array<{ commodity: IntelligenceCommoditySlug; count: number }>
  subtypeCounts: Array<{ content_subtype: string; count: number }>
}

export interface AdminContentOpsSnapshot {
  ingestionQueue: ContentIngestionItem[]
  parsedKnowledgeEntries: SeoContent[]
  draftArticles: SeoContent[]
  reviewQueue: SeoContent[]
  stats: IntelligenceStats
}

const ALLOWED_ORDER_COLUMNS: Record<string, string> = {
  updated_at: 'updated_at',
  created_at: 'created_at',
  year: 'year',
  amount_usd: 'amount_usd',
  source_published_at: 'source_published_at',
  parser_confidence: 'parser_confidence',
  page_views: 'page_views',
  title: 'title',
}

function parseJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return value as T
}

function serializeForPg(value: unknown, column: string): unknown {
  if (value === undefined || value === null) return value
  if (['verified_facts', 'faq', 'structured_data', 'language_variants', 'source_document_json', 'key_facts', 'raw_payload_json'].includes(column)) {
    return JSON.stringify(value)
  }
  return value
}

function normalizeSeoRow(row: SeoContent): SeoContent {
  return {
    ...row,
    commodity: ensureCommoditySlug(row.commodity) ?? null,
    language_variants: parseJson<LanguageVariants>(row.language_variants),
    verified_facts: parseJson<SeoFact[]>(row.verified_facts) ?? [],
    faq: parseJson<SeoFaqItem[]>(row.faq),
    structured_data: parseJson<Record<string, unknown>>(row.structured_data),
    source_document_json: parseJson<SourceDocumentMeta>(row.source_document_json),
    key_facts: parseJson<string[]>(row.key_facts),
  }
}

function normalizeIngestionRow(row: ContentIngestionItem): ContentIngestionItem {
  return {
    ...row,
    commodity: ensureCommoditySlug(row.commodity) ?? null,
    raw_payload_json: parseJson<Record<string, unknown>>(row.raw_payload_json),
  }
}

function resolveOrderBy(orderBy?: string, orderDir?: 'ASC' | 'DESC'): string {
  const column = orderBy ? ALLOWED_ORDER_COLUMNS[orderBy] : null
  const direction = orderDir === 'ASC' ? 'ASC' : 'DESC'
  return column ? `${column} ${direction}` : 'updated_at DESC'
}

export function buildSeoSlug(title: string, fallbackPrefix = 'content'): string {
  const normalized = slugifyContentValue(title)
  return normalized || `${fallbackPrefix}-${Date.now()}`
}

export async function getSeoContentBySlug(slug: string): Promise<SeoContent | null> {
  const result = await db.query<SeoContent>(
    `SELECT * FROM seo_content WHERE slug = $1`,
    [slug],
  )
  return result.rows[0] ? normalizeSeoRow(result.rows[0]) : null
}

export async function listSeoContent(filters: ListSeoFilters = {}): Promise<SeoContent[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (filters.type !== undefined) {
    conditions.push(`content_type = $${paramIndex++}`)
    values.push(filters.type)
  }
  if (filters.types && filters.types.length > 0) {
    conditions.push(`content_type = ANY($${paramIndex++})`)
    values.push(filters.types)
  }
  if (filters.published !== undefined) {
    conditions.push(`published = $${paramIndex++}`)
    values.push(filters.published)
  }
  if (filters.year !== undefined) {
    conditions.push(`year = $${paramIndex++}`)
    values.push(filters.year)
  }
  if (filters.risk_type !== undefined) {
    conditions.push(`$${paramIndex++} = ANY(risk_types)`)
    values.push(filters.risk_type)
  }
  if (filters.entity !== undefined) {
    conditions.push(`$${paramIndex++} = ANY(entities)`)
    values.push(filters.entity)
  }
  if (filters.industry_focus !== undefined) {
    conditions.push(`industry_focus = $${paramIndex++}`)
    values.push(filters.industry_focus)
  }
  if (filters.source_kind !== undefined) {
    conditions.push(`source_kind = $${paramIndex++}`)
    values.push(filters.source_kind)
  }
  if (filters.commodity !== undefined) {
    conditions.push(`commodity = $${paramIndex++}`)
    values.push(filters.commodity)
  }
  if (filters.region !== undefined) {
    conditions.push(`region = $${paramIndex++}`)
    values.push(filters.region)
  }
  if (filters.content_subtype !== undefined) {
    conditions.push(`content_subtype = $${paramIndex++}`)
    values.push(filters.content_subtype)
  }
  if (filters.review_status !== undefined) {
    conditions.push(`review_status = $${paramIndex++}`)
    values.push(filters.review_status)
  }
  if (filters.distribution_status !== undefined) {
    conditions.push(`distribution_status = $${paramIndex++}`)
    values.push(filters.distribution_status)
  }
  if (filters.internal_only !== undefined) {
    conditions.push(`internal_only = $${paramIndex++}`)
    values.push(filters.internal_only)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const orderBy = resolveOrderBy(filters.orderBy, filters.orderDir)
  const limit = filters.limit ?? 100
  const offset = filters.offset ?? 0

  const result = await db.query<SeoContent>(
    `SELECT * FROM seo_content ${whereClause} ORDER BY ${orderBy} LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    [...values, limit, offset],
  )

  return result.rows.map(normalizeSeoRow)
}

export async function countSeoContent(
  filters: Omit<ListSeoFilters, 'limit' | 'offset' | 'orderBy' | 'orderDir'> = {},
): Promise<number> {
  const conditions: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (filters.type !== undefined) {
    conditions.push(`content_type = $${paramIndex++}`)
    values.push(filters.type)
  }
  if (filters.types && filters.types.length > 0) {
    conditions.push(`content_type = ANY($${paramIndex++})`)
    values.push(filters.types)
  }
  if (filters.published !== undefined) {
    conditions.push(`published = $${paramIndex++}`)
    values.push(filters.published)
  }
  if (filters.year !== undefined) {
    conditions.push(`year = $${paramIndex++}`)
    values.push(filters.year)
  }
  if (filters.risk_type !== undefined) {
    conditions.push(`$${paramIndex++} = ANY(risk_types)`)
    values.push(filters.risk_type)
  }
  if (filters.entity !== undefined) {
    conditions.push(`$${paramIndex++} = ANY(entities)`)
    values.push(filters.entity)
  }
  if (filters.industry_focus !== undefined) {
    conditions.push(`industry_focus = $${paramIndex++}`)
    values.push(filters.industry_focus)
  }
  if (filters.source_kind !== undefined) {
    conditions.push(`source_kind = $${paramIndex++}`)
    values.push(filters.source_kind)
  }
  if (filters.commodity !== undefined) {
    conditions.push(`commodity = $${paramIndex++}`)
    values.push(filters.commodity)
  }
  if (filters.region !== undefined) {
    conditions.push(`region = $${paramIndex++}`)
    values.push(filters.region)
  }
  if (filters.content_subtype !== undefined) {
    conditions.push(`content_subtype = $${paramIndex++}`)
    values.push(filters.content_subtype)
  }
  if (filters.review_status !== undefined) {
    conditions.push(`review_status = $${paramIndex++}`)
    values.push(filters.review_status)
  }
  if (filters.distribution_status !== undefined) {
    conditions.push(`distribution_status = $${paramIndex++}`)
    values.push(filters.distribution_status)
  }
  if (filters.internal_only !== undefined) {
    conditions.push(`internal_only = $${paramIndex++}`)
    values.push(filters.internal_only)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM seo_content ${whereClause}`,
    values,
  )
  return parseInt(result.rows[0]?.count ?? '0', 10)
}

export async function upsertSeoContent(
  data: Partial<SeoContent> & { slug: string; content_type: string },
): Promise<SeoContent> {
  const columns = Object.keys(data).filter((key) => data[key as keyof typeof data] !== undefined)
  const values = columns.map((column) => serializeForPg(data[column as keyof typeof data], column))
  const placeholders = columns.map((_, index) => `$${index + 1}`)
  const updates = columns
    .filter((column) => column !== 'slug')
    .map((column, index) => `${column} = $${index + columns.length + 1}`)

  const query = `
    INSERT INTO seo_content (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (slug) DO UPDATE SET ${updates.join(', ')}, updated_at = now()
    RETURNING *
  `

  const result = await db.query<SeoContent>(
    query,
    [...values, ...values.filter((_, index) => columns[index] !== 'slug')],
  )

  return normalizeSeoRow(result.rows[0])
}

export async function incrementPageViews(slug: string): Promise<void> {
  await db.query(`UPDATE seo_content SET page_views = page_views + 1 WHERE slug = $1`, [slug])
}

export async function getSeoStats(): Promise<{
  totalCases: number
  totalAmount: number | null
  byYear: Record<number, number>
  byRiskType: Record<string, number>
  bySourceKind: Record<string, number>
}> {
  const [totalResult, amountResult, yearResult, riskResult, sourceResult] = await Promise.all([
    db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM seo_content WHERE content_type = 'case_study' AND published = true`),
    db.query<{ total: string | null }>(`SELECT SUM(amount_usd) AS total FROM seo_content WHERE content_type = 'case_study' AND published = true`),
    db.query<{ year: number; count: string }>(`SELECT year, COUNT(*) AS count FROM seo_content WHERE content_type = 'case_study' AND published = true GROUP BY year ORDER BY year DESC`),
    db.query<{ risk_type: string; count: string }>(`SELECT UNNEST(risk_types) AS risk_type, COUNT(*) AS count FROM seo_content WHERE content_type = 'case_study' AND published = true GROUP BY UNNEST(risk_types) ORDER BY count DESC`),
    db.query<{ source_kind: string; count: string }>(`SELECT source_kind, COUNT(*) AS count FROM seo_content WHERE content_type = 'case_study' AND published = true GROUP BY source_kind ORDER BY count DESC`),
  ])

  return {
    totalCases: parseInt(totalResult.rows[0]?.count ?? '0', 10),
    totalAmount: amountResult.rows[0]?.total ? parseFloat(amountResult.rows[0].total) : null,
    byYear: Object.fromEntries(yearResult.rows.map((row) => [row.year, parseInt(row.count, 10)])),
    byRiskType: Object.fromEntries(riskResult.rows.map((row) => [row.risk_type, parseInt(row.count, 10)])),
    bySourceKind: Object.fromEntries(sourceResult.rows.map((row) => [row.source_kind, parseInt(row.count, 10)])),
  }
}

export async function getIntelligenceStats(): Promise<IntelligenceStats> {
  const [publishedResult, draftResult, commodityResult, subtypeResult] = await Promise.all([
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM seo_content
       WHERE content_type = ANY($1) AND published = true AND internal_only = false`,
      [Array.from(['market_brief', 'commodity_update', 'intelligence_article'])],
    ),
    db.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM seo_content
       WHERE content_type = ANY($1) AND review_status = 'draft'`,
      [Array.from(['market_brief', 'commodity_update', 'intelligence_article'])],
    ),
    db.query<{ commodity: IntelligenceCommoditySlug; count: string }>(
      `SELECT commodity, COUNT(*) AS count
       FROM seo_content
       WHERE content_type = ANY($1) AND published = true AND commodity IS NOT NULL AND internal_only = false
       GROUP BY commodity
       ORDER BY count DESC`,
      [Array.from(['market_brief', 'commodity_update', 'intelligence_article'])],
    ),
    db.query<{ content_subtype: string; count: string }>(
      `SELECT content_subtype, COUNT(*) AS count
       FROM seo_content
       WHERE content_type = ANY($1) AND content_subtype IS NOT NULL
       GROUP BY content_subtype
       ORDER BY count DESC`,
      [Array.from(['market_brief', 'commodity_update', 'intelligence_article'])],
    ),
  ])

  return {
    totalPublished: parseInt(publishedResult.rows[0]?.count ?? '0', 10),
    totalDrafts: parseInt(draftResult.rows[0]?.count ?? '0', 10),
    commodityCounts: commodityResult.rows.map((row) => ({
      commodity: row.commodity,
      count: parseInt(row.count, 10),
    })),
    subtypeCounts: subtypeResult.rows.map((row) => ({
      content_subtype: row.content_subtype,
      count: parseInt(row.count, 10),
    })),
  }
}

export async function upsertContentIngestionItem(input: IngestionQueueInput): Promise<ContentIngestionItem> {
  const normalizedCommodity = ensureCommoditySlug(input.commodity) ?? null
  const processingStatus = input.processing_status ?? 'queued'

  const result = await db.query<ContentIngestionItem>(
    `
      INSERT INTO content_ingestion_queue (
        source_channel, source_message_id, sender_label, media_type, file_name,
        file_hash, file_size_bytes, message_timestamp, storage_path, source_url,
        processing_status, parser_confidence, commodity, region, extracted_title,
        extracted_summary, raw_payload_json, error_message
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18
      )
      ON CONFLICT (source_channel, source_message_id) DO UPDATE SET
        sender_label = EXCLUDED.sender_label,
        media_type = EXCLUDED.media_type,
        file_name = EXCLUDED.file_name,
        file_hash = EXCLUDED.file_hash,
        file_size_bytes = EXCLUDED.file_size_bytes,
        message_timestamp = EXCLUDED.message_timestamp,
        storage_path = EXCLUDED.storage_path,
        source_url = EXCLUDED.source_url,
        processing_status = EXCLUDED.processing_status,
        parser_confidence = EXCLUDED.parser_confidence,
        commodity = EXCLUDED.commodity,
        region = EXCLUDED.region,
        extracted_title = EXCLUDED.extracted_title,
        extracted_summary = EXCLUDED.extracted_summary,
        raw_payload_json = EXCLUDED.raw_payload_json,
        error_message = EXCLUDED.error_message,
        updated_at = now()
      RETURNING *
    `,
    [
      input.source_channel,
      input.source_message_id,
      input.sender_label ?? null,
      input.media_type,
      input.file_name,
      input.file_hash ?? null,
      input.file_size_bytes ?? null,
      input.message_timestamp,
      input.storage_path ?? null,
      input.source_url ?? null,
      processingStatus,
      input.parser_confidence ?? null,
      normalizedCommodity,
      input.region ?? null,
      input.extracted_title ?? null,
      input.extracted_summary ?? null,
      serializeForPg(input.raw_payload_json ?? null, 'raw_payload_json'),
      input.error_message ?? null,
    ],
  )

  return normalizeIngestionRow(result.rows[0])
}

export async function getContentIngestionQueue(limit = 50): Promise<ContentIngestionItem[]> {
  const result = await db.query<ContentIngestionItem>(
    `SELECT *
     FROM content_ingestion_queue
     ORDER BY
       CASE processing_status
         WHEN 'failed' THEN 0
         WHEN 'review' THEN 1
         WHEN 'queued' THEN 2
         WHEN 'parsed' THEN 3
         WHEN 'drafted' THEN 4
         WHEN 'published' THEN 5
         ELSE 6
       END,
       updated_at DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows.map(normalizeIngestionRow)
}

export async function getAdminContentOpsSnapshot(): Promise<AdminContentOpsSnapshot> {
  const [ingestionQueue, parsedKnowledgeEntries, draftArticles, reviewQueue, stats] = await Promise.all([
    getContentIngestionQueue(40),
    listSeoContent({
      types: ['market_brief', 'commodity_update', 'intelligence_article'],
      limit: 20,
      published: false,
      review_status: 'draft',
      orderBy: 'updated_at',
    }),
    listSeoContent({
      types: ['market_brief', 'commodity_update', 'intelligence_article'],
      limit: 20,
      review_status: 'draft',
      distribution_status: 'draft',
      orderBy: 'updated_at',
    }),
    listSeoContent({
      types: ['market_brief', 'commodity_update', 'intelligence_article'],
      limit: 20,
      review_status: 'reviewed',
      orderBy: 'updated_at',
    }),
    getIntelligenceStats(),
  ])

  return {
    ingestionQueue,
    parsedKnowledgeEntries,
    draftArticles,
    reviewQueue,
    stats,
  }
}

export async function listPublishedIntelligenceContent(filters: {
  commodity?: IntelligenceCommoditySlug
  content_subtype?: string
  region?: string
  limit?: number
  offset?: number
} = {}): Promise<SeoContent[]> {
  return listSeoContent({
    types: ['market_brief', 'commodity_update', 'intelligence_article'],
    published: true,
    internal_only: false,
    commodity: filters.commodity,
    content_subtype: filters.content_subtype,
    region: filters.region,
    limit: filters.limit ?? 30,
    offset: filters.offset ?? 0,
    orderBy: 'source_published_at',
  })
}

export async function getPublishedIntelligenceByCommodity(commodity: IntelligenceCommoditySlug, limit = 30): Promise<SeoContent[]> {
  return listPublishedIntelligenceContent({ commodity, limit })
}

export async function upsertIntelligenceDraft(input: {
  slug?: string
  title: string
  content_type: string
  commodity?: string | null
  subcommodity?: string | null
  region?: string | null
  content_subtype?: string | null
  source_channel?: string | null
  source_message_id?: string | null
  source_file_hash?: string | null
  source_file_name?: string | null
  source_published_at?: string | null
  parser_confidence?: number | null
  review_status?: string | null
  distribution_status?: string | null
  language_variants?: LanguageVariants | null
  source_document_json?: SourceDocumentMeta | null
  verified_facts?: SeoFact[]
  source_urls?: string[]
  risk_types?: string[]
  entities?: string[]
  industry_focus?: string | null
  source_level?: string
  source_kind?: string
  narrative?: string | null
  meta_description?: string | null
  meta_keywords?: string[] | null
  faq?: SeoFaqItem[] | null
  structured_data?: Record<string, unknown> | null
  key_facts?: string[] | null
  why_it_matters?: string | null
  legal_disclaimer?: string
  published?: boolean
  internal_only?: boolean
  year?: number | null
}): Promise<SeoContent> {
  const contentType = isIntelligenceContentType(input.content_type) ? input.content_type : 'intelligence_article'
  const normalizedCommodity = ensureCommoditySlug(input.commodity) ?? null
  const slug = input.slug ?? buildSeoSlug(input.title, normalizedCommodity ?? 'intelligence')
  const reviewStatus = REVIEW_STATUS.includes((input.review_status ?? 'draft') as ReviewStatus)
    ? (input.review_status as ReviewStatus)
    : 'draft'
  const distributionStatus = DISTRIBUTION_STATUS.includes((input.distribution_status ?? 'draft') as DistributionStatus)
    ? (input.distribution_status as DistributionStatus)
    : 'draft'

  return upsertSeoContent({
    slug,
    title: input.title,
    content_type: contentType,
    commodity: normalizedCommodity,
    subcommodity: input.subcommodity ?? null,
    region: input.region ?? null,
    content_subtype: input.content_subtype ?? null,
    source_channel: input.source_channel ?? null,
    source_message_id: input.source_message_id ?? null,
    source_file_hash: input.source_file_hash ?? null,
    source_file_name: input.source_file_name ?? null,
    source_published_at: input.source_published_at ? new Date(input.source_published_at) : null,
    parser_confidence: input.parser_confidence ?? null,
    review_status: reviewStatus,
    distribution_status: distributionStatus,
    language_variants: input.language_variants ?? null,
    source_document_json: input.source_document_json ?? null,
    verified_facts: input.verified_facts ?? [],
    source_urls: input.source_urls ?? [],
    risk_types: input.risk_types ?? [],
    entities: input.entities ?? [],
    industry_focus: input.industry_focus ?? null,
    source_level: input.source_level ?? 'telegram',
    source_kind: input.source_kind ?? 'telegram_attachment',
    narrative: input.narrative ?? null,
    meta_description: input.meta_description ?? null,
    meta_keywords: input.meta_keywords ?? null,
    faq: input.faq ?? null,
    structured_data: input.structured_data ?? null,
    key_facts: input.key_facts ?? null,
    why_it_matters: input.why_it_matters ?? null,
    legal_disclaimer:
      input.legal_disclaimer ??
      'ETI provides structured market intelligence derived from external source documents. Public pages summarize source materials and do not reproduce full original files.',
    published: input.published ?? false,
    internal_only: input.internal_only ?? false,
    year: input.year ?? null,
  })
}

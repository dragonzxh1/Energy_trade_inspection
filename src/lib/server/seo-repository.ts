import { db } from './db'

export interface SeoContent {
  id: string
  content_type: 'case_study' | 'risk_topic' | 'country_profile'
  slug: string
  title: string
  year: number | null
  verified_facts: { fact: string; source_index?: number }[]
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
  faq: { question: string; answer: string }[] | null
  structured_data: Record<string, unknown> | null
  published: boolean
  indexed_at: Date | null
  page_views: number
  created_at: Date
  updated_at: Date
}

export interface ListSeoFilters {
  type?: 'case_study' | 'risk_topic' | 'country_profile'
  published?: boolean
  year?: number
  risk_type?: string
  entity?: string
  industry_focus?: string
  source_kind?: string
  limit?: number
  offset?: number
  orderBy?: string
  orderDir?: 'ASC' | 'DESC'
}

export async function getSeoContentBySlug(slug: string): Promise<SeoContent | null> {
  const result = await db.query<SeoContent>(
    `SELECT * FROM seo_content WHERE slug = $1`,
    [slug]
  )
  return result.rows[0] ?? null
}

export async function listSeoContent(filters: ListSeoFilters = {}): Promise<SeoContent[]> {
  const conditions: string[] = []
  const values: unknown[] = []
  let paramIdx = 1

  if (filters.type !== undefined) {
    conditions.push(`content_type = $${paramIdx++}`)
    values.push(filters.type)
  }
  if (filters.published !== undefined) {
    conditions.push(`published = $${paramIdx++}`)
    values.push(filters.published)
  }
  if (filters.year !== undefined) {
    conditions.push(`year = $${paramIdx++}`)
    values.push(filters.year)
  }
  if (filters.risk_type !== undefined) {
    conditions.push(`$${paramIdx++} = ANY(risk_types)`)
    values.push(filters.risk_type)
  }
  if (filters.entity !== undefined) {
    conditions.push(`$${paramIdx++} = ANY(entities)`)
    values.push(filters.entity)
  }
  if (filters.industry_focus !== undefined) {
    conditions.push(`industry_focus = $${paramIdx++}`)
    values.push(filters.industry_focus)
  }
  if (filters.source_kind !== undefined) {
    conditions.push(`source_kind = $${paramIdx++}`)
    values.push(filters.source_kind)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const orderBy = filters.orderBy ? `${filters.orderBy} ${filters.orderDir ?? 'DESC'}` : 'updated_at DESC'
  const limit = filters.limit ?? 100
  const offset = filters.offset ?? 0

  const result = await db.query<SeoContent>(
    `SELECT * FROM seo_content ${whereClause} ORDER BY ${orderBy} LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...values, limit, offset]
  )
  return result.rows
}

export async function countSeoContent(filters: Omit<ListSeoFilters, 'limit' | 'offset' | 'orderBy' | 'orderDir'> = {}): Promise<number> {
  const conditions: string[] = []
  const values: unknown[] = []
  let paramIdx = 1

  if (filters.type !== undefined) {
    conditions.push(`content_type = $${paramIdx++}`)
    values.push(filters.type)
  }
  if (filters.published !== undefined) {
    conditions.push(`published = $${paramIdx++}`)
    values.push(filters.published)
  }
  if (filters.year !== undefined) {
    conditions.push(`year = $${paramIdx++}`)
    values.push(filters.year)
  }
  if (filters.risk_type !== undefined) {
    conditions.push(`$${paramIdx++} = ANY(risk_types)`)
    values.push(filters.risk_type)
  }
  if (filters.entity !== undefined) {
    conditions.push(`$${paramIdx++} = ANY(entities)`)
    values.push(filters.entity)
  }
  if (filters.industry_focus !== undefined) {
    conditions.push(`industry_focus = $${paramIdx++}`)
    values.push(filters.industry_focus)
  }
  if (filters.source_kind !== undefined) {
    conditions.push(`source_kind = $${paramIdx++}`)
    values.push(filters.source_kind)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM seo_content ${whereClause}`,
    values
  )
  return parseInt(result.rows[0].count, 10)
}

function serializeForPg(value: unknown, column: string): unknown {
  if (value === undefined || value === null) return value
  if (['verified_facts', 'faq', 'structured_data'].includes(column)) {
    return JSON.stringify(value)
  }
  return value
}

export async function upsertSeoContent(data: Partial<SeoContent> & { slug: string; content_type: string }): Promise<SeoContent> {
  const columns = Object.keys(data).filter(k => data[k as keyof typeof data] !== undefined)
  const values = columns.map(c => serializeForPg(data[c as keyof typeof data], c))
  const placeholders = columns.map((_, i) => `$${i + 1}`)
  const updates = columns.filter(c => c !== 'slug').map((c, i) => `${c} = $${i + columns.length + 1}`)

  const query = `
    INSERT INTO seo_content (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
    ON CONFLICT (slug) DO UPDATE SET ${updates.join(', ')}, updated_at = now()
    RETURNING *
  `

  const result = await db.query<SeoContent>(query, [...values, ...values.filter((_, i) => columns[i] !== 'slug')])
  return result.rows[0]
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
  const [totalRes, amountRes, yearRes, riskRes, sourceRes] = await Promise.all([
    db.query<{ count: string }>(`SELECT COUNT(*) as count FROM seo_content WHERE content_type = 'case_study' AND published = true`),
    db.query<{ total: string | null }>(`SELECT SUM(amount_usd) as total FROM seo_content WHERE content_type = 'case_study' AND published = true`),
    db.query<{ year: number; count: string }>(`SELECT year, COUNT(*) as count FROM seo_content WHERE content_type = 'case_study' AND published = true GROUP BY year ORDER BY year DESC`),
    db.query<{ risk_type: string; count: string }>(`SELECT UNNEST(risk_types) as risk_type, COUNT(*) as count FROM seo_content WHERE content_type = 'case_study' AND published = true GROUP BY UNNEST(risk_types) ORDER BY count DESC`),
    db.query<{ source_kind: string; count: string }>(`SELECT source_kind, COUNT(*) as count FROM seo_content WHERE content_type = 'case_study' AND published = true GROUP BY source_kind ORDER BY count DESC`),
  ])

  return {
    totalCases: parseInt(totalRes.rows[0].count, 10),
    totalAmount: amountRes.rows[0].total ? parseFloat(amountRes.rows[0].total) : null,
    byYear: Object.fromEntries(yearRes.rows.map(r => [r.year, parseInt(r.count, 10)])),
    byRiskType: Object.fromEntries(riskRes.rows.map(r => [r.risk_type, parseInt(r.count, 10)])),
    bySourceKind: Object.fromEntries(sourceRes.rows.map(r => [r.source_kind, parseInt(r.count, 10)])),
  }
}

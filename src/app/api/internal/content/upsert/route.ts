import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized } from '@/lib/server/admin-auth'
import { upsertContentIngestionItem, upsertIntelligenceDraft } from '@/lib/server/seo-repository'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const authResult = isAdminAuthorized(req)
  if (!authResult.authorized) {
    const status = authResult.reason === 'no_session' ? 401 : 403
    return NextResponse.json(
      { error: authResult.reason === 'no_session' ? 'Authentication required.' : 'Forbidden.' },
      { status },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const title = String(body.title ?? '').trim()
  if (!title) {
    return NextResponse.json({ error: 'title is required.' }, { status: 400 })
  }

  try {
    const article = await upsertIntelligenceDraft({
      slug: body.slug ? String(body.slug) : undefined,
      title,
      content_type: body.content_type ? String(body.content_type) : 'intelligence_article',
      commodity: body.commodity ? String(body.commodity) : null,
      subcommodity: body.subcommodity ? String(body.subcommodity) : null,
      region: body.region ? String(body.region) : null,
      content_subtype: body.content_subtype ? String(body.content_subtype) : null,
      source_channel: body.source_channel ? String(body.source_channel) : null,
      source_message_id: body.source_message_id ? String(body.source_message_id) : null,
      source_file_hash: body.source_file_hash ? String(body.source_file_hash) : null,
      source_file_name: body.source_file_name ? String(body.source_file_name) : null,
      source_published_at: body.source_published_at ? String(body.source_published_at) : null,
      parser_confidence: typeof body.parser_confidence === 'number' ? body.parser_confidence : null,
      review_status: body.review_status ? String(body.review_status) : 'draft',
      distribution_status: body.distribution_status ? String(body.distribution_status) : 'draft',
      language_variants: typeof body.language_variants === 'object' && body.language_variants ? body.language_variants as Record<string, unknown> : null,
      source_document_json: typeof body.source_document_json === 'object' && body.source_document_json ? body.source_document_json as Record<string, unknown> : null,
      verified_facts: Array.isArray(body.verified_facts) ? body.verified_facts as Array<{ fact: string; source_index?: number }> : [],
      source_urls: Array.isArray(body.source_urls) ? body.source_urls.map((item) => String(item)) : [],
      risk_types: Array.isArray(body.risk_types) ? body.risk_types.map((item) => String(item)) : [],
      entities: Array.isArray(body.entities) ? body.entities.map((item) => String(item)) : [],
      industry_focus: body.industry_focus ? String(body.industry_focus) : null,
      source_level: body.source_level ? String(body.source_level) : 'telegram',
      source_kind: body.source_kind ? String(body.source_kind) : 'telegram_attachment',
      narrative: body.narrative ? String(body.narrative) : null,
      meta_description: body.meta_description ? String(body.meta_description) : null,
      meta_keywords: Array.isArray(body.meta_keywords) ? body.meta_keywords.map((item) => String(item)) : null,
      faq: Array.isArray(body.faq) ? body.faq as Array<{ question: string; answer: string }> : null,
      structured_data: typeof body.structured_data === 'object' && body.structured_data ? body.structured_data as Record<string, unknown> : null,
      key_facts: Array.isArray(body.key_facts) ? body.key_facts.map((item) => String(item)) : null,
      why_it_matters: body.why_it_matters ? String(body.why_it_matters) : null,
      legal_disclaimer: body.legal_disclaimer ? String(body.legal_disclaimer) : undefined,
      published: body.published === true,
      internal_only: body.internal_only === true,
      year: typeof body.year === 'number' ? body.year : null,
    })

    if (body.source_channel && body.source_message_id) {
      await upsertContentIngestionItem({
        source_channel: String(body.source_channel),
        source_message_id: String(body.source_message_id),
        sender_label: body.sender_label ? String(body.sender_label) : null,
        media_type: body.media_type ? String(body.media_type) : 'document',
        file_name: body.source_file_name ? String(body.source_file_name) : `${article.slug}.json`,
        file_hash: body.source_file_hash ? String(body.source_file_hash) : null,
        message_timestamp: body.source_published_at ? String(body.source_published_at) : new Date().toISOString(),
        storage_path: body.storage_path ? String(body.storage_path) : null,
        source_url: body.source_url ? String(body.source_url) : null,
        processing_status: article.published ? 'published' : article.review_status === 'reviewed' ? 'review' : 'drafted',
        parser_confidence: typeof body.parser_confidence === 'number' ? body.parser_confidence : null,
        commodity: article.commodity,
        region: article.region,
        extracted_title: article.title,
        extracted_summary: article.meta_description ?? article.narrative ?? null,
        raw_payload_json: typeof body.raw_payload_json === 'object' && body.raw_payload_json ? body.raw_payload_json as Record<string, unknown> : null,
      })
    }

    return NextResponse.json({ article }, { status: 200 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

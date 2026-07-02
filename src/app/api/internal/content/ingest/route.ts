import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized } from '@/lib/server/admin-auth'
import { upsertContentIngestionItem } from '@/lib/server/seo-repository'

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

  const sourceChannel = String(body.source_channel ?? '').trim()
  const sourceMessageId = String(body.source_message_id ?? '').trim()
  const mediaType = String(body.media_type ?? '').trim()
  const fileName = String(body.file_name ?? '').trim()
  const messageTimestamp = String(body.message_timestamp ?? '').trim()

  if (!sourceChannel || !sourceMessageId || !mediaType || !fileName || !messageTimestamp) {
    return NextResponse.json(
      { error: 'source_channel, source_message_id, media_type, file_name, and message_timestamp are required.' },
      { status: 400 },
    )
  }

  try {
    const item = await upsertContentIngestionItem({
      source_channel: sourceChannel,
      source_message_id: sourceMessageId,
      sender_label: body.sender_label ? String(body.sender_label) : null,
      media_type: mediaType,
      file_name: fileName,
      file_hash: body.file_hash ? String(body.file_hash) : null,
      file_size_bytes: typeof body.file_size_bytes === 'number' ? body.file_size_bytes : null,
      message_timestamp: messageTimestamp,
      storage_path: body.storage_path ? String(body.storage_path) : null,
      source_url: body.source_url ? String(body.source_url) : null,
      processing_status: body.processing_status
        ? String(body.processing_status) as 'queued' | 'parsed' | 'drafted' | 'review' | 'published' | 'failed'
        : 'queued',
      parser_confidence: typeof body.parser_confidence === 'number' ? body.parser_confidence : null,
      commodity: body.commodity ? String(body.commodity) : null,
      region: body.region ? String(body.region) : null,
      extracted_title: body.extracted_title ? String(body.extracted_title) : null,
      extracted_summary: body.extracted_summary ? String(body.extracted_summary) : null,
      raw_payload_json: typeof body.raw_payload_json === 'object' && body.raw_payload_json ? body.raw_payload_json as Record<string, unknown> : null,
      error_message: body.error_message ? String(body.error_message) : null,
    })

    return NextResponse.json({ item }, { status: 201 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

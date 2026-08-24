export const TELEGRAM_INPUT_SCHEMA_VERSION = 'telegram-input.v1' as const

export type MarketPipelineMode = 'legacy' | 'shadow' | 'review' | 'active'
export type TelegramMessageType = 'text' | 'document' | 'image' | 'link' | 'forward'

export interface TelegramInputContract {
  schema_version: typeof TELEGRAM_INPUT_SCHEMA_VERSION
  pipeline_version: string
  pipeline_mode: MarketPipelineMode
  source_channel: string
  message: {
    telegram_chat_id: string
    telegram_message_id: string
    telegram_message_date: string
    sender_name: string | null
    forwarded_from: string | null
    message_text: string | null
    message_type: TelegramMessageType
    reply_to_message_id: string | null
    telegram_message_url: string | null
    raw_payload_path: string | null
    raw_payload: Record<string, unknown> | null
    ingested_at: string
  }
  attachment: {
    telegram_file_id: string | null
    attachment_name: string
    attachment_path: string
    attachment_mime_type: string
    attachment_hash: string
    attachment_size_bytes: number
  }
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized || null
}

function requiredString(value: unknown, name: string): string {
  const normalized = optionalString(value)
  if (!normalized) throw new Error(`${name} is required.`)
  return normalized
}

function timezoneDate(value: unknown, name: string): string {
  const raw = requiredString(value, name)
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new Error(`${name} must be an ISO-8601 datetime with timezone.`)
  }
  return new Date(raw).toISOString()
}

function pipelineMode(value: unknown): MarketPipelineMode {
  const normalized = String(value || process.env.MARKET_PIPELINE_MODE || 'shadow').trim()
  if (!['legacy', 'shadow', 'review', 'active'].includes(normalized)) {
    throw new Error('pipeline_mode must be legacy, shadow, review, or active.')
  }
  return normalized as MarketPipelineMode
}

function messageType(body: Record<string, unknown>, mimeType: string): TelegramMessageType {
  const explicit = optionalString(body.message_type)
  if (explicit) {
    if (!['text', 'document', 'image', 'link', 'forward'].includes(explicit)) {
      throw new Error('message_type is invalid.')
    }
    return explicit as TelegramMessageType
  }
  return mimeType.startsWith('image/') ? 'image' : 'document'
}

export function normalizeTelegramInput(body: Record<string, unknown>): TelegramInputContract {
  const schemaVersion = optionalString(body.schema_version) ?? TELEGRAM_INPUT_SCHEMA_VERSION
  if (schemaVersion !== TELEGRAM_INPUT_SCHEMA_VERSION) {
    throw new Error(`schema_version must be ${TELEGRAM_INPUT_SCHEMA_VERSION}.`)
  }

  const sourceChannel = requiredString(body.source_channel, 'source_channel')
  const telegramMessageId = requiredString(
    body.telegram_message_id ?? body.source_message_id,
    'telegram_message_id or source_message_id',
  )
  const mimeType = requiredString(
    body.attachment_mime_type ?? body.media_type,
    'attachment_mime_type or media_type',
  )
  const attachmentHash = requiredString(
    body.attachment_hash ?? body.file_hash,
    'attachment_hash or file_hash',
  ).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(attachmentHash)) {
    throw new Error('attachment_hash or file_hash must be a SHA-256 hex digest.')
  }

  const sizeValue = body.attachment_size_bytes ?? body.file_size_bytes ?? 0
  const attachmentSize = Number(sizeValue)
  if (!Number.isSafeInteger(attachmentSize) || attachmentSize < 0) {
    throw new Error('attachment_size_bytes or file_size_bytes must be a non-negative integer.')
  }

  const rawPayload = body.raw_payload ?? body.raw_payload_json
  if (rawPayload !== null && rawPayload !== undefined && (typeof rawPayload !== 'object' || Array.isArray(rawPayload))) {
    throw new Error('raw_payload must be an object.')
  }

  return {
    schema_version: TELEGRAM_INPUT_SCHEMA_VERSION,
    pipeline_version: optionalString(body.pipeline_version)
      ?? process.env.MARKET_PIPELINE_VERSION
      ?? TELEGRAM_INPUT_SCHEMA_VERSION,
    pipeline_mode: pipelineMode(body.pipeline_mode),
    source_channel: sourceChannel,
    message: {
      telegram_chat_id: optionalString(body.telegram_chat_id) ?? sourceChannel,
      telegram_message_id: telegramMessageId,
      telegram_message_date: timezoneDate(
        body.telegram_message_date ?? body.message_timestamp,
        'telegram_message_date or message_timestamp',
      ),
      sender_name: optionalString(body.sender_name ?? body.sender_label),
      forwarded_from: optionalString(body.forwarded_from),
      message_text: optionalString(body.message_text)
        ?? optionalString((rawPayload as Record<string, unknown> | null)?.caption),
      message_type: messageType(body, mimeType),
      reply_to_message_id: optionalString(body.reply_to_message_id),
      telegram_message_url: optionalString(body.telegram_message_url ?? body.source_url),
      raw_payload_path: optionalString(body.raw_payload_path),
      raw_payload: rawPayload ? rawPayload as Record<string, unknown> : null,
      ingested_at: body.ingested_at
        ? timezoneDate(body.ingested_at, 'ingested_at')
        : new Date().toISOString(),
    },
    attachment: {
      telegram_file_id: optionalString(body.telegram_file_id),
      attachment_name: requiredString(
        body.attachment_name ?? body.file_name,
        'attachment_name or file_name',
      ),
      attachment_path: requiredString(
        body.attachment_path ?? body.storage_path,
        'attachment_path or storage_path',
      ),
      attachment_mime_type: mimeType,
      attachment_hash: attachmentHash,
      attachment_size_bytes: attachmentSize,
    },
  }
}

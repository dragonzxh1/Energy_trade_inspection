CREATE TABLE telegram_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version TEXT NOT NULL,
  source_channel TEXT NOT NULL,
  telegram_chat_id TEXT NOT NULL,
  telegram_message_id TEXT NOT NULL,
  telegram_message_date TIMESTAMPTZ NOT NULL,
  sender_name TEXT,
  forwarded_from TEXT,
  message_text TEXT,
  message_type TEXT NOT NULL
    CHECK (message_type IN ('text', 'document', 'image', 'link', 'forward')),
  reply_to_message_id TEXT,
  telegram_message_url TEXT,
  raw_payload_path TEXT,
  raw_payload_json JSONB,
  ingested_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_channel, telegram_message_id)
);

CREATE TABLE telegram_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_file_id TEXT,
  file_hash TEXT NOT NULL CHECK (file_hash ~ '^[A-Fa-f0-9]{64}$'),
  attachment_name TEXT NOT NULL,
  attachment_path TEXT NOT NULL,
  attachment_mime_type TEXT NOT NULL,
  attachment_size_bytes BIGINT NOT NULL CHECK (attachment_size_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_telegram_attachments_file_id
  ON telegram_attachments(telegram_file_id)
  WHERE telegram_file_id IS NOT NULL;

CREATE UNIQUE INDEX uq_telegram_attachments_file_hash
  ON telegram_attachments(file_hash);

CREATE TABLE telegram_message_attachments (
  message_id UUID NOT NULL REFERENCES telegram_messages(id) ON DELETE CASCADE,
  attachment_id UUID NOT NULL REFERENCES telegram_attachments(id) ON DELETE RESTRICT,
  caption TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, attachment_id)
);

CREATE TABLE processing_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL REFERENCES telegram_attachments(id) ON DELETE RESTRICT,
  run_type TEXT NOT NULL DEFAULT 'telegram_adapter',
  pipeline_version TEXT NOT NULL,
  pipeline_mode TEXT NOT NULL
    CHECK (pipeline_mode IN ('legacy', 'shadow', 'review', 'active')),
  processing_status TEXT NOT NULL
    CHECK (processing_status IN ('received', 'downloaded', 'adapted', 'failed', 'needs_review')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, run_type, pipeline_version)
);

CREATE INDEX idx_telegram_messages_date
  ON telegram_messages(telegram_message_date DESC);

CREATE INDEX idx_telegram_message_attachments_attachment
  ON telegram_message_attachments(attachment_id);

CREATE INDEX idx_processing_runs_status
  ON processing_runs(processing_status, started_at DESC);

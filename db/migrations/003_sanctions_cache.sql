-- 制裁名单缓存：存储 OFAC、EU 等来源的制裁条目
CREATE TABLE IF NOT EXISTS sanctions_entries (
  id TEXT PRIMARY KEY,                          -- 格式: "ofac:12345"
  source TEXT NOT NULL,                         -- 'ofac' | 'eu'
  entity_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  entity_type TEXT,                             -- 'individual' | 'entity' | 'vessel' | 'aircraft'
  programs TEXT[] NOT NULL DEFAULT '{}',        -- 制裁项目列表
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,   -- 别名数组
  country TEXT,
  additional_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sanctions_name_trgm
  ON sanctions_entries USING gin(normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_sanctions_source ON sanctions_entries(source);
CREATE INDEX IF NOT EXISTS idx_sanctions_entity_type ON sanctions_entries(entity_type);

-- 同步日志
CREATE TABLE IF NOT EXISTS sanctions_sync_log (
  source TEXT NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  record_count INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'error')),
  error_message TEXT,
  duration_ms INTEGER,
  PRIMARY KEY (source, synced_at)
);

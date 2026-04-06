-- 重新设计 sanctions_entries 表适配 OpenSanctions CSV 格式
-- OpenSanctions 已包含 OFAC / EU / UN 等来源，不再需要旧的逐源同步结构

-- 删除旧表（旧结构与 OpenSanctions CSV 字段不兼容）
DROP TABLE IF EXISTS sanctions_entries CASCADE;

-- 重建：与 targets.simple.csv 列直接对应
CREATE TABLE sanctions_entries (
  id           TEXT PRIMARY KEY,            -- OpenSanctions unique ID (e.g. NK-xxx)
  schema       TEXT NOT NULL,              -- Person / Company / Vessel / Organization / LegalEntity
  name         TEXT NOT NULL,              -- 主名称
  search_text  TEXT NOT NULL,              -- lower(name) + ' ' + lower(aliases) — GIN 索引列
  countries    TEXT,                        -- 分号分隔的国家代码
  identifiers  TEXT,                        -- 注册号、IMO 等
  sanctions    TEXT,                        -- 制裁项目描述
  dataset      TEXT,                        -- 来源数据集（分号分隔）
  last_change  TIMESTAMPTZ,                 -- OpenSanctions 上次更新时间
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- 本地同步时间
);

-- GIN trigram 索引：支持 word_similarity() 模糊搜索
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_os_search   ON sanctions_entries USING GIN (search_text gin_trgm_ops);
CREATE INDEX idx_os_schema   ON sanctions_entries (schema);
CREATE INDEX idx_os_last_chg ON sanctions_entries (last_change);
CREATE INDEX idx_os_name_trgm ON sanctions_entries USING GIN (lower(name) gin_trgm_ops);

-- 在同步日志表加入版本字段（用于跳过无变化的重复下载）
ALTER TABLE sanctions_sync_log ADD COLUMN IF NOT EXISTS version TEXT;

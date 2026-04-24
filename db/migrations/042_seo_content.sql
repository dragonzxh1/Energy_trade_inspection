CREATE TABLE seo_content (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_type TEXT NOT NULL CHECK (content_type IN ('case_study', 'risk_topic', 'country_profile')),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  year INTEGER,

  -- 事实层（用户提供，AI 只读）
  verified_facts JSONB NOT NULL,
  source_urls TEXT[] NOT NULL,
  source_level TEXT NOT NULL DEFAULT 'official' CHECK (source_level IN ('official', 'news', 'analysis')),
  source_kind TEXT NOT NULL DEFAULT 'official' CHECK (source_kind IN ('official', 'OFAC SDN designation', 'DOJ press release')),
  risk_types TEXT[] NOT NULL,
  entities TEXT[] NOT NULL,
  industry_focus TEXT,
  amount_usd NUMERIC(20, 2),
  legal_disclaimer TEXT NOT NULL DEFAULT 'ETI provides risk intelligence based on public sources. This page does not constitute a legal finding or final determination of wrongdoing.',

  -- 表现层（AI 生成）
  narrative TEXT,
  meta_description TEXT,
  meta_keywords TEXT[],
  faq JSONB,
  structured_data JSONB,

  -- 发布控制
  published BOOLEAN NOT NULL DEFAULT false,
  indexed_at TIMESTAMP,
  page_views INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX idx_seo_content_type_published ON seo_content(content_type, published);
CREATE INDEX idx_seo_content_slug ON seo_content(slug);
CREATE INDEX idx_seo_content_year ON seo_content(year DESC);
CREATE INDEX idx_seo_content_entities ON seo_content USING GIN(entities);
CREATE INDEX idx_seo_content_risk_types ON seo_content USING GIN(risk_types);
CREATE INDEX idx_seo_content_source_kind ON seo_content(source_kind);
CREATE INDEX idx_seo_content_amount ON seo_content(amount_usd DESC);
CREATE INDEX idx_seo_content_industry ON seo_content(industry_focus);

-- Listed companies / securities master data + CN disclosure documents (enterprise graph Phase 1)

CREATE TABLE IF NOT EXISTS geo_markets (
  market          TEXT PRIMARY KEY,
  country_code    CHAR(2) NOT NULL,
  default_region_keys TEXT[] NOT NULL DEFAULT '{}',
  default_currency TEXT NOT NULL DEFAULT 'USD',
  display_name    TEXT NOT NULL DEFAULT ''
);

INSERT INTO geo_markets (market, country_code, default_region_keys, default_currency, display_name) VALUES
  ('cn', 'CN', ARRAY['asia', 'global'], 'CNY', 'China A-share'),
  ('hk', 'HK', ARRAY['asia', 'global'], 'HKD', 'Hong Kong'),
  ('us', 'US', ARRAY['america', 'global'], 'USD', 'United States'),
  ('eu', 'EU', ARRAY['eu', 'global'], 'EUR', 'Europe')
ON CONFLICT (market) DO NOTHING;

CREATE TABLE IF NOT EXISTS listed_companies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  country_code    CHAR(2) NOT NULL,
  market          TEXT NOT NULL,
  source          TEXT NOT NULL,
  source_org_id   TEXT NOT NULL,
  legal_name      TEXT,
  short_name      TEXT,
  sector          TEXT,
  industry        TEXT,
  listing_date    DATE,
  delisted_at     TIMESTAMPTZ,
  props_json      JSONB NOT NULL DEFAULT '{}',
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, market, source, source_org_id)
);

CREATE INDEX IF NOT EXISTS idx_listed_companies_market
  ON listed_companies (workspace_id, market, country_code);

CREATE TABLE IF NOT EXISTS listed_securities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id      UUID NOT NULL REFERENCES listed_companies(id) ON DELETE CASCADE,
  country_code    CHAR(2) NOT NULL,
  market          TEXT NOT NULL,
  exchange        TEXT NOT NULL,
  region_keys     TEXT[] NOT NULL DEFAULT '{}',
  symbol          TEXT NOT NULL,
  display_symbol  TEXT,
  name            TEXT,
  currency        TEXT NOT NULL DEFAULT 'CNY',
  security_type   TEXT NOT NULL DEFAULT 'stock',
  is_primary      BOOLEAN NOT NULL DEFAULT TRUE,
  props_json      JSONB NOT NULL DEFAULT '{}',
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, market, exchange, symbol)
);

CREATE INDEX IF NOT EXISTS idx_listed_securities_region
  ON listed_securities USING GIN (region_keys);

CREATE INDEX IF NOT EXISTS idx_listed_securities_company
  ON listed_securities (workspace_id, company_id);

-- Extend company_filings for disclosure pipeline (nullable for legacy earnings-ingest rows)
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS country_code CHAR(2);
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS market TEXT;
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS exchange TEXT;
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES listed_companies(id) ON DELETE SET NULL;
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS security_id UUID REFERENCES listed_securities(id) ON DELETE SET NULL;
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS source_doc_id TEXT;
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS parse_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS parse_method TEXT;
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE company_filings ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_company_filings_source_doc
  ON company_filings (workspace_id, source, source_doc_id)
  WHERE source IS NOT NULL AND source_doc_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS disclosure_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filing_id       UUID NOT NULL REFERENCES company_filings(id) ON DELETE CASCADE,
  file_name       TEXT,
  mime_type       TEXT,
  byte_size       BIGINT,
  source_url      TEXT,
  object_key      TEXT,
  checksum        TEXT,
  extract_status  TEXT NOT NULL DEFAULT 'pending',
  extract_method  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disclosure_documents_filing
  ON disclosure_documents (workspace_id, filing_id);

CREATE TABLE IF NOT EXISTS disclosure_texts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  filing_id       UUID NOT NULL REFERENCES company_filings(id) ON DELETE CASCADE,
  document_id     UUID REFERENCES disclosure_documents(id) ON DELETE SET NULL,
  content_plain   TEXT,
  content_markdown TEXT,
  char_count      INT,
  language        TEXT DEFAULT 'zh',
  extract_method  TEXT,
  extracted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disclosure_texts_filing
  ON disclosure_texts (workspace_id, filing_id);

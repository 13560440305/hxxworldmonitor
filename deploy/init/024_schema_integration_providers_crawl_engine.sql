-- Disclosure sources reference a crawl-engine provider (e.g. firecrawl) configured once under category 'crawl'.

ALTER TABLE integration_providers
  ADD COLUMN IF NOT EXISTS crawl_engine_slug TEXT;

COMMENT ON COLUMN integration_providers.crawl_engine_slug IS
  'For category=disclosure: slug of integration_providers row in category crawl (e.g. firecrawl)';

UPDATE integration_providers
SET crawl_engine_slug = 'firecrawl', updated_at = NOW()
WHERE slug = 'cninfo' AND category = 'disclosure' AND crawl_engine_slug IS NULL;

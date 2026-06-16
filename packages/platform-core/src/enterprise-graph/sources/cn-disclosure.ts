import { getIntegrationProviderCached } from '../../integration-providers-repository.js';
import type { JobContext } from '../../jobs/types.js';
import type { EnterpriseGraphIngestResult } from '../types.js';

/** Hardcoded CNINFO endpoints — not configured in Admin (only site root + crawl credentials are). */
export const CNINFO_DISCLOSURE_PATHS = {
  /** Latest announcements listing (web UI backing API). */
  announcementSearch: '/new/hisAnnouncement/query',
  /** Announcement detail page template — params: stockCode, orgId, announcementId. */
  announcementDetail: '/new/disclosure/detail',
  /** Stock profile / orgId lookup. */
  stockProfile: '/new/information/topSearch/query',
} as const;

/**
 * China A-share disclosure ingest via Firecrawl + CNINFO (no official data API).
 * Pipeline (future): list → detail HTML → PDF/XLS download → parse → kg_entities / company_filings.
 */
export async function runCnDisclosureIngest(_ctx: JobContext): Promise<EnterpriseGraphIngestResult> {
  const firecrawl = await getIntegrationProviderCached('firecrawl');
  const cninfo = await getIntegrationProviderCached('cninfo');

  if (!firecrawl?.enabled || !firecrawl.apiKey) {
    return {
      market: 'cn',
      status: 'stub',
      message: '请在 Admin「数据源配置 → 采集引擎」中启用 Firecrawl 并填写 API Key',
      entitiesUpserted: 0,
      edgesUpserted: 0,
    };
  }

  if (!cninfo?.enabled || !cninfo.baseUrl) {
    return {
      market: 'cn',
      status: 'stub',
      message: '请在 Admin「数据源配置 → 上市公司披露」中启用巨潮资讯网',
      entitiesUpserted: 0,
      edgesUpserted: 0,
    };
  }

  return {
    market: 'cn',
    status: 'stub',
    message:
      'CN disclosure ingest stub — implement Firecrawl scrape + PDF parse in platform:executor '
      + `(cninfo base: ${cninfo.baseUrl}; paths in CNINFO_DISCLOSURE_PATHS)`,
    entitiesUpserted: 0,
    edgesUpserted: 0,
  };
}

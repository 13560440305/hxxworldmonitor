import type { IngestPlugin } from './types.js';

/** Hardcoded CNINFO endpoints — not configured in Admin (only site root + engine binding are). */
export const CNINFO_DISCLOSURE_PATHS = {
  announcementSearch: '/new/hisAnnouncement/query',
  announcementDetail: '/new/disclosure/detail',
  stockProfile: '/new/information/topSearch/query',
} as const;

export const cninfoDisclosurePlugin: IngestPlugin = {
  key: 'cninfo-disclosure',
  displayName: '巨潮资讯网披露采集',
  sourceSlug: 'cninfo',
  tier: 'heavy',
  async run(_ctx, deps) {
    const { source, engine, engineSlug } = deps.binding;
    const cninfo = source ?? deps.source;

    if (!cninfo?.enabled || !cninfo.baseUrl) {
      return {
        market: 'cn',
        status: 'stub',
        message: '请在 Admin「数据源配置 → 上市公司披露」中启用巨潮资讯网',
        entitiesUpserted: 0,
        edgesUpserted: 0,
      };
    }

    if (!engineSlug) {
      return {
        market: 'cn',
        status: 'stub',
        message: '请为巨潮资讯网选择采集引擎（编辑 → 采集引擎）',
        entitiesUpserted: 0,
        edgesUpserted: 0,
      };
    }

    const resolvedEngine = engine ?? deps.engine;
    if (!resolvedEngine?.enabled || !resolvedEngine.apiKey) {
      return {
        market: 'cn',
        status: 'stub',
        message: `请在 Admin「采集引擎」中启用并配置 ${engineSlug} 的 API Key`,
        entitiesUpserted: 0,
        edgesUpserted: 0,
      };
    }

    return {
      market: 'cn',
      status: 'stub',
      message:
        'CN disclosure ingest stub — implement Firecrawl scrape + PDF parse in platform:executor '
        + `(disclosure: ${cninfo.baseUrl}; engine: ${engineSlug} @ ${resolvedEngine.baseUrl})`,
      entitiesUpserted: 0,
      edgesUpserted: 0,
    };
  },
};

import type { IngestPlugin } from './types.js';
import { runCninfoDisclosurePipeline } from '../enterprise-graph/cninfo/pipeline.js';

export const CNINFO_DISCLOSURE_PATHS = {
  announcementSearch: '/new/hisAnnouncement/query',
  announcementDetail: '/new/disclosure/detail',
  stockProfile: '/new/information/topSearch/query',
} as const;

export const cninfoDisclosurePlugin: IngestPlugin = {
  key: 'cninfo-disclosure',
  handlerKey: 'disclosure-ingest-cn',
  displayName: '巨潮资讯网披露采集',
  sourceSlug: 'cninfo',
  requiresBinding: true,
  tier: 'heavy',
  async run(ctx, deps) {
    const binding = deps!.binding;
    const { source, engine, engineSlug } = binding;
    const cninfo = source ?? deps!.source;

    if (!cninfo?.enabled || !cninfo.baseUrl) {
      return {
        market: 'cn',
        status: 'stub',
        message: '请在 Admin「数据源配置 → 上市公司披露」中启用巨潮资讯网',
        entitiesUpserted: 0,
        edgesUpserted: 0,
      };
    }

    const resolvedEngine = engine ?? deps.engine;
    const engineReady = Boolean(
      engineSlug && resolvedEngine?.enabled && resolvedEngine.apiKey,
    );

    try {
      const stats = await runCninfoDisclosurePipeline(ctx, {
        cninfoBaseUrl: cninfo.baseUrl,
        engine: engineReady ? resolvedEngine! : null,
        workspaceId: ctx.workspaceId,
      });

      const engineHint = engineReady
        ? ''
        : '（未配置 Firecrawl：仅 direct HTTP 下载/PDF 解析，失败项不会走 Firecrawl 降级）';

      return {
        status: stats.status,
        market: stats.market,
        message: `CNINFO ingest: listed=${stats.listed} new=${stats.filingsNew} skipped=${stats.skippedExisting} extracted=${stats.extracted} failed=${stats.failed}${engineHint}`,
        entitiesUpserted: stats.entitiesUpserted,
        edgesUpserted: stats.edgesUpserted,
        ...stats,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        market: 'cn',
        status: 'error',
        message,
        entitiesUpserted: 0,
        edgesUpserted: 0,
      };
    }
  },
};

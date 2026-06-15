import {
  runEarningsIngest,
  runKnowledgeGraphBuild,
  runStockNewsIngest,
} from '../../equity-ingest.js';
import { runColdTierPass } from '../../cold-tier-worker.js';
import { runAllVariantIngest, runFastVariantIngest, runRssIngest, runRssIngestFast } from '../../rss-ingest.js';
import { runEmbeddingBatch } from '../../research-service.js';
import { deliverAllEnabledSubscriptions, runMatchPassAll } from '../../subscription-delivery-service.js';
import { isHxxbotConfigured } from '../../../_shared/hxxbot-config.js';
import type { JobContext, JobHandler } from '../types.js';

const subscriptionHandler: JobHandler = {
  key: 'subscription-match-deliver',
  tier: 'batch',
  async run(ctx: JobContext) {
    const mode = String(ctx.payload.mode ?? 'both');
    const forceDeliver = ctx.payload.forceDeliver === true;
    const stats: Record<string, unknown> = { mode };

    if (mode === 'match' || mode === 'both') {
      const match = await runMatchPassAll();
      stats.subscriptions = match.subscriptions;
      stats.newMatches = match.totalMatched;
    }

    if (mode === 'deliver' || mode === 'both') {
      if (!isHxxbotConfigured()) {
        return { stats: { ...stats, deliverSkipped: true, reason: 'HXXBOT not configured' } };
      }
      const deliver = await deliverAllEnabledSubscriptions({
        forceDeliver: mode === 'deliver' ? forceDeliver : false,
      });
      stats.deliverProcessed = deliver.processed;
      stats.deliverErrors = deliver.errors.length;
    }

    return { stats };
  },
};

const coldTierHandler: JobHandler = {
  key: 'cold-tier-archive',
  tier: 'batch',
  async run() {
    const result = await runColdTierPass();
    return { stats: { ...result } };
  },
};

const rssIngestFastHandler: JobHandler = {
  key: 'rss-ingest-fast',
  tier: 'batch',
  async run(ctx: JobContext) {
    if (ctx.payload.all === true) {
      const results = await runFastVariantIngest();
      return { stats: { results } };
    }
    const result = await runRssIngestFast(
      String(ctx.payload.variant ?? 'full'),
      String(ctx.payload.lang ?? 'en'),
    );
    return { stats: { result } };
  },
};

const rssIngestHandler: JobHandler = {
  key: 'rss-ingest-full',
  tier: 'batch',
  async run(ctx: JobContext) {
    if (ctx.payload.all === true) {
      const results = await runAllVariantIngest();
      return { stats: { results } };
    }
    const result = await runRssIngest(
      String(ctx.payload.variant ?? 'full'),
      String(ctx.payload.lang ?? 'en'),
    );
    return { stats: { result } };
  },
};

const embeddingBatchHandler: JobHandler = {
  key: 'embedding-batch',
  tier: 'batch',
  async run(ctx: JobContext) {
    const batchSize = ctx.payload.batchSize != null ? Number(ctx.payload.batchSize) : undefined;
    const result = await runEmbeddingBatch({ batchSize });
    return { stats: { result } };
  },
};

const stockNewsHandler: JobHandler = {
  key: 'stock-news-ingest',
  tier: 'batch',
  async run(ctx: JobContext) {
    const lang = String(ctx.payload.lang ?? 'en');
    const categories = Array.isArray(ctx.payload.categories)
      ? ctx.payload.categories.map(String)
      : undefined;
    const result = await runStockNewsIngest({ lang, categories });
    return { stats: { ...result } };
  },
};

const earningsHandler: JobHandler = {
  key: 'earnings-ingest',
  tier: 'batch',
  async run(ctx: JobContext) {
    const lang = String(ctx.payload.lang ?? 'en');
    const result = await runEarningsIngest({ lang });
    return { stats: { ...result } };
  },
};

const knowledgeGraphHandler: JobHandler = {
  key: 'knowledge-graph-build',
  tier: 'heavy',
  async run(ctx: JobContext) {
    const lookbackHours = ctx.payload.lookbackHours != null
      ? Number(ctx.payload.lookbackHours)
      : undefined;
    const sinceRaw = ctx.payload.cycleStart ?? ctx.payload.since;
    const since = typeof sinceRaw === 'string' ? new Date(sinceRaw) : undefined;
    const result = await runKnowledgeGraphBuild({
      lookbackHours,
      since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    });
    return { stats: { ...result, dag: ctx.payload.dag === true } };
  },
};

const HANDLERS: JobHandler[] = [
  subscriptionHandler,
  coldTierHandler,
  rssIngestFastHandler,
  rssIngestHandler,
  embeddingBatchHandler,
  stockNewsHandler,
  earningsHandler,
  knowledgeGraphHandler,
];

const byKey = new Map(HANDLERS.map((h) => [h.key, h]));

export function getJobHandler(key: string): JobHandler | undefined {
  return byKey.get(key);
}

export function listJobHandlers(): JobHandler[] {
  return [...HANDLERS];
}

export function registerJobHandler(handler: JobHandler): void {
  byKey.set(handler.key, handler);
}

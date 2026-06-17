import { deliverAllEnabledSubscriptions, runMatchPassAll } from '../../subscription-delivery-service.js';
import { isHxxbotConfigured } from '@hxxworldmonitor/shared/hxxbot-config.js';
import { listIngestPlugins } from '../../ingest-plugins/registry.js';
import { runIngestPlugin } from '../../ingest-plugins/run-ingest-plugin.js';
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

/** One JobHandler per registered ingest plugin — executor dispatches via runIngestPlugin. */
function ingestHandlersFromRegistry(): JobHandler[] {
  return listIngestPlugins().map((meta) => ({
    key: meta.handlerKey ?? meta.key,
    tier: meta.tier,
    async run(ctx: JobContext) {
      const result = await runIngestPlugin(meta.key, ctx);
      return { stats: { ...result } };
    },
  }));
}

const HANDLERS: JobHandler[] = [
  subscriptionHandler,
  ...ingestHandlersFromRegistry(),
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
  if (!HANDLERS.some((h) => h.key === handler.key)) {
    HANDLERS.push(handler);
  }
}

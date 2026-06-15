import { getDefaultWorkspaceId } from '../../_shared/db.js';
import type { PlatformLogger } from '../../_shared/platform-logger.js';
import {
  enqueueJobRun,
  listDueJobDefinitions,
  tryAcquireSchedulerLock,
  releaseSchedulerLock,
  upsertJobDefinition,
} from './job-repository.js';
import type { JobDefinitionSeed } from './types.js';

export const DEFAULT_JOB_DEFINITIONS: JobDefinitionSeed[] = [
  {
    handlerKey: 'subscription-match-deliver',
    displayName: 'Subscription match & deliver',
    tier: 'batch',
    scheduleKind: 'interval',
    intervalSeconds: 3600,
    timezone: 'UTC',
    maxConcurrency: 1,
    timeoutSec: 1800,
  },
  {
    handlerKey: 'cold-tier-archive',
    displayName: 'Cold tier archive',
    tier: 'batch',
    scheduleKind: 'cron',
    cronExpr: '0 3 * * *',
    timezone: 'UTC',
    maxConcurrency: 1,
    timeoutSec: 3600,
  },
  {
    handlerKey: 'rss-ingest-fast',
    displayName: 'RSS ingest (fast tier)',
    tier: 'batch',
    scheduleKind: 'interval',
    intervalSeconds: 600,
    timezone: 'UTC',
    enabled: true,
    maxConcurrency: 1,
    timeoutSec: 90,
  },
  {
    handlerKey: 'rss-ingest-full',
    displayName: 'RSS ingest (full tier)',
    tier: 'batch',
    scheduleKind: 'interval',
    intervalSeconds: 86400,
    enabled: false,
    maxConcurrency: 1,
    timeoutSec: 120,
  },
  {
    handlerKey: 'embedding-batch',
    displayName: 'Embedding batch',
    tier: 'batch',
    scheduleKind: 'interval',
    intervalSeconds: 300,
    enabled: false,
    maxConcurrency: 1,
    timeoutSec: 7200,
  },
  {
    handlerKey: 'stock-news-ingest',
    displayName: 'Stock news ingest',
    tier: 'batch',
    scheduleKind: 'cron',
    cronExpr: '*/15 9-16 * * 1-5',
    timezone: 'America/New_York',
    enabled: false,
    maxConcurrency: 1,
    timeoutSec: 900,
    payload: { markets: ['US'] },
  },
  {
    handlerKey: 'earnings-ingest',
    displayName: 'Earnings / filings ingest',
    tier: 'batch',
    scheduleKind: 'cron',
    cronExpr: '0 6 * * *',
    timezone: 'Asia/Shanghai',
    enabled: false,
    maxConcurrency: 1,
    timeoutSec: 1800,
  },
  {
    handlerKey: 'knowledge-graph-build',
    displayName: 'Enterprise knowledge graph build',
    tier: 'heavy',
    scheduleKind: 'cron',
    cronExpr: '0 2 * * *',
    timezone: 'Asia/Shanghai',
    enabled: false,
    maxConcurrency: 1,
    timeoutSec: 14400,
  },
];

export async function seedJobDefinitions(log?: PlatformLogger): Promise<number> {
  const workspaceId = getDefaultWorkspaceId();
  for (const seed of DEFAULT_JOB_DEFINITIONS) {
    await upsertJobDefinition(workspaceId, seed);
  }
  log?.info('job definitions seeded', { count: DEFAULT_JOB_DEFINITIONS.length });
  return DEFAULT_JOB_DEFINITIONS.length;
}

export async function runSchedulerTick(log: PlatformLogger): Promise<number> {
  const locked = await tryAcquireSchedulerLock();
  if (!locked) {
    log.debug('scheduler tick skipped (another leader holds lock)');
    return 0;
  }

  try {
    const due = await listDueJobDefinitions();
    let enqueued = 0;
    for (const def of due) {
      await enqueueJobRun(def);
      enqueued += 1;
      log.info('job enqueued', { handler: def.handler_key, definitionId: def.id });
    }
    return enqueued;
  } finally {
    await releaseSchedulerLock();
  }
}

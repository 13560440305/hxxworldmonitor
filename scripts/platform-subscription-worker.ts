import { loadEnvLocal } from '../server/_shared/load-env.js';

loadEnvLocal();

import { closePool, isDatabaseEnabled } from '../server/_shared/db.js';
import { isHxxbotConfigured, refreshHxxbotConfigCache } from '../server/_shared/hxxbot-config.js';
import { closeRedisClient } from '../server/_shared/redis-client.js';
import {
  deliverAllEnabledSubscriptions,
  runMatchPassAll,
} from '../server/platform/subscription-delivery-service.js';
import { ensurePlatformDatabaseReady } from '../server/platform/platform-db-startup.js';
import { createPlatformLogger, installProcessLogHandlers } from '../server/_shared/platform-logger.js';

declare const process: { env: Record<string, string | undefined> };

const log = createPlatformLogger('platform-subscription');
installProcessLogHandlers(log);

const INTERVAL_MS = Number(process.env.PLATFORM_SUBSCRIPTION_INTERVAL_MS ?? 3_600_000);

async function runOnce(opts?: { forceDeliver?: boolean }): Promise<void> {
  if (!isDatabaseEnabled()) {
    throw new Error('DATABASE_URL not configured');
  }
  const match = await runMatchPassAll();
  log.info('match pass complete', {
    subscriptions: match.subscriptions,
    newMatches: match.totalMatched,
  });

  if (!isHxxbotConfigured()) {
    log.warn('HXXBOT not configured — skip email deliver');
    return;
  }

  const deliver = await deliverAllEnabledSubscriptions({
    forceDeliver: opts?.forceDeliver ?? false,
    workerIntervalMs: INTERVAL_MS,
  });
  const sent = deliver.results.filter((r) => !r.skipped && !r.error).length;
  const skipped = deliver.results.filter((r) => r.skipped).length;
  log.info('deliver pass complete', {
    processed: deliver.processed,
    sent,
    skipped,
    errorCount: deliver.errors.length,
  });
  for (const e of deliver.errors) {
    log.error('subscription deliver failed', e.error, { subscriptionId: e.subscriptionId });
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  const matchOnly = process.argv.includes('--match-only');
  const deliverOnly = process.argv.includes('--deliver-only');

  if (isDatabaseEnabled()) {
    await ensurePlatformDatabaseReady({ logger: log });
    try {
      await refreshHxxbotConfigCache();
    } catch (err) {
      log.warn('HXXBOT config load from database failed', err);
    }
  }

  try {
    if (once) {
      if (matchOnly) {
        const match = await runMatchPassAll();
        log.info('match-only complete', { newMatches: match.totalMatched });
      } else if (deliverOnly) {
        const deliver = await deliverAllEnabledSubscriptions({ forceDeliver: true, workerIntervalMs: INTERVAL_MS });
        log.info('deliver-only complete', { processed: deliver.processed, errors: deliver.errors.length });
      } else {
        await runOnce({ forceDeliver: true });
      }
    } else {
      log.info('worker started', { intervalMs: INTERVAL_MS });
      while (true) {
        await runOnce().catch((err) => log.error('scheduled run failed', err));
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
      }
    }
  } finally {
    await closePool();
    await closeRedisClient();
  }
}

main().catch((err) => {
  log.error('fatal', err);
  process.exit(1);
});

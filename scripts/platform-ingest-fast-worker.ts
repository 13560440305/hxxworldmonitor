import { loadEnvLocal } from '../server/_shared/load-env.js';

loadEnvLocal();

import { closePool, isDatabaseEnabled } from '../server/_shared/db.js';
import { runFastVariantIngest } from '../server/platform/rss-ingest.js';
import { ensurePlatformDatabaseReady } from '../server/platform/platform-db-startup.js';
import { createPlatformLogger, installProcessLogHandlers } from '../server/_shared/platform-logger.js';

declare const process: { env: Record<string, string | undefined> };

const log = createPlatformLogger('platform-ingest-fast');
installProcessLogHandlers(log);

const INTERVAL_MS = Number(process.env.PLATFORM_INGEST_FAST_INTERVAL_MS ?? 300_000);
const RUN_ONCE = process.argv.includes('--once');

async function tick(): Promise<void> {
  const started = Date.now();
  log.info('starting fast ingest run');
  try {
    const results = await runFastVariantIngest();
    for (const r of results) {
      log.info('fast ingest complete', {
        tier: r.tier,
        variant: r.variant,
        lang: r.lang,
        feeds: r.feedsTotal,
        collected: r.itemsCollected,
        upserted: r.itemsUpserted,
        errors: r.errors,
      });
    }
    log.info('fast ingest run finished', { durationMs: Date.now() - started });
  } catch (err) {
    log.error('fast ingest run failed', err);
  }
}

async function main(): Promise<void> {
  if (!isDatabaseEnabled()) {
    log.error('DATABASE_URL is required');
    process.exit(1);
  }

  await ensurePlatformDatabaseReady({ logger: log });

  await tick();

  if (RUN_ONCE) {
    await closePool();
    return;
  }

  setInterval(() => { void tick(); }, INTERVAL_MS);
  log.info('scheduled fast ingest worker', { intervalMs: INTERVAL_MS });
}

process.on('SIGINT', () => { void closePool().then(() => process.exit(0)); });
process.on('SIGTERM', () => { void closePool().then(() => process.exit(0)); });

main().catch((err) => {
  log.error('fatal', err);
  process.exit(1);
});
